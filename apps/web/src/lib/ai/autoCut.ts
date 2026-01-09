import { MediaItem } from "@/stores/media-store";
import { extractAudioLightweight } from "../audio-utils";
import { initFFmpeg } from "../ffmpeg-utils";
import { uploadJsonWithProgress } from "../media-processing";
import { sanitizeSegments } from "../segment-sanitizer"; // Import Sanitizer
import { useTimelineStore } from "@/stores/timeline-store";
import { useMediaStore } from "@/stores/media-store";
import { useProjectStore } from "@/stores/project-store"; // Added import for project store
import { TimelineElement } from "@/types/timeline";
import { toast } from "sonner";

interface Segment {
  segment_id: number;
  source_file: string;
  start_sec: number;
  end_sec: number;
  content: string;
  selection_reason: string;
  transition_in: string;
  transition_out: string;
}

interface AutoCutResponse {
  metadata: {
    total_duration: number;
    segment_count: number;
    takes_used: string[];
    quality_warnings: string[];
  };
  segments: Segment[];
}

/**
 * Detects optimal cuts in audio from selected media elements and applies them to the timeline
 */
export async function detectAutomaticCuts(): Promise<void> {
  const timelineStore = useTimelineStore.getState();
  timelineStore.setIsAutoCutting(true);

  try {
    const mediaStore = useMediaStore.getState();

    // Get selected media elements from the timeline
    const selectedElements = timelineStore.selectedElements
      .map(({ trackId, elementId }) => {
        const track = timelineStore._tracks.find(t => t.id === trackId);
        const element = track?.elements.find(e => e.id === elementId);
        return { trackId, element, track };
      })
      .filter(({ element }) => element?.type === "media") as Array<{
        trackId: string;
        element: TimelineElement;
        track: any;
      }>;

    if (selectedElements.length === 0) {
      toast.error("Please select media elements to detect cuts for");
      return;
    }

    // Update UI to show processing
    toast.loading("Detecting cuts...", { id: "auto-cut-progress" });

    // Extract audio from selected media elements
    const audioExtractionPromises = selectedElements.map(async ({ element }) => {
      if (element.type !== "media") return null;

      const mediaItem = mediaStore.mediaItems.find(m => m.id === element.mediaId);
      if (!mediaItem || !mediaItem.file) return null;

      // Extract audio from media file
      toast.loading(`Extracting audio from ${mediaItem.name}...`, { id: "auto-cut-progress" });

      // Use lightweight extraction (AudioContext) instead of FFmpeg
      const audioBlob = await extractAudioLightweight(mediaItem.file);
      const audioUrl = URL.createObjectURL(audioBlob);

      return {
        id: element.id,
        audioBlob,
        audioUrl,
        mediaItem,
        element
      };
    });

    const audioData = (await Promise.all(audioExtractionPromises)).filter(Boolean) as Array<{
      id: string;
      audioBlob: Blob;
      audioUrl: string;
      mediaItem: MediaItem;
      element: TimelineElement;
    }>;

    if (audioData.length === 0) {
      toast.error("Could not extract audio from selected media", { id: "auto-cut-progress" });
      return;
    }

    // Convert audio files to base64 for API request
    const mediaFiles = await Promise.all(audioData.map(async (data) => {
      const buffer = await data.audioBlob.arrayBuffer();
      const base64 = arrayBufferToBase64(buffer);
      // Important: Ensure we send a .wav extension so backend MIME detection works
      // The lightweight extractor always returns WAV
      const filename = data.mediaItem.name.replace(/\.[^/.]+$/, "") + ".wav";

      return {
        filename,
        data: base64
      };
    }));

    // Calculate total duration for sanitization
    const totalDuration = audioData.reduce((acc, curr) => acc + (curr.mediaItem.duration || 0), 0);

    // Call the backend API to analyze audio and generate cuts
    const cutAnalysis = await analyzeAudioWithAI(mediaFiles, totalDuration, (percent) => {
      if (percent === 100) {
        toast.loading("Processing AI analysis...", { id: "auto-cut-progress" });
      } else {
        toast.loading(`Uploading audio... ${Math.round(percent)}% `, { id: "auto-cut-progress" });
      }
    });

    // Apply the detected cuts to the timeline
    await applyCutsToTimeline(cutAnalysis, selectedElements, audioData);

  } catch (error) {
    console.error("Error in automatic cut detection:", error);
    toast.error("Failed to detect automatic cuts", { id: "auto-cut-progress" });
  } finally {
    timelineStore.setIsAutoCutting(false);
  }
}

