import { FFmpeg } from "@ffmpeg/ffmpeg";
import { toBlobURL } from "@ffmpeg/util";

let ffmpeg: FFmpeg | null = null;
let ffmpegLoadingPromise: Promise<FFmpeg> | null = null;

export const initFFmpeg = async (): Promise<FFmpeg> => {
  if (ffmpeg) return ffmpeg;
  if (ffmpegLoadingPromise) return ffmpegLoadingPromise;

  ffmpegLoadingPromise = (async () => {
    try {
      const instance = new FFmpeg();

      const basePath = "/ffmpeg";
      const origin =
        typeof window !== "undefined" ? window.location.origin : "";
      const baseURL = origin ? `${origin}${basePath}` : basePath;

      await instance.load({
        coreURL: await toBlobURL(
          `${baseURL}/ffmpeg-core.js`,
          "text/javascript"
        ),
        wasmURL: await toBlobURL(
          `${baseURL}/ffmpeg-core.wasm`,
          "application/wasm"
        ),
      });

      ffmpeg = instance;
      return instance;
    } finally {
      ffmpegLoadingPromise = null;
    }
  })();

  return ffmpegLoadingPromise;
};

export const generateThumbnail = async (
  videoFile: File,
  timeInSeconds = 1
): Promise<string> => {
  const ffmpeg = await initFFmpeg();

  // Generate safe, unique filenames
  const inputName = `input_${Date.now()}_${Math.random().toString(36).substring(2, 8)}.mp4`;
  const outputName = `thumbnail_${Date.now()}_${Math.random().toString(36).substring(2, 8)}.jpg`;

  // Write input file
  await ffmpeg.writeFile(
    inputName,
    new Uint8Array(await videoFile.arrayBuffer())
  );

  // Generate thumbnail at specific time
  await ffmpeg.exec([
    "-i",
    inputName,
    "-ss",
    timeInSeconds.toString(),
    "-vframes",
    "1",
    "-vf",
    "scale=320:240",
    "-q:v",
    "2",
    outputName,
  ]);

  // Read output file
  const data = await ffmpeg.readFile(outputName);
  const blob = new Blob([data], { type: "image/jpeg" });

  // Cleanup
  await ffmpeg.deleteFile(inputName);
  await ffmpeg.deleteFile(outputName);

  return URL.createObjectURL(blob);
};

export const trimVideo = async (
  videoFile: File,
  startTime: number,
  endTime: number,
  onProgress?: (progress: number) => void
): Promise<Blob> => {
  const ffmpeg = await initFFmpeg();

  const inputName = `input_${Date.now()}_${Math.random().toString(36).substring(2, 8)}.mp4`;
  const outputName = `output_${Date.now()}_${Math.random().toString(36).substring(2, 8)}.mp4`;

  // Set up progress callback
  if (onProgress) {
    ffmpeg.on("progress", ({ progress }) => {
      onProgress(progress * 100);
    });
  }

  // Write input file
  await ffmpeg.writeFile(
    inputName,
    new Uint8Array(await videoFile.arrayBuffer())
  );

  const duration = endTime - startTime;

  // Trim video
  await ffmpeg.exec([
    "-i",
    inputName,
    "-ss",
    startTime.toString(),
    "-t",
    duration.toString(),
    "-c",
    "copy", // Use stream copy for faster processing
    outputName,
  ]);

  // Read output file
  const data = await ffmpeg.readFile(outputName);
  const blob = new Blob([data], { type: "video/mp4" });

  // Cleanup
  await ffmpeg.deleteFile(inputName);
  await ffmpeg.deleteFile(outputName);

  return blob;
};

