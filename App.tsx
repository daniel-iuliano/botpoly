
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { 
  BrainCircuit, 
  ShieldAlert, 
  Coins, 
  ChevronDown, 
  ChevronUp, 
  FlaskConical, 
  Radio,
  TriangleAlert,
  Filter,
  BarChart3,
  Scale,
  Activity
} from 'lucide-react';
import { BrowserProvider, formatUnits, Contract } from 'ethers';
import { Dashboard } from './components/Dashboard';
import { Terminal } from './components/Terminal';
import { WalletSelector } from './components/WalletSelector';
import { 
  Trade, 
  BotStats, 
  LogEntry, 
  BotStep, 
  WalletType, 
  BotConfig, 
  PresetType,
  SimulationStats
} from './types';
import { TradingCore } from './backend/TradingCore';
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
  // UI State
  const [isRunning, setIsRunning] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [showWalletSelector, setShowWalletSelector] = useState(false);
  const [showConfig, setShowConfig] = useState(true);
  const [address, setAddress] = useState<string | null>(null);
  const [allocationPercent, setAllocationPercent] = useState(50);
  
  // Backend State Mirroring
  const [stats, setStats] = useState<BotStats>(INITIAL_STATS);
  const [simStats, setSimStats] = useState<SimulationStats>(INITIAL_SIM_STATS);
  const [activeTrades, setActiveTrades] = useState<Trade[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([
    { timestamp: Date.now(), level: 'INFO', message: 'PolyQuant-X V7.0 - Backend Core Service Ready.' }
  ]);
  
  const [config, setConfig] = useState<BotConfig>(() => {
    const saved = localStorage.getItem('polyquant_config_v7');
    return saved ? JSON.parse(saved) : DEFAULT_CONFIG;
  });

  // THE BACKEND KERNEL
  const coreRef = useRef<TradingCore | null>(null);

  const addLog = useCallback((log: LogEntry) => {
    setLogs(prev => [...prev.slice(-100), log]);
  }, []);

  const syncState = useCallback(() => {
    if (coreRef.current) {
      const state = coreRef.current.getState();
      setStats({ ...state.stats });
      setSimStats({ ...state.simStats });
      setActiveTrades([...state.activeTrades]);
      setIsRunning(state.isRunning);
    }
  }, []);

  // Initialize Core
  useEffect(() => {
    if (!coreRef.current) {
      coreRef.current = new TradingCore(INITIAL_STATS, INITIAL_SIM_STATS, addLog, syncState);
      // If simulated mode, give initial virtual balance
      if (config.mode === 'SIMULATION') {
        coreRef.current.updateBalances(1000, 10);
      }
    }
  }, [config.mode, addLog, syncState]);

  useEffect(() => {
    localStorage.setItem('polyquant_config_v7', JSON.stringify(config));
  }, [config]);

  const deployAgent = () => {
    if (config.mode === 'LIVE') {
      if (!isConnected) {
        addLog({ timestamp: Date.now(), level: 'ERROR', message: 'LIVE MODE BLOCKED: Connect wallet first.' });
        return;
      }
      if (simStats.simulatedTrades === 0) {
        addLog({ timestamp: Date.now(), level: 'ERROR', message: 'LIVE MODE BLOCKED: Zero trades executed in Simulation.' });
        return;
      }
    }

    if (coreRef.current) {
      const allocated = stats.usdcBalance * (allocationPercent / 100);
      coreRef.current.start(config, allocated);
      setShowConfig(false);
    }
  };

  const haltAgent = () => {
    if (coreRef.current) coreRef.current.stop();
  };

  const fetchBalances = async (account: string, provider: BrowserProvider) => {
    try {
      const maticBalanceRaw = await provider.getBalance(account);
      const maticBalance = parseFloat(formatUnits(maticBalanceRaw, 18));
      const nativeContract = new Contract(POLYGON_TOKENS.USDC_NATIVE, ERC20_ABI, provider);
      const nativeUsdc = parseFloat(formatUnits(await nativeContract.balanceOf(account), 6));
      const bridgedContract = new Contract(POLYGON_TOKENS.USDC_BRIDGED, ERC20_ABI, provider);
      const bridgedUsdc = parseFloat(formatUnits(await bridgedContract.balanceOf(account), 6));
      const totalUsdc = nativeUsdc + bridgedUsdc;
      
      if (coreRef.current) coreRef.current.updateBalances(totalUsdc, maticBalance);
      return { totalUsdc, maticBalance };
    } catch (error) { return null; }
  };

  const connectWallet = async (type: WalletType) => {
    setIsConnecting(true);
    try {
      const win = window as any;
      const rawProvider = type === 'METAMASK' ? win.ethereum : win.phantom?.ethereum || win.trustwallet;
      if (!rawProvider) throw new Error(`${type} not detected.`);
      const provider = new BrowserProvider(rawProvider);
      const accounts = await provider.send("eth_requestAccounts", []);
      setAddress(accounts[0]);
      setIsConnected(true);
      setShowWalletSelector(false);
      addLog({ timestamp: Date.now(), level: 'SUCCESS', message: `Wallet ${accounts[0].slice(0,8)} linked.` });
      fetchBalances(accounts[0], provider);
    } catch (e: any) { 
      addLog({ timestamp: Date.now(), level: 'ERROR', message: e.message }); 
    } finally { setIsConnecting(false); }
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
            <h1 className="text-2xl font-black tracking-tighter italic text-white">POLYQUANT-X <span className="text-[10px] not-italic font-bold bg-indigo-500 text-white px-2 py-0.5 rounded ml-2 uppercase tracking-widest text-center">CORE SERVICE</span></h1>
            <div className="flex items-center gap-3 mt-1">
               <span className={`text-[9px] font-mono uppercase tracking-widest ${isRunning ? 'text-emerald-500 animate-pulse' : 'text-gray-500'}`}>
                {isRunning ? `Core: ${config.mode}` : 'Core: Idle'}
              </span>
              <span className="text-gray-700">|</span>
              <span className="text-[9px] text-gray-500 font-mono flex items-center gap-1 uppercase">
                {config.mode === 'LIVE' ? <Radio className="w-3 h-3 text-rose-500" /> : <FlaskConical className="w-3 h-3 text-blue-400" />} {config.mode} Engine
              </span>
            </div>
          </div>
        </div>

        <div className="flex flex-col md:flex-row items-center gap-6 w-full md:w-auto">
          {!isConnected && config.mode === 'LIVE' && (
            <button onClick={() => setShowWalletSelector(true)} className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-bold transition-all flex items-center gap-3">
              {ICONS.Wallet} Link Ledger
            </button>
          )}
          <button 
            onClick={() => isRunning ? haltAgent() : deployAgent()} 
            className={`px-10 py-3 rounded-2xl font-black tracking-widest transition-all active:scale-95 ${isRunning ? 'bg-rose-500/10 text-rose-500 border border-rose-500/20' : 'bg-emerald-600 text-white shadow-xl shadow-emerald-900/30'}`}
          >
            {isRunning ? 'HALT BACKEND' : 'START BACKEND'}
          </button>
        </div>
      </header>

      <main className="grid grid-cols-1 gap-8">
        <div className="glass rounded-3xl overflow-hidden border border-white/5">
          <div className="px-8 py-4 flex flex-col md:flex-row items-center justify-between bg-white/[0.02] border-b border-white/5 gap-4">
             <div className="flex items-center gap-6">
                <div className="flex flex-col">
                   <span className="text-[10px] text-gray-500 font-bold uppercase mb-1">Execution Mode</span>
                   <div className="flex p-1 bg-black rounded-xl border border-white/10">
                      <button onClick={() => setConfig(prev => ({ ...prev, mode: 'SIMULATION' }))} className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-2 ${config.mode === 'SIMULATION' ? 'bg-blue-600 text-white' : 'text-gray-500'}`} disabled={isRunning}>Simulation</button>
                      <button onClick={() => setConfig(prev => ({ ...prev, mode: 'LIVE' }))} className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-2 ${config.mode === 'LIVE' ? 'bg-rose-600 text-white' : 'text-gray-500'}`} disabled={isRunning}>Live</button>
                   </div>
                </div>
                <div className="h-10 w-px bg-white/5" />
                <div className="flex flex-col">
                   <span className="text-[10px] text-gray-500 font-bold uppercase mb-1">Active Preset</span>
                   <div className="flex gap-2">
                      {(['SAFE', 'OPTIMAL', 'FAST', 'AGGRESSIVE'] as PresetType[]).map(p => (
                        <button key={p} onClick={() => { setConfig(PRESETS[p]); addLog({timestamp:Date.now(),level:'INFO',message:`Applied ${p} preset`}); }} className={`px-3 py-1 rounded-lg text-[10px] font-black border transition-all ${config.preset === p ? 'border-indigo-500 bg-indigo-500/10 text-indigo-400' : 'border-white/5 text-gray-500'}`} disabled={isRunning}>{p}</button>
                      ))}
                   </div>
                </div>
             </div>
             {config.mode === 'LIVE' && simStats.simulatedTrades === 0 && (
                <div className="flex items-center gap-2 text-amber-500 bg-amber-500/10 px-4 py-2 rounded-xl border border-amber-500/20">
                   <TriangleAlert className="w-4 h-4" />
                   <span className="text-[10px] font-bold uppercase tracking-widest">Locked: Needs Simulation First</span>
                </div>
             )}
          </div>
          
          <button onClick={() => setShowConfig(!showConfig)} className="w-full px-8 py-3 flex items-center justify-between text-[10px] font-black uppercase text-gray-500 tracking-widest hover:bg-white/[0.01]">
            <span>Kernel Tuning Parameters</span>
            {showConfig ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>

          {showConfig && (
            <div className="p-8 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8 opacity-70">
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-xs font-black text-gray-400 uppercase tracking-widest"><Filter className="w-4 h-4 text-blue-500" /> Filters</div>
                <div className="space-y-4 p-4 rounded-2xl bg-white/[0.02] border border-white/5">
                  <div className="flex flex-col gap-1.5"><label className="text-[10px] font-bold text-gray-500 uppercase">Spread (%)</label><input type="number" step="0.001" value={config.maxSpread * 100} onChange={(e) => setConfig(prev => ({...prev, maxSpread: parseFloat(e.target.value) / 100}))} className="bg-transparent border-b border-white/10 p-1 text-sm font-mono outline-none" disabled={isRunning} /></div>
                </div>
              </div>
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-xs font-black text-gray-400 uppercase tracking-widest"><BarChart3 className="w-4 h-4 text-emerald-500" /> Signal</div>
                <div className="space-y-4 p-4 rounded-2xl bg-white/[0.02] border border-white/5">
                  <div className="flex flex-col gap-1.5"><label className="text-[10px] font-bold text-gray-500 uppercase">Min EV (%)</label><input type="number" step="0.1" value={config.minEV * 100} onChange={(e) => setConfig(prev => ({...prev, minEV: parseFloat(e.target.value) / 100}))} className="bg-transparent border-b border-white/10 p-1 text-sm font-mono outline-none" disabled={isRunning} /></div>
                </div>
              </div>
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-xs font-black text-gray-400 uppercase tracking-widest"><Scale className="w-4 h-4 text-amber-500" /> Risk</div>
                <div className="space-y-4 p-4 rounded-2xl bg-white/[0.02] border border-white/5">
                  <div className="flex flex-col gap-1.5"><label className="text-[10px] font-bold text-gray-500 uppercase">Kelly Multi</label><input type="number" step="0.05" value={config.kellyMultiplier} onChange={(e) => setConfig(prev => ({...prev, kellyMultiplier: parseFloat(e.target.value)}))} className="bg-transparent border-b border-white/10 p-1 text-sm font-mono outline-none" disabled={isRunning} /></div>
                </div>
              </div>
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-xs font-black text-gray-400 uppercase tracking-widest"><Activity className="w-4 h-4 text-purple-500" /> Scanner</div>
                <div className="space-y-4 p-4 rounded-2xl bg-white/[0.02] border border-white/5">
                  <div className="flex flex-col gap-1.5"><label className="text-[10px] font-bold text-gray-500 uppercase">Interval (Sec)</label><input type="number" step="1" value={config.scanIntervalSeconds} onChange={(e) => setConfig(prev => ({...prev, scanIntervalSeconds: parseInt(e.target.value)}))} className="bg-transparent border-b border-white/10 p-1 text-sm font-mono outline-none" disabled={isRunning} /></div>
                </div>
              </div>
            </div>
          )}
        </div>

        <Dashboard stats={stats} activeTrades={activeTrades} currentStep={isRunning ? 'SCANNING' : 'IDLE'} />
        
        {simStats.scans > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4">
             <div className="glass p-4 rounded-2xl"><span className="text-[9px] text-gray-500 font-bold uppercase block mb-1">Core Scans</span><span className="text-xl font-mono font-bold">{simStats.scans}</span></div>
             <div className="glass p-4 rounded-2xl"><span className="text-[9px] text-gray-500 font-bold uppercase block mb-1">Valid Signals</span><span className="text-xl font-mono font-bold text-indigo-400">{simStats.validSignals}</span></div>
             <div className="glass p-4 rounded-2xl"><span className="text-[9px] text-gray-500 font-bold uppercase block mb-1">Executions</span><span className="text-xl font-mono font-bold text-emerald-400">{simStats.simulatedTrades}</span></div>
             <div className="glass p-4 rounded-2xl lg:col-span-3">
                <span className="text-[9px] text-gray-500 font-bold uppercase block mb-1">Backend Primary Reject Reasons</span>
                <div className="flex gap-4">
                   <div className="flex flex-col"><span className="text-[10px] text-gray-400">Spread: {simStats.blockedReasons.spread}</span><div className="w-12 h-1 bg-rose-500/20 rounded"><div className="bg-rose-500 h-full" style={{width: `${(simStats.blockedReasons.spread / (simStats.scans * 3)) * 100}%`}} /></div></div>
                   <div className="flex flex-col"><span className="text-[10px] text-gray-400">Conf: {simStats.blockedReasons.confidence}</span><div className="w-12 h-1 bg-amber-500/20 rounded"><div className="bg-amber-500 h-full" style={{width: `${(simStats.blockedReasons.confidence / (simStats.scans * 3)) * 100}%`}} /></div></div>
                   <div className="flex flex-col"><span className="text-[10px] text-gray-400">Size: {simStats.blockedReasons.size}</span><div className="w-12 h-1 bg-blue-500/20 rounded"><div className="bg-blue-500 h-full" style={{width: `${(simStats.blockedReasons.size / (simStats.scans * 3)) * 100}%`}} /></div></div>
                </div>
             </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2"><Terminal logs={logs} /></div>
          <div className="glass p-8 rounded-3xl border border-white/5 space-y-6">
            <h3 className="text-lg font-bold flex items-center gap-3"><ShieldAlert className="text-indigo-500 w-5 h-5" /> Execution Guard</h3>
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-indigo-500/5 border border-indigo-500/10">
                <span className="text-[9px] text-gray-500 uppercase block mb-1">Backend Policy</span>
                <span className="text-sm font-bold text-blue-400">Decoupled Execution</span>
                <p className="text-[10px] text-gray-500 mt-1 italic leading-tight">Backend runs the loop. UI is a monitoring terminal. Private keys never leave the wallet manager.</p>
              </div>
            </div>
          </div>
        </div>
      </main>
      <footer className="text-center text-gray-600 text-[10px] uppercase tracking-[0.3em] font-mono border-t border-white/5 pt-8 pb-4">
        &copy; 2025 POLYQUANT-X // BACKEND_SERVICE_V7 // v7.0.1-PROD
      </footer>
    </div>
  );
};

export default App;