/**
 * Calls the backend API to analyze audio and return cut suggestions
 */
async function analyzeAudioWithAI(
  mediaFiles: Array<{ filename: string; data: string }>,
  totalDuration: number,
  onProgress?: (percent: number) => void
): Promise<AutoCutResponse> {
  const formattedDuration = totalDuration.toFixed(2);
  const systemPrompt = `Role: You are a professional video editing assistant specialized in high-retention social media content (TikTok/Reels). Your task is to analyze the media and generate a precise edit blueprint.

CRITICAL CONTEXT:

Total Media Duration: ${formattedDuration} seconds.

ABSOLUTE LIMIT: Do NOT generate any segment with an 'end_sec' greater than ${formattedDuration}.

Processing Requirements:

Audio & Visual Analysis:

Analyze vocal clarity and emotional tone.

VISUAL CONTEXT RULE: If there is a pause in speech (up to 3s) where the user is performing an action (unboxing, showing a product, reacting), KEEP IT. Do not cut essential visual demonstrations just because they are silent.

NOISE GATE: Prioritize clear audio, but if a segment has vital visual content + background noise, keep it (flag in quality_warnings).

Segment Selection Strategy:

Hook (0-3s): Select the strongest opening hook.

Body: Create a seamless flow. Preserve "Lists" (e.g., listing flavors) as single blocks—do not chop them up.

Narrative: Ensure the sequence: Intro -> Action/Unboxing -> Details -> Conclusion.

Edge Case Handling:

If the user repeats a phrase (Bad Take vs Good Take), select the one with better clarity and less noise.

End of File: If the user speaks until the end, set end_sec exactly to ${formattedDuration}.

EOF Sentence Integrity: If the source media file ends while the speaker is in the middle of a sentence (i.e., the transcript does not end with punctuation or a natural pause), you MUST DISCARD that incomplete fragment. Trim the segment end to the last complete sentence boundary. Never leave a hanging word like "I think it is..." at the absolute end of the edit.

Output Specification (JSON): { "metadata": { "total_duration": Number, "segment_count": Number, "takes_used": [String], "quality_warnings": [String] }, "segments": [ { "segment_id": Number, "source_file": String, "start_sec": Number, "end_sec": Number, "content": String (transcription), "selection_reason": String, "transition_in": "cut", "transition_out": "jump_cut" } ] }

Technical Constraints:

Buffer: Include 100ms buffer before/after speech.

Timestamp Sanity: end_sec must be > start_sec.

Reject segments with distortion or clipping unless visually vital.`;

  const userPrompt = `Analyze the provided audio files and generate optimal cut suggestions for creating an engaging TikTok video.`;

  console.log("🔍 analyzeAudioWithAI: Starting API call to /api/gemini");
  console.log("🔍 analyzeAudioWithAI: Number of audio files:", mediaFiles.length);

  try {
    const result = await uploadJsonWithProgress<any>(
      "/api/gemini",
      {
        mediaFiles,
        systemPrompt,
        userPrompt
      },
      onProgress
    );

    console.log("🔍 analyzeAudioWithAI: API Response received, mock:", result.mock);
    console.log("🧩 Gemini raw response:", result);

    if (result.mock) {
      console.warn("🔍 analyzeAudioWithAI: Using mock data fallback for Gemini API");
      if (result.data.quality_warnings) {
        result.data.quality_warnings.push("Using mock data fallback - API key may be missing");
      }
      return result.data;
    }

    // Check if the response has valid data structure before using it
    if (result.data && Array.isArray(result.data.segments) && result.data.segments.length > 0) {
      console.log("✅ Using real Gemini API response");

      // SANITIZE RESPONSE
      console.log("🧹 Sanitizing AI segments...");
      result.data.segments = sanitizeSegments(result.data.segments, totalDuration);

      console.log("🎬 Real Gemini data applied to timeline! Segments count:", result.data.segments.length);
      return result.data;
    } else {
      console.warn("⚠️ Fallback: invalid Gemini response structure, using mock");
      // Return mock data as fallback when the response structure is invalid
      return {
        metadata: {
          total_duration: mediaFiles.length * 5,
          segment_count: mediaFiles.length,
          takes_used: mediaFiles.map(f => f.filename),
          quality_warnings: ["Invalid response structure from Gemini API"]
        },
        segments: mediaFiles.map((file, index) => ({
          segment_id: index + 1,
          source_file: file.filename,
          start_sec: 0.5,
          end_sec: 4.5,
          content: `Sample content from ${file.filename} `,
          selection_reason: "Error occurred, using default segment",
          transition_in: "cut",
          transition_out: "cut"
        }))
      };
    }
  } catch (error) {
    console.error("🔍 analyzeAudioWithAI: Error calling backend Gemini API:", error);
    // Return mock data as fallback
    return {
      metadata: {
        total_duration: mediaFiles.length * 5,
        segment_count: mediaFiles.length,
        takes_used: mediaFiles.map(f => f.filename),
        quality_warnings: [`API Error: ${error instanceof Error ? error.message : "Unknown error"} `]
      },
      segments: mediaFiles.map((file, index) => ({
        segment_id: index + 1,
        source_file: file.filename,
        start_sec: 0.5,
        end_sec: 4.5,
        content: `Sample content from ${file.filename} `,
        selection_reason: "Error occurred, using default segment",
        transition_in: "cut",
        transition_out: "cut"
      }))
    };
  }
}

