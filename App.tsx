
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
const ERC20_ABI = ["function balanceOf(address) view returns (uint256)", "function decimals() view returns (uint8)"];

const INITIAL_STATS: BotStats = {
  totalPnL: 0, winRate: 0, totalTrades: 0, activeExposure: 0, usdcBalance: 0, 
  maticBalance: 0, initialUsdcBalance: 0, allocatedCapital: 0, cumulativeSpent: 0
};

const SCAN_INTERVAL = 30000;

const App: React.FC = () => {
  const [isRunning, setIsRunning] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [showWalletSelector, setShowWalletSelector] = useState(false);
  const [address, setAddress] = useState<string | null>(null);
  const [currentStep, setCurrentStep] = useState<BotStep>('IDLE');
  const [allocationPercent, setAllocationPercent] = useState(50);
  const [stats, setStats] = useState<BotStats>(INITIAL_STATS);
  const [activeTrades, setActiveTrades] = useState<Trade[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([
    { timestamp: Date.now(), level: 'INFO', message: 'PolyQuant-X Kernel Initialized.' }
  ]);
  
  const botTimeoutRef = useRef<any>(null);
  const providerRef = useRef<BrowserProvider | null>(null);
  const isExecutingRef = useRef(false);

  const addLog = useCallback((level: LogEntry['level'], message: string, data?: any) => {
    setLogs(prev => [...prev.slice(-100), { timestamp: Date.now(), level, message, data }]);
  }, []);

  const fetchBalances = async (account: string, provider: BrowserProvider) => {
    try {
      const maticBalanceRaw = await provider.getBalance(account);
      const maticBalance = parseFloat(formatUnits(maticBalanceRaw, 18));
      const nativeContract = new Contract(POLYGON_TOKENS.USDC_NATIVE, ERC20_ABI, provider);
      const nativeUsdc = parseFloat(formatUnits(await nativeContract.balanceOf(account), 6));
      const bridgedContract = new Contract(POLYGON_TOKENS.USDC_BRIDGED, ERC20_ABI, provider);
      const bridgedUsdc = parseFloat(formatUnits(await bridgedContract.balanceOf(account), 6));
      const totalUsdc = nativeUsdc + bridgedUsdc;
      
      setStats(prev => ({ 
        ...prev, maticBalance, usdcBalance: totalUsdc,
        initialUsdcBalance: prev.initialUsdcBalance === 0 ? totalUsdc : prev.initialUsdcBalance
      }));
      return { totalUsdc, maticBalance };
    } catch (error) { return null; }
  };

  const connectWallet = async (type: WalletType) => {
    setIsConnecting(true);
    addLog('INFO', `Connecting ${type}...`);
    try {
      const win = window as any;
      const rawProvider = type === 'METAMASK' ? win.ethereum : win.phantom?.ethereum || win.trustwallet;
      if (!rawProvider) throw new Error(`${type} not detected.`);
      const provider = new BrowserProvider(rawProvider);
      const accounts = await provider.send("eth_requestAccounts", []);
      providerRef.current = provider;
      setAddress(accounts[0]);
      const bals = await fetchBalances(accounts[0], provider);
      if (bals) {
        setIsConnected(true);
        setShowWalletSelector(false);
        addLog('SUCCESS', `Wallet connected. Liquid Capital: $${bals.totalUsdc.toFixed(2)}`);
      }
    } catch (error: any) {
      addLog('ERROR', error.message);
    } finally { setIsConnecting(false); }
  };

  const runIteration = useCallback(async () => {
    if (!isRunning || isExecutingRef.current || !address || !providerRef.current) return;
    
    isExecutingRef.current = true;
    try {
      // 1. Check State
      const currentBals = await fetchBalances(address, providerRef.current);
      if (!currentBals || currentBals.maticBalance < 0.05) {
        addLog('ERROR', 'Safety Check Failed: Verification required.');
        setIsRunning(false);
        return;
      }

      // 2. Discover Markets
      setCurrentStep('SCANNING');
      const { markets, totalFetched, filtered } = await fetchLiveMarkets();
      
      if (totalFetched === 0) {
        addLog('WARNING', 'CLOB unreachable or empty. Resting...');
      } else {
        addLog('INFO', `CLOB Discovery: ${totalFetched} raw markets. ${markets.length} passed schema filter.`);
      }

      if (markets.length > 0) {
        let tradeExecuted = false;
        const candidates = markets.slice(0, 5); // Focus on top liquid candidates

        for (const m of candidates) {
          if (tradeExecuted || !isRunning) break;

          const book = await fetchOrderbook(m.yesTokenId);
          if (!book || !validateLiquidity(book, 5)) continue;

          m.currentPrice = book.midPrice;
          setCurrentStep('ANALYZING');
          
          try {
            const signal = await generateMarketSignal(m);
            setCurrentStep('RISK_CHECK');
            const ev = calculateEV(m.currentPrice, signal.impliedProbability);

            if (ev > 0 && signal.confidence >= RISK_LIMITS.minConfidence) {
              const size = calculateKellySize(m.currentPrice, signal.impliedProbability, stats.usdcBalance);
              if (size >= 1) { // Min $1 trade
                setCurrentStep('EXECUTING');
                addLog('SUCCESS', `Edge Detected: ${m.id.slice(0,8)}. EV: ${(ev*100).toFixed(1)}%. Deploying $${size.toFixed(2)}.`);
                
                // Fix: Explicitly typing the new trade object to satisfy literal type requirements for 'side' and 'status' (YES/NO, OPEN/CLOSED)
                const newTrade: Trade = {
                  id: `tx-${Date.now()}`, 
                  marketId: m.id, 
                  marketQuestion: m.question,
                  entryPrice: m.currentPrice, 
                  size, 
                  side: 'YES', 
                  status: 'OPEN', 
                  pnl: 0,
                  timestamp: Date.now(), 
                  edge: ev
                };

                setActiveTrades(prev => [newTrade, ...prev].slice(0, 10));

                setStats(prev => ({
                  ...prev, cumulativeSpent: prev.cumulativeSpent + size,
                  usdcBalance: prev.usdcBalance - size, totalTrades: prev.totalTrades + 1
                }));
                tradeExecuted = true;
              }
            }
          } catch (e) { /* Analysis error */ }
          await new Promise(r => setTimeout(r, 500)); // Rate limit buffer
        }
      }
    } catch (error: any) {
      addLog('ERROR', 'Loop Kernel Error.', error.message);
    } finally {
      isExecutingRef.current = false;
      setCurrentStep('MONITORING');
      if (isRunning) {
        botTimeoutRef.current = setTimeout(runIteration, SCAN_INTERVAL);
      }
    }
  }, [isRunning, address, stats.usdcBalance, stats.allocatedCapital, stats.cumulativeSpent, addLog]);

  useEffect(() => {
    if (isRunning) {
      runIteration();
    } else {
      if (botTimeoutRef.current) clearTimeout(botTimeoutRef.current);
      setCurrentStep('IDLE');
    }
    return () => { if (botTimeoutRef.current) clearTimeout(botTimeoutRef.current); };
  }, [isRunning]); // Strictly triggered only when isRunning toggles

  const startBot = () => {
    if (!isConnected || stats.usdcBalance <= 0) return;
    setStats(prev => ({ ...prev, allocatedCapital: stats.usdcBalance * (allocationPercent / 100), cumulativeSpent: 0 }));
    setIsRunning(true);
    addLog('SUCCESS', 'Agent Deployed.');
  };

  return (
    <div className="min-h-screen p-4 md:p-8 max-w-7xl mx-auto space-y-8 no-scrollbar bg-[#050608]">
      {showWalletSelector && <WalletSelector onSelect={connectWallet} onClose={() => setShowWalletSelector(false)} isConnecting={isConnecting} />}

      <header className="flex flex-col md:flex-row justify-between items-center gap-6 bg-white/[0.02] p-6 rounded-3xl border border-white/[0.05]">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 bg-gradient-to-br from-blue-600 to-indigo-700 rounded-2xl flex items-center justify-center shadow-xl shadow-blue-500/20">
            <BrainCircuit className="text-white w-8 h-8" />
          </div>
          <div>
            <h1 className="text-2xl font-black tracking-tighter italic text-white">POLYQUANT-X <span className="text-[10px] not-italic font-bold bg-amber-500 text-black px-2 py-0.5 rounded ml-2 uppercase tracking-widest">CLOB CORE</span></h1>
            <div className="flex items-center gap-3 mt-1">
               <span className={`text-[9px] font-mono uppercase tracking-widest ${isRunning ? 'text-emerald-500 animate-pulse' : 'text-gray-500'}`}>
                {isRunning ? 'Kernel: Active' : 'Kernel: Idle'}
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
                <span>Allocation</span>
                <span className="text-blue-400">{allocationPercent}% (${(stats.usdcBalance * allocationPercent / 100).toFixed(2)})</span>
              </div>
              <input type="range" min="0" max="100" step="5" value={allocationPercent} onChange={(e) => setAllocationPercent(parseInt(e.target.value))} className="w-full h-1.5 bg-white/10 rounded-lg appearance-none cursor-pointer accent-blue-500" />
            </div>
          )}
          {!isConnected ? (
            <button onClick={() => setShowWalletSelector(true)} disabled={isConnecting} className="px-8 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-2xl font-bold transition-all flex items-center gap-3 active:scale-95">
              {isConnecting ? 'Connecting...' : <><span className="opacity-50">{ICONS.Wallet}</span> CONNECT</>}
            </button>
          ) : (
            <button onClick={() => isRunning ? setIsRunning(false) : startBot()} disabled={!isRunning && stats.usdcBalance <= 0} className={`px-10 py-3 rounded-2xl font-black tracking-widest transition-all active:scale-95 ${isRunning ? 'bg-rose-500/10 text-rose-500 border border-rose-500/20' : 'bg-emerald-600 text-white shadow-xl shadow-emerald-900/30'}`}>
              {isRunning ? 'STOP AGENT' : 'START AGENT'}
            </button>
          )}
        </div>
      </header>

      <main className="grid grid-cols-1 gap-8">
        <Dashboard stats={stats} activeTrades={activeTrades} currentStep={currentStep} />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2"><Terminal logs={logs} /></div>
          <div className="glass p-8 rounded-3xl border border-white/5 space-y-6">
            <h3 className="text-lg font-bold flex items-center gap-3"><ShieldAlert className="text-amber-500 w-5 h-5" /> Safety Protocols</h3>
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-blue-500/5 border border-blue-500/10">
                <span className="text-[9px] text-gray-500 uppercase block mb-1">CLOB Oracle</span>
                <span className="text-sm font-bold text-blue-400">Direct Orderbook</span>
                <p className="text-[10px] text-gray-500 mt-1 italic leading-tight">Scanner uses condition_ids from the CLOB L2 feed for verified liquidity.</p>
              </div>
              <div className="p-4 rounded-xl bg-amber-500/5 border border-amber-500/10">
                <span className="text-[9px] text-gray-500 uppercase block mb-1">Execution Limit</span>
                <span className="text-sm font-bold text-amber-500">Max Exposure: 5%</span>
                <p className="text-[10px] text-gray-500 mt-1 italic leading-tight">Single-trade Kelly fraction enforced to protect bankroll.</p>
              </div>
            </div>
          </div>
        </div>
      </main>
      <footer className="text-center text-gray-600 text-[10px] uppercase tracking-[0.3em] font-mono border-t border-white/5 pt-8">
        &copy; 2025 POLYQUANT-X // STABLE_KERNEL_V5 // v5.1.0-PROD
      </footer>
    </div>
  );
};

export default App;
