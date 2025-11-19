import type { NextApiRequest, NextApiResponse } from "next";
import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import fs from "fs/promises";
import path from "path";
import os from "os";
import crypto from "crypto";

// Configuration to allow larger payloads for the initial upload
export const config = {
  api: {
    bodyParser: {
      sizeLimit: '50mb',
    },
  },
};

// Interfaces
interface Segment {
  segment_id: number;
  source_file: string;
  start_sec: number;
  end_sec: number;
  content: string;
  selection_reason: string;
  transition_in: string;
  transition_out: string;
}

interface AutoCutResponse {
  metadata: {
    total_duration: number;
    segment_count: number;
    takes_used: string[];
    quality_warnings: string[];
  };
  segments: Segment[];
}

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// Model Priority List - Strictly as requested
const MODELS = ["gemini-3.0-flash", "gemini-2.5-flash", "gemini-2.0-flash", "gemini-1.5-flash"];

// Strict Schema Definition for Structured Output
const autoCutSchema = {
  type: SchemaType.OBJECT,
  properties: {
    metadata: {
      type: SchemaType.OBJECT,
      properties: {
        total_duration: { type: SchemaType.NUMBER },
        segment_count: { type: SchemaType.NUMBER },
        takes_used: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
        quality_warnings: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
      },
      required: ["total_duration", "segment_count", "takes_used", "quality_warnings"],
    },
    segments: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          segment_id: { type: SchemaType.NUMBER },
          source_file: { type: SchemaType.STRING },
          start_sec: { type: SchemaType.NUMBER },
          end_sec: { type: SchemaType.NUMBER },
          content: { type: SchemaType.STRING },
          selection_reason: { type: SchemaType.STRING },
          transition_in: { type: SchemaType.STRING },
          transition_out: { type: SchemaType.STRING },
        },
        required: ["segment_id", "source_file", "start_sec", "end_sec", "content", "selection_reason"],
      },
    },
  },
  required: ["metadata", "segments"],
};

/**
 * Helper function to determine MIME type from filename extension
 */
