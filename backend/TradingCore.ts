
import { BotConfig, Market, Trade, BotStats, LogEntry, SimulationStats } from "../types";
import { ClobClient } from "./clob/clobClient";
import { RiskManager } from "./engine/riskManager";
import { ExecutionEngine } from "./engine/execution";
import { generateMarketSignal } from "../services/geminiService";

/**
 * The TradingCore is the "Backend Server" of the system.
 * It is the single source of truth for the agent's state.
 */
export class TradingCore {
  private clob = new ClobClient();
  private risk = new RiskManager();
  private exec = new ExecutionEngine();
  
  private isRunning = false;
  private config: BotConfig | null = null;
  private stats: BotStats;
  private simStats: SimulationStats;
  private activeTrades: Trade[] = [];
  
  private onLog: (log: LogEntry) => void;
  private onStateUpdate: () => void;
  private loopTimeout: any = null;

  constructor(
    initialStats: BotStats, 
    initialSimStats: SimulationStats,
    onLog: (log: LogEntry) => void,
    onStateUpdate: () => void
  ) {
    this.stats = initialStats;
    this.simStats = initialSimStats;
    this.onLog = onLog;
    this.onStateUpdate = onStateUpdate;
  }

  start(config: BotConfig, allocatedUsdc: number) {
    this.config = config;
    this.isRunning = true;
    this.stats.allocatedCapital = allocatedUsdc;
    this.stats.cumulativeSpent = 0;
    this.activeTrades = [];
    
    this.log('SUCCESS', `Core Kernel Deployed: ${config.mode} | ${config.preset}`);
    this.runLoop();
  }

  stop() {
    this.isRunning = false;
    if (this.loopTimeout) clearTimeout(this.loopTimeout);
    this.log('INFO', 'Core Kernel Halted.');
    this.onStateUpdate();
  }

  private log(level: LogEntry['level'], message: string) {
    this.onLog({ timestamp: Date.now(), level, message });
  }

  private async runLoop() {
    if (!this.isRunning || !this.config) return;

    try {
      const isSim = this.config.mode === 'SIMULATION';
      const prefix = isSim ? '[SIM]' : '[LIVE]';

      this.log('INFO', `${prefix} Polling CLOB for tradable markets...`);
      this.simStats.scans++;
      
      const markets = await this.clob.getTradableMarkets(this.config);
      const candidates = markets.slice(0, this.config.maxMarketsPerScan);

      for (const m of candidates) {
        if (!this.isRunning) break;

        const book = await this.clob.getOrderbook(m.yesTokenId);
        if (!book) continue;

        if (book.spread > this.config.maxSpread) {
          this.simStats.blockedReasons.spread++;
          continue;
        }

        // Gemini Analysis
        const signal = await generateMarketSignal(m);
        if (!signal) continue;
        this.simStats.validSignals++;

        // Risk Evaluation
        const ev = this.risk.calculateEV(book.midPrice, signal.impliedProbability);
        if (ev < this.config.minEV) {
          this.simStats.blockedReasons.ev++;
          continue;
        }

        if (signal.confidence < this.config.minConfidence) {
          this.simStats.blockedReasons.confidence++;
          continue;
        }

        const size = this.risk.calculatePositionSize(
          book.midPrice, 
          signal.impliedProbability, 
          this.stats.usdcBalance, 
          this.config
        );

        if (size <= 0) {
          this.simStats.blockedReasons.size++;
          continue;
        }

        // Final Liquidity Check
        const requiredDepth = size * this.config.minLiquidityMultiplier;
        let availableDepth = 0;
        for (let i = 0; i < Math.min(book.asks.length, 5); i++) {
          availableDepth += parseFloat(book.asks[i].size) * parseFloat(book.asks[i].price);
        }

        if (availableDepth < requiredDepth) {
          this.simStats.blockedReasons.liquidity++;
          continue;
        }

        // Execution
        const trade = await this.exec.execute(this.config.mode, m, book, size, 'YES', ev);
        if (trade) {
          this.activeTrades = [trade, ...this.activeTrades].slice(0, 10);
          this.stats.totalTrades++;
          this.stats.cumulativeSpent += size;
          this.stats.usdcBalance -= size;
          
          if (isSim) this.simStats.simulatedTrades++;
          
          this.log('SUCCESS', `${prefix} FILLED: ${m.id.slice(0,8)} | Size $${size.toFixed(2)} | EV ${(ev*100).toFixed(1)}%`);
        }
      }

    } catch (error: any) {
      this.log('ERROR', `Loop Fault: ${error.message}`);
    } finally {
      this.onStateUpdate();
      if (this.isRunning) {
        const interval = (this.config?.scanIntervalSeconds || 30) * 1000;
        this.loopTimeout = setTimeout(() => this.runLoop(), interval);
      }
    }
  }

  getState() {
    return {
      stats: this.stats,
      simStats: this.simStats,
      activeTrades: this.activeTrades,
      isRunning: this.isRunning
    };
  }

  // Used by UI to simulate balance updates or gas
  updateBalances(usdc: number, matic: number) {
    this.stats.usdcBalance = usdc;
    this.stats.maticBalance = matic;
    if (this.stats.initialUsdcBalance === 0) {
      this.stats.initialUsdcBalance = usdc;
    }
    this.onStateUpdate();
  }
}
