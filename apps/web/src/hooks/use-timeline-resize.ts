import { useState, useEffect } from "react";
import { useTimelineStore } from "@/stores/timeline-store";
import { TIMELINE_CONSTANTS, snapTimeToFrame } from "@/constants/timeline-constants";
import { TimelineTrack, TimelineElement } from "@/types/timeline";

interface UseTimelineResizeProps {
    tracks: TimelineTrack[];
    zoomLevel: number;
    tracksContainerRef: React.RefObject<HTMLDivElement>;
}

export function useTimelineResize({
    tracks,
    zoomLevel,
}: UseTimelineResizeProps) {
    // Local state for the resize session
    const [resizingState, setResizingState] = useState<{
        isResizing: boolean;
        elementId: string | null;
        trackId: string | null;
        edge: "left" | "right" | null;
        initialStartTime: number;
        initialDuration: number;
        initialTrimStart: number;
        initialTrimEnd: number;
        startX: number;
        minTime: number; // Wall (Left neighbor)
        maxTime: number; // Wall (Right neighbor)
    }>({
        isResizing: false,
        elementId: null,
        trackId: null,
        edge: null,
        initialStartTime: 0,
        initialDuration: 0,
        initialTrimStart: 0,
        initialTrimEnd: 0,
        startX: 0,
        minTime: 0,
        maxTime: Infinity,
    });

    const [snapLineX, setSnapLineX] = useState<number | null>(null);

    // Helper: Calculate Walls (Clamping)
    const calculateConstraints = (trackId: string, elementId: string, edge: "left" | "right") => {
        const track = tracks.find(t => t.id === trackId);
        if (!track) return { min: 0, max: Infinity };

        const element = track.elements.find(e => e.id === elementId);
        if (!element) return { min: 0, max: Infinity };

        const sortedElements = [...track.elements].sort((a, b) => a.startTime - b.startTime);
        const myIndex = sortedElements.findIndex(e => e.id === elementId);

        let min = 0;
        let max = Infinity;

        if (edge === "left") {
            // Left Wall: Previous element end
            if (myIndex > 0) {
                const prev = sortedElements[myIndex - 1];
                const prevEnd = prev.startTime + (prev.duration - prev.trimStart - prev.trimEnd);
                min = prevEnd;
            }
            // Max Limit: Logic dictates you can't push start past end. 
            const currentEnd = element.startTime + (element.duration - element.trimStart - element.trimEnd);
            max = currentEnd - (TIMELINE_CONSTANTS.ELEMENT_MIN_WIDTH / (TIMELINE_CONSTANTS.PIXELS_PER_SECOND * zoomLevel));
        } else {
            // Right Wall: Next element start
            min = element.startTime + (TIMELINE_CONSTANTS.ELEMENT_MIN_WIDTH / (TIMELINE_CONSTANTS.PIXELS_PER_SECOND * zoomLevel));

            if (myIndex < sortedElements.length - 1) {
                const next = sortedElements[myIndex + 1];
                max = next.startTime;
            }
        }

        return { min, max };
    };

    const handleResizeStart = (
        e: React.MouseEvent,
        element: TimelineElement,
        trackId: string,
        edge: "left" | "right"
    ) => {
        e.stopPropagation();
        e.preventDefault();

        const { min, max } = calculateConstraints(trackId, element.id, edge);

        setResizingState({
            isResizing: true,
            elementId: element.id,
            trackId: trackId,
            edge,
            initialStartTime: element.startTime,
            initialDuration: element.duration,
            initialTrimStart: element.trimStart,
            initialTrimEnd: element.trimEnd,
            startX: e.clientX,
            minTime: min,
            maxTime: max,
        });
    };

    useEffect(() => {
        if (!resizingState.isResizing) return;

        const handleMouseMove = (e: MouseEvent) => {
            const deltaPixels = e.clientX - resizingState.startX;
            const deltaSeconds = deltaPixels / (TIMELINE_CONSTANTS.PIXELS_PER_SECOND * zoomLevel);

            let proposedTime = 0;
            let finalTime = 0;
            const SNAP_THRESHOLD_PX = 15;
            const snapThreshold = SNAP_THRESHOLD_PX / (TIMELINE_CONSTANTS.PIXELS_PER_SECOND * zoomLevel);
            let activeSnapOrWall = false;

            // --- LEFT RESIZE ---
            if (resizingState.edge === "left") {
                proposedTime = resizingState.initialStartTime + deltaSeconds;

                // 1. Magnetic Snap Search (Other tracks)
                let bestSnap = -1;
                let minDistance = snapThreshold;

                tracks.forEach(track => {
                    if (track.id === resizingState.trackId) return; // Skip own track (walls handle this)
                    track.elements.forEach(el => {
                        const elEnd = el.startTime + (el.duration - el.trimStart - el.trimEnd);
                        // Snap to Start or End of others
                        if (Math.abs(el.startTime - proposedTime) < minDistance) { minDistance = Math.abs(el.startTime - proposedTime); bestSnap = el.startTime; }
                        if (Math.abs(elEnd - proposedTime) < minDistance) { minDistance = Math.abs(elEnd - proposedTime); bestSnap = elEnd; }
                    });
                });

                // 2. Apply Snap (if found)
                if (bestSnap !== -1) {
                    proposedTime = bestSnap;
                    activeSnapOrWall = true;
                } else {
                    proposedTime = snapTimeToFrame(proposedTime, 30);
                }

                // 3. Apply Wall Clamping (Override snap if it violates wall)
                if (proposedTime <= resizingState.minTime) {
                    proposedTime = resizingState.minTime;
                    activeSnapOrWall = true; // Show line at wall
                }
                if (proposedTime >= resizingState.maxTime) {
                    proposedTime = resizingState.maxTime;
                }

                // 4. Apply Media Limit (Can't trim past 0)
                const proposedDelta = proposedTime - resizingState.initialStartTime;
                if (resizingState.initialTrimStart + proposedDelta < 0) {
                    proposedTime = resizingState.initialStartTime - resizingState.initialTrimStart;
                    activeSnapOrWall = true; // Show line at media limit
                }

                finalTime = proposedTime;

                // Update Store
                const actualDelta = finalTime - resizingState.initialStartTime;
                const newTrimStart = resizingState.initialTrimStart + actualDelta;

                useTimelineStore.getState().updateElementTrim(
                    resizingState.trackId!,
                    resizingState.elementId!,
                    newTrimStart,
                    resizingState.initialTrimEnd
                );
                useTimelineStore.getState().updateElementStartTime(
                    resizingState.trackId!,
                    resizingState.elementId!,
                    finalTime
                );
            }
            // --- RIGHT RESIZE ---
            else {
                // Calculate Proposed End Time
                const currentDuration = resizingState.initialDuration - resizingState.initialTrimStart - resizingState.initialTrimEnd;
                const currentEnd = resizingState.initialStartTime + currentDuration;
                let proposedEnd = currentEnd + deltaSeconds;

                // 1. Magnetic Snap Search
                let bestSnap = -1;
                let minDistance = snapThreshold;
                tracks.forEach(track => {
                    if (track.id === resizingState.trackId) return;
                    track.elements.forEach(el => {
                        const elEnd = el.startTime + (el.duration - el.trimStart - el.trimEnd);
                        if (Math.abs(el.startTime - proposedEnd) < minDistance) { minDistance = Math.abs(el.startTime - proposedEnd); bestSnap = el.startTime; }
                        if (Math.abs(elEnd - proposedEnd) < minDistance) { minDistance = Math.abs(elEnd - proposedEnd); bestSnap = elEnd; }
                    });
                });

                if (bestSnap !== -1) {
                    proposedEnd = bestSnap;
                    activeSnapOrWall = true;
                } else {
                    proposedEnd = snapTimeToFrame(proposedEnd, 30);
                }

                // 2. Wall Clamping
                if (proposedEnd >= resizingState.maxTime) {
                    proposedEnd = resizingState.maxTime;
                    activeSnapOrWall = true;
                }
                if (proposedEnd <= resizingState.minTime) {
                    proposedEnd = resizingState.minTime;
                }

                // 3. Media Limit
                const proposedVisibleDuration = proposedEnd - resizingState.initialStartTime;
                const proposedTrimEnd = resizingState.initialDuration - resizingState.initialTrimStart - proposedVisibleDuration;

                if (proposedTrimEnd < 0) {
                    proposedEnd = resizingState.initialStartTime + resizingState.initialDuration - resizingState.initialTrimStart;
                    activeSnapOrWall = true;
                }

                finalTime = proposedEnd;

                const finalVisibleDuration = finalTime - resizingState.initialStartTime;
                const newTrimEnd = resizingState.initialDuration - resizingState.initialTrimStart - finalVisibleDuration;

                useTimelineStore.getState().updateElementTrim(
                    resizingState.trackId!,
                    resizingState.elementId!,
                    resizingState.initialTrimStart,
                    newTrimEnd
                );
            }

            // Update Snap Line Visual
            setSnapLineX(activeSnapOrWall ? finalTime * TIMELINE_CONSTANTS.PIXELS_PER_SECOND * zoomLevel : null);
        };

        const handleMouseUp = () => {
            setResizingState(prev => ({ ...prev, isResizing: false }));
            setSnapLineX(null);
        };

        document.addEventListener("mousemove", handleMouseMove);
        document.addEventListener("mouseup", handleMouseUp);

        return () => {
            document.removeEventListener("mousemove", handleMouseMove);
            document.removeEventListener("mouseup", handleMouseUp);
        };
    }, [resizingState, tracks, zoomLevel]);

    return { handleResizeStart, snapLineX };
}
