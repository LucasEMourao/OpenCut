"use client";

import { ScrollArea } from "@/components/ui/scroll-area";
import { Bookmark } from "lucide-react";
import { useProjectStore } from "@/stores/project-store";
import { usePlaybackStore } from "@/stores/playback-store";
import { TIMELINE_CONSTANTS } from "@/constants/timeline-constants";

interface TimelineRulerProps {
  rulerRef: React.RefObject<HTMLDivElement>;
  rulerScrollRef: React.RefObject<HTMLDivElement>;
  zoomLevel: number;
  duration: number;
  dynamicTimelineWidth: number;
  onWheel: (e: React.WheelEvent) => void;
  onMouseDown: (e: React.MouseEvent) => void;
  onClick: (e: React.MouseEvent) => void;
  onRulerMouseDown: (e: React.MouseEvent) => void;
}

export function TimelineRuler({
  rulerRef,
  rulerScrollRef,
  zoomLevel,
  duration,
  dynamicTimelineWidth,
  onWheel,
  onMouseDown,
  onClick,
  onRulerMouseDown,
}: TimelineRulerProps) {
  return (
    <div
      className="flex-1 relative overflow-hidden h-10"
      onWheel={(e) => {
        // Check if this is horizontal scrolling - if so, don't handle it here
        if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
          return; // Let ScrollArea handle horizontal scrolling
        }
        onWheel(e);
      }}
      onMouseDown={onMouseDown}
      onClick={onClick}
      data-ruler-area
    >
      <ScrollArea className="w-full" ref={rulerScrollRef}>
        <div
          ref={rulerRef}
          className="relative h-10 select-none cursor-default"
          style={{
            width: `${dynamicTimelineWidth}px`,
          }}
          onMouseDown={onRulerMouseDown}
        >
          {/* Time markers */}
          {(() => {
            // Calculate appropriate time interval based on zoom level
            const getTimeInterval = (zoom: number) => {
              const pixelsPerSecond =
                TIMELINE_CONSTANTS.PIXELS_PER_SECOND * zoom;
              if (pixelsPerSecond >= 200) return 0.1; // Every 0.1s when very zoomed in
              if (pixelsPerSecond >= 100) return 0.5; // Every 0.5s when zoomed in
              if (pixelsPerSecond >= 50) return 1; // Every 1s at normal zoom
              if (pixelsPerSecond >= 25) return 2; // Every 2s when zoomed out
              if (pixelsPerSecond >= 12) return 5; // Every 5s when more zoomed out
              if (pixelsPerSecond >= 6) return 10; // Every 10s when very zoomed out
              return 30; // Every 30s when extremely zoomed out
            };

            const interval = getTimeInterval(zoomLevel);
            const markerCount = Math.ceil(duration / interval) + 1;

            return Array.from({ length: markerCount }, (_, i) => {
              const time = i * interval;
              if (time > duration) return null;

              const isMainMarker =
                time % (interval >= 1 ? Math.max(1, interval) : 1) === 0;

              return (
                <div
                  key={i}
                  className={`absolute top-0 h-4 ${
                    isMainMarker
                      ? "border-l border-muted-foreground/40"
                      : "border-l border-muted-foreground/20"
                  }`}
                  style={{
                    left: `${
                      time *
                      TIMELINE_CONSTANTS.PIXELS_PER_SECOND *
                      zoomLevel
                    }px`,
                  }}
                >
                  <span
                    className={`absolute top-1 left-1 text-[0.6rem] ${
                      isMainMarker
                        ? "text-muted-foreground font-medium"
                        : "text-muted-foreground/70"
                    }`}
                  >
                    {(() => {
                      const formatTime = (seconds: number) => {
                        const hours = Math.floor(seconds / 3600);
                        const minutes = Math.floor((seconds % 3600) / 60);
                        const secs = seconds % 60;

                        if (hours > 0) {
                          return `${hours}:${minutes
                            .toString()
                            .padStart(2, "0")}:${Math.floor(secs)
                            .toString()
                            .padStart(2, "0")}`;
                        }
                        if (minutes > 0) {
                          return `${minutes}:${Math.floor(secs)
                            .toString()
                            .padStart(2, "0")}`;
                        }
                        if (interval >= 1) {
                          return `${Math.floor(secs)}s`;
                        }
                        return `${secs.toFixed(1)}s`;
                      };
                      return formatTime(time);
                    })()}
                  </span>
                </div>
              );
            }).filter(Boolean);
          })()}

          {/* Bookmark markers */}
          {(() => {
            const { activeProject } = useProjectStore.getState();
            if (!activeProject?.bookmarks?.length) return null;

            return activeProject.bookmarks.map((bookmarkTime, i) => (
              <div
                key={`bookmark-${i}`}
                className="absolute top-0 h-10 w-0.5 !bg-primary cursor-pointer"
                style={{
                  left: `${bookmarkTime * TIMELINE_CONSTANTS.PIXELS_PER_SECOND * zoomLevel}px`,
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  usePlaybackStore.getState().seek(bookmarkTime);
                }}
              >
                <div className="absolute top-[-1px] left-[-5px] text-primary">
                  <Bookmark className="h-3 w-3 fill-primary" />
                </div>
              </div>
            ));
          })()}
        </div>
      </ScrollArea>
    </div>
  );
}
