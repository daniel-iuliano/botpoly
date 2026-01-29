
export type BotStep = 'IDLE' | 'SCANNING' | 'ANALYZING' | 'RISK_CHECK' | 'EXECUTING' | 'MONITORING' | 'COOLING' | 'EXHAUSTED';

export type WalletType = 'METAMASK' | 'PHANTOM' | 'TRUST' | 'WALLETCONNECT';

export interface Market {
  id: string; // conditionId
  question: string;
  category: string;
  volume: number;
  currentPrice: number;
  outcomes: string[];
  lastUpdated: number;
  description: string;
  // CLOB Specific
  yesTokenId: string;
  noTokenId: string;
  rewards?: boolean;
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
  maticBalance: number;
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
