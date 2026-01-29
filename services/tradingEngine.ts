
import { Market, Orderbook, Signal } from "../types";
import { RISK_LIMITS } from "../constants";

const POLYMARKET_CLOB_API = "https://clob.polymarket.com";

/**
 * Calculates Expected Value (EV)
 * EV = (P(win) * Net Profit) - (P(loss) * Stake)
 */
export const calculateEV = (marketPrice: number, estimatedProb: number): number => {
  if (marketPrice <= 0 || marketPrice >= 1) return 0;
  // Net profit is (1 - price) per dollar staked
  // Loss is the price per dollar staked
  return (estimatedProb * (1 - marketPrice)) - ((1 - estimatedProb) * marketPrice);
};

/**
 * Fractional Kelly sizing based on USDC balance
 * f* = (bp - q) / b
 * where b = odds - 1, p = probability of win, q = probability of loss
 */
export const calculateKellySize = (
  marketPrice: number, 
  estimatedProb: number, 
  balance: number
): number => {
  if (marketPrice <= 0 || marketPrice >= 1) return 0;
  const b = (1 / marketPrice) - 1; // Decimal odds - 1
  const p = estimatedProb;
  const q = 1 - p;
  
  const kellyFraction = (b * p - q) / b;
  
  if (kellyFraction <= 0) return 0;
  
  // Apply risk limits: fractional Kelly (e.g., 20% of full Kelly) and max single exposure
  const sizedFraction = Math.min(
    kellyFraction * RISK_LIMITS.kellyFraction,
    RISK_LIMITS.maxSingleTradeExposure
  );
  
  return balance * sizedFraction;
};

/**
 * PRODUCTION SCANNER: Fetches live markets directly from CLOB API.
 * Single source of truth for execution.
 */
export const fetchLiveMarkets = async (): Promise<Market[]> => {
  try {
    const response = await fetch(`${POLYMARKET_CLOB_API}/markets`);
    if (!response.ok) throw new Error(`CLOB API Error: ${response.status}`);
    
    const data = await response.json();
    
    // Filter for active, open markets with tradable outcomes
    return data
      .filter((m: any) => m.active && !m.closed && m.tokens?.length === 2)
      .map((m: any) => ({
        id: m.condition_id,
        question: m.question,
        category: m.description?.split(' ')[0] || 'General',
        volume: 0, // CLOB API doesn't always provide 24h volume in this endpoint
        currentPrice: 0.5, // Will be updated by orderbook fetch
        outcomes: m.tokens.map((t: any) => t.outcome),
        lastUpdated: Date.now(),
        description: m.description || m.question,
        yesTokenId: m.tokens.find((t: any) => t.outcome === 'Yes')?.token_id || '',
        noTokenId: m.tokens.find((t: any) => t.outcome === 'No')?.token_id || '',
      }))
      .filter((m: Market) => m.yesTokenId && m.noTokenId);
  } catch (error) {
    console.error("CLOB Market Fetch Failed:", error);
    return [];
  }
};

/**
 * Fetches and validates L2 Orderbook depth and spread.
 */
export const fetchOrderbook = async (tokenId: string): Promise<Orderbook | null> => {
  try {
    const response = await fetch(`${POLYMARKET_CLOB_API}/book?token_id=${tokenId}`);
    if (!response.ok) return null;
    
    const data = await response.json();
    const bids = data.bids || [];
    const asks = data.asks || [];
    
    if (bids.length === 0 || asks.length === 0) return null;
    
    const bestBid = parseFloat(bids[0].price);
    const bestAsk = parseFloat(asks[0].price);
    const midPrice = (bestBid + bestAsk) / 2;
    const spread = (bestAsk - bestBid) / midPrice;
    
    return {
      bids,
      asks,
      spread,
      midPrice
    };
  } catch (error) {
    return null;
  }
};

/**
 * Strict Liquidity Validation
 */
export const validateLiquidity = (book: Orderbook, targetSize: number): boolean => {
  // 1. Spread Check (Max 2% spread for automated entry)
  if (book.spread > 0.02) return false;
  
  // 2. Depth Check (Sufficient liquidity within first 5 price levels)
  const depthRequired = targetSize * 3; // We want 3x depth for minimal slippage
  let availableDepth = 0;
  
  // Check Ask depth for buying (Yes/No)
  for (let i = 0; i < Math.min(book.asks.length, 5); i++) {
    availableDepth += parseFloat(book.asks[i].size) * parseFloat(book.asks[i].price);
  }
  
  return availableDepth >= depthRequired && availableDepth >= 500; // Minimum $500 depth
};
