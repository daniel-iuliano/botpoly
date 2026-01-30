
import { ACTIVE_CONFIG } from "./config";
import { log } from "./logger";
import { Trade, Market, Orderbook } from "../types";
import { getAuthHeaders } from "./clobAuth";
import { verifySettlementCapability } from "./wallet";

const CLOB_ENDPOINT = "https://clob.polymarket.com/orders";

export async function executeOrder(
  market: Market, 
  book: Orderbook, 
  size: number, 
  edge: number,
  address: string | null
): Promise<Trade | null> {
  const isSim = ACTIVE_CONFIG.mode === "SIMULATION";
  const prefix = isSim ? "[SIM]" : "[LIVE]";

  // 1. Balance Guard (Production Constraint)
  if (!isSim) {
    const canSettle = await verifySettlementCapability(address, size);
    if (!canSettle) return null;
  }

  // 2. Order Construction
  const order = {
    token_id: market.yesTokenId,
    price: book.midPrice.toFixed(2),
    side: "BUY",
    size: (size / book.midPrice).toFixed(2), // Convert USDC to token amount
    type: "LIMIT",
    time_in_force: "GTC",
    expiration: Math.floor(Date.now() / 1000) + 3600 // 1 hour
  };

  // 3. Mode Branching
  if (isSim) {
    log.success(`${prefix} Order simulated: ${market.id.slice(0,8)} @ $${book.midPrice.toFixed(2)} | Size: $${size.toFixed(2)}`);
    return {
      id: `sim-${Date.now()}`,
      marketId: market.id,
      marketQuestion: market.question,
      entryPrice: book.midPrice,
      size: size,
      side: 'YES',
      status: 'OPEN',
      pnl: 0,
      timestamp: Date.now(),
      edge: edge,
      isSimulated: true
    };
  }

  // 4. Real CLOB Execution
  try {
    log.info(`${prefix} Sending REAL order to Polymarket CLOB...`);
    
    const body = JSON.stringify(order);
    const headers = await getAuthHeaders('POST', '/orders', body);

    const response = await fetch(CLOB_ENDPOINT, {
      method: 'POST',
      headers: headers as any,
      body: body
    });

    if (!response.ok) {
      const err = await response.json();
      log.error(`${prefix} CLOB Rejected Order: ${err.error || 'Unknown Error'}`);
      return null;
    }

    const result = await response.json();
    log.success(`${prefix} Order placed: ${result.order_id || 'SUCCESS'}`);

    return {
      id: result.order_id || `live-${Date.now()}`,
      marketId: market.id,
      marketQuestion: market.question,
      entryPrice: book.midPrice,
      size: size,
      side: 'YES',
      status: 'OPEN',
      pnl: 0,
      timestamp: Date.now(),
      edge: edge,
      isSimulated: false
    };
  } catch (error: any) {
    log.error(`${prefix} Execution Fault: ${error.message}`);
    return null;
  }
}
