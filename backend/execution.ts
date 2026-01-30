
import { ACTIVE_CONFIG } from "./config";
import { log } from "./logger";
import { Trade, Market, Orderbook } from "../types";

export async function executeOrder(market: Market, book: Orderbook, size: number, edge: number): Promise<Trade> {
  const isSim = ACTIVE_CONFIG.mode === "SIMULATION";
  const prefix = isSim ? "[SIM]" : "[LIVE]";

  if (isSim) {
    log.success(`${prefix} Simulated execution: ${market.id.slice(0,8)} @ $${book.midPrice.toFixed(3)} | Size: $${size.toFixed(2)}`);
  } else {
    log.warn(`${prefix} Sending REAL order to CLOB (Signing...)`);
    // REAL CLOB SIGNING LOGIC GOES HERE
  }

  return {
    id: `${isSim ? 'sim' : 'live'}-${Date.now()}`,
    marketId: market.id,
    marketQuestion: market.question,
    entryPrice: book.midPrice,
    size: size,
    side: 'YES',
    status: 'OPEN',
    pnl: 0,
    timestamp: Date.now(),
    edge: edge,
    isSimulated: isSim
  };
}
