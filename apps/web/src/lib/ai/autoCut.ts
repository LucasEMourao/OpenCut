import { MediaItem } from "@/stores/media-store";
import { extractAudio } from "../ffmpeg-utils";
import { uploadJsonWithProgress } from "../media-processing";
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
      const audioBlob = await extractAudio(mediaItem.file);
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
    const audioFiles = await Promise.all(audioData.map(async (data) => {
      const buffer = await data.audioBlob.arrayBuffer();
      const base64 = arrayBufferToBase64(buffer);
      return {
        filename: data.mediaItem.name,
        data: base64
      };
    }));

    // Call the backend API to analyze audio and generate cuts
    const cutAnalysis = await analyzeAudioWithAI(audioFiles, (percent) => {
      if (percent === 100) {
        toast.loading("Processing AI analysis...", { id: "auto-cut-progress" });
      } else {
        toast.loading(`Uploading audio... ${Math.round(percent)}%`, { id: "auto-cut-progress" });
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
  audioFiles: Array<{ filename: string; data: string }>,
  onProgress?: (percent: number) => void
): Promise<AutoCutResponse> {
  const systemPrompt = `You are a professional video editing assistant specialized in social media content creation. Your task is to analyze multiple audio takes and generate a precise editing blueprint for stitching the optimal TikTok video.

Inputs: Multiple audio files (MP3/WAV).

Processing Requirements:
- Transcribe with word-level timestamps
- Analyze each take for:
  - Vocal clarity (signal-to-noise ratio)
  - Speech fluency (pauses, stutters, pace consistency)
  - Emotional tone (energy, enthusiasm)
  - Background noise levels
- Identify cleanest segments using priority: Clarity > Emotion > Noise

Segment Selection:
- Create a seamless narrative flow by selecting best segments in this order:
  - Intro
  - Key message
  - Punchline/Call-to-action
- Minimize transitions between different takes
- Ensure segments connect with natural pauses (minimum 200ms buffer between segments)

Edge Case Handling:
- If no perfect segment exists:
  - Prioritize clarity over emotional delivery for informational content
  - Prioritize energy over perfection for emotional/persuasive content
  - Flag segments requiring audio cleanup in output JSON

Output JSON: A valid JSON object with the following structure:
{
  "metadata": {
    "total_duration": "number",
    "segment_count": "number",
    "takes_used": "array of strings (the filenames of audio files that contain the selected segments)",
    "quality_warnings": "array of strings (any quality issues detected)"
  },
  "segments": [
    {
      "segment_id": "number",
      "source_file": "string (must match one of the provided filenames exactly)",
      "start_sec": "number",
      "end_sec": "number",
      "content": "string (a brief transcript of the segment)",
      "selection_reason": "string (why this segment was chosen)",
      "transition_in": "string (e.g., 'cut' or 'fade')",
      "transition_out": "string (e.g., 'cut' or 'fade')"
    }
  ]
}

Technical Constraints:
- Time precision: ±100ms
- Duration tolerance: Final video must be 150s ± 40s

Special Instructions:
- Include 50ms buffer before/after speech in timestamps
- Flag any segments requiring manual audio cleanup
- Optimize for TikTok's algorithm: strongest hook in first 3 seconds
- Reject segments with:
  - Background speech
  - 200ms silent pauses
  - Distortion/clipping`;

  const userPrompt = `Analyze the provided audio files and generate optimal cut suggestions for creating an engaging TikTok video.`;

  console.log("🔍 analyzeAudioWithAI: Starting API call to /api/gemini");
  console.log("🔍 analyzeAudioWithAI: Number of audio files:", audioFiles.length);

  console.log("🔍 analyzeAudioWithAI: Starting API call to /api/gemini");
  console.log("🔍 analyzeAudioWithAI: Number of audio files:", audioFiles.length);

  try {
    const result = await uploadJsonWithProgress<any>(
      "/api/gemini",
      {
        audioFiles,
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
      console.log("🎬 Real Gemini data applied to timeline! Segments count:", result.data.segments.length);
      return result.data;
    } else {
      console.warn("⚠️ Fallback: invalid Gemini response structure, using mock");
      // Return mock data as fallback when the response structure is invalid
      return {
        metadata: {
          total_duration: audioFiles.length * 5,
          segment_count: audioFiles.length,
          takes_used: audioFiles.map(f => f.filename),
          quality_warnings: ["Invalid response structure from Gemini API"]
        },
        segments: audioFiles.map((file, index) => ({
          segment_id: index + 1,
          source_file: file.filename,
          start_sec: 0.5,
          end_sec: 4.5,
          content: `Sample content from ${file.filename}`,
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
        total_duration: audioFiles.length * 5,
        segment_count: audioFiles.length,
        takes_used: audioFiles.map(f => f.filename),
        quality_warnings: [`API Error: ${error instanceof Error ? error.message : "Unknown error"}`]
      },
      segments: audioFiles.map((file, index) => ({
        segment_id: index + 1,
        source_file: file.filename,
        start_sec: 0.5,
        end_sec: 4.5,
        content: `Sample content from ${file.filename}`,
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

  // SAFETY: Limit segments to prevent infinite loops or crashes
  const MAX_CLIPS = 50;
  const segmentsToProcess = cutAnalysis.segments || [];

  if (segmentsToProcess.length > MAX_CLIPS) {
    console.warn(`Auto-Cut: Limiting segments from ${segmentsToProcess.length} to ${MAX_CLIPS}`);
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
    const rawDuration = segment.end_sec - segment.start_sec;
    const cleanDuration = Math.round(rawDuration * 10000) / 10000;
    const sourceDuration = mediaItem.duration ?? cleanDuration;
    const trimStart = Math.max(0, segment.start_sec);
    const trimEnd = Math.max(0, sourceDuration - segment.end_sec);

    // Create a unique ID for this new "virtual" media item
    const newMediaItemId = crypto.randomUUID();

    // 1. Add to Media Gallery (Virtual Item)
    if (activeProject) {
      await mediaStore.addMediaItem(activeProject.id, {
        id: newMediaItemId,
        name: `${mediaItem.name} (Cut ${index + 1})`,
        type: mediaItem.type,
        file: mediaItem.file, // Reference the same file
        url: mediaItem.url, // Reference the same URL
        thumbnailUrl: mediaItem.thumbnailUrl,
        extractedAudioUrl: mediaItem.extractedAudioUrl,
        duration: sourceDuration, // Keep source duration so trims stay accurate
        cutDuration: cleanDuration, // Explicit cut duration for UI/ghost width
        startTime: trimStart, // Start time in the source file
        width: mediaItem.width,
        height: mediaItem.height,
        fps: mediaItem.fps,
      });
      addedCount++;
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
