import { useEffect, useCallback } from "react";
import { usePlaybackStore } from "@/stores/playback-store";
import { useTimelineStore } from "@/stores/timeline-store";
import { useMediaStore } from "@/stores/media-store";
import { useProjectStore } from "@/stores/project-store";
import { toast } from "sonner";
import { extractAudio } from "@/lib/ffmpeg-utils";
import { buildDownloadFilename, downloadBlob } from "@/lib/download-utils";

export const usePlaybackControls = () => {
  const { isPlaying, currentTime, play, pause, seek } = usePlaybackStore();

  const {
    selectedElements,
    tracks,
    splitElement,
    splitAndKeepLeft,
    splitAndKeepRight,
  } = useTimelineStore();
  const { mediaItems, addMediaItem } = useMediaStore();
  const { activeProject } = useProjectStore();

  const handleSplitSelectedElement = useCallback(() => {
    if (selectedElements.length !== 1) {
      toast.error("Select exactly one element to split");
      return;
    }

    const { trackId, elementId } = selectedElements[0];
    const track = tracks.find((t) => t.id === trackId);
    const element = track?.elements.find((e) => e.id === elementId);

    if (!element) return;

    const effectiveStart = element.startTime;
    const effectiveEnd =
      element.startTime +
      (element.duration - element.trimStart - element.trimEnd);

    if (currentTime <= effectiveStart || currentTime >= effectiveEnd) {
      toast.error("Playhead must be within selected element");
      return;
    }

    splitElement(trackId, elementId, currentTime);
  }, [selectedElements, tracks, currentTime, splitElement]);

  const handleSplitAndKeepLeftCallback = useCallback(() => {
    if (selectedElements.length !== 1) {
      toast.error("Select exactly one element");
      return;
    }

    const { trackId, elementId } = selectedElements[0];
    const track = tracks.find((t) => t.id === trackId);
    const element = track?.elements.find((e) => e.id === elementId);

    if (!element) return;

    const effectiveStart = element.startTime;
    const effectiveEnd =
      element.startTime +
      (element.duration - element.trimStart - element.trimEnd);

    if (currentTime <= effectiveStart || currentTime >= effectiveEnd) {
      toast.error("Playhead must be within selected element");
      return;
    }

    splitAndKeepLeft(trackId, elementId, currentTime);
  }, [selectedElements, tracks, currentTime, splitAndKeepLeft]);

  const handleSplitAndKeepRightCallback = useCallback(() => {
    if (selectedElements.length !== 1) {
      toast.error("Select exactly one element");
      return;
    }

    const { trackId, elementId } = selectedElements[0];
    const track = tracks.find((t) => t.id === trackId);
    const element = track?.elements.find((e) => e.id === elementId);

    if (!element) return;

    const effectiveStart = element.startTime;
    const effectiveEnd =
      element.startTime +
      (element.duration - element.trimStart - element.trimEnd);

    if (currentTime <= effectiveStart || currentTime >= effectiveEnd) {
      toast.error("Playhead must be within selected element");
      return;
    }

    splitAndKeepRight(trackId, elementId, currentTime);
  }, [selectedElements, tracks, currentTime, splitAndKeepRight]);

  const handleSeparateAudioCallback = useCallback(async () => {
    if (selectedElements.length !== 1) {
      toast.error("Select exactly one media element to export audio");
      return;
    }

    const { trackId, elementId } = selectedElements[0];
    const track = tracks.find((t) => t.id === trackId);
    const element = track?.elements.find((item) => item.id === elementId);

    if (
      !track ||
      track.type !== "media" ||
      !element ||
      element.type !== "media"
    ) {
      toast.error("Select a video clip to export audio");
      return;
    }

    const mediaItem = mediaItems.find((item) => item.id === element.mediaId);

    if (!mediaItem) {
      toast.error("Original media file not found");
      return;
    }

    const toastId = toast.loading("Extracting audio...");

    try {
      const audioBlob = await extractAudio(mediaItem.file, "mp3");
      const filename = buildDownloadFilename(mediaItem.name, "mp3");

      const audioFile = new File([audioBlob], filename, {
        type: "audio/mpeg",
      });
      const audioUrl = URL.createObjectURL(audioFile);

      downloadBlob(audioBlob, filename);

      let successMessage = "Audio exported as MP3";

      if (activeProject) {
        try {
          await addMediaItem(activeProject.id, {
            name: filename,
            type: "audio",
            file: audioFile,
            url: audioUrl,
            duration:
              mediaItem.duration ??
              element.duration - element.trimStart - element.trimEnd,
          });
          successMessage = "Audio exported and added to media";
        } catch (error) {
          URL.revokeObjectURL(audioUrl);
          throw error;
        }
      } else {
        URL.revokeObjectURL(audioUrl);
      }

      toast.success(successMessage, { id: toastId });
    } catch (error) {
      console.error("Failed to export audio", error);
      toast.error("Failed to export audio", { id: toastId });
    }
  }, [selectedElements, tracks, mediaItems, addMediaItem, activeProject]);
};
