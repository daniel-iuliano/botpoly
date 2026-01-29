
import React from 'react';
import { 
  TrendingUp, 
  ShieldCheck, 
  Activity, 
  Zap, 
  BrainCircuit, 
  Wallet, 
  Terminal,
  Pause,
  Play,
  ShieldAlert,
  Fingerprint,
  Cpu,
  Fuel
} from 'lucide-react';

export const COLORS = {
  primary: '#3b82f6',
  success: '#10b981',
  danger: '#ef4444',
  warning: '#f59e0b',
  bg: '#0a0b0d',
  card: '#111827',
};

export const POLYGON_TOKENS = {
  // Common error: Only checking one version of USDC. We must check both.
  USDC_NATIVE: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', // Native USDC (Circle)
  USDC_BRIDGED: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', // Bridged USDC (USDC.e)
  MIN_MATIC_FOR_GAS: 0.5, 
};

export const RISK_LIMITS = {
  maxSingleTradeExposure: 0.05, 
  kellyFraction: 0.2, 
  maxConcurrentTrades: 3,
  minConfidence: 0.70, 
};

export const ICONS = {
  Trend: <TrendingUp className="w-5 h-5" />,
  Shield: <ShieldCheck className="w-5 h-5" />,
  Activity: <Activity className="w-5 h-5" />,
  Zap: <Zap className="w-5 h-5" />,
  Brain: <BrainCircuit className="w-5 h-5" />,
  Wallet: <Wallet className="w-5 h-5" />,
  Terminal: <Terminal className="w-5 h-5" />,
  Pause: <Pause className="w-5 h-5" />,
  Play: <Play className="w-5 h-5" />,
  Alert: <ShieldAlert className="w-6 h-6" />,
  Auth: <Fingerprint className="w-5 h-5" />,
  System: <Cpu className="w-5 h-5" />,
  Fuel: <Fuel className="w-5 h-5" />,
};
