"use client";

import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "../../ui/button";

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
import { useTimelineZoom } from "@/hooks/use-timeline-zoom";
import { processMediaFiles } from "@/lib/media-processing";
import { toast } from "sonner";
import { useState, useRef, useEffect, useCallback } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  TimelinePlayhead,
  useTimelinePlayheadRuler,
} from "./timeline-playhead";
import { useSelectionBox } from "@/hooks/use-selection-box";
import { SnapIndicator } from "../snap-indicator";
import { SnapPoint } from "@/hooks/use-timeline-snapping";
import type {
  DragData,
  TimelineTrack,
  TrackType,
  MediaElement,
} from "@/types/timeline";
import {
  TIMELINE_CONSTANTS,
  snapTimeToFrame,
} from "@/constants/timeline-constants";
import { TimelineToolbar } from "./timeline-toolbar";
import { TimelineRuler } from "./timeline-ruler";
import { TrackList } from "./track-list";
import { TimelineCanvas } from "./timeline-canvas";

export function Timeline() {
  // Timeline shows all tracks (video, audio, effects) and their elements.
  // You can drag media here to add it to your project.
  // elements can be trimmed, deleted, and moved.

  const tracks = useTimelineStore(useShallow((state) => state.tracks));
  const getTotalDuration = useTimelineStore((state) => state.getTotalDuration);
  const clearSelectedElements = useTimelineStore(
    (state) => state.clearSelectedElements
  );
  const snappingEnabled = useTimelineStore((state) => state.snappingEnabled);
  const setSelectedElements = useTimelineStore(
    (state) => state.setSelectedElements
  );
  const toggleTrackMute = useTimelineStore((state) => state.toggleTrackMute);
  const toggleTrackLock = useTimelineStore((state) => state.toggleTrackLock);
  const toggleTrackVisibility = useTimelineStore(
    (state) => state.toggleTrackVisibility
  );
  const dragState = useTimelineStore(useShallow((state) => state.dragState));
  const { mediaItems, addMediaItem } = useMediaStore();
  const { activeProject } = useProjectStore();
  const { currentTime, duration, seek, setDuration, isPlaying, toggle } =
    usePlaybackStore();
  const [isDragOver, setIsDragOver] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const dragCounterRef = useRef(0);
  const timelineRef = useRef<HTMLDivElement>(null);
  const rulerRef = useRef<HTMLDivElement>(null);
  const [isInTimeline, setIsInTimeline] = useState(false);

  // Track mouse down/up for distinguishing clicks from drag/resize ends
  const mouseTrackingRef = useRef({
    isMouseDown: false,
    downX: 0,
    downY: 0,
    downTime: 0,
  });

  // Timeline zoom functionality
  const { zoomLevel, setZoomLevel, handleWheel } = useTimelineZoom({
    containerRef: timelineRef,
    isInTimeline,
  });

  // Old marquee selection removed - using new SelectionBox component instead

  // Dynamic timeline width calculation based on playhead position and duration
  const dynamicTimelineWidth = Math.max(
    (duration || 0) * TIMELINE_CONSTANTS.PIXELS_PER_SECOND * zoomLevel, // Base width from duration
    (currentTime + 30) * TIMELINE_CONSTANTS.PIXELS_PER_SECOND * zoomLevel, // Width to show current time + 30 seconds buffer
    timelineRef.current?.clientWidth || 1000 // Minimum width
  );

  // Scroll synchronization and auto-scroll to playhead
  const rulerScrollRef = useRef<HTMLDivElement>(null);
  const tracksScrollRef = useRef<HTMLDivElement>(null);
  const trackLabelsRef = useRef<HTMLDivElement>(null);
  const playheadRef = useRef<HTMLDivElement>(null);
  const trackLabelsScrollRef = useRef<HTMLDivElement>(null);
  const isUpdatingRef = useRef(false);
  const lastRulerSync = useRef(0);
  const lastTracksSync = useRef(0);
  const lastVerticalSync = useRef(0);

  // Timeline playhead ruler handlers
  const { handleRulerMouseDown } = useTimelinePlayheadRuler({
    currentTime,
    duration,
    zoomLevel,
    seek,
    rulerRef,
    rulerScrollRef,
    tracksScrollRef,
    playheadRef,
  });

  // Selection box functionality
  const tracksContainerRef = useRef<HTMLDivElement>(null);
  const {
    selectionBox,
    handleMouseDown: handleSelectionMouseDown,
    isSelecting,
    justFinishedSelecting,
  } = useSelectionBox({
    containerRef: tracksContainerRef,
    playheadRef,
    onSelectionComplete: (elements) => {
      console.log(JSON.stringify({ onSelectionComplete: elements.length }));
      setSelectedElements(elements);
    },
  });

  // Calculate snap indicator state
  const [currentSnapPoint, setCurrentSnapPoint] = useState<SnapPoint | null>(
    null
  );
  const showSnapIndicator =
    dragState.isDragging && snappingEnabled && currentSnapPoint !== null;

  // Callback to handle snap point changes from TimelineTrackContent
  const handleSnapPointChange = useCallback((snapPoint: SnapPoint | null) => {
    setCurrentSnapPoint(snapPoint);
  }, []);

  // Track mouse down to distinguish real clicks from drag/resize ends
  const handleTimelineMouseDown = useCallback((e: React.MouseEvent) => {
    // Only track mouse down on timeline background areas (not elements)
    const target = e.target as HTMLElement;
    console.log(
      JSON.stringify({
        debug_mousedown: "START",
        target_class: target.className,
        target_parent_class: target.parentElement?.className,
        clientX: e.clientX,
        clientY: e.clientY,
        timeStamp: e.timeStamp,
      })
    );

    const isTimelineBackground =
      !target.closest(".timeline-element") &&
      !playheadRef.current?.contains(target) &&
      !target.closest("[data-track-labels]");

    console.log(
      JSON.stringify({
        debug_mousedown: "CHECK",
        isTimelineBackground,
        hasTimelineElement: !!target.closest(".timeline-element"),
        hasPlayhead: !!playheadRef.current?.contains(target),
        hasTrackLabels: !!target.closest("[data-track-labels]"),
      })
    );

    if (isTimelineBackground) {
      mouseTrackingRef.current = {
        isMouseDown: true,
        downX: e.clientX,
        downY: e.clientY,
        downTime: e.timeStamp,
      };
      console.log(
        JSON.stringify({
          debug_mousedown: "TRACKED",
          mouseTracking: mouseTrackingRef.current,
        })
      );
    } else {
      console.log(
        JSON.stringify({
          debug_mousedown: "IGNORED - not timeline background",
        })
      );
    }
  }, []);

  // Timeline content click to seek handler
  const handleTimelineContentClick = useCallback(
    (e: React.MouseEvent) => {
      console.log(
        JSON.stringify({
          debug_click: "START",
          target: (e.target as HTMLElement).className,
          target_parent: (e.target as HTMLElement).parentElement?.className,
          mouseTracking: mouseTrackingRef.current,
          isSelecting,
          justFinishedSelecting,
          clickX: e.clientX,
          clickY: e.clientY,
          timeStamp: e.timeStamp,
        })
      );

      const { isMouseDown, downX, downY, downTime } = mouseTrackingRef.current;

      // Reset mouse tracking
      mouseTrackingRef.current = {
        isMouseDown: false,
        downX: 0,
        downY: 0,
        downTime: 0,
      };

      // Only process as click if we tracked a mouse down on timeline background
      if (!isMouseDown) {
        console.log(
          JSON.stringify({
            debug_click: "REJECTED - no mousedown",
            mouseTracking: mouseTrackingRef.current,
          })
        );
        return;
      }

      // Check if mouse moved significantly (indicates drag, not click)
      const deltaX = Math.abs(e.clientX - downX);
      const deltaY = Math.abs(e.clientY - downY);
      const deltaTime = e.timeStamp - downTime;

      if (deltaX > 5 || deltaY > 5 || deltaTime > 500) {
        console.log(
          JSON.stringify({
            debug_click: "REJECTED - movement too large",
            deltaX,
            deltaY,
            deltaTime,
          })
        );
        return;
      }

      // Don't seek if this was a selection box operation
      if (isSelecting || justFinishedSelecting) {
        console.log(
          JSON.stringify({
            debug_click: "REJECTED - selection operation",
            isSelecting,
            justFinishedSelecting,
          })
        );
        return;
      }

      // Don't seek if clicking on timeline elements, but still deselect
      if ((e.target as HTMLElement).closest(".timeline-element")) {
        console.log(
          JSON.stringify({
            debug_click: "REJECTED - clicked timeline element",
          })
        );
        return;
      }

      // Don't seek if clicking on playhead
      if (playheadRef.current?.contains(e.target as Node)) {
        console.log(
          JSON.stringify({
            debug_click: "REJECTED - clicked playhead",
          })
        );
        return;
      }

      // Don't seek if clicking on track labels
      if ((e.target as HTMLElement).closest("[data-track-labels]")) {
        console.log(
          JSON.stringify({
            debug_click: "REJECTED - clicked track labels",
          })
        );
        clearSelectedElements();
        return;
      }

      // Clear selected elements when clicking empty timeline area
      console.log(
        JSON.stringify({
          debug_click: "PROCEEDING - clearing elements",
          clearingSelectedElements: true,
        })
      );
      clearSelectedElements();

      // Determine if we're clicking in ruler or tracks area
      const isRulerClick = (e.target as HTMLElement).closest(
        "[data-ruler-area]"
      );

      console.log(
        JSON.stringify({
          debug_click: "CALCULATING POSITION",
          isRulerClick,
          clientX: e.clientX,
          clientY: e.clientY,
          target_element: (e.target as HTMLElement).tagName,
          target_class: (e.target as HTMLElement).className,
        })
      );

      let mouseX: number;
      let scrollLeft = 0;

      if (isRulerClick) {
        // Calculate based on ruler position
        const rulerContent = rulerScrollRef.current;
        if (!rulerContent) {
          console.log(
            JSON.stringify({
              debug_click: "ERROR - no ruler container found",
            })
          );
          return;
        }
        const rect = rulerContent.getBoundingClientRect();
        mouseX = e.clientX - rect.left;
        scrollLeft = rulerContent.scrollLeft;
      } else {
        const tracksContent = tracksScrollRef.current;
        if (!tracksContent) {
          return;
        }
        const rect = tracksContent.getBoundingClientRect();
        mouseX = e.clientX - rect.left;
        scrollLeft = tracksContent.scrollLeft;
      }

      const rawTime = Math.max(
        0,
        Math.min(
          duration,
          (mouseX + scrollLeft) /
            (TIMELINE_CONSTANTS.PIXELS_PER_SECOND * zoomLevel)
        )
      );

      // Use frame snapping for timeline clicking
      const projectFps = activeProject?.fps || 30;
      const time = snapTimeToFrame(rawTime, projectFps);
      seek(time);
    },
    [
      duration,
      zoomLevel,
      seek,
      rulerScrollRef,
      tracksScrollRef,
      clearSelectedElements,
      isSelecting,
      justFinishedSelecting,
    ]
  );

  // Update timeline duration when tracks change
  useEffect(() => {
    const totalDuration = getTotalDuration();
    setDuration(Math.max(totalDuration, 10)); // Minimum 10 seconds for empty timeline
  }, [tracks, setDuration, getTotalDuration]);

  // Old marquee system removed - using new SelectionBox component instead

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    // When something is dragged over the timeline, show overlay
    e.preventDefault();
    // Don't show overlay for timeline elements - they're handled by tracks
    if (e.dataTransfer.types.includes("application/x-timeline-element")) {
      return;
    }
    dragCounterRef.current += 1;
    if (!isDragOver) {
      setIsDragOver(true);
    }
  }, [isDragOver]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();

    // Don't update state for timeline elements - they're handled by tracks
    if (e.dataTransfer.types.includes("application/x-timeline-element")) {
      return;
    }

    dragCounterRef.current -= 1;
    if (dragCounterRef.current === 0) {
      setIsDragOver(false);
    }
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    // When media is dropped, add it as a new track/element
    e.preventDefault();
    setIsDragOver(false);
    dragCounterRef.current = 0;

    // Ignore timeline element drags - they're handled by track-specific handlers
    const hasTimelineElement = e.dataTransfer.types.includes(
      "application/x-timeline-element"
    );
    if (hasTimelineElement) {
      return;
    }

    const itemData = e.dataTransfer.getData("application/x-media-item");
    if (itemData) {
      try {
        const dragData: DragData = JSON.parse(itemData);

        if (dragData.type === "text") {
          // Always create new text track to avoid overlaps
          useTimelineStore.getState().addTextToNewTrack(dragData);
        } else {
          // Handle media items
          const mediaItem = mediaItems.find(
            (item: any) => item.id === dragData.id
          );
          if (!mediaItem) {
            toast.error("Media item not found");
            return;
          }

          useTimelineStore.getState().addMediaToNewTrack(mediaItem);
        }
      } catch (error) {
        console.error("Error parsing dropped item data:", error);
        toast.error("Failed to add item to timeline");
      }
    } else if (e.dataTransfer.files?.length > 0) {
      // Handle file drops by creating new tracks
      if (!activeProject) {
        toast.error("No active project");
        return;
      }

      setIsProcessing(true);
      setProgress(0);
      try {
        const processedItems = await processMediaFiles(
          e.dataTransfer.files,
          (p) => setProgress(p)
        );
        for (const processedItem of processedItems) {
          await addMediaItem(activeProject.id, processedItem);
          const currentMediaItems = useMediaStore.getState().mediaItems;
          const addedItem = currentMediaItems.find(
            (item) =>
              item.name === processedItem.name && item.url === processedItem.url
          );
          if (addedItem) {
            const trackType: TrackType =
              addedItem.type === "audio" ? "audio" : "media";
            const targetTrackId = useTimelineStore
              .getState()
              .insertTrackAt(trackType, 0);

            useTimelineStore.getState().addElementToTrack(targetTrackId, {
              type: "media",
              mediaId: addedItem.id,
              name: addedItem.name,
              duration: addedItem.duration || 5,
              startTime: currentTime,
              trimStart: 0,
              trimEnd: 0,
            });
          }
        }
      } catch (error) {
        // Show error if file processing fails
        console.error("Error processing external files:", error);
        toast.error("Failed to process dropped files");
      } finally {
        setIsProcessing(false);
        setProgress(0);
      }
    }
  }, [activeProject, addMediaItem, currentTime, mediaItems]);

  const dragProps = {
    onDragEnter: handleDragEnter,
    onDragOver: handleDragOver,
    onDragLeave: handleDragLeave,
    onDrop: handleDrop,
  };

  // --- Scroll synchronization effect ---
  useEffect(() => {
    const rulerViewport = rulerScrollRef.current;
    const tracksViewport = tracksScrollRef.current;
    const trackLabelsViewport = trackLabelsScrollRef.current;

    if (!rulerViewport || !tracksViewport) return;

    // Horizontal scroll synchronization between ruler and tracks
    const handleRulerScroll = () => {
      const now = Date.now();
      if (isUpdatingRef.current || now - lastRulerSync.current < 16) return;
      lastRulerSync.current = now;
      isUpdatingRef.current = true;
      tracksViewport.scrollLeft = rulerViewport.scrollLeft;
      isUpdatingRef.current = false;
    };
    const handleTracksScroll = () => {
      const now = Date.now();
      if (isUpdatingRef.current || now - lastTracksSync.current < 16) return;
      lastTracksSync.current = now;
      isUpdatingRef.current = true;
      rulerViewport.scrollLeft = tracksViewport.scrollLeft;
      isUpdatingRef.current = false;
    };

    rulerViewport.addEventListener("scroll", handleRulerScroll);
    tracksViewport.addEventListener("scroll", handleTracksScroll);

    // Vertical scroll synchronization between track labels and tracks content
    if (trackLabelsViewport) {
      const handleTrackLabelsScroll = () => {
        const now = Date.now();
        if (isUpdatingRef.current || now - lastVerticalSync.current < 16)
          return;
        lastVerticalSync.current = now;
        isUpdatingRef.current = true;
        tracksViewport.scrollTop = trackLabelsViewport.scrollTop;
        isUpdatingRef.current = false;
      };
      const handleTracksVerticalScroll = () => {
        const now = Date.now();
        if (isUpdatingRef.current || now - lastVerticalSync.current < 16)
          return;
        lastVerticalSync.current = now;
        isUpdatingRef.current = true;
        trackLabelsViewport.scrollTop = tracksViewport.scrollTop;
        isUpdatingRef.current = false;
      };

      trackLabelsViewport.addEventListener("scroll", handleTrackLabelsScroll);
      tracksViewport.addEventListener("scroll", handleTracksVerticalScroll);

      return () => {
        rulerViewport.removeEventListener("scroll", handleRulerScroll);
        tracksViewport.removeEventListener("scroll", handleTracksScroll);
        trackLabelsViewport.removeEventListener(
          "scroll",
          handleTrackLabelsScroll
        );
        tracksViewport.removeEventListener(
          "scroll",
          handleTracksVerticalScroll
        );
      };
    }

    return () => {
      rulerViewport.removeEventListener("scroll", handleRulerScroll);
      tracksViewport.removeEventListener("scroll", handleTracksScroll);
    };
  }, []);

  // Combined handler for TimelineCanvas mouse down
  const handleCanvasMouseDown = useCallback(
    (e: React.MouseEvent) => {
      handleTimelineMouseDown(e);
      handleSelectionMouseDown(e);
    },
    [handleTimelineMouseDown, handleSelectionMouseDown]
  );

  return (
    <div
      className={
        "h-full flex flex-col transition-colors duration-200 relative bg-panel rounded-sm overflow-hidden"
      }
      {...dragProps}
      onMouseEnter={() => setIsInTimeline(true)}
      onMouseLeave={() => setIsInTimeline(false)}
    >
      <TimelineToolbar zoomLevel={zoomLevel} setZoomLevel={setZoomLevel} />

      {/* Timeline Container */}
      <div
        className="flex-1 flex flex-col overflow-hidden relative"
        ref={timelineRef}
      >
        <TimelinePlayhead
          currentTime={currentTime}
          duration={duration}
          zoomLevel={zoomLevel}
          tracks={tracks}
          seek={seek}
          rulerRef={rulerRef}
          rulerScrollRef={rulerScrollRef}
          tracksScrollRef={tracksScrollRef}
          trackLabelsRef={trackLabelsRef}
          timelineRef={timelineRef}
          playheadRef={playheadRef}
          isSnappingToPlayhead={
            showSnapIndicator && currentSnapPoint?.type === "playhead"
          }
        />
        <SnapIndicator
          snapPoint={currentSnapPoint}
          zoomLevel={zoomLevel}
          tracks={tracks}
          timelineRef={timelineRef}
          trackLabelsRef={trackLabelsRef}
          tracksScrollRef={tracksScrollRef}
          isVisible={showSnapIndicator}
        />
        {/* Timeline Header with Ruler */}
        <div className="flex bg-panel sticky top-0 z-10">
          {/* Track Labels Header */}
          <div className="w-28 shrink-0 bg-panel border-r flex items-center justify-between px-3 py-2">
            {/* Empty space */}
            <span className="text-sm font-medium text-muted-foreground opacity-0">
              .
            </span>
          </div>

          {/* Timeline Ruler */}
          <TimelineRuler
            rulerRef={rulerRef}
            rulerScrollRef={rulerScrollRef}
            zoomLevel={zoomLevel}
            duration={duration}
            dynamicTimelineWidth={dynamicTimelineWidth}
            onWheel={handleWheel}
            onMouseDown={handleSelectionMouseDown}
            onClick={handleTimelineContentClick}
            onRulerMouseDown={handleRulerMouseDown}
          />
        </div>

        {/* Tracks Area */}
        <div className="flex-1 flex overflow-hidden">
          {/* Track Labels */}
          <TrackList
            tracks={tracks}
            toggleTrackMute={toggleTrackMute}
            toggleTrackLock={toggleTrackLock}
            toggleTrackVisibility={toggleTrackVisibility}
            trackLabelsRef={trackLabelsRef}
            trackLabelsScrollRef={trackLabelsScrollRef}
          />

          {/* Timeline Tracks Content */}
          <TimelineCanvas
            tracks={tracks}
            zoomLevel={zoomLevel}
            dynamicTimelineWidth={dynamicTimelineWidth}
            tracksContainerRef={tracksContainerRef}
            tracksScrollRef={tracksScrollRef}
            onWheel={handleWheel}
            onMouseDown={handleCanvasMouseDown}
            onClick={handleTimelineContentClick}
            selectionBox={selectionBox}
            onSnapPointChange={handleSnapPointChange}
            clearSelectedElements={clearSelectedElements}
            toggleTrackMute={toggleTrackMute}
          />
        </div>
      </div>
    </div>
  );
}




