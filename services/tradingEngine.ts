
import { Market, Orderbook, Signal, BotConfig } from "../types";

const POLYMARKET_CLOB_API = "https://clob.polymarket.com";

export const calculateEV = (marketPrice: number, estimatedProb: number): number => {
  if (marketPrice <= 0 || marketPrice >= 1) return 0;
  return (estimatedProb * (1 - marketPrice)) - ((1 - estimatedProb) * marketPrice);
};

export const calculateKellySize = (
  marketPrice: number, 
  estimatedProb: number, 
  balance: number,
  config: BotConfig
): number => {
  if (marketPrice <= 0 || marketPrice >= 1) return 0;
  const b = (1 / marketPrice) - 1; 
  const p = estimatedProb;
  const q = 1 - p;
  const kellyFraction = (b * p - q) / b;
  if (kellyFraction <= 0) return 0;
  
  const adjustedFraction = kellyFraction * config.kellyMultiplier;
  const size = balance * Math.min(adjustedFraction, config.maxExposurePerTrade);
  
  return Math.min(size, config.maxTradeSize);
};

/**
 * PRODUCTION SCANNER: Strict Layer 1 Discovery.
 */
export const fetchLiveMarkets = async (config: BotConfig): Promise<{ 
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
        const yesToken = m.tokens.find((t: any) => 
          ['yes', 'true', 'will happen', 'hit', 'over'].includes(t.outcome?.toLowerCase())
        );

        if (config.binaryOnly && !yesToken) {
           discarded++;
           continue;
        }

        const fallbackYes = yesToken || m.tokens[0];
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
          yesTokenId: fallbackYes.token_id,
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
 * @param config Bot configuration containing multiplier and max spread
 */
export const validateLiquidity = (book: Orderbook, tradeSize: number, config: BotConfig): boolean => {
  if (book.spread > config.maxSpread) return false; 
  
  let availableDepth = 0;
  for (let i = 0; i < Math.min(book.asks.length, 5); i++) {
    availableDepth += parseFloat(book.asks[i].size) * parseFloat(book.asks[i].price);
  }
  
  const requiredDepth = tradeSize * config.minLiquidityMultiplier;
  return availableDepth >= requiredDepth; 
};
