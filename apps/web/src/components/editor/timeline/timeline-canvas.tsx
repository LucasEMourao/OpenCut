"use client";

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
  selectionBox: any; // Using any for now to match the hook return type, ideally should be typed
  onSnapPointChange: (snapPoint: SnapPoint | null) => void;
  clearSelectedElements: () => void;
  toggleTrackMute: (trackId: string) => void;
}

export function TimelineCanvas({
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
  return (
    <div
      className="flex-1 relative overflow-hidden"
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
        </div>
      </ScrollArea>
    </div>
  );
}
