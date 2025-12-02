import { useEffect, useState } from "react";
import { useTimelineStore } from "@/stores/timeline-store";
import { useShallow } from "zustand/react/shallow";
import {
    TIMELINE_CONSTANTS,
    snapTimeToFrame,
} from "@/constants/timeline-constants";
import { TimelineTrack } from "@/types/timeline";
import { toast } from "sonner";

interface UseInternalDragProps {
    tracks: TimelineTrack[];
    zoomLevel: number;
    tracksContainerRef: React.RefObject<HTMLDivElement>;
}

export function useInternalDrag({
    tracks,
    zoomLevel,
    tracksContainerRef,
}: UseInternalDragProps) {
    const {
        dragState,
        updateDragTime,
        endDrag,
        updateElementStartTime,
        updateElementStartTimeWithRipple,
        rippleEditingEnabled,
    } = useTimelineStore(
        useShallow((state) => ({
            dragState: state.dragState,
            updateDragTime: state.updateDragTime,
            endDrag: state.endDrag,
            updateElementStartTime: state.updateElementStartTime,
            updateElementStartTimeWithRipple: state.updateElementStartTimeWithRipple,
            rippleEditingEnabled: state.rippleEditingEnabled,
        }))
    );

    const [snapLineX, setSnapLineX] = useState<number | null>(null);

    const getDraggedElementDuration = () => {
        if (!dragState.trackId || !dragState.elementId) return 0;
        const track = tracks.find((t) => t.id === dragState.trackId);
        const element = track?.elements.find((e) => e.id === dragState.elementId);
        if (!element) return 0;
        return element.duration - (element.trimStart || 0) - (element.trimEnd || 0);
    };

    const calculateTime = (clientX: number) => {
        if (!tracksContainerRef.current) return 0;
        const rect = tracksContainerRef.current.getBoundingClientRect();
        const x =
            clientX - rect.left + (tracksContainerRef.current.scrollLeft || 0);
        return Math.max(
            0,
            x / (TIMELINE_CONSTANTS.PIXELS_PER_SECOND * zoomLevel)
        );
    };

    useEffect(() => {
        if (!dragState.isDragging || !dragState.trackId || !dragState.elementId) {
            if (snapLineX !== null) setSnapLineX(null);
            return;
        }

        const draggedDuration = getDraggedElementDuration();

        const handleMouseMove = (e: MouseEvent) => {
            const rawTime = calculateTime(e.clientX);
            const proposedStartTime = Math.max(0, rawTime - dragState.clickOffsetTime);
            const proposedEndTime = proposedStartTime + draggedDuration;

            const SNAP_THRESHOLD_PX = 15;
            const snapThresholdSeconds =
                SNAP_THRESHOLD_PX / (TIMELINE_CONSTANTS.PIXELS_PER_SECOND * zoomLevel);

            let bestSnapTime = -1;
            let minDistance = snapThresholdSeconds;
            let snapLineTime = -1;

            // MAGNETIC SNAP LOGIC (Visual Assist only)
            tracks.forEach((track) => {
                track.elements.forEach((el) => {
                    if (el.id === dragState.elementId) return;

                    const targetStart = el.startTime;
                    const targetDuration =
                        el.duration - (el.trimStart || 0) - (el.trimEnd || 0);
                    const targetEnd = el.startTime + targetDuration;

                    // Snap logic (Head-Head, Head-Tail, Tail-Head, Tail-Tail)
                    const distHeadHead = Math.abs(targetStart - proposedStartTime);
                    if (distHeadHead < minDistance) {
                        minDistance = distHeadHead;
                        bestSnapTime = targetStart;
                        snapLineTime = targetStart;
                    }

                    const distHeadTail = Math.abs(targetEnd - proposedStartTime);
                    if (distHeadTail < minDistance) {
                        minDistance = distHeadTail;
                        bestSnapTime = targetEnd;
                        snapLineTime = targetEnd;
                    }

                    const distTailHead = Math.abs(targetStart - proposedEndTime);
                    if (distTailHead < minDistance) {
                        minDistance = distTailHead;
                        bestSnapTime = targetStart - draggedDuration;
                        snapLineTime = targetStart;
                    }

                    const distTailTail = Math.abs(targetEnd - proposedEndTime);
                    if (distTailTail < minDistance) {
                        minDistance = distTailTail;
                        bestSnapTime = targetEnd - draggedDuration;
                        snapLineTime = targetEnd;
                    }
                });
            });

            let finalTime;
            if (bestSnapTime !== -1) {
                finalTime = bestSnapTime;
                setSnapLineX(
                    snapLineTime * TIMELINE_CONSTANTS.PIXELS_PER_SECOND * zoomLevel
                );
            } else {
                finalTime = snapTimeToFrame(proposedStartTime, 30);
                setSnapLineX(null);
            }

            updateDragTime(finalTime);
        };

        const handleMouseUp = () => {
            const finalTime = dragState.currentTime; // This is the snapped/calculated position from mouseMove
            const finalEndTime = finalTime + draggedDuration;

            // --- VALIDATION ON DROP ---
            let hasCollision = false;
            const currentTrack = tracks.find((t) => t.id === dragState.trackId);

            if (currentTrack) {
                for (const el of currentTrack.elements) {
                    if (el.id === dragState.elementId) continue;

                    const elDuration =
                        el.duration - (el.trimStart || 0) - (el.trimEnd || 0);
                    const elStart = el.startTime;
                    const elEnd = elStart + elDuration;

                    // Check Overlap: (StartA < EndB) and (EndA > StartB)
                    // Use a small epsilon for float precision to avoid false positives on exact edge touches
                    const epsilon = 0.001;
                    if (
                        finalTime < elEnd - epsilon &&
                        finalEndTime > elStart + epsilon
                    ) {
                        hasCollision = true;
                        break;
                    }
                }
            }

            setSnapLineX(null);

            if (hasCollision) {
                // INVALID DROP: Revert
                // Calling endDrag() without updateElementStartTime will revert the visual state
                // to the original store state (because we never committed the change).
                toast.error("Invalid placement: Overlaps with another clip");
                endDrag();
            } else {
                // VALID DROP: Commit
                if (rippleEditingEnabled) {
                    updateElementStartTimeWithRipple(
                        dragState.trackId!,
                        dragState.elementId!,
                        finalTime
                    );
                } else {
                    updateElementStartTime(
                        dragState.trackId!,
                        dragState.elementId!,
                        finalTime
                    );
                }
                endDrag();
            }
        };

        document.addEventListener("mousemove", handleMouseMove);
        document.addEventListener("mouseup", handleMouseUp);

        return () => {
            document.removeEventListener("mousemove", handleMouseMove);
            document.removeEventListener("mouseup", handleMouseUp);
        };
    }, [
        dragState,
        zoomLevel,
        tracks,
        tracksContainerRef,
        updateDragTime,
        updateElementStartTime,
        endDrag,
        snapLineX,
    ]);

    return { snapLineX };
}
