import type { NextApiRequest, NextApiResponse } from "next";

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

// In-memory cache for the models
let primaryModelName: string | null = null;
let fallbackModelName: string | null = null;
let modelCacheTimestamp: number | null = null;
const MODEL_CACHE_TTL = 3600000; // 1 hour in milliseconds

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// Function to dynamically detect BOTH models with priority for stable models
async function getModels(): Promise<{primary: string, fallback: string | null}> {
  // Check if we have cached models and they're still valid
  if (primaryModelName && fallbackModelName && modelCacheTimestamp) {
    const now = Date.now();
    if (now - modelCacheTimestamp < MODEL_CACHE_TTL) {
      return { primary: primaryModelName, fallback: fallbackModelName };
    }
  }

  if (!GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is not available");
  }

  try {
    // Call the ListModels API to get available models
    const modelsResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${GEMINI_API_KEY}`
    );

    if (!modelsResponse.ok) {
      throw new Error(`Failed to fetch models: ${modelsResponse.status} ${await modelsResponse.text()}`);
    }

    const modelsData = await modelsResponse.json();
    const models = modelsData.models || [];

    // Filter out preview models (models with "preview" in the name)
    const stableModels = models.filter((m: any) => !m.name.includes("preview"));

    // Find primary and fallback models
    let primaryModel: string | null = null;
    let fallbackModel: string | null = null;

    // Look for gemini-2.5-flash as primary and gemini-1.5-flash as fallback
    const flash25StableModel = stableModels.find((m: any) =>
      m.name === "models/gemini-2.5-flash" && 
      m.supportedGenerationMethods?.includes("generateContent")
    );

    const flash15StableModel = stableModels.find((m: any) =>
      m.name === "models/gemini-1.5-flash" && 
      m.supportedGenerationMethods?.includes("generateContent")
    );

    // Set primary model: prioritize 2.5-flash, fallback to 1.5-flash if needed
    if (flash25StableModel && flash25StableModel.name) {
      primaryModel = flash25StableModel.name.replace(/^models\//, '');
      console.log(`🧠 Gemini primary model initialized: models/${primaryModel}`);
    } else if (flash15StableModel && flash15StableModel.name) {
      primaryModel = flash15StableModel.name.replace(/^models\//, '');
      console.log(`🧠 Gemini primary model initialized (as fallback): models/${primaryModel}`);
    }

    // Set fallback model: use 1.5-flash if primary is 2.5-flash, or vice versa
    if (flash25StableModel && flash25StableModel.name && primaryModel && !primaryModel.includes('2.5')) {
      fallbackModel = flash25StableModel.name.replace(/^models\//, '');
      console.log(`🧠 Gemini fallback model initialized: models/${fallbackModel}`);
    } else if (flash15StableModel && flash15StableModel.name && primaryModel && !primaryModel.includes('1.5')) {
      fallbackModel = flash15StableModel.name.replace(/^models\//, '');
      console.log(`🧠 Gemini fallback model initialized: models/${fallbackModel}`);
    }

    // If we still don't have a fallback, try to set it to the other model
    if (primaryModel && !fallbackModel) {
      if (primaryModel.includes('2.5') && flash15StableModel) {
        fallbackModel = flash15StableModel.name.replace(/^models\//, '');
        console.log(`🧠 Gemini fallback model initialized (reverse): models/${fallbackModel}`);
      } else if (primaryModel.includes('1.5') && flash25StableModel) {
        fallbackModel = flash25StableModel.name.replace(/^models\//, '');
        console.log(`🧠 Gemini fallback model initialized (reverse): models/${fallbackModel}`);
      }
    }

    // Cache the models for future requests
    if (primaryModel) {
      primaryModelName = primaryModel;
      modelCacheTimestamp = Date.now();
    }
    
    if (fallbackModel) {
      fallbackModelName = fallbackModel;
    }

    // If no model found, use default
    if (!primaryModel) {
      console.warn("⚠️ No suitable primary model found, using default");
      primaryModelName = "gemini-1.5-flash";
    }
    
    if (!fallbackModel) {
      console.warn("⚠️ No suitable fallback model found, using default");
      fallbackModelName = "gemini-1.5-flash";
    }

    return {
      primary: primaryModelName,
      fallback: fallbackModelName
    };
  } catch (error) {
    console.error("Failed to fetch available models, using fallback:", error);
    // In case of failure, return default models
    primaryModelName = "gemini-1.5-flash";
    fallbackModelName = "gemini-1.5-flash";
    modelCacheTimestamp = Date.now();
    return {
      primary: primaryModelName,
      fallback: fallbackModelName
    };
  }
}

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

    // Dynamically get both primary and fallback models
    const { primary, fallback } = await getModels();
    console.log("🔍 Primary model (Priority 1):", primary);
    console.log("🔍 Fallback model (Priority 2):", fallback);

    // Get the real filenames to inject into the prompt
    const realFilenames = audioFiles.map(f => f.filename).join(', ');
    
    // Create a new instruction for the AI to use real filenames
    const filenameInstruction = `
IMPORTANT: The audio files you are analyzing are named: [${realFilenames}].
When you respond, the "source_file" field in your JSON *must* exactly match one of these names.
DO NOT use example filenames like "take_1.mp3" or "take_3.mp3" from the prompt examples.
Your response must contain ONLY valid JSON with source_file values that match the provided filenames: [${realFilenames}]`;

    // Prepare the request to Gemini API with audio files
    // Strengthen the prompt to ensure JSON response
    const enhancedPromptText = `${systemPrompt}\n\n${userPrompt}\n\n${filenameInstruction}\n\nIMPORTANT: You MUST respond with ONLY the valid JSON object requested. Do not add *any* explanatory text, markdown formatting, or any words before or after the JSON structure. Your entire response must be parsable by \`JSON.parse()\`.`;
    
    const geminiRequest = {
      contents: [{
        role: "user",
        parts: [
          { text: enhancedPromptText },
          ...audioFiles.map((file: { filename: string; data: string }) => ({
            inlineData: {
              mimeType: "audio/mpeg", // Assuming MP3, may need to be more specific
              data: file.data,
            }
          }))
        ]
      }],
      generationConfig: {
        temperature: 0.7,
        topP: 0.9,
        topK: 40
      }
    };

    console.log("🔍 Sending request to Gemini API...");
    console.log("🔍 Request body structure:", {
      hasContents: !!geminiRequest.contents,
      hasGenerationConfig: !!geminiRequest.generationConfig,
      hasTemperature: !!geminiRequest.generationConfig?.temperature
    });
    
    // Try the primary model first
    let response;
    const primaryRequestUrl = `https://generativelanguage.googleapis.com/v1beta/models/${primary}:generateContent?key=${GEMINI_API_KEY}`;
    console.log("🔍 Gemini API URL (Primary):", primaryRequestUrl);
    
    try {
      response = await fetch(primaryRequestUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(geminiRequest),
      });
    } catch (primaryError) {
      console.error("🔍 Primary request failed:", primaryError);
      response = { ok: false, status: 500, text: () => Promise.resolve("Network error") };
    }

    // Check if primary attempt failed with overload error
    if (!response.ok) {
      const errorStatus = response.status;
      if (errorStatus === 503 || errorStatus === 429) {
        console.log(`🔍 Attempt 1 (${primary}) failed with ${errorStatus}. Trying fallback (${fallback})...`);
        
        // Check if fallback model exists
        if (fallback) {
          const fallbackRequestUrl = `https://generativelanguage.googleapis.com/v1beta/models/${fallback}:generateContent?key=${GEMINI_API_KEY}`;
          console.log("🔍 Gemini API URL (Fallback):", fallbackRequestUrl);
          
          try {
            response = await fetch(fallbackRequestUrl, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify(geminiRequest),
            });
            
            console.log("🔍 Fallback request completed with status:", response.status);
          } catch (fallbackError) {
            console.error("🔍 Fallback request failed:", fallbackError);
            // Still return mock data if fallback also fails
            const errorText = await response.text();
            console.error("🔍 Gemini API request failed:", response.status, errorText);
            return res.status(200).json({ mock: true, data: getMockSegments(audioFiles) });
          }
        } else {
          // If no fallback model was available
          console.log("🔍 No fallback model available, using mock data");
          const errorText = await response.text();
          console.error("🔍 Gemini API request failed:", response.status, errorText);
          return res.status(200).json({ mock: true, data: getMockSegments(audioFiles) });
        }
      } else {
        // If the error is not a 503 or 429, don't try fallback, just return error
        const errorText = await response.text();
        console.error("🔍 Gemini API request failed:", response.status, errorText);
        return res.status(200).json({ mock: true, data: getMockSegments(audioFiles) });
      }
    }

    // Process the successful response (either primary or fallback)
    const result = await response.json();
    console.log("🔍 Gemini API response:", {
      status: response.status,
      hasCandidates: !!result.candidates,
      candidatesCount: result.candidates?.length || 0
    });
    
    // Extract the content from the response
    const responseText = result.candidates?.[0]?.content?.parts?.[0]?.text;
    
    if (!responseText) {
      console.error("🔍 Invalid response format from Gemini API:", result);
      console.error("🔍 Response text missing or invalid");
      return res.status(200).json({ mock: true, data: getMockSegments(audioFiles) });
    }

    console.log("🔍 Response text received, length:", responseText.length);
    
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

    // Parse the cleaned JSON response
    try {
      const parsedResponse: AutoCutResponse = JSON.parse(cleanedResponseText);
      console.log("✅ Gemini API request successful");
      console.log("🔍 Successfully parsed Gemini response with", parsedResponse.segments.length, "segments");
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