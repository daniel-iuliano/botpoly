
import { ACTIVE_CONFIG } from "./config";

export function calculateEV(marketPrice: number, estimatedProb: number): number {
  if (marketPrice <= 0 || marketPrice >= 1) return 0;
  return (estimatedProb * (1 - marketPrice)) - ((1 - estimatedProb) * marketPrice);
}

export function calculatePositionSize(balance: number, marketPrice: number, estimatedProb: number): number {
  if (marketPrice <= 0 || marketPrice >= 1) return 0;
  
  const b = (1 / marketPrice) - 1;
  const p = estimatedProb;
  const q = 1 - p;
  const kellyFraction = (b * p - q) / b;
  
  if (kellyFraction <= 0) return 0;
  
  const adjustedFraction = kellyFraction * ACTIVE_CONFIG.kellyMultiplier;
  let size = balance * Math.min(adjustedFraction, ACTIVE_CONFIG.maxExposurePerTrade);
  
  size = Math.min(size, ACTIVE_CONFIG.maxTradeSize);
  return size >= ACTIVE_CONFIG.minTradeSize ? size : 0;
}
