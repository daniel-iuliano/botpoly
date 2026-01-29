
import { Market, Trade, Signal, BotStats, LogEntry } from "../types";
import { RISK_LIMITS } from "../constants";

const POLYMARKET_CLOB_API = "https://clob.polymarket.com";

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
 * Fetches real production market data from Polymarket CLOB.
 * Uses specific filtering for active, tradeable tokens.
 */
export const fetchLiveMarkets = async (): Promise<Market[]> => {
  try {
    // Fetch active markets with volume filtering if possible
    const response = await fetch(`${POLYMARKET_CLOB_API}/markets?active=true`);
    if (!response.ok) throw new Error("Failed to fetch from Polymarket CLOB API");
    
    const data = await response.json();
    const rawMarkets = data.data || [];

    // Filter for liquid markets (must have outcomes and be active)
    return rawMarkets
      .filter((m: any) => 
        m.active === true && 
        m.closed === false &&
        m.outcomes && 
        m.question
      )
      .sort((a: any) => (a.volume_24h ? -1 : 1)) // Prioritize high volume
      .slice(0, 20)
      .map((m: any) => {
        // Extract current price from the CLOB token data if available
        // Usually YES is index 0, NO is index 1
        const tokens = m.tokens || [];
        const yesPrice = tokens[0]?.price ? parseFloat(tokens[0].price) : 0.5;

        return {
          id: m.condition_id || m.id,
          question: m.question,
          category: m.group_item_title || "General",
          volume: parseFloat(m.volume_24h || m.volume || "0"),
          currentPrice: yesPrice,
          outcomes: typeof m.outcomes === 'string' ? JSON.parse(m.outcomes) : m.outcomes,
          lastUpdated: Date.now(),
          description: m.description || ""
        };
      });
  } catch (error) {
    console.error("Market fetch error:", error);
    return [];
  }
};
