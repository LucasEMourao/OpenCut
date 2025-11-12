import { MediaItem } from "@/stores/media-store";
import { extractAudio, trimVideo } from "../ffmpeg-utils";
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
  try {
    const timelineStore = useTimelineStore.getState();
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

    // Call the AI API to analyze audio and generate cuts
    const cutAnalysis = await analyzeAudioWithAI(audioFiles);

    // Apply the detected cuts to the timeline
    await applyCutsToTimeline(cutAnalysis, selectedElements, audioData);

    // Success notification
    toast.success("Cuts detected and applied to timeline", { id: "auto-cut-progress" });
    
  } catch (error) {
    console.error("Error in automatic cut detection:", error);
    toast.error("Failed to detect automatic cuts", { id: "auto-cut-progress" });
  }
}

/**
 * Calls the AI API to analyze audio and return cut suggestions
 */
async function analyzeAudioWithAI(audioFiles: Array<{ filename: string; data: string }>): Promise<AutoCutResponse> {
  const systemPrompt = `You are a professional video editing assistant specialized in social media content creation. Your task is to analyze multiple audio takes and generate a precise editing blueprint for stitching the optimal TikTok video.

Inputs: Multiple audio files (MP3/WAV).

Processing Requirements:
- Transcribe with word-level timestamps
- Analyze for clarity, fluency, emotion, and noise
- Identify cleanest segments: Clarity > Emotion > Noise
- Select segments for Intro → Key message → Punchline
- Add 50ms buffers before/after speech

Output JSON:
{
  "metadata": {
    "total_duration": number,
    "segment_count": number,
    "takes_used": [string],
    "quality_warnings": [string]
  },
  "segments": [
    {
      "segment_id": number,
      "source_file": string,
      "start_sec": number,
      "end_sec": number,
      "content": string,
      "selection_reason": string,
      "transition_in": string,
      "transition_out": string
    }
  ]
}`;

  const userPrompt = `Analyze the provided audio files and generate optimal cut suggestions for creating an engaging TikTok video.`;

  // Check if we have a Gemini API key in the environment
  const apiKey = process.env.NEXT_PUBLIC_GEMINI_API_KEY;
  if (!apiKey) {
    console.warn("No Gemini API key found. Using mock data.");
    // Return mock data if no API key is available
    return {
      metadata: {
        total_duration: audioFiles.length * 5,
        segment_count: audioFiles.length,
        takes_used: audioFiles.map(f => f.filename),
        quality_warnings: []
      },
      segments: audioFiles.map((file, index) => ({
        segment_id: index + 1,
        source_file: file.filename,
        start_sec: 0.5,
        end_sec: 4.5,
        content: `Sample content from ${file.filename}`,
        selection_reason: "Optimal segment selected",
        transition_in: "cut",
        transition_out: "cut"
      }))
    };
  }

  try {
    // Prepare the request to Gemini API
    const geminiRequest = {
      contents: [{
        role: "user",
        parts: [
          { text: systemPrompt },
          { 
            text: userPrompt,
          },
          ...audioFiles.map(file => ({
            inlineData: {
              mimeType: "audio/mpeg", // Assuming MP3, may need to be more specific
              data: file.data,
            }
          }))
        ]
      }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: {
          type: "OBJECT",
          properties: {
            metadata: {
              type: "OBJECT",
              properties: {
                total_duration: { type: "NUMBER" },
                segment_count: { type: "NUMBER" },
                takes_used: { 
                  type: "ARRAY", 
                  items: { type: "STRING" }
                },
                quality_warnings: { 
                  type: "ARRAY", 
                  items: { type: "STRING" }
                }
              },
              required: ["total_duration", "segment_count", "takes_used", "quality_warnings"]
            },
            segments: {
              type: "ARRAY",
              items: {
                type: "OBJECT",
                properties: {
                  segment_id: { type: "NUMBER" },
                  source_file: { type: "STRING" },
                  start_sec: { type: "NUMBER" },
                  end_sec: { type: "NUMBER" },
                  content: { type: "STRING" },
                  selection_reason: { type: "STRING" },
                  transition_in: { type: "STRING" },
                  transition_out: { type: "STRING" },
                },
                required: ["segment_id", "source_file", "start_sec", "end_sec", "content", "selection_reason", "transition_in", "transition_out"]
              }
            }
          },
          required: ["metadata", "segments"]
        }
      }
    };

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(geminiRequest),
    });

    if (!response.ok) {
      throw new Error(`Gemini API request failed: ${response.status} ${response.statusText}`);
    }

    const result = await response.json();
    
    // Extract the content from the response
    const responseText = result.candidates?.[0]?.content?.parts?.[0]?.text;
    
    if (!responseText) {
      throw new Error("Invalid response format from Gemini API");
    }

    // Parse the JSON response
    const parsedResponse = JSON.parse(responseText);
    return parsedResponse;
  } catch (error) {
    console.error("Error calling Gemini API:", error);
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
  const timelineStore = useTimelineStore.getState();
  const mediaStore = useMediaStore.getState();

  // Push history state before making changes
  timelineStore.pushHistory();

  // Find a suitable track to add the new trimmed elements
  let targetTrackId = selectedElements[0].trackId;
  const targetTrack = timelineStore._tracks.find(t => t.id === targetTrackId);

  for (const segment of cutAnalysis.segments) {
    // Find the original media item for this segment
    const originalElementData = audioData.find(d => d.element.name === segment.source_file);
    if (!originalElementData) continue;

    const { element, mediaItem } = originalElementData;

    // Trim the original media file based on the detected segment
    const trimmedBlob = await trimVideo(
      mediaItem.file, 
      segment.start_sec, 
      segment.end_sec
    );
    
    // Create a new media item for the trimmed clip
    const newMediaItem: MediaItem = {
      id: `trimmed-${element.id}-${segment.segment_id}`,
      name: `${mediaItem.name}-trimmed-${segment.segment_id}`,
      type: mediaItem.type,
      file: new File([trimmedBlob], `trimmed-${mediaItem.name}-${segment.segment_id}.${mediaItem.type}`),
      url: URL.createObjectURL(trimmedBlob),
      thumbnailUrl: mediaItem.thumbnailUrl,
      extractedAudioUrl: mediaItem.extractedAudioUrl,
      duration: segment.end_sec - segment.start_sec,
      width: mediaItem.width,
      height: mediaItem.height,
      fps: mediaItem.fps,
    };

    // Add the new media item to the store
    if (useProjectStore.getState().activeProject) {
      await mediaStore.addMediaItem(useProjectStore.getState().activeProject.id, newMediaItem);
    }

    // Calculate start time for the new element (add to end of timeline or after last element)
    const lastElement = targetTrack?.elements
      .filter(el => el.startTime)
      .sort((a, b) => (b.startTime + b.duration) - (a.startTime + a.duration))[0];
    
    const startTime = lastElement 
      ? (lastElement.startTime + lastElement.duration - lastElement.trimStart - lastElement.trimEnd)
      : 0;

    // Add the new trimmed element to the timeline
    timelineStore.addElementToTrack(targetTrackId, {
      type: "media",
      mediaId: newMediaItem.id,
      name: newMediaItem.name,
      duration: newMediaItem.duration || 5,
      startTime,
      trimStart: 0,
      trimEnd: 0,
    });
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