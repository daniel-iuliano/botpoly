
import { Market, Trade, Signal, BotStats, LogEntry } from "../types";
import { RISK_LIMITS } from "../constants";

const POLYMARKET_GAMMA_API = "https://gamma-api.polymarket.com";

/**
 * Calculates the Expected Value (EV) of a YES position.
 */
export const calculateEV = (marketPrice: number, estimatedProb: number): number => {
  if (marketPrice <= 0 || marketPrice >= 1) return 0;
  const profitOnWin = 1 - marketPrice;
  const lossOnLoss = marketPrice;
  return (estimatedProb * profitOnWin) - ((1 - estimatedProb) * lossOnLoss);
};

/**
 * Fractional Kelly Criterion for position sizing.
 */
export const calculateKellySize = (
  marketPrice: number, 
  estimatedProb: number, 
  balance: number
): number => {
  if (marketPrice <= 0 || marketPrice >= 1) return 0;
  const b = (1 / marketPrice) - 1;
  const p = estimatedProb;
  const q = 1 - p;
  
  if (p * b <= q) return 0; // No edge

  const kellyFraction = (p * b - q) / b;
  const cautiousSize = Math.max(0, kellyFraction * RISK_LIMITS.kellyFraction);
  
  // Cap by risk limits
  const maxAllowed = balance * RISK_LIMITS.maxSingleTradeExposure;
  return Math.min(cautiousSize * balance, maxAllowed);
};

/**
 * Fetches real production market data.
 * Switched to Gamma API for better discovery of active, high-liquidity events.
 */
export const fetchLiveMarkets = async (): Promise<Market[]> => {
  try {
    // Gamma API is more reliable for "what is tradeable now"
    const response = await fetch(`${POLYMARKET_GAMMA_API}/markets?active=true&closed=false&limit=50&order=volume24hr&dir=desc`);
    if (!response.ok) throw new Error("Failed to fetch from Polymarket Gamma API");
    
    const markets = await response.json();
    
    if (!Array.isArray(markets)) {
        console.warn("Gamma API returned unexpected format", markets);
        return [];
    }

    return markets
      .filter((m: any) => 
        m.active === true && 
        m.closed === false &&
        m.question &&
        m.outcomePrices // Ensure we have pricing data
      )
      .map((m: any) => {
        // Gamma API outcomePrices is usually an array of strings ["0.5", "0.5"]
        const prices = JSON.parse(m.outcomePrices || "[]");
        const yesPrice = prices[0] ? parseFloat(prices[0]) : 0.5;

        return {
          id: m.conditionId || m.id,
          question: m.question,
          category: m.groupItemTitle || "General",
          volume: parseFloat(m.volume24hr || "0"),
          currentPrice: yesPrice,
          outcomes: m.outcomes ? (typeof m.outcomes === 'string' ? JSON.parse(m.outcomes) : m.outcomes) : ["YES", "NO"],
          lastUpdated: Date.now(),
          description: m.description || ""
        };
      });
  } catch (error) {
    console.error("Market fetch error:", error);
    return [];
  }
};
