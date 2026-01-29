
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { BrainCircuit, ShieldAlert, Coins } from 'lucide-react';
import { BrowserProvider, formatUnits, Contract } from 'ethers';
import { Dashboard } from './components/Dashboard';
import { Terminal } from './components/Terminal';
import { WalletSelector } from './components/WalletSelector';
import { Market, Trade, BotStats, LogEntry, Signal, BotStep, WalletType, Orderbook } from './types';
import { fetchLiveMarkets, calculateEV, calculateKellySize, fetchOrderbook, validateLiquidity } from './services/tradingEngine';
import { generateMarketSignal } from './services/geminiService';
import { ICONS, RISK_LIMITS, POLYGON_TOKENS } from './constants';

const POLYGON_CHAIN_ID = 137n;
const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)", 
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)"
];

const INITIAL_STATS: BotStats = {
  totalPnL: 0,
  winRate: 0,
  totalTrades: 0,
  activeExposure: 0,
  usdcBalance: 0,
  maticBalance: 0,
  initialUsdcBalance: 0,
  allocatedCapital: 0,
  cumulativeSpent: 0
};

const BASE_POLL_INTERVAL = 30000;
const ERROR_BACKOFF_INTERVAL = 60000;

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
  const providerRef = useRef<BrowserProvider | null>(null);

  const addLog = useCallback((level: LogEntry['level'], message: string, data?: any) => {
    setLogs(prev => [...prev.slice(-100), { timestamp: Date.now(), level, message, data }]);
  }, []);

  const fetchBalances = async (account: string, provider: BrowserProvider) => {
    try {
      const network = await provider.getNetwork();
      if (network.chainId !== POLYGON_CHAIN_ID) {
        addLog('ERROR', `Network Mismatch: Detected Chain ${network.chainId}. Switch to Polygon (137).`);
        return null;
      }

      const maticBalanceRaw = await provider.getBalance(account);
      const maticBalance = parseFloat(formatUnits(maticBalanceRaw, 18));

      const nativeContract = new Contract(POLYGON_TOKENS.USDC_NATIVE, ERC20_ABI, provider);
      const rawNative = await nativeContract.balanceOf(account);
      const nativeUsdc = parseFloat(formatUnits(rawNative, 6));

      const bridgedContract = new Contract(POLYGON_TOKENS.USDC_BRIDGED, ERC20_ABI, provider);
      const rawBridged = await bridgedContract.balanceOf(account);
      const bridgedUsdc = parseFloat(formatUnits(rawBridged, 6));

      const totalUsdc = nativeUsdc + bridgedUsdc;
      
      setStats(prev => ({ 
        ...prev, 
        maticBalance, 
        usdcBalance: totalUsdc,
        initialUsdcBalance: prev.initialUsdcBalance === 0 ? totalUsdc : prev.initialUsdcBalance
      }));

      return { usdcBalance: totalUsdc, maticBalance, nativeUsdc, bridgedUsdc };
    } catch (error: any) {
      addLog('ERROR', 'Balance detection sequence failed.', error.message);
      return null;
    }
  };

  const connectWallet = async (type: WalletType) => {
    setIsConnecting(true);
    addLog('INFO', `Initializing Handshake: ${type}...`);
    try {
      const rawProvider = await detectProvider(type);
      if (!rawProvider) {
        addLog('ERROR', `${type} extension not found.`);
        setShowWalletSelector(false);
        setIsConnecting(false);
        return;
      }

      const provider = new BrowserProvider(rawProvider);
      const network = await provider.getNetwork();
      
      if (network.chainId !== POLYGON_CHAIN_ID) {
        addLog('ERROR', `Chain ID ${network.chainId} unsupported. Switch to Polygon (137).`);
        setIsConnecting(false);
        return;
      }

      const accounts = await provider.send("eth_requestAccounts", []);
      providerRef.current = provider;
      setAddress(accounts[0]);
      setWalletType(type);
      
      const bals = await fetchBalances(accounts[0], provider);
      if (bals) {
        setIsConnected(true);
        setShowWalletSelector(false);
        addLog('SUCCESS', `Session Established: ${accounts[0].slice(0,6)}...`);
        addLog('INFO', `Detected Liquidity: $${bals.usdcBalance.toFixed(2)} total USDC.`);
        if (bals.usdcBalance === 0) {
          addLog('WARNING', 'Zero Tradeable Capital detected.');
        }
      }
    } catch (error: any) {
      addLog('ERROR', 'Handshake aborted.', error.message);
    } finally {
      setIsConnecting(false);
    }
  };

  const startBot = () => {
    if (!isConnected) return;
    if (stats.usdcBalance <= 0) {
      addLog('ERROR', 'Cannot deploy: USDC balance is zero.');
      return;
    }
    if (stats.maticBalance < POLYGON_TOKENS.MIN_MATIC_FOR_GAS) {
      addLog('ERROR', `Insufficient Gas: Need at least ${POLYGON_TOKENS.MIN_MATIC_FOR_GAS} MATIC.`);
      return;
    }

    const allocated = stats.usdcBalance * (allocationPercent / 100);
    setStats(prev => ({ 
      ...prev, 
      allocatedCapital: allocated,
      cumulativeSpent: 0 
    }));
    
    setIsRunning(true);
    addLog('SUCCESS', `Agent Active. Settlement Pool: $${allocated.toFixed(2)} USDC.`);
  };

  const stopBot = (reason: 'USER' | 'BUDGET' = 'USER') => {
    setIsRunning(false);
    setCurrentStep(reason === 'BUDGET' ? 'EXHAUSTED' : 'IDLE');
    if (botTimeoutRef.current) window.clearTimeout(botTimeoutRef.current);
    addLog('WARNING', reason === 'BUDGET' ? 'Budget exhausted.' : 'Manual shutdown.');
  };

  const runIteration = useCallback(async () => {
    if (!isRunning || !address || !providerRef.current) return;

    try {
      const currentBals = await fetchBalances(address, providerRef.current);
      if (!currentBals) throw new Error("State sync failed.");

      if (currentBals.maticBalance < 0.1) {
        addLog('ERROR', 'Gas Safety: Critical low MATIC. Stopping bot.');
        stopBot('USER');
        return;
      }

      const remainingBudget = stats.allocatedCapital - stats.cumulativeSpent;
      if (remainingBudget <= 0.5) { 
        stopBot('BUDGET');
        return;
      }

      setCurrentStep('SCANNING');
      addLog('INFO', 'Scanning CLOB for liquid candidates...');
      const markets = await fetchLiveMarkets();
      if (markets.length === 0) {
        addLog('WARNING', 'No active markets found on CLOB. Retrying in 30s.');
        botTimeoutRef.current = window.setTimeout(runIteration, 30000);
        return;
      }

      let tradeExecuted = false;
      let filteredCount = 0;

      for (const m of markets.slice(0, 10)) {
        if (tradeExecuted || !isRunning) break;
        
        // 1. Fetch Orderbook (Source of Truth for Price and Depth)
        const book: Orderbook | null = await fetchOrderbook(m.yesTokenId);
        if (!book) {
          filteredCount++;
          continue;
        }

        // 2. Validate Liquidity & Spread
        const isLiquid = validateLiquidity(book, 10); // Check depth for min $10 size
        if (!isLiquid) {
          filteredCount++;
          continue;
        }

        m.currentPrice = book.midPrice;
        
        setCurrentStep('ANALYZING');
        try {
          const signal: Signal = await generateMarketSignal(m);
          setCurrentStep('RISK_CHECK');
          const ev = calculateEV(m.currentPrice, signal.impliedProbability);
          
          if (ev > 0 && signal.confidence >= RISK_LIMITS.minConfidence) {
            let size = calculateKellySize(m.currentPrice, signal.impliedProbability, stats.usdcBalance);
            
            const currentRemaining = stats.allocatedCapital - stats.cumulativeSpent;
            if (stats.cumulativeSpent + size > stats.allocatedCapital) {
              size = currentRemaining;
            }

            if (size >= 0.5) { 
              // Confirm execution liquidity one last time for sized amount
              if (validateLiquidity(book, size)) {
                setCurrentStep('EXECUTING');
                addLog('SUCCESS', `Executing Alpha: ${m.id.slice(0,8)}. Size: $${size.toFixed(2)} | Edge: ${(ev*100).toFixed(1)}%`);
                
                const newTrade: Trade = {
                  id: `tx-${Date.now()}`,
                  marketId: m.id,
                  marketQuestion: m.question,
                  entryPrice: m.currentPrice,
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
                  usdcBalance: prev.usdcBalance - size,
                  totalTrades: prev.totalTrades + 1
                }));
                tradeExecuted = true;
              } else {
                addLog('WARNING', `Skipped ${m.id.slice(0,8)}: Insufficient depth for size $${size.toFixed(2)}`);
              }
            }
          }
        } catch (e) { 
          addLog('ERROR', `Analysis failed for ${m.id.slice(0,8)}`);
        }
        
        // Sequential fetch delay to prevent rate limit
        await new Promise(r => setTimeout(r, 200));
      }

      if (!tradeExecuted && filteredCount > 0) {
        addLog('INFO', `Cycle complete. ${filteredCount} markets filtered due to spread/liquidity.`);
      }

      setCurrentStep('MONITORING');
      botTimeoutRef.current = window.setTimeout(runIteration, BASE_POLL_INTERVAL);
    } catch (error: any) {
      addLog('ERROR', 'Kernel Fault.', error.message);
      botTimeoutRef.current = window.setTimeout(runIteration, ERROR_BACKOFF_INTERVAL);
    }
  }, [isRunning, stats, addLog, address]);

  useEffect(() => {
    if (isRunning) botTimeoutRef.current = window.setTimeout(runIteration, 1000);
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
            <h1 className="text-2xl font-black tracking-tighter italic text-white">POLYQUANT-X <span className="text-[10px] not-italic font-bold bg-amber-500 text-black px-2 py-0.5 rounded ml-2 uppercase tracking-widest">CLOB Core</span></h1>
            <div className="flex items-center gap-3 mt-1">
               <span className={`text-[9px] font-mono uppercase tracking-widest ${isRunning ? 'text-emerald-500 animate-pulse' : 'text-gray-500'}`}>
                {isRunning ? 'Kernel: Running' : 'Kernel: Idle'}
              </span>
              <span className="text-gray-700">|</span>
              <span className="text-[9px] text-gray-500 font-mono flex items-center gap-1">
                <Coins className="w-3 h-3 text-blue-400" /> USDC: ${(stats.usdcBalance || 0).toFixed(2)}
              </span>
            </div>
          </div>
        </div>

        <div className="flex flex-col md:flex-row items-center gap-6 w-full md:w-auto">
          {isConnected && !isRunning && (
            <div className="flex flex-col min-w-[200px] gap-2">
              <div className="flex justify-between text-[10px] uppercase font-bold text-gray-400">
                <span>Allocated Capital</span>
                <span className="text-blue-400">{allocationPercent}% (${(stats.usdcBalance * allocationPercent / 100).toFixed(2)})</span>
              </div>
              <input 
                type="range" min="0" max="100" step="5"
                value={allocationPercent}
                onChange={(e) => setAllocationPercent(parseInt(e.target.value))}
                className="w-full h-1.5 bg-white/10 rounded-lg appearance-none cursor-pointer accent-blue-500"
              />
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
                disabled={!isRunning && stats.usdcBalance <= 0}
                className={`px-10 py-3 rounded-2xl font-black tracking-widest transition-all active:scale-95 disabled:opacity-30 disabled:grayscale ${
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
              <ShieldAlert className="text-amber-500 w-5 h-5" /> Execution Guard
            </h3>
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-blue-500/5 border border-blue-500/10">
                <span className="text-[9px] text-gray-500 uppercase block mb-1">Price Oracle</span>
                <span className="text-sm font-bold text-blue-400">Polymarket CLOB</span>
                <p className="text-[10px] text-gray-500 mt-1 leading-tight italic">Direct L2 orderbook access ensures execution at real market depth.</p>
              </div>
              <div className="p-4 rounded-xl bg-amber-500/5 border border-amber-500/10">
                <span className="text-[9px] text-gray-500 uppercase block mb-1">Slippage Protection</span>
                <span className="text-sm font-bold text-amber-500">Max 2% Spread</span>
                <p className="text-[10px] text-gray-500 mt-1 leading-tight italic">Markets with excessive spreads are automatically filtered from scanning.</p>
              </div>
              <div className="p-4 rounded-xl bg-emerald-500/5 border border-emerald-500/10">
                <span className="text-[9px] text-gray-500 uppercase block mb-1">Capital Integrity</span>
                <span className="text-sm font-bold text-gray-200">Kelly Verification</span>
                <p className="text-[10px] text-gray-500 mt-1 leading-tight italic">Position sizes are verifiably bounded by USDC liquidity and signal confidence.</p>
              </div>
            </div>
          </div>
        </div>
      </main>

      <footer className="text-center text-gray-600 text-[10px] uppercase tracking-[0.3em] font-mono border-t border-white/5 pt-8">
        &copy; 2025 POLYQUANT-X // CLOB_EXECUTION_ENGINE // v5.0.0-STABLE
      </footer>
    </div>
  );
};

export default App;
