
import { GoogleGenAI, Type } from "@google/genai";
import { Market, Signal } from "../types";

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function fetchWithRetry<T>(fn: () => Promise<T>, maxRetries = 3, initialDelay = 3000): Promise<T> {
  let lastError: any;
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;
      const errorMsg = error?.message?.toLowerCase() || "";
      const isRateLimit = errorMsg.includes('429') || error?.status === 429 || errorMsg.includes('resource_exhausted') || errorMsg.includes('quota');
      
      if (isRateLimit && i < maxRetries - 1) {
        const waitTime = initialDelay * Math.pow(2, i);
        console.warn(`Rate limit hit (429). Retrying in ${waitTime}ms... (Attempt ${i + 1}/${maxRetries})`);
        await delay(waitTime);
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}

export const generateMarketSignal = async (market: Market): Promise<Signal | null> => {
  return fetchWithRetry(async () => {
    try {
      // Create a new GoogleGenAI instance right before making an API call to ensure it always uses the most up-to-date API key.
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

      const prompt = `Analyze the probability of this prediction market outcome: "${market.question}".
      Description: ${market.description}
      Provide a quantitative probability estimate based on the latest available news and search data.
      Be objective and look for contrarian data points. 
      IMPORTANT: Your response must include the following fields in this exact format:
      IMPLIED_PROBABILITY: [number between 0 and 1]
      CONFIDENCE: [number between 0 and 1]
      REASONING: [your explanation]`;

      const response = await ai.models.generateContent({
        model: "gemini-3-pro-preview",
        contents: prompt,
        config: {
          tools: [{ googleSearch: {} }],
        }
      });

      const text = response.text?.trim();
      if (!text) return null;
      
      // Use regex to extract data because response.text may not be valid JSON when using googleSearch grounding.
      const probMatch = text.match(/IMPLIED_PROBABILITY:\s*([\d.]+)/i);
      const confMatch = text.match(/CONFIDENCE:\s*([\d.]+)/i);
      const reasonMatch = text.match(/REASONING:\s*(.*)/i);

      if (!probMatch) {
        console.warn("Could not extract probability from AI response:", text);
        return null;
      }

      const impliedProbability = parseFloat(probMatch[1]);
      const confidence = confMatch ? parseFloat(confMatch[1]) : 0.5;
      const reasoning = reasonMatch ? reasonMatch[1].trim() : 'Analysis completed';

      const sources = response.candidates?.[0]?.groundingMetadata?.groundingChunks?.map((chunk: any) => ({
        title: chunk.web?.title || 'Source',
        uri: chunk.web?.uri || '#'
      })) || [];

      return {
        marketId: market.id,
        impliedProbability: impliedProbability,
        confidence: confidence,
        reasoning: reasoning,
        sources: sources
      };
    } catch (error) {
      console.error("Signal generation failed:", error);
      return null;
    }
  });
};
