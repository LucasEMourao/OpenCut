import { useState, RefObject } from "react";
import { TimelineTrack } from "@/types/timeline";
import { useTimelineStore } from "@/stores/timeline-store";
import { useMediaStore } from "@/stores/media-store";
import { useShallow } from "zustand/react/shallow";
import {
    TIMELINE_CONSTANTS,
    snapTimeToFrame,
    getTrackHeight,
} from "@/constants/timeline-constants";

interface UseTimelineDragProps {
    tracks: TimelineTrack[];
    zoomLevel: number;
    tracksScrollRef: RefObject<HTMLDivElement>;
}

export interface GhostState {
    trackId: string | null;
    time: number;
}

export function useTimelineDrag({
    tracks,
    zoomLevel,
    tracksScrollRef,
}: UseTimelineDragProps) {
    const externalDragItem = useTimelineStore(
        useShallow((state) => state.externalDragItem)
    );

    const [ghostState, setGhostState] = useState<GhostState | null>(null);

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        if (!externalDragItem) return;

        const tracksContent = tracksScrollRef.current;
        if (!tracksContent) return;

        const rect = tracksContent.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const scrollLeft = tracksContent.scrollLeft;

        // Calculate time with basic snap (frame grid)
        const rawTime = Math.max(
            0,
            (mouseX + scrollLeft) /
            (TIMELINE_CONSTANTS.PIXELS_PER_SECOND * zoomLevel)
        );

        // Magnetic Snapping Logic
        const SNAP_THRESHOLD_PX = 15;
        const snapThresholdSeconds =
            SNAP_THRESHOLD_PX / (TIMELINE_CONSTANTS.PIXELS_PER_SECOND * zoomLevel);

        let bestSnapTime = -1;
        let minDistance = snapThresholdSeconds;

        // Scan all tracks and elements for snap points
        tracks.forEach((track) => {
            track.elements.forEach((el) => {
                // Skip the item currently being dragged (if it exists in the track) to avoid self-snapping
                if (el.id === (externalDragItem as any)?.id) return;

                // Check start time
                const distStart = Math.abs(el.startTime - rawTime);
                if (distStart < minDistance) {
                    minDistance = distStart;
                    bestSnapTime = el.startTime;
                }

                // Check end time
                // Account for trims to get the actual visual end time
                const actualDuration =
                    el.duration - (el.trimStart || 0) - (el.trimEnd || 0);
                const elEndTime = el.startTime + actualDuration;
                const distEnd = Math.abs(elEndTime - rawTime);
                if (distEnd < minDistance) {
                    minDistance = distEnd;
                    bestSnapTime = elEndTime;
                }
            });
        });

        // Final Decision: Snap vs Grid
        const time =
            bestSnapTime !== -1 ? bestSnapTime : snapTimeToFrame(rawTime, 30);

        // Identify track based on Y position
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

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();

        if (!ghostState || !ghostState.trackId || !externalDragItem) return;

        const { addElementToTrack, setExternalDragItem } = useTimelineStore.getState();

        if (externalDragItem.type === "text") {
            addElementToTrack(ghostState.trackId, {
                type: "text",
                name: externalDragItem.name || "Text",
                content: (externalDragItem as any).content || "Default Text",
                duration: externalDragItem.duration || TIMELINE_CONSTANTS.DEFAULT_TEXT_DURATION,
                startTime: ghostState.time,
                trimStart: 0,
                trimEnd: 0,
                fontSize: 48,
                fontFamily: "Arial",
                color: "#ffffff",
                backgroundColor: "transparent",
                textAlign: "center",
                fontWeight: "normal",
                fontStyle: "normal",
                textDecoration: "none",
                x: 0,
                y: 0,
                rotation: 0,
                opacity: 1,
            });
        } else {
            // Media (video, image, audio)
            const mediaStore = useMediaStore.getState();
            const mediaItem = mediaStore.mediaItems.find(
                (item) => item.id === externalDragItem.id
            );

            const trimStart = mediaItem?.startTime || 0;
            const cutDuration = mediaItem?.cutDuration;
            const sourceDuration =
                mediaItem?.duration || externalDragItem.duration || 5;

            let trimEnd = 0;
            if (cutDuration) {
                trimEnd = Math.max(0, sourceDuration - trimStart - cutDuration);
            }

            addElementToTrack(ghostState.trackId, {
                type: "media",
                mediaId: externalDragItem.id,
                name: externalDragItem.name,
                duration: sourceDuration,
                startTime: ghostState.time,
                trimStart: trimStart,
                trimEnd: trimEnd,
            });
        }

        setExternalDragItem(null);
        setGhostState(null);
    };

    return {
        ghostState,
        externalDragItem, // Returned so the component knows if it should render
        handleDragOver,
        handleDragLeave,
        handleDrop,
    };
}
