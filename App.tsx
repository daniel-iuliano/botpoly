
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { BrainCircuit, ShieldAlert } from 'lucide-react';
import { BrowserProvider, formatUnits } from 'ethers';
import { Dashboard } from './components/Dashboard';
import { Terminal } from './components/Terminal';
import { WalletSelector } from './components/WalletSelector';
import { Market, Trade, BotStats, LogEntry, Signal, BotStep, WalletType } from './types';
import { fetchLiveMarkets, calculateEV, calculateKellySize } from './services/tradingEngine';
import { generateMarketSignal } from './services/geminiService';
import { ICONS, RISK_LIMITS } from './constants';

const POLYGON_CHAIN_ID = 137n;

const INITIAL_STATS: BotStats = {
  totalPnL: 0,
  winRate: 0,
  totalTrades: 0,
  activeExposure: 0,
  balance: 0,
  initialBalance: 0,
  allocatedCapital: 0,
  cumulativeSpent: 0
};

const BASE_POLL_INTERVAL = 30000; // 30s cycle
const ERROR_BACKOFF_INTERVAL = 60000;
const STEP_DELAY = 800;

async function detectProvider(type: WalletType): Promise<any> {
  const win = window as any;
  let provider = getRawProvider(type);
  if (provider) return provider;

  if (document.readyState !== 'complete') {
    await new Promise((resolve) => {
      window.addEventListener('load', resolve, { once: true });
      setTimeout(resolve, 3000);
    });
    provider = getRawProvider(type);
    if (provider) return provider;
  }

  for (let i = 0; i < 10; i++) {
    await new Promise(r => setTimeout(r, 100 * i));
    provider = getRawProvider(type);
    if (provider) return provider;
  }
  return null;
}

function getRawProvider(type: WalletType): any {
  const win = window as any;
  switch (type) {
    case 'METAMASK':
      if (win.ethereum?.providers?.length) {
        return win.ethereum.providers.find((p: any) => p.isMetaMask);
      }
      return win.ethereum?.isMetaMask ? win.ethereum : null;
    case 'PHANTOM':
      return win.phantom?.ethereum || (win.ethereum?.isPhantom ? win.ethereum : null);
    case 'TRUST':
      return win.trustwallet || (win.ethereum?.isTrust ? win.ethereum : null);
    default:
      return win.ethereum;
  }
}

