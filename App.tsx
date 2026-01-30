
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { 
  BrainCircuit, 
  ShieldAlert, 
  Coins, 
  Settings2, 
  Filter, 
  BarChart3, 
  Scale, 
  ChevronDown, 
  ChevronUp, 
  Activity, 
  FlaskConical, 
  Radio,
  TriangleAlert
} from 'lucide-react';
import { BrowserProvider, formatUnits, Contract } from 'ethers';
import { Dashboard } from './components/Dashboard';
import { Terminal } from './components/Terminal';
import { WalletSelector } from './components/WalletSelector';
import { 
  Market, 
  Trade, 
  BotStats, 
  LogEntry, 
  Signal, 
  BotStep, 
  WalletType, 
  Orderbook, 
  BotConfig, 
  PresetType,
  SimulationStats
} from './types';
import { 
  fetchLiveMarkets, 
  calculateEV, 
  calculateKellySize, 
  fetchOrderbook, 
  validateLiquidity 
} from './services/tradingEngine';
import { generateMarketSignal } from './services/geminiService';
import { ICONS, POLYGON_TOKENS, DEFAULT_CONFIG, PRESETS } from './constants';

const ERC20_ABI = ["function balanceOf(address) view returns (uint256)", "function decimals() view returns (uint8)"];

const INITIAL_STATS: BotStats = {
  totalPnL: 0, winRate: 0, totalTrades: 0, activeExposure: 0, usdcBalance: 0, 
  maticBalance: 0, initialUsdcBalance: 0, allocatedCapital: 0, cumulativeSpent: 0
};