export const getVideoInfo = async (
  videoFile: File
): Promise<{
  duration: number;
  width: number;
  height: number;
  fps: number;
}> => {
  const ffmpeg = await initFFmpeg();

  const inputName = `input_${Date.now()}_${Math.random().toString(36).substring(2, 8)}.mp4`;

  // Write input file
  await ffmpeg.writeFile(
    inputName,
    new Uint8Array(await videoFile.arrayBuffer())
  );

  // Capture FFmpeg stderr output with a one-time listener pattern
  let ffmpegOutput = "";
  let listening = true;
  const listener = (data: string) => {
    if (listening) ffmpegOutput += data;
  };
  ffmpeg.on("log", ({ message }) => listener(message));

  // Run ffmpeg to get info (stderr will contain the info)
  try {
    await ffmpeg.exec(["-i", inputName, "-f", "null", "-"]);
  } catch (error) {
    listening = false;
    await ffmpeg.deleteFile(inputName);
    console.error("FFmpeg execution failed:", error);
    throw new Error(
      "Failed to extract video info. The file may be corrupted or in an unsupported format."
    );
  }

  // Disable listener after exec completes
  listening = false;

  // Cleanup
  await ffmpeg.deleteFile(inputName);

  // Parse output for duration, resolution, and fps
  // Example: Duration: 00:00:10.00, start: 0.000000, bitrate: 1234 kb/s
  // Example: Stream #0:0: Video: h264 (High), yuv420p(progressive), 1920x1080 [SAR 1:1 DAR 16:9], 30 fps, 30 tbr, 90k tbn, 60 tbc

  const durationMatch = ffmpegOutput.match(/Duration: (\d+):(\d+):([\d.]+)/);
  let duration = 0;
  if (durationMatch) {
    const [, h, m, s] = durationMatch;
    duration = parseInt(h) * 3600 + parseInt(m) * 60 + parseFloat(s);
  }

  // More flexible regex to handle different FPS formats (fps, tbr, tbn, tbc)
  let width = 0, height = 0, fps = 0;

  // Look for resolution first (width x height)
  const resolutionMatch = ffmpegOutput.match(/Video:.*?(\d+)x(\d+)(?:\s|\[)/);
  if (resolutionMatch) {
    width = parseInt(resolutionMatch[1]);
    height = parseInt(resolutionMatch[2]);
  }

  // Look for frame rate in various formats
  const fpsPatterns = [
    /(\d+\.?\d*)\s+fps/,  // Standard fps
    /(\d+\.?\d*)\s+tbr/,  // Video time base
    /(\d+\.?\d*)\s+tbn/,  // Time base denominator
    /(\d+\.?\d*)\s+tbc/   // Time base count
  ];

  for (const pattern of fpsPatterns) {
    const fpsMatch = ffmpegOutput.match(pattern);
    if (fpsMatch) {
      fps = parseFloat(fpsMatch[1]);
      break; // Take the first match
    }
  }

  return {
    duration,
    width,
    height,
    fps,
  };
};

export const convertToWebM = async (
  videoFile: File,
  onProgress?: (progress: number) => void
): Promise<Blob> => {
  const ffmpeg = await initFFmpeg();

  const inputName = `input_${Date.now()}_${Math.random().toString(36).substring(2, 8)}.mp4`;
  const outputName = `output_${Date.now()}_${Math.random().toString(36).substring(2, 8)}.webm`;

  // Set up progress callback
  if (onProgress) {
    ffmpeg.on("progress", ({ progress }) => {
      onProgress(progress * 100);
    });
  }

  // Write input file
  await ffmpeg.writeFile(
    inputName,
    new Uint8Array(await videoFile.arrayBuffer())
  );

  // Convert to WebM
  await ffmpeg.exec([
    "-i",
    inputName,
    "-c:v",
    "libvpx-vp9",
    "-crf",
    "30",
    "-b:v",
    "0",
    "-c:a",
    "libopus",
    outputName,
  ]);

  // Read output file
  const data = await ffmpeg.readFile(outputName);
  const blob = new Blob([data], { type: "video/webm" });

  // Cleanup
  await ffmpeg.deleteFile(inputName);
  await ffmpeg.deleteFile(outputName);

  return blob;
};

export const extractAudio = async (
  videoFile: File,
  format: "mp3" | "wav" = "mp3"
): Promise<Blob> => {
  const ffmpeg = await initFFmpeg();

  const inputName = `input_${Date.now()}_${Math.random().toString(36).substring(2, 8)}.mp4`;
  const outputName = `output_${Date.now()}_${Math.random().toString(36).substring(2, 8)}.${format}`;

  // Write input file
  await ffmpeg.writeFile(
    inputName,
    new Uint8Array(await videoFile.arrayBuffer())
  );

  // Extract audio
  await ffmpeg.exec([
    "-i",
    inputName,
    "-vn", // Disable video
    "-acodec",
    format === "mp3" ? "libmp3lame" : "pcm_s16le",
    outputName,
  ]);

  // Read output file
  const data = await ffmpeg.readFile(outputName);
  const blob = new Blob([data], { type: `audio/${format}` });

  // Cleanup
  await ffmpeg.deleteFile(inputName);
  await ffmpeg.deleteFile(outputName);

  return blob;
};
