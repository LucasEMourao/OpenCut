"use client";

import { memo, useRef, useState, useEffect } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "../../ui/context-menu";
import { TimelineTrackContent } from "./timeline-track";
import { SelectionBox } from "../selection-box";
import { GhostClip } from "./ghost-clip";
import { useTimelineDrag } from "@/hooks/use-timeline-drag";
import { TimelineTrack } from "@/types/timeline";
import { SnapPoint } from "@/hooks/use-timeline-snapping";
import {
  getTrackHeight,
  getCumulativeHeightBefore,
  getTotalTracksHeight,
  TIMELINE_CONSTANTS,
} from "@/constants/timeline-constants";

interface TimelineCanvasProps {
  tracks: TimelineTrack[];
  zoomLevel: number;
  dynamicTimelineWidth: number;
  tracksContainerRef: React.RefObject<HTMLDivElement>;
  tracksScrollRef: React.RefObject<HTMLDivElement>;
  onWheel: (e: React.WheelEvent) => void;
  onMouseDown: (e: React.MouseEvent) => void;
  onClick: (e: React.MouseEvent) => void;
  selectionBox: any;
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
  
  // Dragging Hook (Decoupled logic)
  const { ghostState, externalDragItem, handleDragOver, handleDragLeave } = useTimelineDrag({
    tracks,
    zoomLevel,
    tracksScrollRef,
  });

  // Virtualization (Original logic kept for stability in this step)
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

      const buffer = 10;
      const newStart = Math.max(0, start - buffer);
      const newEnd = end + buffer;

      if (
        Math.abs(newStart - lastVisibleWindow.current.start) > 1 ||
        Math.abs(newEnd - lastVisibleWindow.current.end) > 1
      ) {
        const newWindow = { start: newStart, end: newEnd };
        setVisibleWindow(newWindow);
        lastVisibleWindow.current = newWindow;
      }
    };

    scrollContainer.addEventListener("scroll", handleScroll);
    window.addEventListener("resize", handleScroll);
    handleScroll();

    return () => {
      scrollContainer.removeEventListener("scroll", handleScroll);
      window.removeEventListener("resize", handleScroll);
    };
  }, [tracksScrollRef, zoomLevel]);

  return (
    <div
      className="flex-1 relative overflow-hidden"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onWheel={(e) => {
        if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
          return;
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
                        if (
                          !(e.target as HTMLElement).closest(".timeline-element")
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
          
          {/* Ghost Rendering extracted and clean */}
          {ghostState && externalDragItem && (
            <GhostClip 
              ghostState={ghostState}
              externalDragItem={externalDragItem}
              tracks={tracks}
              zoomLevel={zoomLevel}
            />
          )}
        </div>
      </ScrollArea>
    </div>
  );
});
