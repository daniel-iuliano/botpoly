
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
  
  const adjustedFraction = kellyFraction * RISK_LIMITS.kellyFraction;
  const size = balance * Math.min(adjustedFraction, RISK_LIMITS.maxSingleTradeExposure);
  return size;
};

/**
 * PRODUCTION SCANNER: Strict Layer 1 Discovery.
 */
export const fetchLiveMarkets = async (): Promise<{ 
  markets: Market[], 
  stats: { total: number, discarded: number, tradable: number } 
}> => {
  try {
    const response = await fetch(`${POLYMARKET_CLOB_API}/markets`);
    if (!response.ok) throw new Error(`CLOB_OFFLINE_${response.status}`);
    
    const data = await response.json();
    const rawMarkets = Array.isArray(data) ? data : (data.data || data.markets || []);
    
    let discarded = 0;
    const tradableMarkets: Market[] = [];

    for (const m of rawMarkets) {
      const isClosed = m.closed === true || String(m.closed) === "true";
      const isArchived = m.archived === true || String(m.archived) === "true";
      const acceptingOrders = m.accepting_orders === true || String(m.accepting_orders) === "true";
      const orderBookEnabled = m.enable_order_book === true || String(m.enable_order_book) === "true";

      if (isClosed || isArchived || !acceptingOrders || !orderBookEnabled) {
        discarded++;
        continue;
      }

      if (m.condition_id && Array.isArray(m.tokens) && m.tokens.length >= 1) {
        // ROBUST TOKEN SELECTION: 
        // 1. Try common 'positive' labels
        // 2. Fallback to first available token (guarantees we never have empty ID for tradable market)
        const yesToken = m.tokens.find((t: any) => 
          ['yes', 'true', 'will happen', 'hit', 'over'].includes(t.outcome?.toLowerCase())
        ) || m.tokens[0];

        const noToken = m.tokens.find((t: any) => 
          ['no', 'false', 'will not happen', 'miss', 'under'].includes(t.outcome?.toLowerCase())
        ) || m.tokens[1] || m.tokens[0];

        tradableMarkets.push({
          id: m.condition_id,
          question: m.question || m.description || "Unknown",
          category: m.description?.split(' ')[0] || 'General',
          volume: 0,
          currentPrice: 0.5, 
          outcomes: m.tokens.map((t: any) => t.outcome),
          lastUpdated: Date.now(),
          description: m.description || m.question,
          yesTokenId: yesToken.token_id,
          noTokenId: noToken.token_id,
          acceptingOrders: true,
          enableOrderBook: true
        });
      } else {
        discarded++;
      }
    }

    return { 
      markets: tradableMarkets, 
      stats: { total: rawMarkets.length, discarded, tradable: tradableMarkets.length } 
    };
  } catch (error) {
    console.error("Discovery Kernel Error:", error);
    return { markets: [], stats: { total: 0, discarded: 0, tradable: 0 } };
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

/**
 * Validates if the orderbook can support the intended trade size.
 * @param book The orderbook object
 * @param tradeSize The intended trade amount in USDC
 * @param multiplier Safety buffer for liquidity (default 1.5x trade size)
 */
export const validateLiquidity = (book: Orderbook, tradeSize: number, multiplier = 1.5): boolean => {
  // Spread check: Reject highly illiquid/manipulated spreads
  if (book.spread > 0.08) return false; 
  
  let availableDepth = 0;
  // Calculate aggregate depth at top levels
  for (let i = 0; i < Math.min(book.asks.length, 5); i++) {
    availableDepth += parseFloat(book.asks[i].size) * parseFloat(book.asks[i].price);
  }
  
  // Depth must support the trade size with a safety buffer
  const requiredDepth = tradeSize * multiplier;
  return availableDepth >= requiredDepth; 
};
