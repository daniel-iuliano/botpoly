
export type BotStep = 'IDLE' | 'SCANNING' | 'ANALYZING' | 'RISK_CHECK' | 'EXECUTING' | 'MONITORING' | 'COOLING' | 'EXHAUSTED';

export type WalletType = 'METAMASK' | 'PHANTOM' | 'TRUST' | 'WALLETCONNECT';

export type ExecutionMode = 'SIMULATION' | 'LIVE';
export type PresetType = 'SAFE' | 'OPTIMAL' | 'FAST' | 'AGGRESSIVE' | 'SLOW' | 'DEBUG';

export interface BotConfig {
  mode: ExecutionMode;
  preset: PresetType | null;
  
  // Market Filters
  minLiquidityMultiplier: number;
  maxSpread: number;
  binaryOnly: boolean;
  
  // Signal & Edge
  minEV: number;
  minConfidence: number;
  onMissingSignal: 'SKIP' | 'RETRY';
  
  // Risk & Sizing
  kellyMultiplier: number;
  minTradeSize: number;
  maxTradeSize: number;
  maxExposurePerTrade: number;
  cooldownSeconds: number;
  
  // Scanner
  scanIntervalSeconds: number;
  maxMarketsPerScan: number;
}

export interface SimulationStats {
  scans: number;
  validSignals: number;
  simulatedTrades: number;
  pnl: number;
  maxDrawdown: number;
  blockedReasons: {
    spread: number;
    liquidity: number;
    confidence: number;
    ev: number;
    size: number;
  };
}

export interface Market {
  id: string;
  question: string;
  category: string;
  volume: number;
  currentPrice: number;
  outcomes: string[];
  lastUpdated: number;
  description: string;
  yesTokenId: string;
  noTokenId: string;
  acceptingOrders: boolean;
  enableOrderBook: boolean;
}

export interface Orderbook {
  bids: { price: string; size: string }[];
  asks: { price: string; size: string }[];
  spread: number;
  midPrice: number;
}

export interface Trade {
  id: string;
  marketId: string;
  marketQuestion: string;
  entryPrice: number;
  size: number;
  side: 'YES' | 'NO';
  status: 'OPEN' | 'CLOSED';
  pnl: number;
  timestamp: number;
  edge: number;
  isSimulated?: boolean;
}

export interface Signal {
  marketId: string;
  impliedProbability: number;
  confidence: number;
  reasoning: string;
  sources: { title: string; uri: string }[];
}

export interface BotStats {
  totalPnL: number;
  winRate: number;
  totalTrades: number;
  activeExposure: number;
  usdcBalance: number;
  polBalance: number; // Updated from maticBalance
  initialUsdcBalance: number;
  allocatedCapital: number;
  cumulativeSpent: number;
}

export interface LogEntry {
  timestamp: number;
  level: 'INFO' | 'SUCCESS' | 'WARNING' | 'ERROR' | 'SIGNAL';
  message: string;
  data?: any;
}
