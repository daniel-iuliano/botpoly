
import { scanMarkets } from "./marketScanner";
import { calculateEV, calculatePositionSize } from "./riskManager";
import { executeOrder } from "./execution";
import { log } from "./logger";
import { ACTIVE_CONFIG } from "./config";
import { generateMarketSignal } from "../services/geminiService";
import { Trade } from "../types";

export async function runIteration(balance: number): Promise<Trade[]> {
  const candidates = await scanMarkets();
  const executedTrades: Trade[] = [];

  for (const { market, book } of candidates) {
    if (book.spread > ACTIVE_CONFIG.maxSpread) {
      log.info(`Skip: Spread too wide (${(book.spread*100).toFixed(2)}%)`);
      continue;
    }

    // Call Gemini for alpha
    log.info(`Analyzing ${market.id.slice(0,8)} with Gemini...`);
    const signal = await generateMarketSignal(market);
    if (!signal) continue;

    const ev = calculateEV(book.midPrice, signal.impliedProbability);
    log.signal(`Edge Analysis: Prob ${(signal.impliedProbability*100).toFixed(1)}% | EV ${(ev*100).toFixed(1)}%`);

    if (ev < ACTIVE_CONFIG.minEV || signal.confidence < ACTIVE_CONFIG.minConfidence) {
      log.info(`Skip: Edge or Confidence below threshold`);
      continue;
    }

    const size = calculatePositionSize(balance, book.midPrice, signal.impliedProbability);
    if (size <= 0) {
      log.info(`Skip: Position size too small`);
      continue;
    }

    const trade = await executeOrder(market, book, size, ev);
    executedTrades.push(trade);
    
    // Break after first execution to avoid overlapping orders in a single scan
    break; 
  }

  return executedTrades;
}
