import { initFFmpeg } from "@/lib/ffmpeg-utils";
import type { TimelineTrack, TextElement } from "@/types/timeline";
import type { MediaItem } from "@/stores/media-store";
import { buildDownloadFilename } from "@/lib/download-utils";

const EPSILON = 0.01;

export class TimelineExportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TimelineExportError";
  }
}

interface CanvasSize {
  width: number;
  height: number;
}

interface ExportOptions {
  tracks: TimelineTrack[];
  mediaItems: MediaItem[];
  projectName?: string;
  canvasSize: CanvasSize;
}

interface TimelineElementWithMedia {
  element: TimelineTrack["elements"][number];
  media: MediaItem;
}

const textEncoder = new TextEncoder();

const waitForFonts = async () => {
  if (typeof document === "undefined") return;

  const docWithFonts = document as Document & {
    fonts?: FontFaceSet;
  };

  if (docWithFonts.fonts) {
    try {
      await docWithFonts.fonts.ready;
    } catch (error) {
      console.warn("Failed to wait for fonts to load", error);
    }
  }
};

const renderTextElementToPng = async (
  element: TextElement,
  canvasSize: CanvasSize
): Promise<Uint8Array> => {
  if (typeof document === "undefined") {
    throw new TimelineExportError(
      "Text rendering is only supported in a browser environment."
    );
  }

  await waitForFonts();

  const canvas = document.createElement("canvas");
  canvas.width = canvasSize.width;
  canvas.height = canvasSize.height;
  const ctx = canvas.getContext("2d");

  if (!ctx) {
    throw new TimelineExportError(
      "Failed to create rendering context for text overlay."
    );
  }

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const lines = element.content.split(/\r?\n/);
  const fontStyle = element.fontStyle || "normal";
  const fontWeight = element.fontWeight || "normal";
  const rawFontFamily = element.fontFamily || "Arial";
  const fontFamily = rawFontFamily.includes(" ")
    ? `"${rawFontFamily}"`
    : rawFontFamily;
  const fontSize = element.fontSize || 48;
  const font = `${fontStyle} ${fontWeight} ${fontSize}px ${fontFamily}`.trim();

  ctx.font = font;
  ctx.textBaseline = "middle";
  ctx.textAlign = element.textAlign || "center";
  ctx.globalAlpha = element.opacity ?? 1;
  ctx.fillStyle = element.color || "#ffffff";

  const paddingX = 8;
  const paddingY = 4;
  const lineHeight = fontSize * 1.2;

  let maxLineWidth = 0;
  for (const line of lines) {
    const metrics = ctx.measureText(line || " ");
    maxLineWidth = Math.max(maxLineWidth, metrics.width);
  }

  const blockWidth = maxLineWidth + paddingX * 2;
  const blockHeight = lines.length * lineHeight + paddingY * 2;

  const centerX = canvasSize.width / 2 + element.x;
  const centerY = canvasSize.height / 2 + element.y;

  ctx.save();
  ctx.translate(centerX, centerY);
  ctx.rotate(((element.rotation || 0) * Math.PI) / 180);

  if (
    element.backgroundColor &&
    element.backgroundColor.toLowerCase() !== "transparent"
  ) {
    ctx.fillStyle = element.backgroundColor;
    ctx.fillRect(-blockWidth / 2, -blockHeight / 2, blockWidth, blockHeight);
    ctx.fillStyle = element.color || "#ffffff";
  }

  const textAlign = (element.textAlign || "center") as CanvasTextAlign;
  ctx.textAlign = textAlign;

  const textX =
    textAlign === "left"
      ? -blockWidth / 2 + paddingX
      : textAlign === "right"
        ? blockWidth / 2 - paddingX
        : 0;

  lines.forEach((line, index) => {
    const lineY =
      -blockHeight / 2 + paddingY + index * lineHeight + lineHeight / 2;

    ctx.fillText(line, textX, lineY);

    if (element.textDecoration && element.textDecoration !== "none") {
      const metrics = ctx.measureText(line);
      let startX = textX;
      let endX = textX;

      if (textAlign === "center") {
        startX = textX - metrics.width / 2;
        endX = textX + metrics.width / 2;
      } else if (textAlign === "right") {
        startX = textX - metrics.width;
        endX = textX;
      } else {
        endX = textX + metrics.width;
      }

      const decorationY =
        element.textDecoration === "underline"
          ? lineY + fontSize / 2.5
          : element.textDecoration === "line-through"
            ? lineY
            : lineY - fontSize / 2.5;

      ctx.beginPath();
      ctx.moveTo(startX, decorationY);
      ctx.lineTo(endX, decorationY);
      ctx.lineWidth = Math.max(1, fontSize / 15);
      ctx.strokeStyle = element.color || "#ffffff";
      ctx.stroke();
    }
  });

  ctx.restore();

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((result) => {
      if (!result) {
        reject(new TimelineExportError("Failed to create text overlay image."));
        return;
      }
      resolve(result);
    }, "image/png");
  });

  const buffer = await blob.arrayBuffer();
  return new Uint8Array(buffer);
};

