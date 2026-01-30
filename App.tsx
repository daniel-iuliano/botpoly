
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
  WalletType, 
  BotConfig, 
  PresetType,
  SimulationStats
} from './types';
import { startBot, stopBot } from './backend/server';
import { setLogSubscriber } from './backend/logger';
import { getBalances } from './backend/wallet';
import { ICONS, POLYGON_TOKENS, DEFAULT_CONFIG, PRESETS } from './constants';

const INITIAL_STATS: BotStats = {
  totalPnL: 0, winRate: 0, totalTrades: 0, activeExposure: 0, usdcBalance: 0, 
  polBalance: 0, initialUsdcBalance: 0, allocatedCapital: 0, cumulativeSpent: 0
};

const INITIAL_SIM_STATS: SimulationStats = {
  scans: 0, validSignals: 0, simulatedTrades: 0, pnl: 0, maxDrawdown: 0,
  blockedReasons: { spread: 0, liquidity: 0, confidence: 0, ev: 0, size: 0 }
};

const POLYGON_CHAIN_ID = '0x89'; // 137

const App: React.FC = () => {
  const [isRunning, setIsRunning] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [showWalletSelector, setShowWalletSelector] = useState(false);
  const [showConfig, setShowConfig] = useState(true);
  const [address, setAddress] = useState<string | null>(null);
  const [stats, setStats] = useState<BotStats>(INITIAL_STATS);
  const [simStats, setSimStats] = useState<SimulationStats>(INITIAL_SIM_STATS);
  const [activeTrades, setActiveTrades] = useState<Trade[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([{ timestamp: Date.now(), level: 'INFO', message: 'System Ready.' }]);
  const [config, setConfig] = useState<BotConfig>(() => {
    const saved = localStorage.getItem('polyquant_v7');
    return saved ? JSON.parse(saved) : DEFAULT_CONFIG;
  });

  // Subscribe UI to Backend Logs
  useEffect(() => {
    setLogSubscriber((newLog) => {
      setLogs(prev => [...prev.slice(-99), newLog]);
      if (newLog.message.includes("Scanning")) {
        setSimStats(prev => ({ ...prev, scans: prev.scans + 1 }));
      }
      if (newLog.level === 'SIGNAL') {
        setSimStats(prev => ({ ...prev, validSignals: prev.validSignals + 1 }));
      }
      if (newLog.message.includes("Skip: Spread")) {
        setSimStats(prev => ({ ...prev, blockedReasons: { ...prev.blockedReasons, spread: prev.blockedReasons.spread + 1 } }));
      }
    });
  }, []);

  useEffect(() => {
    localStorage.setItem('polyquant_v7', JSON.stringify(config));
  }, [config]);

  const addLog = useCallback((log: LogEntry) => {
    setLogs(prev => [...prev.slice(-99), log]);
  }, []);

  const handleTrade = useCallback((trade: Trade) => {
    setActiveTrades(prev => [trade, ...prev].slice(0, 10));
    setStats(prev => ({
      ...prev,
      totalTrades: prev.totalTrades + 1,
      cumulativeSpent: prev.cumulativeSpent + trade.size
    }));
    if (trade.isSimulated) {
      setSimStats(prev => ({ ...prev, simulatedTrades: prev.simulatedTrades + 1 }));
    }
  }, []);

  const handleIterationUpdate = useCallback((balances: { usdc: number, pol: number }) => {
    setStats(prev => ({
      ...prev,
      usdcBalance: balances.usdc,
      polBalance: balances.pol,
      initialUsdcBalance: prev.initialUsdcBalance === 0 ? balances.usdc : prev.initialUsdcBalance
    }));
  }, []);

  const deployAgent = () => {
    if (config.mode === 'LIVE' && !isConnected) {
      addLog({ timestamp: Date.now(), level: 'ERROR', message: 'LIVE MODE BLOCKED: Connect wallet first.' });
      return;
    }
    setIsRunning(true);
    startBot(config, address, handleTrade, handleIterationUpdate);
    setShowConfig(false);
  };

  const haltAgent = () => {
    setIsRunning(false);
    stopBot();
  };

  const connectWallet = async (type: WalletType) => {
    try {
      const win = window as any;
      if (!win.ethereum) {
        addLog({ timestamp: Date.now(), level: 'ERROR', message: 'MetaMask provider not detected.' });
        return;
      }
      
      const provider = new BrowserProvider(win.ethereum);
      
      // Network Check
      const network = await provider.getNetwork();
      if (network.chainId !== 137n) {
        try {
          await win.ethereum.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: POLYGON_CHAIN_ID }],
          });
        } catch (switchError: any) {
          if (switchError.code === 4902) {
            addLog({ timestamp: Date.now(), level: 'ERROR', message: 'Polygon Mainnet not found in MetaMask.' });
          } else {
            addLog({ timestamp: Date.now(), level: 'ERROR', message: 'Network switch failed.' });
          }
          return;
        }
      }

      const accounts = await provider.send("eth_requestAccounts", []);
      const connectedAddress = accounts[0];
      setAddress(connectedAddress);
      setIsConnected(true);
      setShowWalletSelector(false);
      
      addLog({ timestamp: Date.now(), level: 'INFO', message: `MetaMask connected: ${connectedAddress.slice(0, 10)}...` });
      
      // Initial Balance Discovery
      const balances = await getBalances(connectedAddress);
      handleIterationUpdate(balances);
      
      addLog({ timestamp: Date.now(), level: 'INFO', message: `USDC balance: ${balances.usdc.toFixed(2)}` });
      addLog({ timestamp: Date.now(), level: 'INFO', message: `POL balance: ${balances.pol.toFixed(4)}` });

      // Handle Account Changes
      win.ethereum.on('accountsChanged', (accounts: string[]) => {
        if (accounts.length === 0) {
          setIsConnected(false);
          setAddress(null);
          haltAgent();
        } else {
          setAddress(accounts[0]);
        }
      });

    } catch (e: any) {
      addLog({ timestamp: Date.now(), level: 'ERROR', message: `Connection failed: ${e.message}` });
    }
  };

  return (
    <div className="min-h-screen p-4 md:p-8 max-w-7xl mx-auto space-y-8 no-scrollbar bg-[#050608]">
      {showWalletSelector && <WalletSelector onSelect={connectWallet} onClose={() => setShowWalletSelector(false)} isConnecting={false} />}

      <header className="flex flex-col md:flex-row justify-between items-center gap-6 bg-white/[0.02] p-6 rounded-3xl border border-white/[0.05]">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 bg-gradient-to-br from-indigo-600 to-violet-700 rounded-2xl flex items-center justify-center">
            <BrainCircuit className="text-white w-8 h-8" />
          </div>
          <div>
            <h1 className="text-2xl font-black italic text-white tracking-tighter">POLYQUANT-X <span className="text-[10px] not-italic font-bold bg-indigo-500 text-white px-2 py-0.5 rounded ml-2 uppercase">Core Engine</span></h1>
            <div className="flex items-center gap-3 mt-1">
              <span className={`text-[9px] font-mono uppercase tracking-widest ${isRunning ? 'text-emerald-500 animate-pulse' : 'text-gray-500'}`}>
                {isRunning ? `ENGINE: ${config.mode}` : 'ENGINE: IDLE'}
              </span>
              {isConnected && (
                <span className="text-[9px] text-gray-500 font-mono flex items-center gap-1 uppercase">
                  | WALLET: {address?.slice(0, 6)}...{address?.slice(-4)}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-6">
          {!isConnected && (
            <button onClick={() => setShowWalletSelector(true)} className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-bold flex items-center gap-3 transition-colors">
              {ICONS.Wallet} Link MetaMask
            </button>
          )}
          <button 
            onClick={() => isRunning ? haltAgent() : deployAgent()} 
            className={`px-10 py-3 rounded-2xl font-black tracking-widest transition-all ${isRunning ? 'bg-rose-500/10 text-rose-500 border border-rose-500/20' : 'bg-emerald-600 text-white shadow-xl shadow-emerald-900/30'}`}
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
                  <button onClick={() => setConfig(prev => ({ ...prev, mode: 'SIMULATION' }))} className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${config.mode === 'SIMULATION' ? 'bg-blue-600 text-white' : 'text-gray-500'}`} disabled={isRunning}>Simulation</button>
                  <button onClick={() => setConfig(prev => ({ ...prev, mode: 'LIVE' }))} className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${config.mode === 'LIVE' ? 'bg-rose-600 text-white' : 'text-gray-500'}`} disabled={isRunning}>Live</button>
                </div>
              </div>
              <div className="flex flex-col">
                <span className="text-[10px] text-gray-500 font-bold uppercase mb-1">Active Preset</span>
                <div className="flex gap-2">
                  {(['SAFE', 'OPTIMAL', 'FAST', 'AGGRESSIVE'] as PresetType[]).map(p => (
                    <button key={p} onClick={() => setConfig(PRESETS[p])} className={`px-3 py-1 rounded-lg text-[10px] font-black border transition-all ${config.preset === p ? 'border-indigo-500 bg-indigo-500/10 text-indigo-400' : 'border-white/5 text-gray-500'}`} disabled={isRunning}>{p}</button>
                  ))}
                </div>
              </div>
            </div>
            {config.mode === 'LIVE' && !isConnected && (
              <div className="flex items-center gap-2 text-rose-500 bg-rose-500/10 px-4 py-2 rounded-xl border border-rose-500/20">
                <TriangleAlert className="w-4 h-4" />
                <span className="text-[10px] font-bold uppercase tracking-widest">Live Locked: Link Ledger First</span>
              </div>
            )}
            {config.mode === 'LIVE' && isConnected && simStats.simulatedTrades === 0 && (
              <div className="flex items-center gap-2 text-amber-500 bg-amber-500/10 px-4 py-2 rounded-xl border border-amber-500/20">
                <TriangleAlert className="w-4 h-4" />
                <span className="text-[10px] font-bold uppercase tracking-widest">Caution: No simulation data</span>
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
                <div className="flex items-center gap-2 text-xs font-black text-gray-400 uppercase tracking-widest"><Filter className="w-4 h-4 text-blue-500" /> Scanner</div>
                <div className="p-4 rounded-2xl bg-white/[0.02] border border-white/5">
                  <div className="flex flex-col gap-1.5"><label className="text-[10px] font-bold text-gray-500 uppercase">Spread (%)</label><input type="number" step="0.1" value={config.maxSpread * 100} onChange={(e) => setConfig(prev => ({...prev, maxSpread: parseFloat(e.target.value) / 100}))} className="bg-transparent border-b border-white/10 p-1 text-sm font-mono outline-none" disabled={isRunning} /></div>
                </div>
              </div>
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-xs font-black text-gray-400 uppercase tracking-widest"><BarChart3 className="w-4 h-4 text-emerald-500" /> Signal</div>
                <div className="p-4 rounded-2xl bg-white/[0.02] border border-white/5">
                  <div className="flex flex-col gap-1.5"><label className="text-[10px] font-bold text-gray-500 uppercase">Min EV (%)</label><input type="number" step="0.1" value={config.minEV * 100} onChange={(e) => setConfig(prev => ({...prev, minEV: parseFloat(e.target.value) / 100}))} className="bg-transparent border-b border-white/10 p-1 text-sm font-mono outline-none" disabled={isRunning} /></div>
                </div>
              </div>
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-xs font-black text-gray-400 uppercase tracking-widest"><Scale className="w-4 h-4 text-amber-500" /> Risk</div>
                <div className="p-4 rounded-2xl bg-white/[0.02] border border-white/5">
                   <div className="flex flex-col gap-1.5"><label className="text-[10px] font-bold text-gray-500 uppercase">Kelly Multi</label><input type="number" step="0.05" value={config.kellyMultiplier} onChange={(e) => setConfig(prev => ({...prev, kellyMultiplier: parseFloat(e.target.value)}))} className="bg-transparent border-b border-white/10 p-1 text-sm font-mono outline-none" disabled={isRunning} /></div>
                </div>
              </div>
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-xs font-black text-gray-400 uppercase tracking-widest"><Activity className="w-4 h-4 text-purple-500" /> Loop</div>
                <div className="p-4 rounded-2xl bg-white/[0.02] border border-white/5">
                   <div className="flex flex-col gap-1.5"><label className="text-[10px] font-bold text-gray-500 uppercase">Interval (Sec)</label><input type="number" step="1" value={config.scanIntervalSeconds} onChange={(e) => setConfig(prev => ({...prev, scanIntervalSeconds: parseInt(e.target.value)}))} className="bg-transparent border-b border-white/10 p-1 text-sm font-mono outline-none" disabled={isRunning} /></div>
                </div>
              </div>
            </div>
          )}
        </div>

        <Dashboard stats={stats} activeTrades={activeTrades} currentStep={isRunning ? 'SCANNING' : 'IDLE'} />
        
        {simStats.scans > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4">
            <div className="glass p-4 rounded-2xl"><span className="text-[9px] text-gray-500 font-bold uppercase block mb-1">Total Scans</span><span className="text-xl font-mono font-bold">{simStats.scans}</span></div>
            <div className="glass p-4 rounded-2xl"><span className="text-[9px] text-gray-500 font-bold uppercase block mb-1">Valid Signals</span><span className="text-xl font-mono font-bold text-indigo-400">{simStats.validSignals}</span></div>
            <div className="glass p-4 rounded-2xl"><span className="text-[9px] text-gray-500 font-bold uppercase block mb-1">Sim Trades</span><span className="text-xl font-mono font-bold text-emerald-400">{simStats.simulatedTrades}</span></div>
            <div className="glass p-4 rounded-2xl lg:col-span-3">
              <span className="text-[9px] text-gray-500 font-bold uppercase block mb-1">Reject Distribution</span>
              <div className="flex gap-4">
                <div className="flex flex-col"><span className="text-[10px] text-gray-400">Spread: {simStats.blockedReasons.spread}</span><div className="w-12 h-1 bg-rose-500/20 rounded overflow-hidden"><div className="bg-rose-500 h-full" style={{width: `${(simStats.blockedReasons.spread / Math.max(1, simStats.scans*3)) * 100}%`}} /></div></div>
              </div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2"><Terminal logs={logs} /></div>
          <div className="glass p-8 rounded-3xl border border-white/5 space-y-6">
            <h3 className="text-lg font-bold flex items-center gap-3"><ShieldAlert className="text-indigo-500 w-5 h-5" /> Safety Guard</h3>
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-indigo-500/5 border border-indigo-500/10">
                <span className="text-sm font-bold text-blue-400">REST Execution</span>
                <p className="text-[10px] text-gray-500 mt-1 italic leading-tight">MetaMask proves liquidity. CLOB executes off-chain. No on-chain transactions are manually triggered by the bot.</p>
              </div>
              <div className="p-4 rounded-xl bg-indigo-500/5 border border-indigo-500/10">
                <span className="text-sm font-bold text-emerald-400">Polygon Mainnet</span>
                <p className="text-[10px] text-gray-500 mt-1 italic leading-tight">Settlement occurs via Polymarket contracts on Polygon. Gas (POL) is required for successful order lifecycle.</p>
              </div>
            </div>
          </div>
        </div>
      </main>
      <footer className="text-center text-gray-600 text-[10px] uppercase tracking-[0.3em] font-mono border-t border-white/5 pt-8 pb-4">
        &copy; 2025 POLYQUANT-X // HYBRID_CLOB_REST // v7.2.0-PROD
      </footer>
    </div>
  );
};

export default App;
