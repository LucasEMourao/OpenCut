"use client";

import { useRef, useState, useEffect } from "react";
import { useTimelineStore } from "@/stores/timeline-store";
import { useMediaStore } from "@/stores/media-store";
import { toast } from "sonner";
import { processMediaFiles } from "@/lib/media-processing";
import { TimelineElement } from "./timeline-element";
import {
  TimelineTrack,
  getMainTrack,
  canElementGoOnTrack,
} from "@/types/timeline";
import { usePlaybackStore } from "@/stores/playback-store";
import type {
  TimelineElement as TimelineElementType,
  DragData,
  TrackType,
} from "@/types/timeline";
import {
  snapTimeToFrame,
  TIMELINE_CONSTANTS,
} from "@/constants/timeline-constants";
import { useProjectStore } from "@/stores/project-store";
import { useTimelineSnapping, SnapPoint } from "@/hooks/use-timeline-snapping";

export function TimelineTrackContent({
  track,
  zoomLevel,
  onSnapPointChange,
  visibleWindow,
}: {
  track: TimelineTrack;
  zoomLevel: number;
  onSnapPointChange?: (snapPoint: SnapPoint | null) => void;
  visibleWindow: { start: number; end: number };
}) {
  const { mediaItems } = useMediaStore();
  const {
    tracks,
    addTrack,
    moveElementToTrack,
    updateElementStartTime,
    updateElementStartTimeWithRipple,
    addElementToTrack,
    selectedElements,
    selectElement,
    dragState,
    startDrag: startDragAction,
    updateDragTime,
    endDrag: endDragAction,
    clearSelectedElements,
    insertTrackAt,
    snappingEnabled,
    rippleEditingEnabled,
  } = useTimelineStore();

  const { currentTime } = usePlaybackStore();

  // Initialize snapping hook
  const { snapElementPosition, snapElementEdge } = useTimelineSnapping({
    snapThreshold: 10,
    enableElementSnapping: snappingEnabled,
    enablePlayheadSnapping: snappingEnabled,
  });

  // Helper function for drop snapping that tries both edges
  const getDropSnappedTime = (
    dropTime: number,
    elementDuration: number,
    excludeElementId?: string
  ) => {
    // Always apply frame snapping first
    const projectStore = useProjectStore.getState();
    const projectFps = projectStore.activeProject?.fps || 30;
    let finalTime = snapTimeToFrame(dropTime, projectFps);

    // Additionally apply element snapping if enabled
    if (snappingEnabled) {
      // Try snapping both start and end edges for drops
      const startSnapResult = snapElementEdge(
        dropTime,
        elementDuration,
        tracks,
        currentTime,
        zoomLevel,
        excludeElementId,
        true // snap to start edge
      );

      const endSnapResult = snapElementEdge(
        dropTime,
        elementDuration,
        tracks,
        currentTime,
        zoomLevel,
        excludeElementId,
        false // snap to end edge
      );

      // Choose the snap result with the smaller distance (closer snap)
      let bestSnapResult = startSnapResult;
      if (
        endSnapResult.snapPoint &&
        (!startSnapResult.snapPoint ||
          endSnapResult.snapDistance < startSnapResult.snapDistance)
      ) {
        bestSnapResult = endSnapResult;
      }

      // Only use element snapping if it found a snap point, otherwise keep frame-snapped time
      if (bestSnapResult.snapPoint) {
        finalTime = bestSnapResult.snappedTime;
      }
    }

    return finalTime;
  };

  const timelineRef = useRef<HTMLDivElement>(null);
  const [isDropping, setIsDropping] = useState(false);
  const [dropPosition, setDropPosition] = useState<number | null>(null);
  const [wouldOverlap, setWouldOverlap] = useState(false);
  const dragCounterRef = useRef(0);
  const [mouseDownLocation, setMouseDownLocation] = useState<{
    x: number;
    y: number;
  } | null>(null);

  // Set up mouse event listeners for drag
  useEffect(() => {
    if (!dragState.isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!timelineRef.current) return;

      // On first mouse move during drag, ensure the element is selected
      if (dragState.elementId && dragState.trackId) {
        const isSelected = selectedElements.some(
          (c) =>
            c.trackId === dragState.trackId &&
            c.elementId === dragState.elementId
        );

        if (!isSelected) {
          // Select this element (replacing other selections) since we're dragging it
          selectElement(dragState.trackId, dragState.elementId, false);
        }
      }

      const timelineRect = timelineRef.current.getBoundingClientRect();
      const mouseX = e.clientX - timelineRect.left;
      const mouseTime = Math.max(
        0,
        mouseX / (TIMELINE_CONSTANTS.PIXELS_PER_SECOND * zoomLevel)
      );
      const adjustedTime = Math.max(0, mouseTime - dragState.clickOffsetTime);

      // Always apply frame snapping first
      const projectStore = useProjectStore.getState();
      const projectFps = projectStore.activeProject?.fps || 30;
      let finalTime = snapTimeToFrame(adjustedTime, projectFps);
      let snapPoint = null;

      // Additionally apply element snapping if enabled
      if (snappingEnabled) {
        // Find the element being dragged to get its duration
        let elementDuration = 5; // fallback duration
        if (dragState.elementId && dragState.trackId) {
          const sourceTrack = tracks.find((t) => t.id === dragState.trackId);
          const element = sourceTrack?.elements.find(
            (e) => e.id === dragState.elementId
          );
          if (element) {
            elementDuration =
              element.duration - element.trimStart - element.trimEnd;
          }
        }

        // Try snapping both start and end edges
        const startSnapResult = snapElementEdge(
          adjustedTime,
          elementDuration,
          tracks,
          currentTime,
          zoomLevel,
          dragState.elementId || undefined,
          true // snap to start edge
        );

        const endSnapResult = snapElementEdge(
          adjustedTime,
          elementDuration,
          tracks,
          currentTime,
          zoomLevel,
          dragState.elementId || undefined,
          false // snap to end edge
        );

        // Choose the snap result with the smaller distance (closer snap)
        let bestSnapResult = startSnapResult;
        if (
          endSnapResult.snapPoint &&
          (!startSnapResult.snapPoint ||
            endSnapResult.snapDistance < startSnapResult.snapDistance)
        ) {
          bestSnapResult = endSnapResult;
        }

        // Only use element snapping if it found a snap point, otherwise keep frame-snapped time
        if (bestSnapResult.snapPoint) {
          finalTime = bestSnapResult.snappedTime;
          snapPoint = bestSnapResult.snapPoint;
        }

        // Notify parent component about snap point change
        onSnapPointChange?.(snapPoint);
      } else {
        // Clear snap point when element snapping is disabled
        onSnapPointChange?.(null);
      }

      updateDragTime(finalTime);
    };

    const handleMouseUp = (e: MouseEvent) => {
      if (!dragState.elementId || !dragState.trackId) return;

      // If this track initiated the drag, we should handle the mouse up regardless of where it occurs
      const isTrackThatStartedDrag = dragState.trackId === track.id;

      const timelineRect = timelineRef.current?.getBoundingClientRect();
      if (!timelineRect) {
        if (isTrackThatStartedDrag) {
          if (rippleEditingEnabled) {
            updateElementStartTimeWithRipple(
              track.id,
              dragState.elementId,
              dragState.currentTime
            );
          } else {
            updateElementStartTime(
              track.id,
              dragState.elementId,
              dragState.currentTime
            );
          }
          endDragAction();
          // Clear snap point when drag ends
          onSnapPointChange?.(null);
        }
        return;
      }

      const isMouseOverThisTrack =
        e.clientY >= timelineRect.top && e.clientY <= timelineRect.bottom;

      if (!isMouseOverThisTrack && !isTrackThatStartedDrag) return;

      const finalTime = dragState.currentTime;

      if (isMouseOverThisTrack) {
        const sourceTrack = tracks.find((t) => t.id === dragState.trackId);
        const movingElement = sourceTrack?.elements.find(
          (c) => c.id === dragState.elementId
        );

        if (movingElement) {
          const movingElementDuration =
            movingElement.duration -
            movingElement.trimStart -
            movingElement.trimEnd;
          const movingElementEnd = finalTime + movingElementDuration;

          const targetTrack = tracks.find((t) => t.id === track.id);
          const hasOverlap = targetTrack?.elements.some((existingElement) => {
            if (
              dragState.trackId === track.id &&
              existingElement.id === dragState.elementId
            ) {
              return false;
            }
            const existingStart = existingElement.startTime;
            const existingEnd =
              existingElement.startTime +
              (existingElement.duration -
                existingElement.trimStart -
                existingElement.trimEnd);
            return finalTime < existingEnd && movingElementEnd > existingStart;
          });

          if (!hasOverlap) {
            if (dragState.trackId === track.id) {
              if (rippleEditingEnabled) {
                updateElementStartTimeWithRipple(
                  track.id,
                  dragState.elementId,
                  finalTime
                );
              } else {
                updateElementStartTime(
                  track.id,
                  dragState.elementId,
                  finalTime
                );
              }
            } else {
              moveElementToTrack(
                dragState.trackId,
                track.id,
                dragState.elementId
              );
              requestAnimationFrame(() => {
                if (rippleEditingEnabled) {
                  updateElementStartTimeWithRipple(
                    track.id,
                    dragState.elementId!,
                    finalTime
                  );
                } else {
                  updateElementStartTime(
                    track.id,
                    dragState.elementId!,
                    finalTime
                  );
                }
              });
            }
          }
        }
      } else if (isTrackThatStartedDrag) {
        // Mouse is not over this track, but this track started the drag
        // This means user released over ruler/outside - update position within same track
        const sourceTrack = tracks.find((t) => t.id === dragState.trackId);
        const movingElement = sourceTrack?.elements.find(
          (c) => c.id === dragState.elementId
        );

        if (movingElement) {
          const movingElementDuration =
            movingElement.duration -
            movingElement.trimStart -
            movingElement.trimEnd;
          const movingElementEnd = finalTime + movingElementDuration;

          const hasOverlap = track.elements.some((existingElement) => {
            if (existingElement.id === dragState.elementId) {
              return false;
            }
            const existingStart = existingElement.startTime;
            const existingEnd =
              existingElement.startTime +
              (existingElement.duration -
                existingElement.trimStart -
                existingElement.trimEnd);
            return finalTime < existingEnd && movingElementEnd > existingStart;
          });

          if (!hasOverlap) {
            if (rippleEditingEnabled) {
              updateElementStartTimeWithRipple(
                track.id,
                dragState.elementId,
                finalTime
              );
            } else {
              updateElementStartTime(track.id, dragState.elementId, finalTime);
            }
          }
        }
      }

      if (isTrackThatStartedDrag) {
        endDragAction();
        // Clear snap point when drag ends
        onSnapPointChange?.(null);
      }
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [
    dragState.isDragging,
    dragState.clickOffsetTime,
    dragState.elementId,
    dragState.trackId,
    dragState.currentTime,
    zoomLevel,
    tracks,
    track.id,
    updateDragTime,
    updateElementStartTime,
    moveElementToTrack,
    endDragAction,
    selectedElements,
    selectElement,
    onSnapPointChange,
  ]);

  const handleElementMouseDown = (
    e: React.MouseEvent,
    element: TimelineElementType
  ) => {
    setMouseDownLocation({ x: e.clientX, y: e.clientY });

    // Detect right-click (button 2) and handle selection without starting drag
    const isRightClick = e.button === 2;
    const isMultiSelect = e.metaKey || e.ctrlKey || e.shiftKey;

    if (isRightClick) {
      // Handle right-click selection
      const isSelected = selectedElements.some(
        (c) => c.trackId === track.id && c.elementId === element.id
      );

      // If element is not selected, select it (keep other selections if multi-select)
      if (!isSelected) {
        selectElement(track.id, element.id, isMultiSelect);
      }
      // If element is already selected, keep it selected

      // Don't start drag action for right-clicks
      return;
    }

    // Handle multi-selection for left-click with modifiers
    if (isMultiSelect) {
      selectElement(track.id, element.id, true);
    }

    // Calculate the offset from the left edge of the element to where the user clicked
    const elementElement = e.currentTarget as HTMLElement;
    const elementRect = elementElement.getBoundingClientRect();
    const clickOffsetX = e.clientX - elementRect.left;
    const clickOffsetTime =
      clickOffsetX / (TIMELINE_CONSTANTS.PIXELS_PER_SECOND * zoomLevel);

    startDragAction(
      element.id,
      track.id,
      e.clientX,
      element.startTime,
      clickOffsetTime
    );
  };

  const handleElementClick = (
    e: React.MouseEvent,
    element: TimelineElementType
  ) => {
    e.stopPropagation();

    // Check if mouse moved significantly
    if (mouseDownLocation) {
      const deltaX = Math.abs(e.clientX - mouseDownLocation.x);
      const deltaY = Math.abs(e.clientY - mouseDownLocation.y);
      // If it moved more than a few pixels, consider it a drag and not a click.
      if (deltaX > 5 || deltaY > 5) {
        setMouseDownLocation(null); // Reset for next interaction
        return;
      }
    }

    // Skip selection logic for multi-selection (handled in mousedown)
    if (e.metaKey || e.ctrlKey || e.shiftKey) {
      return;
    }

    // Handle single selection
    const isSelected = selectedElements.some(
      (c) => c.trackId === track.id && c.elementId === element.id
    );

    if (!isSelected) {
      // If element is not selected, select it (replacing other selections)
      selectElement(track.id, element.id, false);
    }
    // If element is already selected, keep it selected (do nothing)
  };



  const handleTrackDragEnter = (e: React.DragEvent) => {
    e.preventDefault();

    const hasTimelineElement = e.dataTransfer.types.includes(
      "application/x-timeline-element"
    );
    const hasMediaItem = e.dataTransfer.types.includes(
      "application/x-media-item"
    );

    if (!hasTimelineElement && !hasMediaItem) return;

    dragCounterRef.current++;
    setIsDropping(true);
  };

  const handleTrackDragLeave = (e: React.DragEvent) => {
    e.preventDefault();

    const hasTimelineElement = e.dataTransfer.types.includes(
      "application/x-timeline-element"
    );
    const hasMediaItem = e.dataTransfer.types.includes(
      "application/x-media-item"
    );

    if (!hasTimelineElement && !hasMediaItem) return;

    dragCounterRef.current--;

    if (dragCounterRef.current === 0) {
      setIsDropping(false);
      setWouldOverlap(false);
      setDropPosition(null);
    }
  };



  return (
    <div
      className="w-full h-full hover:bg-muted/20"
      onClick={(e) => {
        // If clicking empty area (not on an element), deselect all elements
        if (!(e.target as HTMLElement).closest(".timeline-element")) {
          clearSelectedElements();
        }
      }}

      onDragEnter={handleTrackDragEnter}
      onDragLeave={handleTrackDragLeave}

    >
      <div
        ref={timelineRef}
        className="h-full relative track-elements-container min-w-full"
      >
        {track.elements.length === 0 ? (
          <div
            className={`h-full w-full rounded-sm border-2 border-dashed flex items-center justify-center text-xs text-muted-foreground transition-colors ${
              isDropping
                ? wouldOverlap
                  ? "border-red-500 bg-red-500/10 text-red-600"
                  : "border-blue-500 bg-blue-500/10 text-blue-600"
                : "border-muted/30"
            }`}
          >
            {isDropping
              ? wouldOverlap
                ? "Cannot drop - would overlap"
                : "Drop element here"
              : ""}
          </div>
        ) : (
          <>
            {track.elements.map((element) => {
              // Virtualization check
              const elementEnd =
                element.startTime +
                (element.duration - element.trimStart - element.trimEnd);
              const isVisible =
                elementEnd > visibleWindow.start &&
                element.startTime < visibleWindow.end;

              if (!isVisible) return null;

              const isSelected = selectedElements.some(
                (c) => c.trackId === track.id && c.elementId === element.id
              );

              return (
                <TimelineElement
                  key={element.id}
                  element={element}
                  track={track}
                  zoomLevel={zoomLevel}
                  isSelected={isSelected}
                  onElementMouseDown={handleElementMouseDown}
                  onElementClick={handleElementClick}
                />
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}
