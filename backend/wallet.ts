
import { ACTIVE_CONFIG } from "./config";

export async function getBalances(address: string | null) {
  if (ACTIVE_CONFIG.mode === 'SIMULATION') {
    return { usdc: 1000.0, matic: 10.0 };
  }
  // REAL BALANCES WOULD BE FETCHED VIA ETHERS HERE
  return { usdc: 0, matic: 0 };
}