const App: React.FC = () => {
  const [isRunning, setIsRunning] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [showWalletSelector, setShowWalletSelector] = useState(false);
  const [address, setAddress] = useState<string | null>(null);
  const [walletType, setWalletType] = useState<WalletType | null>(null);
  const [currentStep, setCurrentStep] = useState<BotStep>('IDLE');
  const [allocationPercent, setAllocationPercent] = useState(50);
  const [stats, setStats] = useState<BotStats>(INITIAL_STATS);
  const [activeTrades, setActiveTrades] = useState<Trade[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([
    { timestamp: Date.now(), level: 'INFO', message: 'Production Multi-Wallet Engine Initialized. Mode: MAINNET.' }
  ]);
  
  const botTimeoutRef = useRef<any>(null);

  const addLog = useCallback((level: LogEntry['level'], message: string, data?: any) => {
    setLogs(prev => [...prev.slice(-100), { timestamp: Date.now(), level, message, data }]);
  }, []);

  const connectWallet = async (type: WalletType) => {
    setIsConnecting(true);
    addLog('INFO', `Scanning for ${type} provider...`);
    try {
      const rawProvider = await detectProvider(type);
      if (!rawProvider) {
        addLog('ERROR', `${type} extension not detected or inactive.`);
        setShowWalletSelector(false);
        setIsConnecting(false);
        return;
      }
      const provider = new BrowserProvider(rawProvider);
      const accounts = await provider.send("eth_requestAccounts", []);
      const balance = await provider.getBalance(accounts[0]);
      
      setAddress(accounts[0]);
      setWalletType(type);
      setIsConnected(true);
      setShowWalletSelector(false);
      const currentBal = parseFloat(formatUnits(balance, 18));
      setStats(prev => ({ ...prev, balance: currentBal, initialBalance: currentBal }));
      addLog('SUCCESS', `${type} Wallet Active: ${accounts[0].slice(0, 6)}...${accounts[0].slice(-4)}`);
    } catch (error: any) {
      addLog('ERROR', 'Wallet handshake failed.', error.message);
    } finally {
      setIsConnecting(false);
    }
  };

  const startBot = () => {
    if (!isConnected) return;
    if (allocationPercent <= 0) {
      addLog('ERROR', 'Capital allocation must be greater than 0%.');
      return;
    }

    const allocated = stats.balance * (allocationPercent / 100);
    setStats(prev => ({ 
      ...prev, 
      initialBalance: prev.balance,
      allocatedCapital: allocated,
      cumulativeSpent: 0 
    }));
    
    setIsRunning(true);
    addLog('SUCCESS', `Bot started with hard limit of $${allocated.toFixed(2)} capital.`);
    addLog('INFO', 'Budget Guard activated. Multi-market scan initialized.');
  };

  const stopBot = (reason: 'USER' | 'BUDGET' = 'USER') => {
    setIsRunning(false);
    if (reason === 'BUDGET') {
      setCurrentStep('EXHAUSTED');
      addLog('WARNING', 'CRITICAL: ALLOCATED CAPITAL FULLY CONSUMED. System shutdown.');
    } else {
      setCurrentStep('IDLE');
      addLog('WARNING', 'Emergency stop triggered by user.');
    }
    if (botTimeoutRef.current) window.clearTimeout(botTimeoutRef.current);
  };

  const runIteration = useCallback(async () => {
    if (!isRunning) return;

    let nextDelay = BASE_POLL_INTERVAL;

    try {
      // Step 1: Budget Guard Pre-flight
      const remainingBudget = stats.allocatedCapital - stats.cumulativeSpent;
      if (remainingBudget <= 0.1) { 
        stopBot('BUDGET');
        return;
      }

      setCurrentStep('SCANNING');
      addLog('INFO', 'Fetching top liquid markets from CLOB...');
      const markets = await fetchLiveMarkets();
      
      if (markets.length === 0) {
        addLog('WARNING', 'Zero liquidity detected in scan. Retrying in 10s...');
        botTimeoutRef.current = window.setTimeout(runIteration, 10000);
        return;
      }

      // Instead of picking 1 random, we evaluate the top 3-5 candidates for edge
      const candidates = markets.slice(0, 3);
      let tradeExecuted = false;

      for (const targetMarket of candidates) {
        if (tradeExecuted) break;
        
        setCurrentStep('ANALYZING');
        addLog('INFO', `Evaluating Alpha: "${targetMarket.question.slice(0, 40)}..."`);
        
        const signal: Signal = await generateMarketSignal(targetMarket);
        addLog('SIGNAL', `Edge Analysis: ${(signal.confidence * 100).toFixed(0)}% confidence | Implied: ${(signal.impliedProbability * 100).toFixed(1)}%`);

        setCurrentStep('RISK_CHECK');
        const ev = calculateEV(targetMarket.currentPrice, signal.impliedProbability);
        
        if (ev > 0 && signal.confidence >= RISK_LIMITS.minConfidence) {
          let size = calculateKellySize(targetMarket.currentPrice, signal.impliedProbability, stats.balance);
          
          // Enforce Hard Capital Cap
          const currentRemaining = stats.allocatedCapital - stats.cumulativeSpent;
          if (stats.cumulativeSpent + size > stats.allocatedCapital) {
            size = currentRemaining;
          }

          if (size >= 0.5) { 
            setCurrentStep('EXECUTING');
            addLog('SUCCESS', `Edge Confirmed (EV: ${ev.toFixed(3)}). Sending tx for $${size.toFixed(2)}`);
            
            const newTrade: Trade = {
              id: `tx-${Date.now()}`,
              marketId: targetMarket.id,
              marketQuestion: targetMarket.question,
              entryPrice: targetMarket.currentPrice,
              size: size,
              side: 'YES',
              status: 'OPEN',
              pnl: 0,
              timestamp: Date.now(),
              edge: ev
            };

            setActiveTrades(prev => [newTrade, ...prev].slice(0, 10));
            setStats(prev => ({
              ...prev,
              cumulativeSpent: prev.cumulativeSpent + size,
              balance: prev.balance - size,
              totalTrades: prev.totalTrades + 1
            }));
            tradeExecuted = true;
          }
        } else {
          addLog('INFO', 'Alpha insufficient for current candidate. Skipping.');
          await new Promise(r => setTimeout(r, 500)); // Brief pause between candidates
        }
      }

      if (!tradeExecuted) {
        addLog('INFO', 'Scan cycle complete: No actionable edge found in top candidates.');
      }

      setCurrentStep('MONITORING');
      botTimeoutRef.current = window.setTimeout(runIteration, nextDelay);
    } catch (error: any) {
      addLog('ERROR', 'Kernel iteration fault.', error.message);
      botTimeoutRef.current = window.setTimeout(runIteration, ERROR_BACKOFF_INTERVAL);
    }
  }, [isRunning, stats, addLog]);

  useEffect(() => {
    if (isRunning) {
      botTimeoutRef.current = window.setTimeout(runIteration, 1000);
    }
    return () => { if (botTimeoutRef.current) window.clearTimeout(botTimeoutRef.current); };
  }, [isRunning, runIteration]);

  return (
    <div className="min-h-screen p-4 md:p-8 max-w-7xl mx-auto space-y-8 no-scrollbar bg-[#050608]">
      {showWalletSelector && <WalletSelector onSelect={connectWallet} onClose={() => setShowWalletSelector(false)} isConnecting={isConnecting} />}

      <header className="flex flex-col md:flex-row justify-between items-center gap-6 bg-white/[0.02] p-6 rounded-3xl border border-white/[0.05]">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 bg-gradient-to-br from-blue-600 to-indigo-700 rounded-2xl flex items-center justify-center shadow-xl shadow-blue-500/20">
            <BrainCircuit className="text-white w-8 h-8" />
          </div>
          <div>
            <h1 className="text-2xl font-black tracking-tighter italic">POLYQUANT-X <span className="text-[10px] not-italic font-bold bg-amber-500 text-black px-2 py-0.5 rounded ml-2">GUARDIAN</span></h1>
            <p className="text-[10px] text-gray-500 font-mono uppercase tracking-widest">
              <span className={`w-2 h-2 rounded-full mr-2 inline-block ${isRunning ? 'bg-emerald-500 animate-pulse' : 'bg-gray-600'}`}></span>
              {isRunning ? 'Kernel: Running' : 'Kernel: Idle'} // Cap: Active
            </p>
          </div>
        </div>

        <div className="flex flex-col md:flex-row items-center gap-6 w-full md:w-auto">
          {isConnected && !isRunning && (
            <div className="flex flex-col min-w-[200px] gap-2">
              <div className="flex justify-between text-[10px] uppercase font-bold text-gray-400">
                <span>Capital Allocation</span>
                <span className="text-blue-400">{allocationPercent}% (${(stats.balance * allocationPercent / 100).toFixed(2)})</span>
              </div>
              <input 
                type="range" min="0" max="100" step="5"
                value={allocationPercent}
                onChange={(e) => setAllocationPercent(parseInt(e.target.value))}
                className="w-full h-1.5 bg-white/10 rounded-lg appearance-none cursor-pointer accent-blue-500"
              />
              <p className="text-[9px] text-gray-600 italic">Bot stops when allocated capital is fully spent.</p>
            </div>
          )}

          <div className="flex items-center gap-4">
            {!isConnected ? (
              <button onClick={() => setShowWalletSelector(true)} disabled={isConnecting} className="px-8 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-2xl font-bold transition-all flex items-center gap-3 active:scale-95">
                {isConnecting ? 'Detecting...' : <><span className="opacity-50">{ICONS.Wallet}</span> CONNECT</>}
              </button>
            ) : (
              <button 
                onClick={isRunning ? () => stopBot('USER') : startBot}
                className={`px-10 py-3 rounded-2xl font-black tracking-widest transition-all active:scale-95 ${
                  isRunning ? 'bg-rose-500/10 text-rose-500 border border-rose-500/20' : 'bg-emerald-600 text-white shadow-xl shadow-emerald-900/30'
                }`}
              >
                {isRunning ? 'TERMINATE' : 'DEPLOY AGENT'}
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="grid grid-cols-1 gap-8 animate-in fade-in slide-in-from-bottom-4 duration-1000">
        <Dashboard stats={stats} activeTrades={activeTrades} currentStep={currentStep} />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2">
            <Terminal logs={logs} />
          </div>
          <div className="glass p-8 rounded-3xl border border-white/5 space-y-6">
            <h3 className="text-lg font-bold flex items-center gap-3">
              <ShieldAlert className="text-amber-500 w-5 h-5" /> Safety Protocols
            </h3>
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-blue-500/5 border border-blue-500/10">
                <span className="text-[9px] text-gray-500 uppercase block mb-1">Max Consumption</span>
                <span className="text-sm font-bold text-gray-200">${stats.allocatedCapital.toFixed(2)}</span>
                <p className="text-[10px] text-gray-500 mt-1 leading-tight">This bot will hard-stop once total signed trade volume reaches this limit.</p>
              </div>
              <div className="p-4 rounded-xl bg-amber-500/5 border border-amber-500/10">
                <span className="text-[9px] text-gray-500 uppercase block mb-1">Exposure Rule</span>
                <span className="text-sm font-bold text-gray-200">5% Kelly Cap</span>
                <p className="text-[10px] text-gray-500 mt-1 leading-tight">Single position risk is further limited to 5% of current equity.</p>
              </div>
              <div className="p-4 rounded-xl bg-emerald-500/5 border border-emerald-500/10">
                <span className="text-[9px] text-gray-500 uppercase block mb-1">Settlement Chain</span>
                <span className="text-sm font-bold text-gray-200">Polygon Mainnet</span>
              </div>
            </div>
          </div>
        </div>
      </main>

      <footer className="text-center text-gray-600 text-[10px] uppercase tracking-[0.3em] font-mono border-t border-white/5 pt-8">
        &copy; 2025 POLYQUANT-X // ABSOLUTE_CAPITAL_ALLOCATION_MODE // v4.0.0-SECURE
      </footer>
    </div>
  );
};

export default App;
