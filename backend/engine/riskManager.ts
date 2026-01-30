
import { BotConfig } from "../../types";

export class RiskManager {
  /**
   * Calculates Expected Value based on market vs estimated probability.
   */
  calculateEV(marketPrice: number, estimatedProb: number): number {
    if (marketPrice <= 0 || marketPrice >= 1) return 0;
    // EV = (Prob of Win * Profit) - (Prob of Loss * Stake)
    // Profit = (1 / Price) - 1
    const profit = (1 / marketPrice) - 1;
    return (estimatedProb * profit) - (1 - estimatedProb);
  }

  /**
   * Applies the Kelly Criterion to find optimal stake.
   */
  calculatePositionSize(
    marketPrice: number, 
    estimatedProb: number, 
    balance: number, 
    config: BotConfig
  ): number {
    if (marketPrice <= 0 || marketPrice >= 1) return 0;
    
    // b = decimal odds - 1
    const b = (1 / marketPrice) - 1;
    const p = estimatedProb;
    const q = 1 - p;
    
    // f* = (bp - q) / b
    const kellyFraction = (b * p - q) / b;
    
    if (kellyFraction <= 0) return 0;
    
    // Apply safety multipliers and limits
    const adjustedFraction = kellyFraction * config.kellyMultiplier;
    let size = balance * Math.min(adjustedFraction, config.maxExposurePerTrade);
    
    // Hard caps
    size = Math.max(size, 0);
    size = Math.min(size, config.maxTradeSize);
    
    // Floor
    if (size < config.minTradeSize) return 0;
    
    return size;
  }
}
