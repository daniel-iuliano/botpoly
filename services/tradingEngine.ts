
import { Market, Orderbook, Signal } from "../types";
import { RISK_LIMITS } from "../constants";

const POLYMARKET_CLOB_API = "https://clob.polymarket.com";

export const calculateEV = (marketPrice: number, estimatedProb: number): number => {
  if (marketPrice <= 0 || marketPrice >= 1) return 0;
  return (estimatedProb * (1 - marketPrice)) - ((1 - estimatedProb) * marketPrice);
};

export const calculateKellySize = (
  marketPrice: number, 
  estimatedProb: number, 
  balance: number
): number => {
  if (marketPrice <= 0 || marketPrice >= 1) return 0;
  const b = (1 / marketPrice) - 1; 
  const p = estimatedProb;
  const q = 1 - p;
  const kellyFraction = (b * p - q) / b;
  if (kellyFraction <= 0) return 0;
  return balance * Math.min(kellyFraction * RISK_LIMITS.kellyFraction, RISK_LIMITS.maxSingleTradeExposure);
};

/**
 * PRODUCTION SCANNER: Direct CLOB interaction with diagnostics.
 */
export const fetchLiveMarkets = async (): Promise<{ markets: Market[], totalFetched: number, filtered: number }> => {
  try {
    const response = await fetch(`${POLYMARKET_CLOB_API}/markets`);
    if (!response.ok) throw new Error(`HTTP_${response.status}`);
    
    let data = await response.json();
    
    // Handle cases where response might be wrapped in a 'data' or 'markets' key
    const rawMarkets = Array.isArray(data) ? data : (data.data || data.markets || []);
    const totalFetched = rawMarkets.length;

    if (totalFetched === 0) {
      return { markets: [], totalFetched: 0, filtered: 0 };
    }

    const filteredMarkets = rawMarkets
      .filter((m: any) => {
        // Essential fields for CLOB trading
        const hasCondition = !!m.condition_id;
        const hasTokens = Array.isArray(m.tokens) && m.tokens.length >= 2;
        const isActive = m.active === true || m.active === "true";
        const isNotClosed = m.closed !== true && m.closed !== "true";
        return hasCondition && hasTokens && isActive && isNotClosed;
      })
      .map((m: any) => ({
        id: m.condition_id,
        question: m.question || m.description || "Unknown Market",
        category: m.description?.split(' ')[0] || 'General',
        volume: 0,
        currentPrice: 0.5, 
        outcomes: m.tokens.map((t: any) => t.outcome),
        lastUpdated: Date.now(),
        description: m.description || m.question,
        yesTokenId: m.tokens.find((t: any) => t.outcome?.toLowerCase() === 'yes')?.token_id || m.tokens[0]?.token_id || '',
        noTokenId: m.tokens.find((t: any) => t.outcome?.toLowerCase() === 'no')?.token_id || m.tokens[1]?.token_id || '',
      }));

    return { 
      markets: filteredMarkets, 
      totalFetched, 
      filtered: totalFetched - filteredMarkets.length 
    };
  } catch (error) {
    console.error("Scanner Error:", error);
    return { markets: [], totalFetched: 0, filtered: 0 };
  }
};

export const fetchOrderbook = async (tokenId: string): Promise<Orderbook | null> => {
  try {
    if (!tokenId) return null;
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
    return { bids, asks, spread, midPrice };
  } catch (error) {
    return null;
  }
};

export const validateLiquidity = (book: Orderbook, targetSize: number): boolean => {
  if (book.spread > 0.05) return false; // Increased threshold to 5% for better capture in low vol
  const depthRequired = targetSize * 2;
  let availableDepth = 0;
  for (let i = 0; i < Math.min(book.asks.length, 5); i++) {
    availableDepth += parseFloat(book.asks[i].size) * parseFloat(book.asks[i].price);
  }
  return availableDepth >= 50 && availableDepth >= depthRequired; 
};