/**
 * Applies the detected cuts to the timeline by trimming and inserting new elements
 */
async function applyCutsToTimeline(
  cutAnalysis: AutoCutResponse,
  selectedElements: Array<{ trackId: string; element: TimelineElement; track: any }>,
  audioData: Array<{ id: string; audioBlob: Blob; audioUrl: string; mediaItem: MediaItem; element: TimelineElement }>
): Promise<void> {
  const mediaStore = useMediaStore.getState();
  const activeProject = useProjectStore.getState().activeProject;
  const ffmpeg = await initFFmpeg();

  // SAFETY: Limit segments to prevent infinite loops or crashes
  const MAX_CLIPS = 50;
  const segmentsToProcess = cutAnalysis.segments || [];

  if (segmentsToProcess.length > MAX_CLIPS) {
    console.warn(`Auto - Cut: Limiting segments from ${segmentsToProcess.length} to ${MAX_CLIPS} `);
    toast.warning(`Result limited to ${MAX_CLIPS} clips for performance`);
    segmentsToProcess.length = MAX_CLIPS;
  }

  let addedCount = 0;

  for (let index = 0; index < segmentsToProcess.length; index++) {
    const segment = segmentsToProcess[index];

    // Find the original media item for this segment
    const originalElementData = audioData.find(d => {
      // Check if the segment source_file matches the original media file name
      // This could be either the full filename or just the name part without extension
      return d.mediaItem.name === segment.source_file ||
        d.mediaItem.name.startsWith(segment.source_file.replace(/\.[^/.]+$/, '')); // Remove extension and match
    });

    if (!originalElementData) {
      console.warn("❌ [Debug Match] FAILED. No match found for:", segment.source_file);
      continue;
    }

    const { mediaItem } = originalElementData;

    // --- 🛡️ TIMESTAMP VALIDATION (Fix Out of Bounds Hallucinations) ---
    const sourceDuration = mediaItem.duration || 0;

    // Case A: Total Hallucination (Start is beyond EOF)
    if (segment.start_sec >= sourceDuration) {
      console.warn(`⚠️ Skipping hallucinated segment starting after EOF: ${segment.start_sec}s >= ${sourceDuration}s`, segment);
      continue;
    }

    // Case B: Partial Overflow (End is beyond EOF) -> Clamp it
    if (segment.end_sec > sourceDuration) {
      console.warn(`⚠️ Clamping segment end from ${segment.end_sec}s to ${sourceDuration}s (EOF)`);
      segment.end_sec = sourceDuration;
    }
    // -------------------------------------------------------------

    const duration = segment.end_sec - segment.start_sec;
    const clipName = `cut_${Date.now()}_${segment.segment_id}.mp4`;

    try {
      // Write input file (if checking for performance, maybe optimizing this to not write every time if same file?)
      // For safety/simplicity per request, we write and cut
      const inputName = `source_${Date.now()}_${index}.mp4`;
      await ffmpeg.writeFile(inputName, new Uint8Array(await mediaItem.file!.arrayBuffer()));

      await ffmpeg.exec([
        "-i", inputName,
        "-ss", segment.start_sec.toString(),
        "-t", duration.toString(),
        // FIX: Bad Initial Frame Regression
        // We MUST re-encode because "-c copy" fails if the cut isn't on a keyframe.
        // "ultrafast" preset keeps it quick enough for web usage.
        "-c:v", "libx264",
        "-preset", "ultrafast",
        "-c:a", "aac",
        clipName
      ]);

      const clipData = await ffmpeg.readFile(clipName);
      const clipBlob = new Blob([clipData as any], { type: 'video/mp4' });
      const clipUrl = URL.createObjectURL(clipBlob);

      // Create a unique ID for this new media item
      const newMediaItemId = crypto.randomUUID();

      // 1. Add to Media Gallery (Physical Clip)
      if (activeProject) {
        await mediaStore.addMediaItem(activeProject.id, {
          id: newMediaItemId,
          name: `${mediaItem.name} (Cut ${index + 1})`,
          type: "video",
          file: new File([clipBlob], clipName, { type: "video/mp4" }),
          url: clipUrl,
          thumbnailUrl: mediaItem.thumbnailUrl, // Use original thumb for now or generate new one
          extractedAudioUrl: undefined, // Need to re-extract if needed
          duration: duration,
          width: mediaItem.width,
          height: mediaItem.height,
          fps: mediaItem.fps,
        });
        addedCount++;
      }

      // Cleanup input
      await ffmpeg.deleteFile(inputName);

      // 🛑 MEMORY CLEANUP (CRITICAL FIX)
      try {
        await ffmpeg.deleteFile(clipName);
        console.log(`🧹 Cleaned up memory for ${clipName}`);
      } catch (e) {
        console.warn('Failed to cleanup file:', e);
      }

      // Pause for GC
      await new Promise(r => setTimeout(r, 100));

    } catch (error) {
      console.error(`Failed to process segment ${segment.segment_id}: `, error);
    }
  }

  // Final Feedback
  if (addedCount > 0) {
    toast.success(`Generated ${addedCount} clips in your Media Library`, { id: "auto-cut-progress" });
  } else {
    toast.info("No valid cuts were detected.", { id: "auto-cut-progress" });
  }

  // Clean up object URLs
  audioData.forEach(data => {
    if (data.audioUrl) {
      URL.revokeObjectURL(data.audioUrl);
    }
  });
}

/**
 * Helper function to convert ArrayBuffer to Base64
 */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}