import type { NextApiRequest, NextApiResponse } from "next";
import { GoogleGenerativeAI } from "@google/generative-ai";

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

// Define model priority list
const MODELS = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash'];

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  console.log("🔍 Gemini API route called - Method:", req.method);
  console.log("🔍 GEMINI_API_KEY available:", !!GEMINI_API_KEY);

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!GEMINI_API_KEY) {
    console.warn("🔍 Gemini API key not found — using mock data fallback.");
    return res.status(200).json({ mock: true, data: getMockSegments() });
  }

  try {
    const { audioFiles, systemPrompt, userPrompt } = req.body;
    console.log("🔍 Gemini API received:", {
      audioFilesCount: audioFiles?.length,
      hasSystemPrompt: !!systemPrompt,
      hasUserPrompt: !!userPrompt,
      apiKeyExists: !!GEMINI_API_KEY
    });

    if (!audioFiles || !Array.isArray(audioFiles)) {
      return res.status(400).json({ error: "audioFiles array is required in request body" });
    }

    // Get the real filenames to inject into the prompt
    const realFilenames = audioFiles.map((f: any) => f.filename).join(', ');

    // Create a new instruction for the AI to use real filenames
    const filenameInstruction = `
IMPORTANT: The audio files you are analyzing are named: [${realFilenames}].
When you respond, the "source_file" field in your JSON *must* exactly match one of these names.
DO NOT use example filenames like "take_1.mp3" or "take_3.mp3" from the prompt examples.
Your response must contain ONLY valid JSON with source_file values that match the provided filenames: [${realFilenames}]`;

    // Prepare the request to Gemini API with audio files
    // Strengthen the prompt to ensure JSON response
    const enhancedPromptText = `${systemPrompt}\n\n${filenameInstruction}\n\n${userPrompt}\n\nIMPORTANT: You MUST respond with ONLY the valid JSON object requested. Do not add *any* explanatory text, markdown formatting, or any words before or after the JSON structure. Your entire response must be parsable by \`JSON.parse()\`.`;

    // Create the content array with both text and audio parts
    const contentParts = [
      { text: enhancedPromptText },
      ...audioFiles.map((file: { filename: string; data: string; mimeType?: string }) => ({
        inlineData: {
          mimeType: file.mimeType || "audio/mpeg", // Use provided MIME type or default
          data: file.data,
        }
      }))
    ];

    console.log("🔍 Creating GoogleGenerativeAI client...");

    // Initialize the Google Generative AI client
    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

    // Waterfall logic: Try each model in priority order
    let result;
    let modelUsed: string | null = null;

    for (const modelName of MODELS) {
      console.log(`🔍 Attempting to call model: ${modelName}`);

      try {
        // Initialize the model
        const model = genAI.getGenerativeModel({
          model: modelName,
          generationConfig: {
            temperature: 0.3,
            responseMimeType: "application/json"
          }
        });

        // Generate content using the SDK
        result = await model.generateContent({
          contents: [{
            role: "user",
            parts: contentParts as any
          }]
        });

        modelUsed = modelName;
        console.log(`✅ Successfully used model: ${modelName}`);
        break; // Exit the loop if successful

      } catch (error: any) {
        console.error(`🔍 Model ${modelName} failed:`, error?.message || error);

        // Check if this is a retryable error (404, 429, 503)
        const isRetryable = error.status === 404 || error.status === 429 || error.status === 503 ||
          error.message?.includes('429') ||
          error.message?.includes('503') ||
          error.message?.includes('OVERLOADED') ||
          error.message?.includes('NOT_FOUND');

        if (isRetryable) {
          console.warn(`⚠️ Model ${modelName} not available, trying next model...`);
          continue; // Try the next model in the list
        } else {
          // If it's not a retryable error, continue to the next model anyway (safest bet)
          console.warn(`⚠️ Model ${modelName} failed with non-retryable error, trying next model...`);
          continue;
        }
      }
    }

    // If no model was successful
    if (!result || !modelUsed) {
      console.error("🔍 All models failed, using mock data fallback");
      return res.status(200).json({ mock: true, data: getMockSegments(audioFiles) });
    }

    // Process the successful response
    console.log("🔍 Gemini API response from model:", modelUsed);
    console.log("🔍 Response received, checking for candidates...");

    // Extract the content from the response
    const responseText = result.response.text();

    if (!responseText) {
      console.error("🔍 Invalid response format from Gemini API");
      console.error("🔍 Response text missing or invalid");
      return res.status(200).json({ mock: true, data: getMockSegments(audioFiles) });
    }

    console.log("🔍 Response text received, length:", responseText.length);
    // console.log("🔍 Raw response text:", responseText.substring(0, 200) + "...");

    // Clean the response text to remove markdown formatting (e.g., ```json ... ```)
    let cleanedResponseText = responseText.trim();

    // Check if the response is wrapped in markdown code block
    if (cleanedResponseText.startsWith('```json')) {
      // Extract content between the code block markers
      const startIdx = cleanedResponseText.indexOf('{');
      const endIdx = cleanedResponseText.lastIndexOf('}');
      if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
        cleanedResponseText = cleanedResponseText.substring(startIdx, endIdx + 1);
      } else {
        // If we can't find proper JSON structure, try to clean with regex
        cleanedResponseText = cleanedResponseText.replace(/```json\n?|```/g, '').trim();
      }
    }
    // Remove any leading/trailing code block markers that might not be json-specific
    else if (cleanedResponseText.startsWith('```')) {
      const endIdx = cleanedResponseText.lastIndexOf('```');
      if (endIdx !== -1) {
        cleanedResponseText = cleanedResponseText.substring(0, endIdx).replace(/```/g, '').trim();
      }
    }

    // console.log("🔍 Cleaned response text:", cleanedResponseText.substring(0, 200) + "...");

    // Parse the cleaned JSON response
    try {
      const parsedResponse: AutoCutResponse = JSON.parse(cleanedResponseText);
      console.log("✅ Gemini API request successful");

      // Safety check for segments array
      const segmentsCount = parsedResponse.segments ? parsedResponse.segments.length : 0;
      console.log("🔍 Successfully parsed Gemini response with", segmentsCount, "segments");

      // Ensure segments exists even if empty
      if (!parsedResponse.segments) {
        parsedResponse.segments = [];
      }

      res.status(200).json({ mock: false, data: parsedResponse });
    } catch (parseError) {
      console.error("🔍 Failed to parse Gemini API response:", parseError);
      console.error("🔍 Raw response that caused the error:", responseText);
      console.error("🔍 Cleaned response that failed to parse:", cleanedResponseText);
      res.status(200).json({ mock: true, data: getMockSegments(audioFiles) });
    }
  } catch (error) {
    console.error("🔍 Error in Gemini request:", error);
    res.status(200).json({ mock: true, data: getMockSegments() });
  }
}

function getMockSegments(audioFiles?: Array<{ filename: string; data: string }>): AutoCutResponse {
  const filenames = audioFiles ? audioFiles.map(f => f.filename) : ["demo.mp3"];

  return {
    metadata: {
      total_duration: audioFiles ? audioFiles.length * 5 : 5,
      segment_count: audioFiles ? audioFiles.length : 1,
      takes_used: filenames,
      quality_warnings: ["Using mock data - no Gemini API key provided"]
    },
    segments: audioFiles ?
      audioFiles.map((file, index) => ({
        segment_id: index + 1,
        source_file: file.filename,
        start_sec: 0.5,
        end_sec: 4.5,
        content: `Sample content from ${file.filename}`,
        selection_reason: "Optimal segment selected",
        transition_in: "cut",
        transition_out: "cut"
      }))
      : [{
        segment_id: 1,
        source_file: "demo.mp3",
        start_sec: 0.0,
        end_sec: 4.0,
        content: "Example intro for testing.",
        selection_reason: "Mocked response for fallback mode.",
        transition_in: "fade",
        transition_out: "cut"
      }]
  };
}

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '20mb',
    },
  },
};