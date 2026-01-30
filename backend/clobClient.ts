
import { Market, Orderbook } from "../types";

const BASE = "https://clob.polymarket.com";

export class ClobClient {
  async fetchMarkets(): Promise<any[]> {
    try {
      const res = await fetch(`${BASE}/markets`);
      if (!res.ok) return [];
      const json = await res.json();
      return Array.isArray(json) ? json : (json.data || []);
    } catch (e) {
      return [];
    }
  }

  async fetchOrderbook(tokenId: string): Promise<Orderbook | null> {
    try {
      const res = await fetch(`${BASE}/book?token_id=${tokenId}`);
      if (!res.ok) return null;
      const data = await res.json();
      
      const bids = data.bids || [];
      const asks = data.asks || [];
      if (bids.length === 0 || asks.length === 0) return null;
      
      const bestBid = parseFloat(bids[0].price);
      const bestAsk = parseFloat(asks[0].price);
      const midPrice = (bestBid + bestAsk) / 2;
      const spread = (bestAsk - bestBid) / midPrice;

      return { bids, asks, spread, midPrice };
    } catch (e) {
      return null;
    }
  }
}