function getMimeType(filename: string): string {
  const lowerName = filename.toLowerCase();
  console.log(`🔍 Helper getMimeType checking: ${lowerName}`); // Debug log

  if (lowerName.endsWith('.mp3')) return 'audio/mpeg';
  if (lowerName.endsWith('.wav')) return 'audio/wav';
  if (lowerName.endsWith('.aac')) return 'audio/aac';
  if (lowerName.endsWith('.ogg')) return 'audio/ogg';
  if (lowerName.endsWith('.flac')) return 'audio/flac';
  if (lowerName.endsWith('.m4a')) return 'audio/mp4';

  // VIDEO FORMATS
  if (lowerName.endsWith('.mp4')) return 'video/mp4';
  if (lowerName.endsWith('.mov')) return 'video/quicktime';
  if (lowerName.endsWith('.webm')) return 'video/webm';
  if (lowerName.endsWith('.avi')) return 'video/x-msvideo';

  // Default to octet-stream to avoid misleading the API
  return 'application/octet-stream';
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  console.log("🔍 Gemini API route called - Method:", req.method);

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!GEMINI_API_KEY) {
    console.warn("🔍 Gemini API key not found — using mock data fallback.");
    return res.status(200).json({ mock: true, data: getMockSegments() });
  }

  const tempFiles: string[] = [];

  try {
    const { audioFiles, systemPrompt, userPrompt } = req.body;

    if (!audioFiles || !Array.isArray(audioFiles) || audioFiles.length === 0) {
      return res.status(400).json({ error: "audioFiles array is required" });
    }

    console.log(`🔍 Processing ${audioFiles.length} audio files...`);

    // Initialize Google SDK
    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

    // 1. Upload Files to Gemini (Manual Resumable Upload)
    const uploadPromises = audioFiles.map(async (file: { filename: string; data: string }, index: number) => {
      // Create a temporary file
      const tempDir = os.tmpdir();
      const randomId = crypto.randomBytes(8).toString('hex');
      const ext = path.extname(file.filename) || '.mp3';
      const tempFilePath = path.join(tempDir, `opencut_${randomId}_${index}${ext}`);

      // Write base64 data to temp file
      await fs.writeFile(tempFilePath, file.data, 'base64');
      tempFiles.push(tempFilePath);

      // Get File Stats and MIME type
      const stats = await fs.stat(tempFilePath);

      // CRITICAL FIX: Calculate MimeType here and reuse it later
      const detectedMimeType = getMimeType(file.filename);
      const fileSize = stats.size;

      console.log(`🔍 Starting Resumable Upload for: ${file.filename} (${fileSize} bytes, ${detectedMimeType})`);

      // Initiate Resumable Upload
      const initiateUrl = `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${GEMINI_API_KEY}`;
      const initiateResponse = await fetch(initiateUrl, {
        method: "POST",
        headers: {
          "X-Goog-Upload-Protocol": "resumable",
          "X-Goog-Upload-Command": "start",
          "X-Goog-Upload-Header-Content-Length": fileSize.toString(),
          "X-Goog-Upload-Mime-Type": detectedMimeType, // Use detected type
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ file: { display_name: file.filename } }),
      });

      if (!initiateResponse.ok) {
        const errorText = await initiateResponse.text();
        throw new Error(`Failed to initiate upload: ${initiateResponse.statusText} - ${errorText}`);
      }

      const uploadUrl = initiateResponse.headers.get("x-goog-upload-url");
      if (!uploadUrl) {
        throw new Error("Failed to get upload URL from initiation response");
      }

      // Upload File Bytes
      const fileBuffer = await fs.readFile(tempFilePath);
      const uploadResponse = await fetch(uploadUrl, {
        method: "POST",
        headers: {
          "Content-Length": fileSize.toString(),
          "X-Goog-Upload-Offset": "0",
          "X-Goog-Upload-Command": "upload, finalize",
        },
        body: fileBuffer as any,
      });

      if (!uploadResponse.ok) {
        const errorText = await uploadResponse.text();
        throw new Error(`Failed to upload file bytes: ${uploadResponse.statusText} - ${errorText}`);
      }

      const uploadResult = await uploadResponse.json();
      console.log(`✅ Uploaded ${file.filename} -> URI: ${uploadResult.file.uri}`);

      return {
        filename: file.filename,
        uri: uploadResult.file.uri,
        name: uploadResult.file.name,
        mimeType: detectedMimeType // CRITICAL: Pass the detected mime type forward
      };
    });

    const uploadedFiles = await Promise.all(uploadPromises);

    // 2. Wait for Files to be Active (Polling)
    console.log("🔍 Waiting for files to process...");
    await Promise.all(uploadedFiles.map(async (file) => {
      let state = "PROCESSING";
      while (state === "PROCESSING") {
        const statusUrl = `https://generativelanguage.googleapis.com/v1beta/files/${file.name.split('/').pop()}?key=${GEMINI_API_KEY}`;
        const statusResponse = await fetch(statusUrl);

        if (!statusResponse.ok) {
          console.warn(`⚠️ Failed to check status for ${file.filename}, retrying...`);
          await new Promise(resolve => setTimeout(resolve, 2000));
          continue;
        }

        const statusData = await statusResponse.json();
        state = statusData.state;

        if (state === "PROCESSING") {
          await new Promise(resolve => setTimeout(resolve, 1000));
        } else if (state === "FAILED") {
          throw new Error(`File processing failed for ${file.filename}`);
        }
      }
      console.log(`✅ File ready: ${file.filename}`);
    }));


    // 3. Construct Prompt with Strict Timing Rules
    const realFilenames = uploadedFiles.map(f => f.filename).join(', ');
    const filenameInstruction = `
IMPORTANT: The audio files you are analyzing are named: [${realFilenames}].
When you respond, the "source_file" field in your JSON *must* exactly match one of these names.
DO NOT use example filenames like "take_1.mp3" or "take_3.mp3" from the prompt examples.
Your response must contain ONLY valid JSON with source_file values that match the provided filenames: [${realFilenames}]`;

    const TIMING_RULES = `
CRITICAL TIMING INSTRUCTIONS:
1. PADDING: You MUST subtract 0.1s from the actual start time and add 0.1s to the actual end time of every segment.
2. NEVER cut in the middle of a word. If a sentence boundary is unclear, extend the segment to include the silence/breath.
3. PRECISION: Be extremely conservative. It is better to include 0.5s of silence than to cut 0.1s of a word.
`;

    const fullPrompt = `${systemPrompt}\n\n${filenameInstruction}\n\n${TIMING_RULES}\n\n${userPrompt}`;

    // 4. Call Gemini Model
    let result;
    let modelUsed: string | null = null;

    // Debug logs before generating content
    console.log("🔍 DEBUG - Files passed to generateContent:", uploadedFiles.map(f => ({ name: f.filename, mime: f.mimeType })));

    const contentParts = [
      ...uploadedFiles.map((f: any) => {
        return {
          fileData: {
            mimeType: "audio/mpeg", // Forced audio/mpeg as per instruction
            fileUri: f.uri
          }
        };
      }),
      { text: fullPrompt }
    ];

    for (const modelName of MODELS) {
      console.log(`🔍 Attempting to call model: ${modelName}`);
      try {
        const model = genAI.getGenerativeModel({
          model: modelName,
          generationConfig: {
            temperature: 0.0, // Strict determinism
            responseMimeType: "application/json",
            // @ts-ignore - Schema typing can be tricky with different SDK versions
            responseSchema: autoCutSchema,
          }
        });

        result = await model.generateContent({
          contents: [{
            role: "user",
            parts: contentParts as any
          }]
        });

        modelUsed = modelName;
        console.log(`✅ Successfully used model: ${modelName}`);
        break;
      } catch (error: any) {
        console.error(`🔍 Model ${modelName} failed:`, error?.message || error);
        // Continue to next model
      }
    }

    if (!result || !modelUsed) {
      throw new Error("All models failed to generate content");
    }

    // 5. Parse Response
    const responseText = result.response.text();
    console.log("🔍 Raw Gemini Response:", responseText.substring(0, 200) + "...");

    const parsedResponse = JSON.parse(responseText);

    // 6. Cleanup Local Temp Files
    await Promise.all(tempFiles.map(p => fs.unlink(p).catch(e => console.error("Failed to delete temp file:", p, e))));

    res.status(200).json({ mock: false, data: parsedResponse });

  } catch (error: any) {
    console.error("❌ Error in Gemini File API flow:", error);
    // Cleanup on error
    tempFiles.forEach(p => fs.unlink(p).catch(() => { }));

    // Return mock only if everything fails
    res.status(200).json({
      mock: true,
      data: getMockSegments(),
      error: error.message
    });
  }
}

function getMockSegments(audioFiles?: Array<{ filename: string; data: string }>): AutoCutResponse {
  // Mock data implementation...
  return {
    metadata: {
      total_duration: 10,
      segment_count: 0,
      takes_used: [],
      quality_warnings: ["Mock Data"]
    },
    segments: []
  };
}