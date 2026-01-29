
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

export const generateMarketSignal = async (market: Market): Promise<Signal> => {
  return fetchWithRetry(async () => {
    try {
      // Fix: Initialize the API client directly using the environment variable as per guidelines.
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

      const prompt = `Analyze the probability of this prediction market outcome: "${market.question}".
      Description: ${market.description}
      Provide a quantitative probability estimate based on the latest available news and search data.
      Be objective and look for contrarian data points. Respond in JSON format.`;

      // Fix: Using gemini-3-pro-preview for complex reasoning and quantitative analysis tasks.
      const response = await ai.models.generateContent({
        model: "gemini-3-pro-preview",
        contents: prompt,
        config: {
          tools: [{ googleSearch: {} }],
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              impliedProbability: { 
                type: Type.NUMBER, 
                description: "The estimated probability of the 'YES' outcome from 0.0 to 1.0" 
              },
              confidence: { 
                type: Type.NUMBER, 
                description: "How certain are you in this estimate from 0.0 to 1.0" 
              },
              reasoning: { 
                type: Type.STRING, 
                description: "Brief explanation of the core logic" 
              }
            },
            required: ["impliedProbability", "confidence", "reasoning"]
          }
        }
      });

      // Fix: Directly access .text property from GenerateContentResponse (do not use .text())
      const text = response.text?.trim() || '{}';
      const data = JSON.parse(text);
      
      // Extract search URLs for grounding
      const sources = response.candidates?.[0]?.groundingMetadata?.groundingChunks?.map((chunk: any) => ({
        title: chunk.web?.title || 'Source',
        uri: chunk.web?.uri || '#'
      })) || [];

      return {
        marketId: market.id,
        impliedProbability: data.impliedProbability ?? 0.5,
        confidence: data.confidence ?? 0.5,
        reasoning: data.reasoning ?? 'Analysis unavailable',
        sources: sources
      };
    } catch (error) {
      console.error("Signal generation failed:", error);
      throw error;
    }
  });
};
