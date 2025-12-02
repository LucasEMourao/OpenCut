"use client";

import { useRef, useState } from "react";
import { useTimelineStore } from "@/stores/timeline-store";
import { TimelineElement } from "./timeline-element";
import { TimelineTrack } from "@/types/timeline";
import type { TimelineElement as TimelineElementType } from "@/types/timeline";
import { TIMELINE_CONSTANTS } from "@/constants/timeline-constants";
import { SnapPoint } from "@/hooks/use-timeline-snapping";

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
  const {
    selectedElements,
    selectElement,
    startDrag: startDragAction,
    clearSelectedElements,
  } = useTimelineStore();

  const timelineRef = useRef<HTMLDivElement>(null);
  const [mouseDownLocation, setMouseDownLocation] = useState<{
    x: number;
    y: number;
  } | null>(null);

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

  return (
    <div
      className="w-full h-full hover:bg-muted/20"
      onClick={(e) => {
        // If clicking empty area (not on an element), deselect all elements
        if (!(e.target as HTMLElement).closest(".timeline-element")) {
          clearSelectedElements();
        }
      }}
    >
      <div
        ref={timelineRef}
        className="h-full relative track-elements-container min-w-full"
      >
        {track.elements.length === 0 ? (
          <div className="h-full w-full rounded-sm border-2 border-dashed border-muted/30 flex items-center justify-center text-xs text-muted-foreground transition-colors">
            {/* Empty track placeholder */}
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
