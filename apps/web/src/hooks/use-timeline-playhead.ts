import { snapTimeToFrame } from "@/constants/timeline-constants";
import { useProjectStore } from "@/stores/project-store";
import { usePlaybackStore } from "@/stores/playback-store";
import { useState, useEffect, useCallback, useRef } from "react";

interface UseTimelinePlayheadProps {
  currentTime: number;
  duration: number;
  zoomLevel: number;
  seek: (time: number) => void;
  rulerRef: React.RefObject<HTMLDivElement>;
  rulerScrollRef: React.RefObject<HTMLDivElement>;
  tracksScrollRef: React.RefObject<HTMLDivElement>;
  playheadRef?: React.RefObject<HTMLDivElement>;
}

export function useTimelinePlayhead({
  currentTime,
  duration,
  zoomLevel,
  seek,
  rulerRef,
  rulerScrollRef,
  tracksScrollRef,
  playheadRef,
}: UseTimelinePlayheadProps) {
  // Playhead scrubbing state
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [scrubTime, setScrubTime] = useState<number | null>(null);

  // Ruler drag detection state
  const [isDraggingRuler, setIsDraggingRuler] = useState(false);
  const [hasDraggedRuler, setHasDraggedRuler] = useState(false);

  // Refs for performance optimization (Throttling)
  const autoScrollRef = useRef<number | null>(null);
  const scrubRafRef = useRef<number | null>(null); // NEW: Throttling ref
  const lastMouseXRef = useRef<number>(0);

  // NEW: Ref to track last seek time for throttling
  const lastSeekTimeRef = useRef<number>(0);

  const playheadPosition =
    isScrubbing && scrubTime !== null ? scrubTime : currentTime;

  // --- Core Scrub Logic ---
  // Calculates time based on mouse X, independent of the event type
  const calculateScrubTime = useCallback(
    (clientX: number) => {
      const ruler = rulerRef.current;
      if (!ruler) return null;

      const rect = ruler.getBoundingClientRect();
      const rawX = clientX - rect.left;

      // Get the timeline content width based on duration and zoom
      const timelineContentWidth = duration * 50 * zoomLevel;

      // Constrain x to be within the timeline content bounds
      const x = Math.max(0, Math.min(timelineContentWidth, rawX));

      const rawTime = Math.max(0, Math.min(duration, x / (50 * zoomLevel)));

      // Use frame snapping
      const projectStore = useProjectStore.getState();
      const projectFps = projectStore.activeProject?.fps || 30;
      return snapTimeToFrame(rawTime, projectFps);
    },
    [duration, zoomLevel, rulerRef]
  );

  const handleScrub = useCallback(
    (e: React.MouseEvent | MouseEvent) => {
      const time = calculateScrubTime(e.clientX);
      if (time === null) return;

      setScrubTime(time);
      seek(time);
      lastMouseXRef.current = e.clientX;
    },
    [calculateScrubTime, seek]
  );

  // --- Handlers ---

  const handlePlayheadMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsScrubbing(true);
      handleScrub(e);
    },
    [handleScrub]
  );

  const handleRulerMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      if (playheadRef?.current?.contains(e.target as Node)) return;

      e.preventDefault();
      setIsDraggingRuler(true);
      setHasDraggedRuler(false);
      setIsScrubbing(true);
      handleScrub(e);
    },
    [handleScrub, playheadRef]
  );

  // --- Auto-scroll (unchanged logic) ---
  const performAutoScroll = useCallback(() => {
    const rulerViewport = rulerScrollRef.current;
    const tracksViewport = tracksScrollRef.current;

    if (!rulerViewport || !tracksViewport || !isScrubbing) return;

    const viewportRect = rulerViewport.getBoundingClientRect();
    const mouseX = lastMouseXRef.current;
    const mouseXRelative = mouseX - viewportRect.left;

    const edgeThreshold = 100;
    const maxScrollSpeed = 15;
    const viewportWidth = rulerViewport.clientWidth;
    const timelineContentWidth = duration * 50 * zoomLevel;
    const scrollMax = Math.max(0, timelineContentWidth - viewportWidth);

    let scrollSpeed = 0;

    if (mouseXRelative < edgeThreshold && rulerViewport.scrollLeft > 0) {
      const edgeDistance = Math.max(0, mouseXRelative);
      const intensity = 1 - edgeDistance / edgeThreshold;
      scrollSpeed = -maxScrollSpeed * intensity;
    } else if (
      mouseXRelative > viewportWidth - edgeThreshold &&
      rulerViewport.scrollLeft < scrollMax
    ) {
      const edgeDistance = Math.max(
        0,
        viewportWidth - edgeThreshold - mouseXRelative
      );
      const intensity = 1 - edgeDistance / edgeThreshold;
      scrollSpeed = maxScrollSpeed * intensity;
    }

    if (scrollSpeed !== 0) {
      const newScrollLeft = Math.max(
        0,
        Math.min(scrollMax, rulerViewport.scrollLeft + scrollSpeed)
      );
      rulerViewport.scrollLeft = newScrollLeft;
      tracksViewport.scrollLeft = newScrollLeft;
    }

    if (isScrubbing) {
      autoScrollRef.current = requestAnimationFrame(performAutoScroll);
    }
  }, [isScrubbing, rulerScrollRef, tracksScrollRef, duration, zoomLevel]);

  // --- Global Mouse Listeners (OPTIMIZED) ---
  useEffect(() => {
    if (!isScrubbing) return;

    const onMouseMove = (e: MouseEvent) => {
      // OPTIMIZATION: Throttling with requestAnimationFrame
      // Instead of running logic on every pixel move, we sync with the frame rate.

      if (scrubRafRef.current) {
        return; // Skip if a frame is already pending (Throttling)
      }

      // Capture the clientX immediately as the event might change
      const currentClientX = e.clientX;

      scrubRafRef.current = requestAnimationFrame(() => {
        const time = calculateScrubTime(currentClientX);

        if (time !== null) {
          // 1. ALWAYS update UI immediately (Visual Feedback)
          setScrubTime(time);

          // 2. THROTTLE video seeking (Heavy Operation)
          const now = Date.now();
          if (now - lastSeekTimeRef.current > 100) { // Limit to ~10 seeks per second
            seek(time);
            lastSeekTimeRef.current = now;
          }

          lastMouseXRef.current = currentClientX;
        }

        if (isDraggingRuler) {
          setHasDraggedRuler(true);
        }

        scrubRafRef.current = null;
      });
    };

    const onMouseUp = (e: MouseEvent) => {
      setIsScrubbing(false);

      // Cleanup pending RAFs
      if (scrubRafRef.current) {
        cancelAnimationFrame(scrubRafRef.current);
        scrubRafRef.current = null;
      }

      // Ensure we perform one FINAL seek to the exact spot where mouse stopped
      const finalTime = calculateScrubTime(e.clientX);
      if (finalTime !== null) {
        seek(finalTime); // Always seek on mouse up
      }

      setScrubTime(null);

      // Reset throttle ref
      lastSeekTimeRef.current = 0;

      // Stop auto-scrolling
      if (autoScrollRef.current) {
        cancelAnimationFrame(autoScrollRef.current);
        autoScrollRef.current = null;
      }

      if (isDraggingRuler) {
        setIsDraggingRuler(false);
        if (!hasDraggedRuler) {
          // Handle simple click (seek without drag)
          const clickTime = calculateScrubTime(e.clientX);
          if (clickTime !== null) seek(clickTime);
        }
        setHasDraggedRuler(false);
      }
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);

    autoScrollRef.current = requestAnimationFrame(performAutoScroll);

    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      if (autoScrollRef.current) {
        cancelAnimationFrame(autoScrollRef.current);
        autoScrollRef.current = null;
      }
      if (scrubRafRef.current) {
        cancelAnimationFrame(scrubRafRef.current);
        scrubRafRef.current = null;
      }
    };
  }, [
    isScrubbing,
    // remove scrubTime dependency to avoid re-binding
    seek,
    calculateScrubTime, // New dependency
    isDraggingRuler,
    hasDraggedRuler,
    performAutoScroll,
  ]);

  // --- Auto-scroll during playback (unchanged) ---
  useEffect(() => {
    const { isPlaying } = usePlaybackStore.getState();
    if (!isPlaying || isScrubbing) return;

    const rulerViewport = rulerScrollRef.current;
    const tracksViewport = tracksScrollRef.current;
    if (!rulerViewport || !tracksViewport) return;

    const playheadPx = playheadPosition * 50 * zoomLevel;
    const viewportWidth = rulerViewport.clientWidth;
    const scrollMin = 0;
    const scrollMax = rulerViewport.scrollWidth - viewportWidth;

    const needsScroll =
      playheadPx < rulerViewport.scrollLeft ||
      playheadPx > rulerViewport.scrollLeft + viewportWidth;

    if (needsScroll) {
      const desiredScroll = Math.max(
        scrollMin,
        Math.min(scrollMax, playheadPx - viewportWidth / 2)
      );
      rulerViewport.scrollLeft = tracksViewport.scrollLeft = desiredScroll;
    }
  }, [
    playheadPosition,
    duration,
    zoomLevel,
    rulerScrollRef,
    tracksScrollRef,
    isScrubbing,
  ]);

  return {
    playheadPosition,
    handlePlayheadMouseDown,
    handleRulerMouseDown,
    isDraggingRuler,
  };
}
