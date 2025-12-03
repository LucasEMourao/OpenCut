import { toast } from "sonner";
import {
  getFileType,
  generateVideoThumbnail,
  getMediaDuration,
  getImageDimensions,
  type MediaItem,
} from "@/stores/media-store";
import { generateThumbnail, getVideoInfo, extractAudio } from "./ffmpeg-utils";

export interface ProcessedMediaItem extends Omit<MediaItem, "id"> { }

export async function processMediaFiles(
  files: FileList | File[],
  onProgress?: (progress: number) => void
): Promise<ProcessedMediaItem[]> {
  const fileArray = Array.from(files);
  const processedItems: ProcessedMediaItem[] = [];

  const total = fileArray.length;
  let completed = 0;

  for (const file of fileArray) {
    const fileType = getFileType(file);

    if (!fileType) {
      toast.error(`Unsupported file type: ${file.name}`);
      continue;
    }

    const url = URL.createObjectURL(file);
    let thumbnailUrl: string | undefined;
    let extractedAudioUrl: string | undefined;
    let duration: number | undefined;
    let width: number | undefined;
    let height: number | undefined;
    let fps: number | undefined;

    try {
      // Milestone 1: Start processing (10%)
      const baseProgress = (completed / total) * 100;
      if (onProgress) onProgress(baseProgress + (10 / total));

      if (fileType === "image") {
        // Get image dimensions
        const dimensions = await getImageDimensions(file);
        width = dimensions.width;
        height = dimensions.height;

        // Image processing is fast, jump to 90% for this file
        if (onProgress) onProgress(baseProgress + (90 / total));
      } else if (fileType === "video") {
        try {
          // Use FFmpeg for comprehensive video info extraction
          const videoInfo = await getVideoInfo(file);
          duration = videoInfo.duration;
          width = videoInfo.width;
          height = videoInfo.height;
          fps = videoInfo.fps;

          // Milestone 2: Info extracted (40%)
          if (onProgress) onProgress(baseProgress + (40 / total));

          // Generate thumbnail using FFmpeg
          thumbnailUrl = await generateThumbnail(file, 1);

          // Milestone 3: Thumbnail generated (70%)
          if (onProgress) onProgress(baseProgress + (70 / total));

          // Extract audio from video (this is for audio waveform visualization)
          const audioBlob = await extractAudio(file);
          extractedAudioUrl = URL.createObjectURL(audioBlob);
        } catch (error) {
          console.warn(
            "FFmpeg processing failed, falling back to basic processing:",
            error
          );
          // Fallback to basic processing
          const videoResult = await generateVideoThumbnail(file);
          thumbnailUrl = videoResult.thumbnailUrl;
          width = videoResult.width;
          height = videoResult.height;
          duration = await getMediaDuration(file);
          // FPS will remain undefined for fallback
        }
      } else if (fileType === "audio") {
        // For audio, we don't set width/height/fps (they'll be undefined)
        duration = await getMediaDuration(file);
        // Audio processing is fast, jump to 90%
        if (onProgress) onProgress(baseProgress + (90 / total));
      }

      // For video files, ensure the original video file maintains its proper URL and properties
      processedItems.push({
        name: file.name,
        type: fileType,
        file,
        url, // This is the main URL for the media (video file URL for video items)
        thumbnailUrl,
        extractedAudioUrl, // URL for extracted audio (for waveforms)
        duration,
        width,
        height,
        fps,
      });

      // Yield back to the event loop to keep the UI responsive
      await new Promise((resolve) => setTimeout(resolve, 0));

      completed += 1;
      if (onProgress) {
        const percent = Math.round((completed / total) * 100);
        onProgress(percent);
      }
    } catch (error) {
      console.error("Error processing file:", file.name, error);
      toast.error(`Failed to process ${file.name}`);
      URL.revokeObjectURL(url); // Clean up on error
    }
  }

  return processedItems;
}

export async function uploadFile(
  file: File,
  url: string,
  onProgress?: (percent: number) => void
): Promise<any> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        const percent = (event.loaded / event.total) * 100;
        if (onProgress) onProgress(percent);
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText));
        } catch (e) {
          reject(new Error("Failed to parse response"));
        }
      } else {
        reject(new Error(`Upload failed: ${xhr.status} ${xhr.statusText}`));
      }
    };

    xhr.onerror = () => reject(new Error("Network error"));

    const formData = new FormData();
    formData.append("file", file);
    xhr.send(formData);
  });
}

export async function uploadJsonWithProgress<T>(
  url: string,
  data: any,
  onProgress?: (percent: number) => void
): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.setRequestHeader("Content-Type", "application/json");

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) {
        const percent = (event.loaded / event.total) * 100;
        onProgress(percent);
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText));
        } catch (e) {
          reject(new Error("Failed to parse response"));
        }
      } else {
        // Return the error response if possible, or reject
        try {
          const errorResponse = JSON.parse(xhr.responseText);
          // If the server returns a structured error or fallback, we might want to resolve it?
          // But standard fetch throws on non-200? No, fetch doesn't throw.
          // Here we reject.
          reject(new Error(`Upload failed: ${xhr.status} ${xhr.statusText}`));
        } catch (e) {
          reject(new Error(`Upload failed: ${xhr.status} ${xhr.statusText}`));
        }
      }
    };

    xhr.onerror = () => reject(new Error("Network error"));

    if (onProgress) onProgress(0);
    xhr.send(JSON.stringify(data));
  });
}
