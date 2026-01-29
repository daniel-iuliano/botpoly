
import { Market, Trade, Signal, BotStats, LogEntry } from "../types";
import { RISK_LIMITS } from "../constants";

const POLYMARKET_CLOB_API = "https://clob.polymarket.com";

/**
 * Calculates the Expected Value (EV) of a YES position.
 */
export const calculateEV = (marketPrice: number, estimatedProb: number): number => {
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
 */
export const fetchLiveMarkets = async (): Promise<Market[]> => {
  try {
    // Note: Polymarket CLOB API often requires specific query params for active liquid markets.
    // Fetching a subset of active markets.
    const response = await fetch(`${POLYMARKET_CLOB_API}/markets?next_cursor=`);
    if (!response.ok) throw new Error("Failed to fetch from Polymarket CLOB API");
    
    const data = await response.json();
    const rawMarkets = data.data || [];

    // Filter for liquid markets (USDC markets usually have price data available)
    return rawMarkets
      .filter((m: any) => m.active && m.order_price_min_tick && m.outcomes)
      .slice(0, 15)
      .map((m: any) => ({
        id: m.condition_id || m.id,
        question: m.question,
        category: m.group_item_title || "General",
        volume: parseFloat(m.volume || "0"),
        currentPrice: 0.5, // Defaulting if not in basic endpoint, real bot would check orderbook
        outcomes: JSON.parse(m.outcomes || '["YES", "NO"]'),
        lastUpdated: Date.now(),
        description: m.description || ""
      }));
  } catch (error) {
    console.error("Market fetch error:", error);
    return [];
  }
};
