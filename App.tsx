
import React, { useState, useEffect, useCallback, useRef } from 'react';
// Added Activity to the imports from lucide-react to fix the error on line 406
import { BrainCircuit, ShieldAlert, Coins, Settings2, Filter, BarChart3, Scale, ChevronDown, ChevronUp, Activity } from 'lucide-react';
import { BrowserProvider, formatUnits, Contract } from 'ethers';
import { Dashboard } from './components/Dashboard';
import { Terminal } from './components/Terminal';
import { WalletSelector } from './components/WalletSelector';
import { Market, Trade, BotStats, LogEntry, Signal, BotStep, WalletType, Orderbook, BotConfig } from './types';
import { fetchLiveMarkets, calculateEV, calculateKellySize, fetchOrderbook, validateLiquidity } from './services/tradingEngine';
import { generateMarketSignal } from './services/geminiService';
import { ICONS, POLYGON_TOKENS, DEFAULT_CONFIG } from './constants';

const POLYGON_CHAIN_ID = 137n;
const ERC20_ABI = ["function balanceOf(address) view returns (uint256)", "function decimals() view returns (uint8)"];

const INITIAL_STATS: BotStats = {
  totalPnL: 0, winRate: 0, totalTrades: 0, activeExposure: 0, usdcBalance: 0, 
  maticBalance: 0, initialUsdcBalance: 0, allocatedCapital: 0, cumulativeSpent: 0
};

