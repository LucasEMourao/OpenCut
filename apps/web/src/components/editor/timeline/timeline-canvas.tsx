"use client";

import { memo } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "../../ui/context-menu";
import { TimelineTrackContent } from "./timeline-track";
import { SelectionBox } from "../selection-box";
import { TimelineTrack } from "@/types/timeline";
import { SnapPoint } from "@/hooks/use-timeline-snapping";
import {
  getTrackHeight,
  getCumulativeHeightBefore,
  getTotalTracksHeight,
  TIMELINE_CONSTANTS,
  snapTimeToFrame,
} from "@/constants/timeline-constants";
import { useTimelineStore } from "@/stores/timeline-store";
import { useShallow } from "zustand/react/shallow";
import { useRef, useState, useEffect } from "react";

interface TimelineCanvasProps {
  tracks: TimelineTrack[];
  zoomLevel: number;
  dynamicTimelineWidth: number;
  tracksContainerRef: React.RefObject<HTMLDivElement>;
  tracksScrollRef: React.RefObject<HTMLDivElement>;
  onWheel: (e: React.WheelEvent) => void;
  onMouseDown: (e: React.MouseEvent) => void;
  onClick: (e: React.MouseEvent) => void;
  selectionBox: any; // Using any for now to match the hook return type, ideally should be typed
  onSnapPointChange: (snapPoint: SnapPoint | null) => void;
  clearSelectedElements: () => void;
  toggleTrackMute: (trackId: string) => void;
}

