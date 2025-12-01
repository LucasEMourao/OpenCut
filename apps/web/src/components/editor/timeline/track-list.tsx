"use client";

import { memo } from "react";

import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Video,
  Music,
  TypeIcon,
  Eye,
  EyeOff,
  MicOff,
  Mic,
  Lock,
  LockOpen,
} from "lucide-react";
import { TimelineTrack } from "@/types/timeline";
import { getTrackHeight } from "@/constants/timeline-constants";

interface TrackListProps {
  tracks: TimelineTrack[];
  toggleTrackMute: (trackId: string) => void;
  toggleTrackLock: (trackId: string) => void;
  toggleTrackVisibility: (trackId: string) => void;
  trackLabelsRef: React.RefObject<HTMLDivElement>;
  trackLabelsScrollRef: React.RefObject<HTMLDivElement>;
}

export const TrackList = memo(function TrackList({
  tracks,
  toggleTrackMute,
  toggleTrackLock,
  toggleTrackVisibility,
  trackLabelsRef,
  trackLabelsScrollRef,
}: TrackListProps) {
  if (tracks.length === 0) return null;

  return (
    <div
      ref={trackLabelsRef}
      className="w-28 shrink-0 border-r overflow-y-auto z-100 bg-panel"
      data-track-labels
    >
      <ScrollArea className="w-full h-full" ref={trackLabelsScrollRef}>
        <div className="flex flex-col gap-1">
          {tracks.map((track) => (
            <div
              key={track.id}
              className="flex items-center px-3 group"
              style={{ height: `${getTrackHeight(track.type)}px` }}
            >
              <div className="flex items-center justify-end flex-1 min-w-0 gap-2">
                {track.muted ? (
                  <MicOff
                    className="h-4 w-4 text-destructive cursor-pointer"
                    onClick={() => toggleTrackMute(track.id)}
                  />
                ) : (
                  <Mic
                    className="h-4 w-4 text-muted-foreground cursor-pointer"
                    onClick={() => toggleTrackMute(track.id)}
                  />
                )}
                {track.hidden ? (
                  <EyeOff
                    className="h-4 w-4 text-muted-foreground cursor-pointer"
                    onClick={() => toggleTrackVisibility(track.id)}
                  />
                ) : (
                  <Eye
                    className="h-4 w-4 text-muted-foreground cursor-pointer"
                    onClick={() => toggleTrackVisibility(track.id)}
                  />
                )}
                {track.locked ? (
                  <Lock
                    className="h-4 w-4 text-destructive cursor-pointer"
                    onClick={() => toggleTrackLock(track.id)}
                  />
                ) : (
                  <LockOpen
                    className="h-4 w-4 text-muted-foreground cursor-pointer"
                    onClick={() => toggleTrackLock(track.id)}
                  />
                )}
                <TrackIcon track={track} />
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
});

function TrackIcon({ track }: { track: TimelineTrack }) {
  return (
    <>
      {track.type === "media" && (
        <Video className="w-4 h-4 shrink-0 text-muted-foreground" />
      )}
      {track.type === "text" && (
        <TypeIcon className="w-4 h-4 shrink-0 text-muted-foreground" />
      )}
      {track.type === "audio" && (
        <Music className="w-4 h-4 shrink-0 text-muted-foreground" />
      )}
    </>
  );
}
