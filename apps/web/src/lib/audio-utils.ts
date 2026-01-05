/**
 * Lightweight utilities for audio processing using the Web Audio API.
 * This avoids the heavy dependency of FFmpeg for simple extraction tasks.
 */

/**
 * Extracts audio from a video file and returns it as a WAV Blob.
 * 
 * @param file The video file to extract audio from
 * @returns A Promise that resolves to a generic audio/wav Blob
 */
export async function extractAudioLightweight(file: File): Promise<Blob> {
    // 1. Read file as ArrayBuffer
    const arrayBuffer = await file.arrayBuffer();

    // 2. Decode audio data
    // We use the browser's native AudioContext to decode
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();

    try {
        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

        // 3. Convert to WAV
        const wavBlob = audioBufferToWav(audioBuffer);
        return wavBlob;
    } finally {
        // Always close the context to release resources
        if (audioContext.state !== 'closed') {
            await audioContext.close();
        }
    }
}

/**
 * Converts an AudioBuffer to a WAV Blob.
 * Adapted from standard implementations of WAV encoding.
 */
function audioBufferToWav(buffer: AudioBuffer): Blob {
    const numChannels = buffer.numberOfChannels;
    const sampleRate = buffer.sampleRate;
    const length = buffer.length * numChannels * 2; // 16-bit PCM = 2 bytes per sample
    const bufferLength = 44 + length;

    const data = new DataView(new ArrayBuffer(bufferLength));
    let offset = 0;

    // Helper to write string
    const writeString = (s: string) => {
        for (let i = 0; i < s.length; i++) {
            data.setUint8(offset + i, s.charCodeAt(i));
        }
        offset += s.length;
    };

    // RIFF identifier
    writeString('RIFF');
    // file length
    data.setUint32(offset, 36 + length, true);
    offset += 4;
    // RIFF type
    writeString('WAVE');
    // format chunk identifier
    writeString('fmt ');
    // format chunk length
    data.setUint32(offset, 16, true);
    offset += 4;
    // sample format (raw)
    data.setUint16(offset, 1, true);
    offset += 2;
    // channel count
    data.setUint16(offset, numChannels, true);
    offset += 2;
    // sample rate
    data.setUint32(offset, sampleRate, true);
    offset += 4;
    // byte rate (sample rate * block align)
    data.setUint32(offset, sampleRate * numChannels * 2, true);
    offset += 4;
    // block align (channel count * bytes per sample)
    data.setUint16(offset, numChannels * 2, true);
    offset += 2;
    // bits per sample
    data.setUint16(offset, 16, true);
    offset += 2;
    // data chunk identifier
    writeString('data');
    // data chunk length
    data.setUint32(offset, length, true);
    offset += 4;

    // Write Interleaved Data
    // We interleave channels: L R L R...
    for (let i = 0; i < buffer.length; i++) {
        for (let channel = 0; channel < numChannels; channel++) {
            const channelData = buffer.getChannelData(channel);
            let sample = channelData[i];
            // Clip sample to [-1, 1]
            sample = Math.max(-1, Math.min(1, sample));
            // Scale to 16-bit integer range
            sample = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
            data.setInt16(offset, sample, true);
            offset += 2;
        }
    }

    return new Blob([data], { type: 'audio/wav' });
}