export const TimelineCanvas = memo(function TimelineCanvas({
  tracks,
  zoomLevel,
  dynamicTimelineWidth,
  tracksContainerRef,
  tracksScrollRef,
  onWheel,
  onMouseDown,
  onClick,
  selectionBox,
  onSnapPointChange,
  clearSelectedElements,
  toggleTrackMute,
}: TimelineCanvasProps) {
  const externalDragItem = useTimelineStore(
    useShallow((state) => state.externalDragItem)
  );
  const [ghostState, setGhostState] = useState<{
    trackId: string | null;
    time: number;
  } | null>(null);

  // Virtualization state
  const [visibleWindow, setVisibleWindow] = useState({ start: 0, end: 100 });
  const lastVisibleWindow = useRef(visibleWindow);

  useEffect(() => {
    const scrollContainer = tracksScrollRef.current;
    if (!scrollContainer) return;

    const handleScroll = () => {
      const scrollLeft = scrollContainer.scrollLeft;
      const containerWidth = scrollContainer.clientWidth;

      const start =
        scrollLeft / (TIMELINE_CONSTANTS.PIXELS_PER_SECOND * zoomLevel);
      const end =
        (scrollLeft + containerWidth) /
        (TIMELINE_CONSTANTS.PIXELS_PER_SECOND * zoomLevel);

      const buffer = 10; // 10 seconds buffer
      const newStart = Math.max(0, start - buffer);
      const newEnd = end + buffer;

      // Only update if changed significantly (e.g. > 1s) to avoid excessive re-renders
      if (
        Math.abs(newStart - lastVisibleWindow.current.start) > 1 ||
        Math.abs(newEnd - lastVisibleWindow.current.end) > 1
      ) {
        const newWindow = { start: newStart, end: newEnd };
        setVisibleWindow(newWindow);
        lastVisibleWindow.current = newWindow;
      }
    };

    // Add scroll listener
    // Note: We need to attach to the scroll viewport.
    // If tracksScrollRef points to the viewport, this works.
    // If it points to a wrapper, we might need to find the viewport.
    // Assuming tracksScrollRef works for scroll events as per index.tsx usage.
    scrollContainer.addEventListener("scroll", handleScroll);
    window.addEventListener("resize", handleScroll);

    // Initial calculation
    handleScroll();

    return () => {
      scrollContainer.removeEventListener("scroll", handleScroll);
      window.removeEventListener("resize", handleScroll);
    };
  }, [tracksScrollRef, zoomLevel]);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (!externalDragItem) return;

    const tracksContent = tracksScrollRef.current;
    if (!tracksContent) return;

    const rect = tracksContent.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const scrollLeft = tracksContent.scrollLeft;

    // Calculate time
    const rawTime = Math.max(
      0,
      (mouseX + scrollLeft) /
        (TIMELINE_CONSTANTS.PIXELS_PER_SECOND * zoomLevel)
    );
    const time = snapTimeToFrame(rawTime, 30); // Default to 30fps for ghost snapping

    // Calculate track
    const mouseY = e.clientY - rect.top + tracksContent.scrollTop;
    let currentY = 0;
    let targetTrackId = null;

    for (const track of tracks) {
      const height = getTrackHeight(track.type);
      if (mouseY >= currentY && mouseY < currentY + height) {
        targetTrackId = track.id;
        break;
      }
      currentY += height;
    }

    setGhostState({ time, trackId: targetTrackId });
  };

  const handleDragLeave = () => {
    setGhostState(null);
  };

  // Helper to find track index for ghost positioning
  const getTrackIndex = (id: string) => tracks.findIndex((t) => t.id === id);

  return (
    <div
      className="flex-1 relative overflow-hidden"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onWheel={(e) => {
        // Check if this is horizontal scrolling - if so, don't handle it here
        if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
          return; // Let ScrollArea handle horizontal scrolling
        }
        onWheel(e);
      }}
      onMouseDown={onMouseDown}
      onClick={onClick}
      ref={tracksContainerRef}
    >
      <SelectionBox
        startPos={selectionBox?.startPos || null}
        currentPos={selectionBox?.currentPos || null}
        containerRef={tracksContainerRef}
        isActive={selectionBox?.isActive || false}
      />
      <ScrollArea className="w-full h-full" ref={tracksScrollRef}>
        <div
          className="relative flex-1"
          style={{
            height: `${Math.max(
              200,
              Math.min(800, getTotalTracksHeight(tracks))
            )}px`,
            width: `${dynamicTimelineWidth}px`,
          }}
        >
          {tracks.length === 0 ? (
            <div />
          ) : (
            <>
              {tracks.map((track, index) => (
                <ContextMenu key={track.id}>
                  <ContextMenuTrigger asChild>
                    <div
                      className="absolute left-0 right-0"
                      style={{
                        top: `${getCumulativeHeightBefore(tracks, index)}px`,
                        height: `${getTrackHeight(track.type)}px`,
                      }}
                      onClick={(e) => {
                        // If clicking empty area (not on a element), deselect all elements
                        if (
                          !(e.target as HTMLElement).closest(
                            ".timeline-element"
                          )
                        ) {
                          clearSelectedElements();
                        }
                      }}
                    >
                      <TimelineTrackContent
                        track={track}
                        zoomLevel={zoomLevel}
                        onSnapPointChange={onSnapPointChange}
                        visibleWindow={visibleWindow}
                      />
                    </div>
                  </ContextMenuTrigger>
                  <ContextMenuContent className="z-200">
                    <ContextMenuItem
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleTrackMute(track.id);
                      }}
                    >
                      {track.muted ? "Unmute Track" : "Mute Track"}
                    </ContextMenuItem>
                    <ContextMenuItem onClick={(e) => e.stopPropagation()}>
                      Track settings (soon)
                    </ContextMenuItem>
                  </ContextMenuContent>
                </ContextMenu>
              ))}
            </>
          )}
          {/* Ghost Clip */}
          {ghostState && ghostState.trackId && externalDragItem && (
            <div
              className="absolute z-10 pointer-events-none border-2 border-primary/50 bg-primary/20 rounded-md overflow-hidden"
              style={{
                left: `${
                  ghostState.time *
                  TIMELINE_CONSTANTS.PIXELS_PER_SECOND *
                  zoomLevel
                }px`,
                top: `${getCumulativeHeightBefore(
                  tracks,
                  getTrackIndex(ghostState.trackId)
                )}px`,
                width: `${
                  (externalDragItem.duration || 5) *
                  TIMELINE_CONSTANTS.PIXELS_PER_SECOND *
                  zoomLevel
                }px`,
                height: `${getTrackHeight(
                  tracks.find((t) => t.id === ghostState.trackId)?.type ||
                    "media"
                )}px`,
              }}
            >
              <div className="p-1 text-xs text-primary font-medium truncate">
                {externalDragItem.name}
              </div>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
});