const App: React.FC = () => {
  const [isRunning, setIsRunning] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [showWalletSelector, setShowWalletSelector] = useState(false);
  const [showConfig, setShowConfig] = useState(true);
  const [address, setAddress] = useState<string | null>(null);
  const [currentStep, setCurrentStep] = useState<BotStep>('IDLE');
  const [allocationPercent, setAllocationPercent] = useState(50);
  const [stats, setStats] = useState<BotStats>(INITIAL_STATS);
  const [activeTrades, setActiveTrades] = useState<Trade[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([
    { timestamp: Date.now(), level: 'INFO', message: 'PolyQuant-X Kernel Online. Configure your parameters to deploy.' }
  ]);
  
  // CONFIGURATION STATE
  const [config, setConfig] = useState<BotConfig>(() => {
    const saved = localStorage.getItem('polyquant_config');
    return saved ? JSON.parse(saved) : DEFAULT_CONFIG;
  });

  // SNAPSHOT STATE
  const configSnapshotRef = useRef<BotConfig | null>(null);
  
  const botTimeoutRef = useRef<any>(null);
  const providerRef = useRef<BrowserProvider | null>(null);
  const isExecutingRef = useRef(false);

  const addLog = useCallback((level: LogEntry['level'], message: string, data?: any) => {
    setLogs(prev => [...prev.slice(-100), { timestamp: Date.now(), level, message, data }]);
  }, []);

  useEffect(() => {
    localStorage.setItem('polyquant_config', JSON.stringify(config));
  }, [config]);

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
        addLog('SUCCESS', `Authenticated: ${accounts[0].slice(0,8)}...`);
      }
    } catch (error: any) {
      addLog('ERROR', error.message);
    } finally { setIsConnecting(false); }
  };

  const runIteration = useCallback(async () => {
    // ALWAYS use the snapshot captured at Start Agent
    const activeConfig = configSnapshotRef.current;
    if (!isRunning || isExecutingRef.current || !address || !providerRef.current || !activeConfig) return;
    
    isExecutingRef.current = true;
    try {
      const currentBals = await fetchBalances(address, providerRef.current);
      if (!currentBals) throw new Error("Balance refresh failed.");

      setCurrentStep('SCANNING');
      addLog('INFO', 'Scanning CLOB for tradable markets...');
      const { markets, stats: scanStats } = await fetchLiveMarkets(activeConfig);
      
      if (scanStats.tradable === 0) {
        addLog('WARNING', `No tradable markets found among ${scanStats.total} candidates.`);
      }

      if (markets.length > 0) {
        let tradeExecuted = false;
        const candidates = markets.slice(0, activeConfig.maxMarketsPerScan); 

        for (const m of candidates) {
          if (tradeExecuted || !isRunning) break;

          addLog('INFO', `Evaluating: ${m.question.slice(0,40)}...`);

          const book = await fetchOrderbook(m.yesTokenId);
          if (!book) {
            addLog('WARNING', `Orderbook missing for ${m.id.slice(0,8)}. Skipping.`);
            continue;
          }
          m.currentPrice = book.midPrice;
          
          if (book.spread > activeConfig.maxSpread) {
            addLog('INFO', `SKIP: Spread too wide (${(book.spread*100).toFixed(2)}% > ${(activeConfig.maxSpread*100).toFixed(2)}%)`);
            continue;
          }

          setCurrentStep('ANALYZING');
          const signal = await generateMarketSignal(m);
          
          if (!signal) {
            if (activeConfig.onMissingSignal === 'RETRY') {
              addLog('WARNING', `Analysis failed. Will retry later.`);
            } else {
              addLog('WARNING', `Analysis failed. Skipping market.`);
            }
            continue;
          }

          setCurrentStep('RISK_CHECK');
          const ev = calculateEV(m.currentPrice, signal.impliedProbability);
          addLog('SIGNAL', `Edge Analysis: Prob ${(signal.impliedProbability*100).toFixed(1)}% | EV ${(ev*100).toFixed(1)}%`);

          if (ev >= activeConfig.minEV && signal.confidence >= activeConfig.minConfidence) {
            const tradeSize = calculateKellySize(m.currentPrice, signal.impliedProbability, currentBals.totalUsdc, activeConfig);
            
            if (tradeSize >= activeConfig.minTradeSize) {
              addLog('INFO', `Calculated Size: $${tradeSize.toFixed(2)} USDC`);

              if (validateLiquidity(book, tradeSize, activeConfig)) {
                setCurrentStep('EXECUTING');
                addLog('SUCCESS', `All gates cleared. Placing order...`);
                
                const newTrade: Trade = {
                  id: `tx-${Date.now()}`, 
                  marketId: m.id, 
                  marketQuestion: m.question,
                  entryPrice: m.currentPrice, 
                  size: tradeSize, 
                  side: 'YES', 
                  status: 'OPEN', 
                  pnl: 0,
                  timestamp: Date.now(), 
                  edge: ev
                };

                setActiveTrades(prev => [newTrade, ...prev].slice(0, 10));
                setStats(prev => ({
                  ...prev, 
                  cumulativeSpent: prev.cumulativeSpent + tradeSize,
                  usdcBalance: prev.usdcBalance - tradeSize, 
                  totalTrades: prev.totalTrades + 1
                }));
                tradeExecuted = true;
                addLog('SUCCESS', `ORDER FILLED: ${m.id.slice(0,8)} at $${m.currentPrice.toFixed(3)}`);
              } else {
                addLog('WARNING', `FAIL: Insufficient liquidity for size $${tradeSize.toFixed(2)}.`);
              }
            } else {
              addLog('INFO', `SKIP: Calculated size ($${tradeSize.toFixed(2)}) below min (${activeConfig.minTradeSize}).`);
            }
          } else {
             addLog('INFO', `SKIP: EV (${(ev*100).toFixed(1)}%) below min (${(activeConfig.minEV*100).toFixed(1)}%).`);
          }
          
          await new Promise(r => setTimeout(r, 1500)); 
        }
      }
    } catch (error: any) {
      addLog('ERROR', `Kernel Iteration Failed: ${error.message}`);
    } finally {
      isExecutingRef.current = false;
      setCurrentStep('MONITORING');
      if (isRunning) {
        if (botTimeoutRef.current) clearTimeout(botTimeoutRef.current);
        const interval = (configSnapshotRef.current?.scanIntervalSeconds ?? 30) * 1000;
        botTimeoutRef.current = setTimeout(runIteration, interval);
      }
    }
  }, [isRunning, address, addLog]);

  useEffect(() => {
    if (isRunning) {
      addLog('SUCCESS', 'Autonomous Agent Deployed.');
      runIteration();
    } else {
      if (botTimeoutRef.current) clearTimeout(botTimeoutRef.current);
      setCurrentStep('IDLE');
      configSnapshotRef.current = null;
    }
    return () => { if (botTimeoutRef.current) clearTimeout(botTimeoutRef.current); };
  }, [isRunning, runIteration, addLog]);

  const validateAndStart = () => {
    if (!isConnected || stats.usdcBalance <= 0) {
      addLog('ERROR', 'Deployment failed. Check connection and USDC balance.');
      return;
    }

    // VALIDATION
    if (config.minTradeSize > config.maxTradeSize) {
      addLog('ERROR', 'Config Error: Min trade size cannot exceed max trade size.');
      return;
    }
    if (config.kellyMultiplier > 1.0) {
      addLog('ERROR', 'Config Error: Kelly multiplier too high for safe execution.');
      return;
    }
    if (config.minLiquidityMultiplier < 1.0) {
       addLog('ERROR', 'Config Error: Liquidity multiplier must be at least 1.0x.');
       return;
    }

    // CREATE IMMUTABLE SNAPSHOT
    const snapshot = { ...config };
    configSnapshotRef.current = snapshot;
    setShowConfig(false);

    // LOG SNAPSHOT
    addLog('INFO', `Agent started with configuration:
- Min EV: ${(snapshot.minEV*100).toFixed(1)}%
- Kelly Multiplier: ${snapshot.kellyMultiplier}x
- Liquidity Multiplier: ${snapshot.minLiquidityMultiplier}x
- Min Trade Size: $${snapshot.minTradeSize}
- Binary Only: ${snapshot.binaryOnly}`);

    setStats(prev => ({ 
      ...prev, 
      allocatedCapital: stats.usdcBalance * (allocationPercent / 100), 
      cumulativeSpent: 0 
    }));
    setIsRunning(true);
  };

  const updateConfig = (key: keyof BotConfig, value: any) => {
    if (isRunning) return; // Prevent live updates
    setConfig(prev => ({ ...prev, [key]: value }));
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
            <h1 className="text-2xl font-black tracking-tighter italic text-white">POLYQUANT-X <span className="text-[10px] not-italic font-bold bg-amber-500 text-black px-2 py-0.5 rounded ml-2 uppercase tracking-widest text-center">STABLE CORE</span></h1>
            <div className="flex items-center gap-3 mt-1">
               <span className={`text-[9px] font-mono uppercase tracking-widest ${isRunning ? 'text-emerald-500 animate-pulse' : 'text-gray-500'}`}>
                {isRunning ? 'System: Active' : 'System: Idle'}
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
                <span>Operation Allocation</span>
                <span className="text-blue-400">{allocationPercent}% (${(stats.usdcBalance * allocationPercent / 100).toFixed(2)})</span>
              </div>
              <input type="range" min="0" max="100" step="5" value={allocationPercent} onChange={(e) => setAllocationPercent(parseInt(e.target.value))} className="w-full h-1.5 bg-white/10 rounded-lg appearance-none cursor-pointer accent-blue-500" />
            </div>
          )}
          {!isConnected ? (
            <button onClick={() => setShowWalletSelector(true)} disabled={isConnecting} className="px-8 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-2xl font-bold transition-all flex items-center gap-3 active:scale-95 shadow-lg shadow-blue-500/20">
              {isConnecting ? 'Connecting...' : <><span className="opacity-50">{ICONS.Wallet}</span> CONNECT MAINNET</>}
            </button>
          ) : (
            <button 
              onClick={() => isRunning ? setIsRunning(false) : validateAndStart()} 
              disabled={!isRunning && stats.usdcBalance <= 0} 
              className={`px-10 py-3 rounded-2xl font-black tracking-widest transition-all active:scale-95 ${isRunning ? 'bg-rose-500/10 text-rose-500 border border-rose-500/20' : 'bg-emerald-600 text-white shadow-xl shadow-emerald-900/30'}`}
            >
              {isRunning ? 'HALT AGENT' : 'START AGENT'}
            </button>
          )}
        </div>
      </header>

      <main className="grid grid-cols-1 gap-8">
        {/* CONFIGURATION PANEL */}
        <div className="glass rounded-3xl overflow-hidden border border-white/5">
          <button 
            onClick={() => setShowConfig(!showConfig)}
            className="w-full px-8 py-4 flex items-center justify-between bg-white/[0.02] hover:bg-white/[0.04] transition-colors"
          >
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-500/10 text-blue-400">{ICONS.Config}</div>
              <h2 className="text-lg font-bold">Trading Configuration</h2>
              {isRunning && <span className="text-[10px] bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded font-mono border border-emerald-500/20 uppercase">Snapshot Locked</span>}
            </div>
            {showConfig ? <ChevronUp className="w-5 h-5 text-gray-500" /> : <ChevronDown className="w-5 h-5 text-gray-500" />}
          </button>
          
          {showConfig && (
            <div className="p-8 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
              {/* MARKET FILTERS */}
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-xs font-black text-gray-400 uppercase tracking-widest">
                  <Filter className="w-4 h-4 text-blue-500" /> Market Filters
                </div>
                <div className="space-y-4 p-4 rounded-2xl bg-white/[0.02] border border-white/5">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-bold text-gray-500 uppercase">Liquidity Multiplier</label>
                    <input type="number" step="0.1" value={config.minLiquidityMultiplier} onChange={(e) => updateConfig('minLiquidityMultiplier', parseFloat(e.target.value))} className="bg-transparent border-b border-white/10 p-1 text-sm font-mono focus:border-blue-500 outline-none" disabled={isRunning} />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-bold text-gray-500 uppercase">Max Spread (%)</label>
                    <input type="number" step="0.001" value={config.maxSpread * 100} onChange={(e) => updateConfig('maxSpread', parseFloat(e.target.value) / 100)} className="bg-transparent border-b border-white/10 p-1 text-sm font-mono focus:border-blue-500 outline-none" disabled={isRunning} />
                  </div>
                  <div className="flex items-center justify-between pt-2">
                    <label className="text-[10px] font-bold text-gray-500 uppercase">Binary Only</label>
                    <input type="checkbox" checked={config.binaryOnly} onChange={(e) => updateConfig('binaryOnly', e.target.checked)} className="w-4 h-4 accent-blue-500" disabled={isRunning} />
                  </div>
                </div>
              </div>

              {/* SIGNAL & EDGE */}
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-xs font-black text-gray-400 uppercase tracking-widest">
                  <BarChart3 className="w-4 h-4 text-emerald-500" /> Signal Parameters
                </div>
                <div className="space-y-4 p-4 rounded-2xl bg-white/[0.02] border border-white/5">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-bold text-gray-500 uppercase">Min EV (%)</label>
                    <input type="number" step="0.1" value={config.minEV * 100} onChange={(e) => updateConfig('minEV', parseFloat(e.target.value) / 100)} className="bg-transparent border-b border-white/10 p-1 text-sm font-mono focus:border-blue-500 outline-none" disabled={isRunning} />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-bold text-gray-500 uppercase">Min Confidence (%)</label>
                    <input type="number" step="1" value={config.minConfidence * 100} onChange={(e) => updateConfig('minConfidence', parseFloat(e.target.value) / 100)} className="bg-transparent border-b border-white/10 p-1 text-sm font-mono focus:border-blue-500 outline-none" disabled={isRunning} />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-bold text-gray-500 uppercase">Missing Signal</label>
                    <select value={config.onMissingSignal} onChange={(e) => updateConfig('onMissingSignal', e.target.value)} className="bg-transparent border-b border-white/10 p-1 text-sm font-mono focus:border-blue-500 outline-none" disabled={isRunning}>
                      <option value="SKIP">SKIP</option>
                      <option value="RETRY">RETRY</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* RISK & SIZING */}
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-xs font-black text-gray-400 uppercase tracking-widest">
                  <Scale className="w-4 h-4 text-amber-500" /> Risk Controls
                </div>
                <div className="space-y-4 p-4 rounded-2xl bg-white/[0.02] border border-white/5">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-bold text-gray-500 uppercase">Kelly Fraction</label>
                    <input type="number" step="0.05" value={config.kellyMultiplier} onChange={(e) => updateConfig('kellyMultiplier', parseFloat(e.target.value))} className="bg-transparent border-b border-white/10 p-1 text-sm font-mono focus:border-blue-500 outline-none" disabled={isRunning} />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-bold text-gray-500 uppercase">Min/Max Size (USDC)</label>
                    <div className="flex gap-2">
                      <input type="number" value={config.minTradeSize} onChange={(e) => updateConfig('minTradeSize', parseFloat(e.target.value))} className="w-full bg-transparent border-b border-white/10 p-1 text-sm font-mono focus:border-blue-500 outline-none" placeholder="Min" disabled={isRunning} />
                      <input type="number" value={config.maxTradeSize} onChange={(e) => updateConfig('maxTradeSize', parseFloat(e.target.value))} className="w-full bg-transparent border-b border-white/10 p-1 text-sm font-mono focus:border-blue-500 outline-none" placeholder="Max" disabled={isRunning} />
                    </div>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-bold text-gray-500 uppercase">Max Exp. (%)</label>
                    <input type="number" step="1" value={config.maxExposurePerTrade * 100} onChange={(e) => updateConfig('maxExposurePerTrade', parseFloat(e.target.value) / 100)} className="bg-transparent border-b border-white/10 p-1 text-sm font-mono focus:border-blue-500 outline-none" disabled={isRunning} />
                  </div>
                </div>
              </div>

              {/* SCANNER */}
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-xs font-black text-gray-400 uppercase tracking-widest">
                  <Activity className="w-4 h-4 text-purple-500" /> Scanner Policy
                </div>
                <div className="space-y-4 p-4 rounded-2xl bg-white/[0.02] border border-white/5">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-bold text-gray-500 uppercase">Interval (Sec)</label>
                    <input type="number" step="1" value={config.scanIntervalSeconds} onChange={(e) => updateConfig('scanIntervalSeconds', parseInt(e.target.value))} className="bg-transparent border-b border-white/10 p-1 text-sm font-mono focus:border-blue-500 outline-none" disabled={isRunning} />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-bold text-gray-500 uppercase">Max Markets / Scan</label>
                    <input type="number" step="1" value={config.maxMarketsPerScan} onChange={(e) => updateConfig('maxMarketsPerScan', parseInt(e.target.value))} className="bg-transparent border-b border-white/10 p-1 text-sm font-mono focus:border-blue-500 outline-none" disabled={isRunning} />
                  </div>
                  <div className="pt-2 flex gap-2">
                    <button onClick={() => setConfig(DEFAULT_CONFIG)} disabled={isRunning} className="w-full py-2 bg-white/5 hover:bg-white/10 text-[10px] font-bold uppercase rounded-lg border border-white/10 disabled:opacity-50">Reset Defaults</button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        <Dashboard stats={stats} activeTrades={activeTrades} currentStep={currentStep} />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2"><Terminal logs={logs} /></div>
          <div className="glass p-8 rounded-3xl border border-white/5 space-y-6">
            <h3 className="text-lg font-bold flex items-center gap-3"><ShieldAlert className="text-amber-500 w-5 h-5" /> Safety Protocol</h3>
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-blue-500/5 border border-blue-500/10">
                <span className="text-[9px] text-gray-500 uppercase block mb-1">Execution Pipeline</span>
                <span className="text-sm font-bold text-blue-400">CLOB Direct</span>
                <p className="text-[10px] text-gray-500 mt-1 italic leading-tight">Scanner ignores non-tradable Gamma endpoints. Direct orderbook validation per candidate.</p>
              </div>
              <div className="p-4 rounded-xl bg-emerald-500/5 border border-emerald-500/10">
                <span className="text-[9px] text-gray-500 uppercase block mb-1">Dynamic Sizing</span>
                <span className="text-sm font-bold text-emerald-400">Adaptive Depth</span>
                <p className="text-[10px] text-gray-500 mt-1 italic leading-tight">Liquidity validation scales dynamically with trade size. No fixed floor blockers.</p>
              </div>
              <div className="p-4 rounded-xl bg-amber-500/5 border border-amber-500/10">
                <span className="text-[9px] text-gray-500 uppercase block mb-1">Signal Integrity</span>
                <span className="text-sm font-bold text-amber-500">Gemini 3-Pro</span>
                <p className="text-[10px] text-gray-500 mt-1 italic leading-tight">Neutral probability (0.5) is rejected. Bot only trades on high-confidence quantitative edges.</p>
              </div>
            </div>
          </div>
        </div>
      </main>
      <footer className="text-center text-gray-600 text-[10px] uppercase tracking-[0.3em] font-mono border-t border-white/5 pt-8 pb-4">
        &copy; 2025 POLYQUANT-X // CONFIGURABLE_KERNEL // v5.5.0-PROD
      </footer>
    </div>
  );
};

export default App;
