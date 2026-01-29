
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
 * PRODUCTION SCANNER: Strict Layer 1 Discovery.
 * Only identifies markets that are physically tradable on the CLOB.
 */
export const fetchLiveMarkets = async (): Promise<{ 
  markets: Market[], 
  stats: { total: number, discarded: number, tradable: number } 
}> => {
  try {
    // CLOB Discovery Endpoint Only
    const response = await fetch(`${POLYMARKET_CLOB_API}/markets`);
    if (!response.ok) throw new Error(`CLOB_OFFLINE_${response.status}`);
    
    const data = await response.json();
    const rawMarkets = Array.isArray(data) ? data : (data.data || data.markets || []);
    
    let discarded = 0;
    const tradableMarkets: Market[] = [];

    for (const m of rawMarkets) {
      // THE FOUR GATES: Strict tradability check
      const isClosed = m.closed === true || String(m.closed) === "true";
      const isArchived = m.archived === true || String(m.archived) === "true";
      const acceptingOrders = m.accepting_orders === true || String(m.accepting_orders) === "true";
      const orderBookEnabled = m.enable_order_book === true || String(m.enable_order_book) === "true";

      if (isClosed || isArchived || !acceptingOrders || !orderBookEnabled) {
        discarded++;
        continue;
      }

      // Final metadata check
      if (m.condition_id && Array.isArray(m.tokens) && m.tokens.length >= 2) {
        tradableMarkets.push({
          id: m.condition_id,
          question: m.question || m.description || "Unknown",
          category: m.description?.split(' ')[0] || 'General',
          volume: 0,
          currentPrice: 0.5, 
          outcomes: m.tokens.map((t: any) => t.outcome),
          lastUpdated: Date.now(),
          description: m.description || m.question,
          yesTokenId: m.tokens.find((t: any) => t.outcome?.toLowerCase() === 'yes')?.token_id || m.tokens[0]?.token_id || '',
          noTokenId: m.tokens.find((t: any) => t.outcome?.toLowerCase() === 'no')?.token_id || m.tokens[1]?.token_id || '',
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

/**
 * LAYER 2: Live Order Book Fetching.
 * Directly queries the specific order book for the candidate token.
 */
export const fetchOrderbook = async (tokenId: string): Promise<Orderbook | null> => {
  try {
    if (!tokenId) return null;
    const response = await fetch(`${POLYMARKET_CLOB_API}/book?token_id=${tokenId}`);
    if (!response.ok) return null;
    
    const data = await response.json();
    const bids = data.bids || [];
    const asks = data.asks || [];
    
    // Explicitly confirm bid/ask existence
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
 * LAYER 2: Liquidity Validation.
 * Confirms depth and spread constraints for execution.
 */
export const validateLiquidity = (book: Orderbook, targetSize: number): boolean => {
  // 1. Spread Check (Guard against toxic slippage)
  if (book.spread > 0.04) return false; 
  
  // 2. Depth Check (Verify existence of real orders)
  let availableDepth = 0;
  for (let i = 0; i < Math.min(book.asks.length, 5); i++) {
    availableDepth += parseFloat(book.asks[i].size) * parseFloat(book.asks[i].price);
  }
  
  // Requirement: Minimum depth for entry + base safety threshold
  return availableDepth >= targetSize && availableDepth >= 10; 
};
