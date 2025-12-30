import type { NextApiRequest, NextApiResponse } from "next";
import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import { GoogleAIFileManager, FileState } from "@google/generative-ai/server";
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
const MODELS = ["gemini-3.0-flash-preview", "gemini-2.5-flash", "gemini-2.0-flash", "gemini-1.5-flash"];

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
    // 2. Rename: audioFiles -> mediaFiles to support generic media (Step 1)
    const { mediaFiles, systemPrompt, userPrompt } = req.body;

    // Fallback for older frontend clients that might still send audioFiles
    const inputFiles = mediaFiles || req.body.audioFiles;

    if (!inputFiles || !Array.isArray(inputFiles) || inputFiles.length === 0) {
      return res.status(400).json({ error: "mediaFiles array is required" });
    }

    console.log(`🔍 Processing ${inputFiles.length} media files...`);

    // Initialize Google SDK
    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    // 2. Initialize FileManager (Step 2)
    const fileManager = new GoogleAIFileManager(GEMINI_API_KEY);

    // 1. Upload Files to Gemini (SDK Method)
    const uploadPromises = inputFiles.map(async (file: { filename: string; data: string }, index: number) => {
      // Create a temporary file
      const tempDir = os.tmpdir();
      const randomId = crypto.randomBytes(8).toString('hex');
      const ext = path.extname(file.filename) || '.mp3';
      const tempFilePath = path.join(tempDir, `opencut_${randomId}_${index}${ext}`);

      // Write base64 data to temp file
      await fs.writeFile(tempFilePath, file.data, 'base64');
      tempFiles.push(tempFilePath);

      // Get MIME type
      const detectedMimeType = getMimeType(file.filename);
      const stats = await fs.stat(tempFilePath);

      // Sanitize Filename for Display Name (Keep alphanumeric and extension)
      const cleanFilename = file.filename.replace(/[^a-zA-Z0-9.]/g, '_');

      console.log(`🔍 Starting SDK Upload for: ${file.filename} as ${cleanFilename} (${stats.size} bytes, ${detectedMimeType})`);

      // 3. Use fileManager.uploadFile (Step 2)
      const uploadResponse = await fileManager.uploadFile(tempFilePath, {
        mimeType: detectedMimeType,
        displayName: cleanFilename,
      });

      console.log(`✅ Uploaded ${file.filename} -> URI: ${uploadResponse.file.uri}`);

      return {
        filename: file.filename,
        uri: uploadResponse.file.uri,
        name: uploadResponse.file.name,
        mimeType: detectedMimeType
      };
    });

    const uploadedFiles = await Promise.all(uploadPromises);

    // 2. Wait for Files to be Active (Polling with SDK)
    console.log("🔍 Waiting for files to process...");
    await Promise.all(uploadedFiles.map(async (file) => {
      let state = FileState.PROCESSING;
      let retryCount = 0;
      const MAX_RETRIES = 60; // ~5 minutes max wait

      while (state === FileState.PROCESSING) {
        if (retryCount >= MAX_RETRIES) {
          throw new Error(`Timeout: File processing took too long for ${file.filename}`);
        }
        retryCount++;

        try {
          // 4. Use fileManager.getFile (Step 2)
          const fileStatus = await fileManager.getFile(file.name);
          state = fileStatus.state;

          if (state === FileState.PROCESSING) {
            await new Promise(resolve => setTimeout(resolve, 2000)); // Standard 2s wait
          } else if (state === FileState.FAILED) {
            throw new Error(`File processing failed for ${file.filename}`);
          }
        } catch (error: any) {
          const errorMessage = error?.message || String(error);
          const isNetworkError = errorMessage.includes("500") || errorMessage.includes("JSON");

          if (isNetworkError) {
            console.warn(`⚠️ Transient API Error (500/JSON) for ${file.filename}. Retrying in 5s... (${retryCount}/${MAX_RETRIES})`);
            await new Promise(resolve => setTimeout(resolve, 5000)); // Longer wait for 500s
            continue;
          }

          // For other errors, log and retry with standard delay
          console.warn(`⚠️ Status check error for ${file.filename}, retrying in 2s...`, error);
          await new Promise(resolve => setTimeout(resolve, 2000));
          continue;
        }
      }
      console.log(`✅ File ready: ${file.filename}`);
    }));


    // 3. Construct Prompt with Strict Timing Rules
    const realFilenames = uploadedFiles.map(f => f.filename).join(', ');
    const filenameInstruction = `
IMPORTANT: The media files you are analyzing are named: [${realFilenames}].
When you respond, the "source_file" field in your JSON *must* exactly match one of these names.
DO NOT use example filenames like "take_1.mp3" or "take_3.mp3" from the prompt examples.
Your response must contain ONLY valid JSON with source_file values that match the provided filenames: [${realFilenames}]`;

    const TIMING_RULES = `
CRITICAL TIMING INSTRUCTIONS:
1. PADDING: You MUST subtract 0.1s from the actual start time and add 0.1s to the actual end time of every segment.
2. NEVER cut in the middle of a word or action. If a boundary is unclear, extend the segment.
3. PRECISION: Be extremely conservative. It is better to include 0.5s of silence than to cut 0.1s of content.
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
            mimeType: f.mimeType, // Use actual mime type (video/audio)
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
    console.log("🔍 [DEBUG] FULL GEMINI RESPONSE:\n", JSON.stringify(parsedResponse, null, 2));

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