const getFileExtension = (item: MediaItem): string => {
  const name = item.file?.name || "";
  const match = name.match(/\.[a-zA-Z0-9]+$/);
  if (match) return match[0].toLowerCase();

  const mime = item.file?.type || "";
  if (mime.includes("mp4")) return ".mp4";
  if (mime.includes("quicktime")) return ".mov";
  if (mime.includes("webm")) return ".webm";
  if (mime.includes("mp3")) return ".mp3";
  if (mime.includes("wav")) return ".wav";

  return item.type === "audio" ? ".mp3" : ".mp4";
};

const getClipDuration = (element: TimelineTrack["elements"][number]) => {
  return element.duration - element.trimStart - element.trimEnd;
};

const snapTimelineElements = (
  elements: TimelineTrack["elements"]
): TimelineTrack["elements"] => {
  if (elements.length <= 1) {
    return elements;
  }

  const sorted = [...elements].sort((a, b) => a.startTime - b.startTime);
  const snapped: TimelineTrack["elements"] = [];

  for (let i = 0; i < sorted.length; i++) {
    const element = sorted[i];
    const newElement = { ...element };

    if (i === 0) {
      // First element keeps its start time (or set to 0 if desired, but keeping original allows offset)
      // For strict export from 0, uncomment: newElement.startTime = 0;
    } else {
      // Set start time to exactly match the end time of the previous element
      const previousElement = snapped[i - 1];
      const previousDuration = getClipDuration(previousElement);
      newElement.startTime = previousElement.startTime + previousDuration;
    }

    snapped.push(newElement);
  }

  return snapped;
};

const validateSequentialTimeline = (
  elements: TimelineTrack["elements"],
  label: string
): number => {
  if (elements.length === 0) {
    throw new TimelineExportError(
      `The ${label} track does not contain any clips.`
    );
  }

  let expectedStart = 0;

  const sorted = [...elements].sort((a, b) => a.startTime - b.startTime);

  for (const element of sorted) {
    const clipDuration = getClipDuration(element);

    if (clipDuration <= 0) {
      throw new TimelineExportError(
        `One of the clips in the ${label} track has zero duration.`
      );
    }

    // Note: With auto-snap, this check should pass, but we keep it as a sanity check
    if (Math.abs(element.startTime - expectedStart) > EPSILON) {
      // If we are here, it means auto-snap wasn't called or failed. 
      // We will warn but allow proceed if it's a small gap? No, export expects sequential.
      // But since we are calling snapTimelineElements before this, it should be fine.
    }

    expectedStart = element.startTime + clipDuration;
  }

  return expectedStart;
};

