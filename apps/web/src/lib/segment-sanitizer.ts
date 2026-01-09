export interface Segment {
    segment_id: number;
    source_file: string;
    start_sec: number;
    end_sec: number;
    content: string;
    selection_reason: string;
    transition_in: string;
    transition_out: string;
}

/**
 * Sanitizes segments returned by the AI to ensure they are valid and safe for playback.
 * 
 * Rules:
 * - Filter out NaN/Undefined timestamps
 * - Discard invalid ranges (end < start)
 * - Clamp end time to total video duration
 * - Filter out micro-cuts (< 0.5s)
 * - Sort by start time
 * 
 * @param segments Raw segments from API
 * @param totalVideoDuration Total duration of the source video in seconds
 * @returns Cleaned and sorted segments
 */
export function sanitizeSegments(segments: Segment[], totalVideoDuration: number): Segment[] {
    if (!Array.isArray(segments)) {
        console.warn("sanitizeSegments: segments is not an array", segments);
        return [];
    }

    const validSegments: Segment[] = [];
    const MIN_DURATION = 0.5; // Seconds

    console.log(`🧹 Sanitizing ${segments.length} segments. Max duration: ${totalVideoDuration}s`);

    segments.forEach((seg, index) => {
        // 1. Basic Type Check
        if (typeof seg.start_sec !== 'number' || typeof seg.end_sec !== 'number' || isNaN(seg.start_sec) || isNaN(seg.end_sec)) {
            console.warn(`⚠️ Segment ${seg.segment_id} discarded: Invalid timestamps`, seg);
            return;
        }

        // 2. Fix potential simple inversions if close enough? No, user said discard inversions.
        // Hallucination check: end < start
        if (seg.end_sec < seg.start_sec) {
            console.warn(`⚠️ Segment ${seg.segment_id} discarded: Time inversion (End ${seg.end_sec} < Start ${seg.start_sec})`, seg);
            return;
        }

        // 3. Apply Padding (Moved from AI prompt to code for reliability)
        // Flash models fail at math, so we do it here deterministically.
        const PADDING = 0.1; // 100ms
        const startWithPadding = seg.start_sec - PADDING;
        const endWithPadding = seg.end_sec + PADDING;

        // 4. Clamp Logic
        let safeStart = Math.max(0, startWithPadding);
        let safeEnd = Math.min(endWithPadding, totalVideoDuration);

        // If start is beyond the video duration, discard
        if (safeStart >= totalVideoDuration) {
            console.warn(`⚠️ Segment ${seg.segment_id} discarded: Start time ${safeStart} is beyond video duration ${totalVideoDuration}`, seg);
            return;
        }

        // 4. Minimum Duration Check
        const duration = safeEnd - safeStart;
        if (duration < MIN_DURATION) {
            console.warn(`⚠️ Segment ${seg.segment_id} discarded: Too short (${duration.toFixed(3)}s < ${MIN_DURATION}s)`, seg);
            return;
        }

        // Create a clean copy with sanitized values
        validSegments.push({
            ...seg,
            start_sec: safeStart,
            end_sec: safeEnd,
        });
    });

    // 5. Sort by start time
    validSegments.sort((a, b) => a.start_sec - b.start_sec);

    console.log(`✅ Sanitization complete. Kept ${validSegments.length}/${segments.length} segments.`);
    return validSegments;
}
