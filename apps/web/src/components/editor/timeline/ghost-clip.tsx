import { memo } from "react";
import { TimelineTrack } from "@/types/timeline";
import { TIMELINE_CONSTANTS, getCumulativeHeightBefore, getTrackHeight } from "@/constants/timeline-constants";
import { GhostState } from "@/hooks/use-timeline-drag";

interface GhostClipProps {
  ghostState: GhostState;
  externalDragItem: { name: string; duration?: number };
  tracks: TimelineTrack[];
  zoomLevel: number;
}

export const GhostClip = memo(function GhostClip({
  ghostState,
  externalDragItem,
  tracks,
  zoomLevel,
}: GhostClipProps) {
  if (!ghostState.trackId) return null;

  const trackIndex = tracks.findIndex((t) => t.id === ghostState.trackId);
  const trackType = tracks[trackIndex]?.type || "media";

  // Visual position calculations
  const left = ghostState.time * TIMELINE_CONSTANTS.PIXELS_PER_SECOND * zoomLevel;
  const top = getCumulativeHeightBefore(tracks, trackIndex);
  const width = (externalDragItem.duration || 5) * TIMELINE_CONSTANTS.PIXELS_PER_SECOND * zoomLevel;
  const height = getTrackHeight(trackType);

  return (
    <div
      className="absolute z-50 pointer-events-none border-2 border-primary/50 bg-primary/20 rounded-md overflow-hidden"
      style={{
        left: `${left}px`,
        top: `${top}px`,
        width: `${width}px`,
        height: `${height}px`,
      }}
    >
      <div className="p-1 text-xs text-primary font-medium truncate">
        {externalDragItem.name}
      </div>
    </div>
  );
});
