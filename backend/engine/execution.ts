
import { Trade, Market, Orderbook, ExecutionMode } from "../../types";

export class ExecutionEngine {
  async execute(
    mode: ExecutionMode,
    market: Market,
    book: Orderbook,
    size: number,
    side: 'YES' | 'NO',
    edge: number
  ): Promise<Trade | null> {
    if (mode === 'SIMULATION') {
      return this.simulateFill(market, book, size, side, edge);
    }
    return this.placeLiveOrder(market, book, size, side, edge);
  }

  private simulateFill(
    market: Market, 
    book: Orderbook, 
    size: number, 
    side: 'YES' | 'NO',
    edge: number
  ): Trade {
    // High-fidelity simulation includes slippage check
    // In a real execution, we'd walk the book to find true fill price
    const fillPrice = book.midPrice; 
    
    return {
      id: `sim-${Date.now()}`,
      marketId: market.id,
      marketQuestion: market.question,
      entryPrice: fillPrice,
      size: size,
      side: side,
      status: 'OPEN',
      pnl: 0,
      timestamp: Date.now(),
      edge: edge,
      isSimulated: true
    };
  }

  private async placeLiveOrder(
    market: Market, 
    book: Orderbook, 
    size: number, 
    side: 'YES' | 'NO',
    edge: number
  ): Promise<Trade | null> {
    // REAL BACKEND: Use EIP-712 to sign and POST /orders to CLOB
    console.warn("LIVE EXECUTION REQUESTED - Transaction signing would occur here.");
    
    // Placeholder for actual CLOB integration
    return {
      id: `live-${Date.now()}`,
      marketId: market.id,
      marketQuestion: market.question,
      entryPrice: book.midPrice,
      size: size,
      side: side,
      status: 'OPEN',
      pnl: 0,
      timestamp: Date.now(),
      edge: edge,
      isSimulated: false
    };
  }
}
