
import { Market, Orderbook, BotConfig } from "../../types";

const POLYMARKET_CLOB_API = "https://clob.polymarket.com";

/**
 * Handles all direct communication with Polymarket CLOB.
 * Strictly implements filtering for tradable markets.
 */
export class ClobClient {
  async getTradableMarkets(config: BotConfig): Promise<Market[]> {
    try {
      const response = await fetch(`${POLYMARKET_CLOB_API}/markets`);
      if (!response.ok) throw new Error("CLOB_OFFLINE");
      
      const data = await response.json();
      const rawMarkets = Array.isArray(data) ? data : (data.data || []);
      
      return rawMarkets
        .filter((m: any) => {
          const isTradable = 
            m.accepting_orders === true && 
            m.enable_order_book === true &&
            !m.closed && 
            !m.archived;
            
          if (config.binaryOnly) {
            const hasYes = m.tokens?.some((t: any) => t.outcome?.toLowerCase() === 'yes');
            return isTradable && hasYes;
          }
          return isTradable;
        })
        .map((m: any) => {
          const yesToken = m.tokens.find((t: any) => t.outcome?.toLowerCase() === 'yes') || m.tokens[0];
          const noToken = m.tokens.find((t: any) => t.outcome?.toLowerCase() === 'no') || m.tokens[1] || m.tokens[0];
          
          return {
            id: m.condition_id,
            question: m.question,
            description: m.description,
            yesTokenId: yesToken.token_id,
            noTokenId: noToken.token_id,
            currentPrice: 0.5, // Default before book fetch
            outcomes: m.tokens.map((t: any) => t.outcome),
            lastUpdated: Date.now(),
            acceptingOrders: true,
            enableOrderBook: true,
            category: m.group_id || 'General',
            volume: 0
          };
        });
    } catch (error) {
      console.error("ClobClient.getMarkets error:", error);
      return [];
    }
  }

  async getOrderbook(tokenId: string): Promise<Orderbook | null> {
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

      return { bids, asks, spread, midPrice };
    } catch (error) {
      return null;
    }
  }
}
