"use client";

import { Button } from "../../ui/button";
import {
  Scissors,
  ArrowLeftToLine,
  ArrowRightToLine,
  Trash2,
  Snowflake,
  Copy,
  SplitSquareHorizontal,
  Pause,
  Play,
  Magnet,
  Link,
  ZoomIn,
  ZoomOut,
  Bookmark,
  Loader2,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from "../../ui/tooltip";
import { useTimelineStore } from "@/stores/timeline-store";
import { useMediaStore } from "@/stores/media-store";
import { usePlaybackStore } from "@/stores/playback-store";
import { useProjectStore } from "@/stores/project-store";
import { toast } from "sonner";
import { Slider } from "@/components/ui/slider";
import { extractAudio } from "@/lib/ffmpeg-utils";
import { downloadBlob, buildDownloadFilename } from "@/lib/download-utils";
import { detectAutomaticCuts } from "@/lib/ai/autoCut";
import { TIMELINE_CONSTANTS } from "@/constants/timeline-constants";
import { MediaElement } from "@/types/timeline";

interface TimelineToolbarProps {
  zoomLevel: number;
  setZoomLevel: (zoom: number) => void;
}

export function TimelineToolbar({
  zoomLevel,
  setZoomLevel,
}: TimelineToolbarProps) {
  const {
    tracks,
    addTrack,
    addElementToTrack,
    removeElementFromTrack,
    removeElementFromTrackWithRipple,
    selectedElements,
    clearSelectedElements,
    splitElement,
    splitAndKeepLeft,
    splitAndKeepRight,
    snappingEnabled,
    toggleSnapping,
    rippleEditingEnabled,
    toggleRippleEditing,
    isAutoCutting,
  } = useTimelineStore();
  const { currentTime, duration, isPlaying, toggle } = usePlaybackStore();
  const { toggleBookmark, isBookmarked, activeProject } = useProjectStore();
  const { mediaItems, addMediaItem } = useMediaStore();

  // Action handlers
  const handleSplitSelected = () => {
    if (selectedElements.length === 0) return;
    let splitCount = 0;
    selectedElements.forEach(({ trackId, elementId }) => {
      const track = tracks.find((t) => t.id === trackId);
      const element = track?.elements.find((c) => c.id === elementId);
      if (element && track) {
        const effectiveStart = element.startTime;
        const effectiveEnd =
          element.startTime +
          (element.duration - element.trimStart - element.trimEnd);
        if (currentTime > effectiveStart && currentTime < effectiveEnd) {
          const newElementId = splitElement(trackId, elementId, currentTime);
          if (newElementId) splitCount++;
        }
      }
    });
    if (splitCount === 0) {
      toast.error("Playhead must be within selected elements to split");
    }
  };

  const handleDuplicateSelected = () => {
    if (selectedElements.length === 0) return;
    const canDuplicate = selectedElements.length === 1;
    if (!canDuplicate) return;

    selectedElements.forEach(({ trackId, elementId }) => {
      const track = tracks.find((t) => t.id === trackId);
      const element = track?.elements.find((el) => el.id === elementId);
      if (element) {
        const newStartTime =
          element.startTime +
          (element.duration - element.trimStart - element.trimEnd) +
          0.1;
        const { id, ...elementWithoutId } = element;
        addElementToTrack(trackId, {
          ...elementWithoutId,
          startTime: newStartTime,
        });
      }
    });
    clearSelectedElements();
  };

  const handleFreezeSelected = () => {
    toast.info("Freeze frame functionality coming soon!");
  };

  const handleSplitAndKeepLeft = () => {
    if (selectedElements.length !== 1) {
      toast.error("Select exactly one element");
      return;
    }
    const { trackId, elementId } = selectedElements[0];
    const track = tracks.find((t) => t.id === trackId);
    const element = track?.elements.find((c) => c.id === elementId);
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
  };

  const handleSplitAndKeepRight = () => {
    if (selectedElements.length !== 1) {
      toast.error("Select exactly one element");
      return;
    }
    const { trackId, elementId } = selectedElements[0];
    const track = tracks.find((t) => t.id === trackId);
    const element = track?.elements.find((c) => c.id === elementId);
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
  };

  const handleSeparateAudio = async () => {
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

    const mediaElement = element as MediaElement;
    const mediaItem = mediaItems.find(
      (item) => item.id === mediaElement.mediaId
    );

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
  };

  const handleDeleteSelected = () => {
    if (selectedElements.length === 0) return;
    selectedElements.forEach(({ trackId, elementId }) => {
      if (rippleEditingEnabled) {
        removeElementFromTrackWithRipple(trackId, elementId);
      } else {
        removeElementFromTrack(trackId, elementId);
      }
    });
    clearSelectedElements();
  };

  // Zoom handlers
  const handleZoomIn = () => {
    setZoomLevel(Math.min(4, zoomLevel + 0.25));
  };

  const handleZoomOut = () => {
    setZoomLevel(Math.max(0.25, zoomLevel - 0.25));
  };

  const handleZoomSliderChange = (values: number[]) => {
    setZoomLevel(values[0]);
  };

  const handleToggleBookmark = async () => {
    await toggleBookmark(currentTime);
  };

  // Check if the current time is bookmarked
  const currentBookmarked = isBookmarked(currentTime);
  return (
    <div className="border-b flex items-center justify-between px-2 py-1">
      <div className="flex items-center gap-1 w-full">
        <TooltipProvider delayDuration={500}>
          {/* Play/Pause Button */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="text"
                size="icon"
                onClick={toggle}
                className="mr-2"
              >
                {isPlaying ? (
                  <Pause className="h-4 w-4" />
                ) : (
                  <Play className="h-4 w-4" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {isPlaying ? "Pause (Space)" : "Play (Space)"}
            </TooltipContent>
          </Tooltip>
          <div className="w-px h-6 bg-border mx-1" />
          {/* Time Display */}
          <div
            className="text-xs text-muted-foreground font-mono px-2"
            style={{ minWidth: "18ch", textAlign: "center" }}
          >
            {currentTime.toFixed(1)}s / {duration.toFixed(1)}s
          </div>
          {/* Test Clip Button - for debugging */}
          {tracks.length === 0 && (
            <>
              <div className="w-px h-6 bg-border mx-1" />
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const trackId = addTrack("media");
                      addElementToTrack(trackId, {
                        type: "media",
                        mediaId: "test",
                        name: "Test Clip",
                        duration: TIMELINE_CONSTANTS.DEFAULT_TEXT_DURATION,
                        startTime: 0,
                        trimStart: 0,
                        trimEnd: 0,
                      });
                    }}
                    className="text-xs"
                  >
                    Add Test Clip
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Add a test clip to try playback</TooltipContent>
              </Tooltip>
            </>
          )}
          <div className="w-px h-6 bg-border mx-1" />
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="text" size="icon" onClick={handleSplitSelected}>
                <Scissors className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Split element (Ctrl+S)</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="text"
                size="icon"
                onClick={handleSplitAndKeepLeft}
              >
                <ArrowLeftToLine className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Split and keep left (Ctrl+Q)</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="text"
                size="icon"
                onClick={handleSplitAndKeepRight}
              >
                <ArrowRightToLine className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Split and keep right (Ctrl+W)</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="text" size="icon" onClick={handleSeparateAudio}>
                <SplitSquareHorizontal className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Separate audio (Ctrl+D)</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="text"
                size="icon"
                onClick={handleDuplicateSelected}
              >
                <Copy className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Duplicate element (Ctrl+D)</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="text" size="icon" onClick={handleFreezeSelected}>
                <Snowflake className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Freeze frame (F)</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="text" size="icon" onClick={handleDeleteSelected}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Delete element (Delete)</TooltipContent>
          </Tooltip>
          <div className="w-px h-6 bg-border mx-1" />
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="text" size="icon" onClick={handleToggleBookmark}>
                <Bookmark
                  className={`h-4 w-4 ${currentBookmarked ? "fill-primary text-primary" : ""}`}
                />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {currentBookmarked ? "Remove bookmark" : "Add bookmark"}
            </TooltipContent>
          </Tooltip>
          <div className="w-px h-6 bg-border mx-1" />
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="text"
                size="icon"
                onClick={detectAutomaticCuts}
                disabled={isAutoCutting}
              >
                {isAutoCutting ? (
                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                ) : (
                  <Scissors className="h-4 w-4" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {isAutoCutting
                ? "AI is analyzing..."
                : "Detect automatic cuts with AI"}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
      <div className="flex items-center gap-1">
        <TooltipProvider delayDuration={500}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="text" size="icon" onClick={toggleSnapping}>
                {snappingEnabled ? (
                  <Magnet className="h-4 w-4 text-primary" />
                ) : (
                  <Magnet className="h-4 w-4" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>Auto snapping</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="text" size="icon" onClick={toggleRippleEditing}>
                <Link
                  className={`h-4 w-4 ${
                    rippleEditingEnabled ? "text-primary" : ""
                  }`}
                />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {rippleEditingEnabled
                ? "Disable Ripple Editing"
                : "Enable Ripple Editing"}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>

        <div className="h-6 w-px bg-border mx-1" />
        <div className="flex items-center gap-1">
          <Button variant="text" size="icon" onClick={handleZoomOut}>
            <ZoomOut className="h-4 w-4" />
          </Button>
          <Slider
            className="w-24"
            value={[zoomLevel]}
            onValueChange={handleZoomSliderChange}
            min={0.25}
            max={4}
            step={0.25}
          />
          <Button variant="text" size="icon" onClick={handleZoomIn}>
            <ZoomIn className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
