
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
  Cpu
} from 'lucide-react';

export const COLORS = {
  primary: '#3b82f6',
  success: '#10b981',
  danger: '#ef4444',
  warning: '#f59e0b',
  bg: '#0a0b0d',
  card: '#111827',
};

export const RISK_LIMITS = {
  maxSingleTradeExposure: 0.05, // Lowered to 5% for production safety
  kellyFraction: 0.2, // Conservative fractional Kelly
  maxConcurrentTrades: 3,
  minConfidence: 0.70, // Increased threshold for real funds
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
};