const INITIAL_SIM_STATS: SimulationStats = {
  scans: 0, validSignals: 0, simulatedTrades: 0, pnl: 0, maxDrawdown: 0,
  blockedReasons: { spread: 0, liquidity: 0, confidence: 0, ev: 0, size: 0 }
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
  const [simStats, setSimStats] = useState<SimulationStats>(INITIAL_SIM_STATS);
  const [activeTrades, setActiveTrades] = useState<Trade[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([
    { timestamp: Date.now(), level: 'INFO', message: 'PolyQuant-X V6.0 - Simulation Engine Ready.' }
  ]);
  
  const [config, setConfig] = useState<BotConfig>(() => {
    const saved = localStorage.getItem('polyquant_config_v6');
    return saved ? JSON.parse(saved) : DEFAULT_CONFIG;
  });

  const configSnapshotRef = useRef<BotConfig | null>(null);
  const botTimeoutRef = useRef<any>(null);
  const providerRef = useRef<BrowserProvider | null>(null);
  const isExecutingRef = useRef(false);

  const addLog = useCallback((level: LogEntry['level'], message: string, data?: any) => {
    setLogs(prev => [...prev.slice(-100), { timestamp: Date.now(), level, message, data }]);
  }, []);

  useEffect(() => {
    localStorage.setItem('polyquant_config_v6', JSON.stringify(config));
  }, [config]);

  const fetchBalances = async (account: string, provider: BrowserProvider) => {
    try {
      if (config.mode === 'SIMULATION') {
        setStats(prev => ({
          ...prev, maticBalance: 10.0, usdcBalance: 1000.0,
          initialUsdcBalance: prev.initialUsdcBalance === 0 ? 1000.0 : prev.initialUsdcBalance
        }));
        return { totalUsdc: 1000.0, maticBalance: 10.0 };
      }
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

  const runIteration = useCallback(async () => {
    const activeConfig = configSnapshotRef.current;
    if (!isRunning || isExecutingRef.current || !activeConfig) return;
    
    isExecutingRef.current = true;
    const isSim = activeConfig.mode === 'SIMULATION';
    const logPrefix = isSim ? '[SIMULATION]' : '[LIVE]';

    try {
      const currentBals = await fetchBalances(address || '0xSimAddress', providerRef.current as any);
      if (!currentBals) throw new Error("Ledger sync failed.");

      setCurrentStep('SCANNING');
      setSimStats(prev => ({ ...prev, scans: prev.scans + 1 }));
      addLog('INFO', `${logPrefix} Scanning CLOB...`);
      const { markets, stats: scanStats } = await fetchLiveMarkets(activeConfig);
      
      if (markets.length > 0) {
        let tradeExecuted = false;
        const candidates = markets.slice(0, activeConfig.maxMarketsPerScan); 

        for (const m of candidates) {
          if (tradeExecuted || !isRunning) break;

          const book = await fetchOrderbook(m.yesTokenId);
          if (!book) continue;
          m.currentPrice = book.midPrice;
          
          if (book.spread > activeConfig.maxSpread) {
            setSimStats(prev => ({ ...prev, blockedReasons: { ...prev.blockedReasons, spread: prev.blockedReasons.spread + 1 } }));
            continue;
          }

          setCurrentStep('ANALYZING');
          const signal = await generateMarketSignal(m);
          if (!signal) continue;
          setSimStats(prev => ({ ...prev, validSignals: prev.validSignals + 1 }));

          setCurrentStep('RISK_CHECK');
          const ev = calculateEV(m.currentPrice, signal.impliedProbability);

          if (ev < activeConfig.minEV) {
            setSimStats(prev => ({ ...prev, blockedReasons: { ...prev.blockedReasons, ev: prev.blockedReasons.ev + 1 } }));
            continue;
          }

          if (signal.confidence < activeConfig.minConfidence) {
            setSimStats(prev => ({ ...prev, blockedReasons: { ...prev.blockedReasons, confidence: prev.blockedReasons.confidence + 1 } }));
            continue;
          }

          const tradeSize = calculateKellySize(m.currentPrice, signal.impliedProbability, currentBals.totalUsdc, activeConfig);
          
          if (tradeSize < activeConfig.minTradeSize) {
            setSimStats(prev => ({ ...prev, blockedReasons: { ...prev.blockedReasons, size: prev.blockedReasons.size + 1 } }));
            continue;
          }

          if (!validateLiquidity(book, tradeSize, activeConfig)) {
            setSimStats(prev => ({ ...prev, blockedReasons: { ...prev.blockedReasons, liquidity: prev.blockedReasons.liquidity + 1 } }));
            continue;
          }

          // EXECUTION GATE
          setCurrentStep('EXECUTING');
          addLog('SUCCESS', `${logPrefix} Executing order on ${m.id.slice(0,8)} | Size $${tradeSize.toFixed(2)}`);
          
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
            edge: ev,
            isSimulated: isSim
          };

          if (isSim) {
            setSimStats(prev => ({ ...prev, simulatedTrades: prev.simulatedTrades + 1 }));
          }

          setActiveTrades(prev => [newTrade, ...prev].slice(0, 10));
          setStats(prev => ({
            ...prev, 
            cumulativeSpent: prev.cumulativeSpent + tradeSize,
            usdcBalance: prev.usdcBalance - tradeSize, 
            totalTrades: prev.totalTrades + 1
          }));
          tradeExecuted = true;
          
          await new Promise(r => setTimeout(r, 1000)); 
        }
      }
    } catch (error: any) {
      addLog('ERROR', `Kernel fault: ${error.message}`);
    } finally {
      isExecutingRef.current = false;
      setCurrentStep('MONITORING');
      if (isRunning) {
        if (botTimeoutRef.current) clearTimeout(botTimeoutRef.current);
        botTimeoutRef.current = setTimeout(runIteration, activeConfig.scanIntervalSeconds * 1000);
      }
    }
  }, [isRunning, address, addLog]);

  useEffect(() => {
    if (isRunning) {
      runIteration();
    } else {
      if (botTimeoutRef.current) clearTimeout(botTimeoutRef.current);
      setCurrentStep('IDLE');
    }
    return () => { if (botTimeoutRef.current) clearTimeout(botTimeoutRef.current); };
  }, [isRunning, runIteration]);

  const deployAgent = () => {
    if (config.mode === 'LIVE') {
      if (!isConnected) {
        addLog('ERROR', 'LIVE MODE BLOCKED: Connect wallet first.');
        return;
      }
      if (simStats.simulatedTrades === 0) {
        addLog('ERROR', 'LIVE MODE BLOCKED: Zero trades executed in Simulation. Validate your config first.');
        return;
      }
    }

    if (!config.preset) {
      addLog('ERROR', 'Deployment failed: No preset selected.');
      return;
    }

    const snapshot = { ...config };
    configSnapshotRef.current = snapshot;
    setShowConfig(false);
    setIsRunning(true);
    addLog('SUCCESS', `Deployed in ${snapshot.mode} mode using ${snapshot.preset} preset.`);
  };

  const applyPreset = (p: PresetType) => {
    setConfig(PRESETS[p]);
    addLog('INFO', `Applied ${p} preset.`);
  };

  const connectWallet = async (type: WalletType) => {
    setIsConnecting(true);
    try {
      const win = window as any;
      const rawProvider = type === 'METAMASK' ? win.ethereum : win.phantom?.ethereum || win.trustwallet;
      if (!rawProvider) throw new Error(`${type} not detected.`);
      const provider = new BrowserProvider(rawProvider);
      const accounts = await provider.send("eth_requestAccounts", []);
      providerRef.current = provider;
      setAddress(accounts[0]);
      setIsConnected(true);
      setShowWalletSelector(false);
      addLog('SUCCESS', `Wallet ${accounts[0].slice(0,8)} linked.`);
      fetchBalances(accounts[0], provider);
    } catch (e: any) { addLog('ERROR', e.message); }
    finally { setIsConnecting(false); }
  };

  return (
    <div className="min-h-screen p-4 md:p-8 max-w-7xl mx-auto space-y-8 no-scrollbar bg-[#050608]">
      {showWalletSelector && <WalletSelector onSelect={connectWallet} onClose={() => setShowWalletSelector(false)} isConnecting={isConnecting} />}

      <header className="flex flex-col md:flex-row justify-between items-center gap-6 bg-white/[0.02] p-6 rounded-3xl border border-white/[0.05]">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 bg-gradient-to-br from-indigo-600 to-violet-700 rounded-2xl flex items-center justify-center shadow-xl shadow-indigo-500/20">
            <BrainCircuit className="text-white w-8 h-8" />
          </div>
          <div>
            <h1 className="text-2xl font-black tracking-tighter italic text-white">POLYQUANT-X <span className="text-[10px] not-italic font-bold bg-indigo-500 text-white px-2 py-0.5 rounded ml-2 uppercase tracking-widest text-center">V6.0 KERNEL</span></h1>
            <div className="flex items-center gap-3 mt-1">
               <span className={`text-[9px] font-mono uppercase tracking-widest ${isRunning ? 'text-emerald-500 animate-pulse' : 'text-gray-500'}`}>
                {isRunning ? `System: ${config.mode}` : 'System: Idle'}
              </span>
              <span className="text-gray-700">|</span>
              <span className="text-[9px] text-gray-500 font-mono flex items-center gap-1 uppercase">
                {config.mode === 'LIVE' ? <Radio className="w-3 h-3 text-rose-500" /> : <FlaskConical className="w-3 h-3 text-blue-400" />} {config.mode} Ledger
              </span>
            </div>
          </div>
        </div>

        <div className="flex flex-col md:flex-row items-center gap-6 w-full md:w-auto">
          {!isConnected && config.mode === 'LIVE' && (
            <button onClick={() => setShowWalletSelector(true)} className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-bold transition-all flex items-center gap-3">
              {ICONS.Wallet} Link Wallet
            </button>
          )}
          <button 
            onClick={() => isRunning ? setIsRunning(false) : deployAgent()} 
            className={`px-10 py-3 rounded-2xl font-black tracking-widest transition-all active:scale-95 ${isRunning ? 'bg-rose-500/10 text-rose-500 border border-rose-500/20' : 'bg-emerald-600 text-white shadow-xl shadow-emerald-900/30'}`}
          >
            {isRunning ? 'HALT AGENT' : 'DEPLOY AGENT'}
          </button>
        </div>
      </header>

      <main className="grid grid-cols-1 gap-8">
        {/* MODE & PRESET SELECTOR */}
        <div className="glass rounded-3xl overflow-hidden border border-white/5">
          <div className="px-8 py-4 flex flex-col md:flex-row items-center justify-between bg-white/[0.02] border-b border-white/5 gap-4">
             <div className="flex items-center gap-6">
                <div className="flex flex-col">
                   <span className="text-[10px] text-gray-500 font-bold uppercase mb-1">Execution Mode</span>
                   <div className="flex p-1 bg-black rounded-xl border border-white/10">
                      <button 
                        onClick={() => setConfig(prev => ({ ...prev, mode: 'SIMULATION' }))}
                        className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-2 ${config.mode === 'SIMULATION' ? 'bg-blue-600 text-white' : 'text-gray-500'}`}
                        disabled={isRunning}
                      >
                        <FlaskConical className="w-3.5 h-3.5" /> Simulation
                      </button>
                      <button 
                        onClick={() => setConfig(prev => ({ ...prev, mode: 'LIVE' }))}
                        className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-2 ${config.mode === 'LIVE' ? 'bg-rose-600 text-white' : 'text-gray-500'}`}
                        disabled={isRunning}
                      >
                        <Radio className="w-3.5 h-3.5" /> Live
                      </button>
                   </div>
                </div>
                <div className="h-10 w-px bg-white/5" />
                <div className="flex flex-col">
                   <span className="text-[10px] text-gray-500 font-bold uppercase mb-1">Configuration Preset</span>
                   <div className="flex gap-2">
                      {(['SAFE', 'OPTIMAL', 'FAST', 'AGGRESSIVE'] as PresetType[]).map(p => (
                        <button 
                          key={p} 
                          onClick={() => applyPreset(p)}
                          className={`px-3 py-1 rounded-lg text-[10px] font-black border transition-all ${config.preset === p ? 'border-indigo-500 bg-indigo-500/10 text-indigo-400' : 'border-white/5 text-gray-500'}`}
                          disabled={isRunning}
                        >
                          {p}
                        </button>
                      ))}
                   </div>
                </div>
             </div>
             {config.mode === 'LIVE' && simStats.simulatedTrades === 0 && (
                <div className="flex items-center gap-2 text-amber-500 bg-amber-500/10 px-4 py-2 rounded-xl border border-amber-500/20">
                   <TriangleAlert className="w-4 h-4" />
                   <span className="text-[10px] font-bold uppercase tracking-widest">Live Locked: Perform Simulation First</span>
                </div>
             )}
          </div>
          
          <button 
            onClick={() => setShowConfig(!showConfig)}
            className="w-full px-8 py-3 flex items-center justify-between text-[10px] font-black uppercase text-gray-500 tracking-widest hover:bg-white/[0.01]"
          >
            <span>Advanced Parameters</span>
            {showConfig ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>

          {showConfig && (
            <div className="p-8 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8 opacity-70">
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-xs font-black text-gray-400 uppercase tracking-widest">
                  <Filter className="w-4 h-4 text-blue-500" /> Market Filters
                </div>
                <div className="space-y-4 p-4 rounded-2xl bg-white/[0.02] border border-white/5">
                  <div className="flex flex-col gap-1.5"><label className="text-[10px] font-bold text-gray-500 uppercase">Liquidity Mult.</label><input type="number" step="0.1" value={config.minLiquidityMultiplier} onChange={(e) => setConfig(prev => ({...prev, minLiquidityMultiplier: parseFloat(e.target.value)}))} className="bg-transparent border-b border-white/10 p-1 text-sm font-mono outline-none" disabled={isRunning} /></div>
                  <div className="flex flex-col gap-1.5"><label className="text-[10px] font-bold text-gray-500 uppercase">Max Spread (%)</label><input type="number" step="0.001" value={config.maxSpread * 100} onChange={(e) => setConfig(prev => ({...prev, maxSpread: parseFloat(e.target.value) / 100}))} className="bg-transparent border-b border-white/10 p-1 text-sm font-mono outline-none" disabled={isRunning} /></div>
                </div>
              </div>
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-xs font-black text-gray-400 uppercase tracking-widest">
                  <BarChart3 className="w-4 h-4 text-emerald-500" /> Signal Thresholds
                </div>
                <div className="space-y-4 p-4 rounded-2xl bg-white/[0.02] border border-white/5">
                  <div className="flex flex-col gap-1.5"><label className="text-[10px] font-bold text-gray-500 uppercase">Min EV (%)</label><input type="number" step="0.1" value={config.minEV * 100} onChange={(e) => setConfig(prev => ({...prev, minEV: parseFloat(e.target.value) / 100}))} className="bg-transparent border-b border-white/10 p-1 text-sm font-mono outline-none" disabled={isRunning} /></div>
                  <div className="flex flex-col gap-1.5"><label className="text-[10px] font-bold text-gray-500 uppercase">Min Confidence (%)</label><input type="number" step="1" value={config.minConfidence * 100} onChange={(e) => setConfig(prev => ({...prev, minConfidence: parseFloat(e.target.value) / 100}))} className="bg-transparent border-b border-white/10 p-1 text-sm font-mono outline-none" disabled={isRunning} /></div>
                </div>
              </div>
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-xs font-black text-gray-400 uppercase tracking-widest">
                  <Scale className="w-4 h-4 text-amber-500" /> Risk Controls
                </div>
                <div className="space-y-4 p-4 rounded-2xl bg-white/[0.02] border border-white/5">
                  <div className="flex flex-col gap-1.5"><label className="text-[10px] font-bold text-gray-500 uppercase">Kelly Fraction</label><input type="number" step="0.05" value={config.kellyMultiplier} onChange={(e) => setConfig(prev => ({...prev, kellyMultiplier: parseFloat(e.target.value)}))} className="bg-transparent border-b border-white/10 p-1 text-sm font-mono outline-none" disabled={isRunning} /></div>
                  <div className="flex flex-col gap-1.5"><label className="text-[10px] font-bold text-gray-500 uppercase">Min Trade (USDC)</label><input type="number" value={config.minTradeSize} onChange={(e) => setConfig(prev => ({...prev, minTradeSize: parseFloat(e.target.value)}))} className="bg-transparent border-b border-white/10 p-1 text-sm font-mono outline-none" disabled={isRunning} /></div>
                </div>
              </div>
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-xs font-black text-gray-400 uppercase tracking-widest">
                  <Activity className="w-4 h-4 text-purple-500" /> Scanner Policy
                </div>
                <div className="space-y-4 p-4 rounded-2xl bg-white/[0.02] border border-white/5">
                  <div className="flex flex-col gap-1.5"><label className="text-[10px] font-bold text-gray-500 uppercase">Interval (Sec)</label><input type="number" step="1" value={config.scanIntervalSeconds} onChange={(e) => setConfig(prev => ({...prev, scanIntervalSeconds: parseInt(e.target.value)}))} className="bg-transparent border-b border-white/10 p-1 text-sm font-mono outline-none" disabled={isRunning} /></div>
                  <div className="flex flex-col gap-1.5"><label className="text-[10px] font-bold text-gray-500 uppercase">Markets / Scan</label><input type="number" step="1" value={config.maxMarketsPerScan} onChange={(e) => setConfig(prev => ({...prev, maxMarketsPerScan: parseInt(e.target.value)}))} className="bg-transparent border-b border-white/10 p-1 text-sm font-mono outline-none" disabled={isRunning} /></div>
                </div>
              </div>
            </div>
          )}
        </div>

        <Dashboard stats={stats} activeTrades={activeTrades} currentStep={currentStep} />
        
        {/* SIMULATION METRICS */}
        {simStats.scans > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4">
             <div className="glass p-4 rounded-2xl">
                <span className="text-[9px] text-gray-500 font-bold uppercase block mb-1">Total Scans</span>
                <span className="text-xl font-mono font-bold">{simStats.scans}</span>
             </div>
             <div className="glass p-4 rounded-2xl">
                <span className="text-[9px] text-gray-500 font-bold uppercase block mb-1">Valid Signals</span>
                <span className="text-xl font-mono font-bold text-indigo-400">{simStats.validSignals}</span>
             </div>
             <div className="glass p-4 rounded-2xl">
                <span className="text-[9px] text-gray-500 font-bold uppercase block mb-1">Simulated Trades</span>
                <span className="text-xl font-mono font-bold text-emerald-400">{simStats.simulatedTrades}</span>
             </div>
             <div className="glass p-4 rounded-2xl lg:col-span-3">
                <span className="text-[9px] text-gray-500 font-bold uppercase block mb-1">Rejection Primary Blocker</span>
                <div className="flex gap-4">
                   <div className="flex flex-col">
                      <span className="text-[10px] text-gray-400">Spread: {simStats.blockedReasons.spread}</span>
                      <div className="w-12 h-1 bg-rose-500/20 rounded"><div className="bg-rose-500 h-full" style={{width: `${(simStats.blockedReasons.spread / (simStats.scans * config.maxMarketsPerScan)) * 100}%`}} /></div>
                   </div>
                   <div className="flex flex-col">
                      <span className="text-[10px] text-gray-400">Confidence: {simStats.blockedReasons.confidence}</span>
                      <div className="w-12 h-1 bg-amber-500/20 rounded"><div className="bg-amber-500 h-full" style={{width: `${(simStats.blockedReasons.confidence / (simStats.scans * config.maxMarketsPerScan)) * 100}%`}} /></div>
                   </div>
                   <div className="flex flex-col">
                      <span className="text-[10px] text-gray-400">Size: {simStats.blockedReasons.size}</span>
                      <div className="w-12 h-1 bg-blue-500/20 rounded"><div className="bg-blue-500 h-full" style={{width: `${(simStats.blockedReasons.size / (simStats.scans * config.maxMarketsPerScan)) * 100}%`}} /></div>
                   </div>
                </div>
             </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2"><Terminal logs={logs} /></div>
          <div className="glass p-8 rounded-3xl border border-white/5 space-y-6">
            <h3 className="text-lg font-bold flex items-center gap-3"><ShieldAlert className="text-indigo-500 w-5 h-5" /> Safety Protocol</h3>
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-indigo-500/5 border border-indigo-500/10">
                <span className="text-[9px] text-gray-500 uppercase block mb-1">Execution Status</span>
                <span className={`text-sm font-bold ${config.mode === 'LIVE' ? 'text-rose-500' : 'text-blue-400'}`}>
                  {config.mode === 'LIVE' ? 'LIVE MODE' : 'SIMULATION MODE'}
                </span>
                <p className="text-[10px] text-gray-500 mt-1 italic leading-tight">
                  {config.mode === 'LIVE' 
                    ? 'Orders will be sent to CLOB. Real capital will be spent.' 
                    : 'Theoretical orders only. No funds will leave your wallet.'}
                </p>
              </div>
              <div className="p-4 rounded-xl bg-amber-500/5 border border-amber-500/10">
                <span className="text-[9px] text-gray-500 uppercase block mb-1">Deployment Guard</span>
                <span className="text-sm font-bold text-amber-500">Preset Mandatory</span>
                <p className="text-[10px] text-gray-500 mt-1 italic leading-tight">Agent requires an validated preset and successful simulation before Live deployment.</p>
              </div>
            </div>
          </div>
        </div>
      </main>
      <footer className="text-center text-gray-600 text-[10px] uppercase tracking-[0.3em] font-mono border-t border-white/5 pt-8 pb-4">
        &copy; 2025 POLYQUANT-X // SIMULATION_CORE // v6.0.0-STABLE
      </footer>
    </div>
  );
};

export default App;
