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
      // First element keeps its start time (or set to 0)
      newElement.startTime = 0;
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

    if (Math.abs(element.startTime - expectedStart) > EPSILON) {
      throw new TimelineExportError(
        `Export currently supports clips laid out sequentially without gaps or overlaps. The ${label} track has a gap or overlap around ${element.startTime.toFixed(2)}s.`
      );
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
}: ExportOptions): Promise<{ blob: Blob; filename: string }> => {
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

  const videoDuration = validateSequentialTimeline(
    snappedVideoElements,
    "video"
  );

  const audioTracks = tracks.filter(
    (track) => track.type === "audio" && track.elements.length > 0
  );

  if (audioTracks.length > 1) {
    throw new TimelineExportError(
      "Export currently supports a single audio track. Please merge your audio clips into one track."
    );
  }

  let audioElementsWithMedia: TimelineElementWithMedia[] = [];

  if (audioTracks.length === 1) {
    const audioTrack = audioTracks[0];

    // Auto-snap audio track elements to eliminate gaps
    const snappedAudioElements = snapTimelineElements(audioTrack.elements);

    audioElementsWithMedia = snappedAudioElements
      .slice()
      .sort((a, b) => a.startTime - b.startTime)
      .map((element) => {
        const media = mediaMap.get(element.mediaId);
        if (!media) {
          throw new TimelineExportError(
            `An audio clip references a missing media item (id: ${element.mediaId}).`
          );
        }

        if (media.type !== "audio") {
          throw new TimelineExportError(
            "Only audio clips can be placed on the audio track for export."
          );
        }

        return { element, media };
      });

    const audioDuration = validateSequentialTimeline(
      snappedAudioElements,
      "audio"
    );

    if (audioDuration + EPSILON < videoDuration) {
      throw new TimelineExportError(
        "The audio track ends before the video track. Extend the audio track or remove the extra video content."
      );
    }
  }

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

  const scaleFilter =
    `scale=${canvasSize.width}:${canvasSize.height}:force_original_aspect_ratio=decrease,` +
    `pad=${canvasSize.width}:${canvasSize.height}:(ow-iw)/2:(oh-ih)/2,format=yuv420p`;

  const createVideoOutput = async () => {
    const segmentNames: string[] = [];

    for (let index = 0; index < videoElementsWithMedia.length; index += 1) {
      const { element, media } = videoElementsWithMedia[index];
      const inputName = await writeUniqueInput(ffmpeg, media, writtenInputs);
      const clipDuration = getClipDuration(element);
      const segmentName = `video_segment_${index}.mp4`;

      await ffmpeg.exec([
        "-i",
        inputName,
        "-ss",
        element.trimStart.toFixed(3),
        "-t",
        clipDuration.toFixed(3),
        "-vf",
        scaleFilter,
        "-c:v",
        "libx264",
        "-preset",
        "fast",
        "-crf",
        "23",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-movflags",
        "faststart",
        segmentName,
      ]);

      segmentNames.push(segmentName);
      cleanupQueue.push(segmentName);
    }

    const outputName = "video_concat.mp4";

    if (segmentNames.length === 1) {
      await ffmpeg.exec([
        "-i",
        segmentNames[0],
        "-c",
        "copy",
        "-movflags",
        "faststart",
        outputName,
      ]);
    } else {
      const concatList = segmentNames
        .map((name) => `file '${name}'`)
        .join("\n");
      const listFile = "video_segments.txt";
      await ffmpeg.writeFile(listFile, textEncoder.encode(concatList));
      cleanupQueue.push(listFile);

      await ffmpeg.exec([
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        listFile,
        "-c",
        "copy",
        "-movflags",
        "faststart",
        outputName,
      ]);
    }

    cleanupQueue.push(outputName);
    return outputName;
  };

  const createAudioTrack = async (): Promise<string | null> => {
    if (audioElementsWithMedia.length === 0) return null;

    const audioSegmentNames: string[] = [];

    for (let index = 0; index < audioElementsWithMedia.length; index += 1) {
      const { element, media } = audioElementsWithMedia[index];
      const inputName = await writeUniqueInput(ffmpeg, media, writtenInputs);
      const clipDuration = getClipDuration(element);
      const segmentName = `audio_segment_${index}.aac`;

      await ffmpeg.exec([
        "-i",
        inputName,
        "-ss",
        element.trimStart.toFixed(3),
        "-t",
        clipDuration.toFixed(3),
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        segmentName,
      ]);

      audioSegmentNames.push(segmentName);
      cleanupQueue.push(segmentName);
    }

    const outputName = "audio_concat.aac";

    if (audioSegmentNames.length === 1) {
      await ffmpeg.exec(["-i", audioSegmentNames[0], "-c", "copy", outputName]);
    } else {
      const concatList = audioSegmentNames
        .map((name) => `file '${name}'`)
        .join("\n");
      const listFile = "audio_segments.txt";
      await ffmpeg.writeFile(listFile, textEncoder.encode(concatList));
      cleanupQueue.push(listFile);

      await ffmpeg.exec([
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        listFile,
        "-c",
        "copy",
        outputName,
      ]);
    }

    cleanupQueue.push(outputName);
    return outputName;
  };

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

  let baseVideoFile: string | null = null;
  let finalAudioFile: string | null = null;

  try {
    baseVideoFile = await createVideoOutput();
    finalAudioFile = await createAudioTrack();

    if (baseVideoFile === null) {
      throw new TimelineExportError(
        "Failed to assemble the video track for export."
      );
    }

    const textOverlays = await createTextOverlays();
    const outputName = "timeline_export.mp4";

    const command: string[] = ["-i", baseVideoFile];
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

    if (finalAudioFile) {
      command.push("-i", finalAudioFile);
    }

    if (filterParts.length > 0) {
      command.push("-filter_complex", filterParts.join("; "));
      command.push("-map", currentVideoLabel);
    } else {
      command.push("-map", "0:v:0");
    }

    const audioInputIndex = textOverlays.length + 1;

    if (finalAudioFile) {
      command.push("-map", `${audioInputIndex}:a:0`);
      command.push("-c:a", "aac", "-b:a", "192k");
    } else {
      command.push("-map", "0:a?");
      command.push("-c:a", "copy");
    }

    if (filterParts.length > 0) {
      command.push("-c:v", "libx264", "-preset", "fast", "-crf", "23");
      command.push("-pix_fmt", "yuv420p");
    } else {
      command.push("-c:v", "copy");
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