const writeUniqueInput = async (
  ffmpeg: Awaited<ReturnType<typeof initFFmpeg>>,
  item: MediaItem,
  cache: Map<string, string>
) => {
  if (cache.has(item.id)) {
    return cache.get(item.id)!;
  }

  if (!item.file) {
    throw new TimelineExportError(
      `Media item "${item.name}" is missing its source file and cannot be exported.`
    );
  }

  const extension = getFileExtension(item);
  const inputName = `input_${item.id}${extension}`;
  const data = new Uint8Array(await item.file.arrayBuffer());
  await ffmpeg.writeFile(inputName, data);
  cache.set(item.id, inputName);
  return inputName;
};

export const exportTimelineToMp4 = async ({
  tracks,
  mediaItems,
  projectName,
  canvasSize,
  onProgress,
}: ExportOptions & { onProgress?: (progress: number) => void }): Promise<{ blob: Blob; filename: string }> => {
  const mediaMap = new Map(mediaItems.map((item) => [item.id, item]));
  const activeMediaTracks = tracks.filter(
    (track) => track.type === "media" && track.elements.length > 0
  );

  if (activeMediaTracks.length === 0) {
    throw new TimelineExportError(
      "Add at least one video clip to the timeline before exporting."
    );
  }

  if (activeMediaTracks.length > 1) {
    throw new TimelineExportError(
      "Export currently supports a single video track. Remove additional video tracks and try again."
    );
  }

  const videoTrack = activeMediaTracks[0];

  // Auto-snap video track elements to eliminate gaps
  const snappedVideoElements = snapTimelineElements(videoTrack.elements);
  console.log("Sanitized export timeline (video):", snappedVideoElements);

  const videoElementsWithMedia: TimelineElementWithMedia[] = snappedVideoElements
    .slice()
    .sort((a, b) => a.startTime - b.startTime)
    .map((element) => {
      const media = mediaMap.get(element.mediaId);
      if (!media) {
        throw new TimelineExportError(
          `A timeline clip references a missing media item (id: ${element.mediaId}).`
        );
      }

      if (media.type !== "video") {
        throw new TimelineExportError(
          "Export currently supports only video clips on the main track. Remove images or non-video clips and try again."
        );
      }

      return { element, media };
    });

  const textElements = tracks
    .filter((track) => track.type === "text" && track.elements.length > 0)
    .flatMap((track) =>
      track.elements.map((element) => {
        if (element.type !== "text") {
          throw new TimelineExportError(
            "Only text clips can be placed on text tracks for export."
          );
        }

        return element as TextElement;
      })
    )
    .sort((a, b) => a.startTime - b.startTime);

  const ffmpeg = await initFFmpeg();

  const writtenInputs = new Map<string, string>();
  const cleanupQueue: string[] = [];

  // Scale filter to ensure all inputs conform to canvas size
  const scaleFilter =
    `scale=${canvasSize.width}:${canvasSize.height}:force_original_aspect_ratio=decrease,` +
    `pad=${canvasSize.width}:${canvasSize.height}:(ow-iw)/2:(oh-ih)/2,format=yuv420p`;

  // --- NEW: Consolidated Video + Audio Processing Function ---
  const createVideoOutput = async () => {
    const segmentNames: string[] = [];

    // Calculate total duration for accurate progress
    const totalDuration = videoElementsWithMedia.reduce(
      (acc, { element }) => acc + getClipDuration(element),
      0
    );
    let processedDuration = 0;

    // Helper to parse time from FFmpeg logs
    const parseTimeFromLog = (message: string): number | null => {
      const timeMatch = message.match(/time=(\d{2}):(\d{2}):(\d{2}\.\d{2})/);
      if (timeMatch) {
        const hours = parseFloat(timeMatch[1]);
        const minutes = parseFloat(timeMatch[2]);
        const seconds = parseFloat(timeMatch[3]);
        return hours * 3600 + minutes * 60 + seconds;
      }
      return null;
    };

    // 1. Process each segment: Trim and Re-encode to fix rotation/format
    for (let index = 0; index < videoElementsWithMedia.length; index += 1) {
      const { element, media } = videoElementsWithMedia[index];
      const inputName = await writeUniqueInput(ffmpeg, media, writtenInputs);
      const clipDuration = getClipDuration(element);
      const segmentName = `video_segment_${index}.mp4`;

      const logListener = ({ message }: { message: string }) => {
        if (onProgress) {
          const currentTime = parseTimeFromLog(message);
          if (currentTime !== null) {
            // Progress within this specific clip
            const clipProgress = Math.min(currentTime / clipDuration, 1);
            // Global progress (0-80% allocated for processing segments)
            const segmentWeight = clipDuration / totalDuration;
            const currentSegmentContribution = clipProgress * segmentWeight;
            const rawProgress = (processedDuration / totalDuration + currentSegmentContribution) * 0.8;

            onProgress(Math.min(100, Math.max(0, Math.round(rawProgress * 100))));
          }
        }
      };

      ffmpeg.on("log", logListener);

      try {
        await ffmpeg.exec([
          "-i",
          inputName,
          "-ss",
          element.trimStart.toFixed(3),
          "-t",
          clipDuration.toFixed(3),
          "-vf",
          scaleFilter, // Apply scale/pad to match canvas
          "-c:v",
          "libx264",
          "-preset",
          "fast", // Good balance of speed/quality
          "-crf",
          "23",
          "-c:a",
          "aac", // Re-encode audio
          "-b:a",
          "192k",
          "-ac",
          "2", // Force stereo
          "-ar",
          "44100", // Standardize rate
          "-movflags",
          "faststart",
          segmentName,
        ]);
      } finally {
        ffmpeg.off("log", logListener);
      }

      processedDuration += clipDuration;
      segmentNames.push(segmentName);
      cleanupQueue.push(segmentName);
    }

    const outputName = "video_concat.mp4";

    // 2. Concatenate Segments (Video + Audio)
    // Using filter_complex concat which is robust for re-encoded clips
    const concatLogListener = ({ message }: { message: string }) => {
      if (onProgress) {
        const currentTime = parseTimeFromLog(message);
        if (currentTime !== null) {
          // Global progress (80-100% allocated for concatenation)
          const concatProgress = Math.min(currentTime / totalDuration, 1);
          const rawProgress = 0.8 + (concatProgress * 0.2);
          onProgress(Math.min(100, Math.max(0, Math.round(rawProgress * 100))));
        }
      }
    };
    ffmpeg.on("log", concatLogListener);

    try {
      if (segmentNames.length === 1) {
        // Single segment: just copy/rename
        await ffmpeg.exec([
          "-i",
          segmentNames[0],
          "-c",
          "copy",
          outputName,
        ]);
      } else {
        // Multiple segments: use concat filter for A/V sync
        const inputArgs: string[] = [];
        const filterInputs: string[] = [];

        segmentNames.forEach((name, i) => {
          inputArgs.push("-i", name);
          filterInputs.push(`[${i}:v][${i}:a]`);
        });

        // concat=n=XX:v=1:a=1 ensures both streams are joined
        const filterComplex = `${filterInputs.join("")}concat=n=${segmentNames.length}:v=1:a=1[outv][outa]`;

        await ffmpeg.exec([
          ...inputArgs,
          "-filter_complex",
          filterComplex,
          "-map",
          "[outv]",
          "-map",
          "[outa]",
          "-c:v",
          "libx264", // Re-encode final concat to ensure smoothness
          "-preset",
          "fast",
          "-crf",
          "23",
          "-c:a",
          "aac",
          "-b:a",
          "192k",
          outputName,
        ]);
      }
    } finally {
      ffmpeg.off("log", concatLogListener);
    }

    cleanupQueue.push(outputName);
    return outputName;
  };
  // -----------------------------------------------------------

  const createTextOverlays = async () => {
    const overlays: Array<{
      file: string;
      start: number;
      end: number;
      duration: number;
    }> = [];
    if (textElements.length === 0) return overlays;

    for (let index = 0; index < textElements.length; index += 1) {
      const textElement = textElements[index];

      const clipDuration =
        textElement.duration -
        (textElement.trimStart || 0) -
        (textElement.trimEnd || 0);

      if (clipDuration <= 0) {
        throw new TimelineExportError(
          "Text clips must have a positive duration to be exported."
        );
      }

      const data = await renderTextElementToPng(textElement, canvasSize);
      const fileName = `text_overlay_${index}.png`;
      await ffmpeg.writeFile(fileName, data);
      cleanupQueue.push(fileName);
      overlays.push({
        file: fileName,
        start: textElement.startTime + (textElement.trimStart || 0),
        end:
          textElement.startTime + (textElement.trimStart || 0) + clipDuration,
        duration: clipDuration,
      });
    }

    return overlays;
  };

  let concatenatedVideo: string | null = null;

  try {
    // Generate the base video (with audio)
    concatenatedVideo = await createVideoOutput();

    if (!concatenatedVideo) {
      throw new TimelineExportError("Failed to create base video.");
    }

    const textOverlays = await createTextOverlays();
    const outputName = "timeline_export.mp4";

    // Final Command: Merge Concat Video with Text Overlays
    const command: string[] = ["-i", concatenatedVideo];
    const filterParts: string[] = [];
    let currentVideoLabel = "[0:v]";

    textOverlays.forEach((overlay, index) => {
      command.push(
        "-loop",
        "1",
        "-framerate",
        "30",
        "-t",
        overlay.duration.toFixed(3),
        "-i",
        overlay.file
      );
      const overlayLabel = `[${index + 1}:v]`;
      const outputLabel =
        index === textOverlays.length - 1 ? "[vout]" : `[v${index + 1}]`;
      const enableExpr = `between(t\\,${overlay.start.toFixed(3)}\\,${overlay.end.toFixed(3)})`;
      filterParts.push(
        `${currentVideoLabel}${overlayLabel} overlay=enable='${enableExpr}' ${outputLabel}`
      );
      currentVideoLabel = outputLabel;
    });

    if (filterParts.length > 0) {
      command.push("-filter_complex", filterParts.join("; "));
      command.push("-map", currentVideoLabel); // Map final video
      command.push("-map", "0:a");             // Map audio from the base video
    } else {
      // If no text, just copy streams from concat video
      command.push("-c", "copy");
    }

    // If re-encoding happened due to filters
    if (filterParts.length > 0) {
      command.push("-c:v", "libx264", "-preset", "fast", "-crf", "23");
      command.push("-c:a", "copy"); // Copy audio (it was already processed in createVideoOutput)
      command.push("-pix_fmt", "yuv420p");
    }

    command.push("-movflags", "faststart", outputName);

    await ffmpeg.exec(command);

    cleanupQueue.push(outputName);

    const data = await ffmpeg.readFile(outputName);
    const blob = new Blob([data], { type: "video/mp4" });

    const filename = buildDownloadFilename(
      projectName ?? "opencut-export",
      "mp4"
    );

    return { blob, filename };

  } catch (error) {
    if (error instanceof TimelineExportError) {
      throw error;
    }

    throw new TimelineExportError(
      error instanceof Error
        ? error.message
        : "Unexpected error while exporting the timeline."
    );
  } finally {
    for (const file of cleanupQueue) {
      try {
        await ffmpeg.deleteFile(file);
      } catch (cleanupError) {
        console.warn("Failed to clean up temporary ffmpeg file", cleanupError);
      }
    }

    for (const inputFile of writtenInputs.values()) {
      try {
        await ffmpeg.deleteFile(inputFile);
      } catch (cleanupError) {
        console.warn("Failed to clean up source ffmpeg file", cleanupError);
      }
    }
  }
};