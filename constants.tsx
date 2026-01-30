
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
  Fuel,
  Settings2,
  Filter,
  BarChart3,
  Scale,
  FlaskConical,
  Radio
} from 'lucide-react';
import { BotConfig, PresetType } from './types';

export const POLYGON_TOKENS = {
  USDC_NATIVE: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
  USDC_BRIDGED: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
  MIN_MATIC_FOR_GAS: 0.5, 
};

export const PRESETS: Record<PresetType, BotConfig> = {
  SAFE: {
    mode: 'SIMULATION',
    preset: 'SAFE',
    minLiquidityMultiplier: 2.5,
    maxSpread: 0.015,
    binaryOnly: true,
    minEV: 0.03,
    minConfidence: 0.85,
    onMissingSignal: 'SKIP',
    kellyMultiplier: 0.05,
    minTradeSize: 1.0,
    maxTradeSize: 10.0,
    maxExposurePerTrade: 0.01,
    cooldownSeconds: 60,
    scanIntervalSeconds: 60,
    maxMarketsPerScan: 2
  },
  OPTIMAL: {
    mode: 'SIMULATION',
    preset: 'OPTIMAL',
    minLiquidityMultiplier: 1.8,
    maxSpread: 0.035,
    binaryOnly: false,
    minEV: 0.015,
    minConfidence: 0.75,
    onMissingSignal: 'SKIP',
    kellyMultiplier: 0.15,
    minTradeSize: 1.0,
    maxTradeSize: 50.0,
    maxExposurePerTrade: 0.05,
    cooldownSeconds: 30,
    scanIntervalSeconds: 30,
    maxMarketsPerScan: 3
  },
  FAST: {
    mode: 'SIMULATION',
    preset: 'FAST',
    minLiquidityMultiplier: 1.4,
    maxSpread: 0.05,
    binaryOnly: false,
    minEV: 0.01,
    minConfidence: 0.70,
    onMissingSignal: 'SKIP',
    kellyMultiplier: 0.2,
    minTradeSize: 1.0,
    maxTradeSize: 100.0,
    maxExposurePerTrade: 0.08,
    cooldownSeconds: 15,
    scanIntervalSeconds: 20,
    maxMarketsPerScan: 5
  },
  AGGRESSIVE: {
    mode: 'SIMULATION',
    preset: 'AGGRESSIVE',
    minLiquidityMultiplier: 1.1,
    maxSpread: 0.08,
    binaryOnly: false,
    minEV: 0.005,
    minConfidence: 0.65,
    onMissingSignal: 'SKIP',
    kellyMultiplier: 0.5,
    minTradeSize: 5.0,
    maxTradeSize: 500.0,
    maxExposurePerTrade: 0.15,
    cooldownSeconds: 10,
    scanIntervalSeconds: 15,
    maxMarketsPerScan: 8
  },
  SLOW: {
    mode: 'SIMULATION',
    preset: 'SLOW',
    minLiquidityMultiplier: 3.0,
    maxSpread: 0.01,
    binaryOnly: true,
    minEV: 0.05,
    minConfidence: 0.90,
    onMissingSignal: 'RETRY',
    kellyMultiplier: 0.1,
    minTradeSize: 10.0,
    maxTradeSize: 50.0,
    maxExposurePerTrade: 0.03,
    cooldownSeconds: 300,
    scanIntervalSeconds: 120,
    maxMarketsPerScan: 2
  },
  DEBUG: {
    mode: 'SIMULATION',
    preset: 'DEBUG',
    minLiquidityMultiplier: 1.0,
    maxSpread: 0.20,
    binaryOnly: false,
    minEV: -0.5,
    minConfidence: 0.1,
    onMissingSignal: 'RETRY',
    kellyMultiplier: 1.0,
    minTradeSize: 0.01,
    maxTradeSize: 1000.0,
    maxExposurePerTrade: 1.0,
    cooldownSeconds: 1,
    scanIntervalSeconds: 5,
    maxMarketsPerScan: 10
  }
};

export const COLORS = {
  primary: '#3b82f6',
  success: '#10b981',
  danger: '#ef4444',
  warning: '#f59e0b',
  bg: '#0a0b0d',
  card: '#111827',
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
  Config: <Settings2 className="w-5 h-5" />,
  Filter: <Filter className="w-4 h-4" />,
  Stats: <BarChart3 className="w-4 h-4" />,
  Scale: <Scale className="w-4 h-4" />,
  Sim: <FlaskConical className="w-5 h-5" />,
  Live: <Radio className="w-5 h-5" />
};

export const DEFAULT_CONFIG = PRESETS.OPTIMAL;
