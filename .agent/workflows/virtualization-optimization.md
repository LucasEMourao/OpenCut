---
description: Timeline Virtualization Optimization
---
# Timeline Virtualization

The `TimelineCanvas` component has been optimized to only render clips that are currently visible in the viewport.

## Implementation Details

1.  **Visible Window Tracking**:
    *   `TimelineCanvas` tracks the `scrollLeft` and `containerWidth` of the tracks container.
    *   It calculates a `visibleWindow` ({ start, end }) based on `pixelsPerSecond` and `zoomLevel`.
    *   A buffer of 10 seconds is added to ensure smooth scrolling.

2.  **Clip Filtering**:
    *   `visibleWindow` is passed down to `TimelineTrackContent`.
    *   `TimelineTrackContent` filters `track.elements` before rendering.
    *   Clips outside the window are not rendered (return null).

## Benefits

*   Reduced DOM nodes significantly for long timelines.
*   Improved scrolling performance (60fps).
*   Reduced style recalculations during drag and drop.
