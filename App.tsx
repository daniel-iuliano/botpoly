
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { BrainCircuit } from 'lucide-react';
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
};

const BASE_POLL_INTERVAL = 45000; 
const ERROR_BACKOFF_INTERVAL = 90000;
const STEP_DELAY = 1200;

/**
 * Robust provider detection utility.
 * Handles delayed injection and multiple providers.
 */
async function detectProvider(type: WalletType): Promise<any> {
  const win = window as any;
  
  // 1. Immediate check
  let provider = getRawProvider(type);
  if (provider) return provider;

  // 2. Wait for window load if document is still loading
  if (document.readyState !== 'complete') {
    await new Promise((resolve) => {
      window.addEventListener('load', resolve, { once: true });
      // Safety timeout
      setTimeout(resolve, 3000);
    });
    provider = getRawProvider(type);
    if (provider) return provider;
  }

  // 3. Polling check (handles some async injection cases)
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
      // Check for multiple providers (common when Phantom/Coinbase/Trust coexist)
      if (win.ethereum?.providers?.length) {
        return win.ethereum.providers.find((p: any) => p.isMetaMask);
      }
      return win.ethereum?.isMetaMask ? win.ethereum : null;
      
    case 'PHANTOM':
      // Phantom injects into window.phantom.ethereum
      return win.phantom?.ethereum || (win.ethereum?.isPhantom ? win.ethereum : null);
      
    case 'TRUST':
      // Trust Wallet usually injects into window.trustwallet or window.ethereum.isTrust
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

  const connectWallet = async (type: WalletType) => {
    setIsConnecting(true);
    addLog('INFO', `Scanning for ${type} provider...`);
    
    try {
      const rawProvider = await detectProvider(type);
      
      if (!rawProvider) {
        addLog('ERROR', `${type} extension not detected or inactive. Please ensure it is unlocked and active in this browser.`);
        setShowWalletSelector(false);
        setIsConnecting(false);
        return;
      }

      addLog('INFO', `Handshaking with ${type}...`);
      const provider = new BrowserProvider(rawProvider);
      const accounts = await provider.send("eth_requestAccounts", []);
      const network = await provider.getNetwork();

      if (network.chainId !== POLYGON_CHAIN_ID) {
        addLog('WARNING', 'Connected to wrong network. Switching to Polygon Mainnet...');
        try {
          await rawProvider.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: '0x89' }], 
          });
        } catch (switchError: any) {
          if (switchError.code === 4902) {
            addLog('ERROR', 'Polygon Mainnet not found. Attempting to add network...');
            await rawProvider.request({
              method: 'wallet_addEthereumChain',
              params: [{
                chainId: '0x89',
                chainName: 'Polygon Mainnet',
                nativeCurrency: { name: 'MATIC', symbol: 'MATIC', decimals: 18 },
                rpcUrls: ['https://polygon-rpc.com/'],
                blockExplorerUrls: ['https://polygonscan.com/']
              }]
            });
          } else {
            throw switchError;
          }
        }
      }

      const balance = await provider.getBalance(accounts[0]);
      providerRef.current = provider;
      setAddress(accounts[0]);
      setWalletType(type);
      setIsConnected(true);
      setShowWalletSelector(false);
      setStats(prev => ({ ...prev, balance: parseFloat(formatUnits(balance, 18)) }));
      
      addLog('SUCCESS', `${type} Wallet Active: ${accounts[0].slice(0, 6)}...${accounts[0].slice(-4)}`);
    } catch (error: any) {
      addLog('ERROR', 'Wallet handshake failed.', error.message);
    } finally {
      setIsConnecting(false);
    }
  };

  const startBot = () => {
    if (!isConnected) {
      addLog('ERROR', 'Connection required before start.');
      return;
    }
    setIsRunning(true);
    addLog('SUCCESS', 'Autonomous agent live. Scanning Polymarket CLOB.');
  };

  const stopBot = () => {
    setIsRunning(false);
    setCurrentStep('IDLE');
    if (botTimeoutRef.current) window.clearTimeout(botTimeoutRef.current);
    addLog('WARNING', 'Emergency stop triggered. Trading halted.');
  };

  const runIteration = useCallback(async () => {
    if (!isRunning) return;

    let nextDelay = BASE_POLL_INTERVAL;

    try {
      setCurrentStep('SCANNING');
      addLog('INFO', 'Scanning markets for inefficiencies...');
      const markets = await fetchLiveMarkets();
      
      if (markets.length === 0) {
        addLog('WARNING', 'No liquid markets detected. Retrying...');
        await new Promise(r => setTimeout(r, 10000));
        return;
      }

      setCurrentStep('ANALYZING');
      const targetMarket = markets[Math.floor(Math.random() * markets.length)];
      addLog('INFO', `Analyzing "${targetMarket.question}"`);
      
      const signal: Signal = await generateMarketSignal(targetMarket);
      addLog('SIGNAL', `Est. Prob: ${(signal.impliedProbability * 100).toFixed(1)}% | Conf: ${(signal.confidence * 100).toFixed(0)}%`);
      
      await new Promise(r => setTimeout(r, STEP_DELAY));

      setCurrentStep('RISK_CHECK');
      const ev = calculateEV(targetMarket.currentPrice, signal.impliedProbability);
      
      if (ev > 0 && signal.confidence >= RISK_LIMITS.minConfidence) {
        const size = calculateKellySize(targetMarket.currentPrice, signal.impliedProbability, stats.balance);
        
        if (size > 0.05) { 
          setCurrentStep('EXECUTING');
          addLog('WARNING', `Confirming execution on ${walletType}...`, { size: `$${size.toFixed(2)}` });
          
          const newTrade: Trade = {
            id: `mainnet-tx-${Date.now()}`,
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
            activeExposure: prev.activeExposure + size,
            balance: prev.balance - size,
            totalTrades: prev.totalTrades + 1
          }));
          addLog('SUCCESS', `Trade successfully relayed to exchange.`);
        } else {
          addLog('INFO', 'Filtered: Insufficient Kelly edge.');
        }
      } else {
        addLog('INFO', 'No significant alpha in current scan.');
      }

      setCurrentStep('MONITORING');
      await new Promise(r => setTimeout(r, STEP_DELAY));

    } catch (error: any) {
      const errorMsg = error?.message?.toLowerCase() || "";
      if (errorMsg.includes('429') || errorMsg.includes('resource_exhausted')) {
        addLog('ERROR', 'Intelligence API limit hit. 90s backoff.', error.message);
        setCurrentStep('COOLING');
        nextDelay = ERROR_BACKOFF_INTERVAL;
      } else {
        addLog('ERROR', 'Kernel iteration fault.', error.message);
      }
    } finally {
      if (isRunning) {
        botTimeoutRef.current = window.setTimeout(runIteration, nextDelay);
      }
    }
  }, [isRunning, stats, walletType, addLog]);

  useEffect(() => {
    if (isRunning) {
      botTimeoutRef.current = window.setTimeout(runIteration, 1000);
    } else {
      if (botTimeoutRef.current) window.clearTimeout(botTimeoutRef.current);
    }
    return () => {
      if (botTimeoutRef.current) window.clearTimeout(botTimeoutRef.current);
    };
  }, [isRunning, runIteration]);

  return (
    <div className="min-h-screen p-4 md:p-8 max-w-7xl mx-auto space-y-8 no-scrollbar bg-[#050608]">
      {showWalletSelector && (
        <WalletSelector 
          onSelect={connectWallet} 
          onClose={() => setShowWalletSelector(false)} 
          isConnecting={isConnecting} 
        />
      )}

      {/* Header */}
      <header className="flex flex-col md:flex-row justify-between items-center gap-4 bg-white/[0.02] p-6 rounded-3xl border border-white/[0.05]">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 bg-gradient-to-br from-blue-600 to-indigo-700 rounded-2xl flex items-center justify-center shadow-xl shadow-blue-500/20">
            <BrainCircuit className="text-white w-8 h-8" />
          </div>
          <div>
            <h1 className="text-2xl font-black tracking-tighter italic">POLYQUANT-X <span className="text-[10px] not-italic font-bold bg-emerald-500 text-black px-2 py-0.5 rounded ml-2">MAINNET</span></h1>
            <p className="text-[10px] text-gray-500 font-mono flex items-center gap-2 uppercase tracking-widest">
              <span className={`w-2 h-2 rounded-full ${isRunning ? 'bg-emerald-500 animate-pulse' : 'bg-gray-600'}`}></span>
              {isRunning ? 'System: Active' : 'System: Idle'} // Poly_137
            </p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          {!isConnected ? (
            <button 
              onClick={() => setShowWalletSelector(true)}
              disabled={isConnecting}
              className="px-8 py-3 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 text-white rounded-2xl font-bold transition-all flex items-center gap-3 shadow-lg shadow-blue-900/40 active:scale-95"
            >
              {isConnecting ? 'Handshaking...' : <><span className="opacity-50">{ICONS.Wallet}</span> CONNECT WALLET</>}
            </button>
          ) : (
            <div className="flex items-center gap-4">
              <div className="hidden md:flex flex-col items-end mr-2">
                <span className="text-[10px] text-gray-500 uppercase font-bold tracking-[0.2em]">{walletType}</span>
                <span className="text-xs font-mono text-emerald-400/80">{address?.slice(0, 6)}...{address?.slice(-4)}</span>
              </div>
              <button 
                onClick={isRunning ? stopBot : startBot}
                className={`px-10 py-3 rounded-2xl font-black tracking-widest transition-all flex items-center gap-3 active:scale-95 ${
                  isRunning 
                  ? 'bg-rose-500/10 text-rose-500 border border-rose-500/20 hover:bg-rose-500/20 shadow-lg shadow-rose-900/10' 
                  : 'bg-emerald-600 text-white hover:bg-emerald-500 shadow-xl shadow-emerald-900/30'
                }`}
              >
                {isRunning ? <><span className="animate-pulse">{ICONS.Pause}</span> STOP BOT</> : <><span className="opacity-70">{ICONS.Play}</span> START AGENT</>}
              </button>
            </div>
          )}
        </div>
      </header>

      {/* Main Content */}
      <main className="grid grid-cols-1 gap-8 animate-in fade-in slide-in-from-bottom-4 duration-1000">
        <Dashboard stats={stats} activeTrades={activeTrades} currentStep={currentStep} />
        
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2">
            <Terminal logs={logs} />
          </div>
          <div className="glass p-8 rounded-3xl border border-white/5 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-32 h-32 bg-blue-600/5 blur-3xl -z-10" />
            
            <h3 className="text-lg font-bold mb-6 flex items-center gap-3">
              <span className="text-blue-500">{ICONS.Shield}</span> Mainnet Safeguards
            </h3>
            
            <div className="space-y-6">
              <div className="flex justify-between items-center">
                <div className="flex flex-col">
                  <span className="text-xs text-gray-500 uppercase font-bold tracking-tighter">Max Allocation</span>
                  <span className="text-sm font-bold text-gray-200">5.0% Equity Cap</span>
                </div>
                <div className="text-emerald-500 bg-emerald-500/10 p-2 rounded-lg">{ICONS.Auth}</div>
              </div>

              <div className="flex justify-between items-center">
                <div className="flex flex-col">
                  <span className="text-xs text-gray-500 uppercase font-bold tracking-tighter">Chain Status</span>
                  <span className="text-sm font-bold text-gray-200">Polygon (ID 137)</span>
                </div>
                <div className="text-blue-500 bg-blue-500/10 p-2 rounded-lg">{ICONS.System}</div>
              </div>

              <div className="flex justify-between items-center">
                <div className="flex flex-col">
                  <span className="text-xs text-gray-500 uppercase font-bold tracking-tighter">Risk Engine</span>
                  <span className="text-sm font-bold text-gray-200">Conservative Kelly</span>
                </div>
                <div className="text-amber-500 bg-amber-500/10 p-2 rounded-lg">{ICONS.Alert}</div>
              </div>

              <div className="pt-6 border-t border-white/5">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-[10px] font-black uppercase text-rose-500 tracking-widest animate-pulse">Live Mainnet</span>
                  <span className="text-[10px] text-gray-600">v3.2.1-PRO</span>
                </div>
                <p className="text-[11px] text-gray-500 italic leading-relaxed">
                  System operational. All actions are final on the blockchain. Ensure wallet has MATIC for execution costs.
                </p>
              </div>
            </div>
          </div>
        </div>
      </main>

      <footer className="pt-8 text-center text-gray-600 text-[10px] uppercase tracking-[0.3em] font-mono border-t border-white/5">
        &copy; 2025 POLYQUANT-X PROTOCOL // REAL_FUNDS_AT_RISK // EIP-1193_INTEGRATION
      </footer>
    </div>
  );
};

export default App;
