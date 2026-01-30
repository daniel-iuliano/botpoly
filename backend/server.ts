
import { runIteration } from "./tradingEngine";
import { getBalances } from "./wallet";
import { ACTIVE_CONFIG, updateConfig } from "./config";
import { log } from "./logger";
import { BotConfig, Trade } from "../types";

let running = false;
let loopTimeout: any = null;

export async function startBot(
  config: BotConfig, 
  address: string | null,
  onTrade: (trade: Trade) => void,
  onIterationComplete: (balances: { usdc: number, pol: number }) => void
) {
  if (running) return;
  running = true;
  updateConfig(config);

  log.success(`Backend Engine Initialized: ${config.mode} mode`);

  const loop = async () => {
    if (!running) return;

    try {
      // Fetch real-time balances before every iteration
      const balances = await getBalances(address);
      onIterationComplete(balances);

      // Core decision loop
      const newTrades = await runIteration(balances.usdc, address);
      newTrades.forEach(onTrade);

    } catch (e: any) {
      log.error(`Engine Loop Fault: ${e.message}`);
    } finally {
      if (running) {
        loopTimeout = setTimeout(loop, ACTIVE_CONFIG.scanIntervalSeconds * 1000);
      }
    }
  };

  loop();
}

export function stopBot() {
  running = false;
  if (loopTimeout) {
    clearTimeout(loopTimeout);
    loopTimeout = null;
  }
  log.info("Backend Engine Halted.");
}
