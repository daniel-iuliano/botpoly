
import { BrowserProvider, formatUnits, Contract } from 'ethers';
import { POLYGON_TOKENS } from '../constants';
import { log } from './logger';

const ERC20_ABI = ["function balanceOf(address) view returns (uint256)"];

export interface WalletBalances {
  usdc: number;
  pol: number;
}

export async function getBalances(address: string | null): Promise<WalletBalances> {
  // Default values for simulation or disconnected state
  if (!address) {
    return { usdc: 0, pol: 0 };
  }

  try {
    const win = window as any;
    if (!win.ethereum) {
      // Return simulation values if no ethereum provider
      return { usdc: 1000, pol: 10 }; 
    }

    const provider = new BrowserProvider(win.ethereum);
    
    // Check Native POL (Gas)
    const polRaw = await provider.getBalance(address);
    const pol = parseFloat(formatUnits(polRaw, 18));

    // Check USDC (Capital) - Using Native USDC for Polygon
    const usdcContract = new Contract(POLYGON_TOKENS.USDC_NATIVE, ERC20_ABI, provider);
    const usdcRaw = await usdcContract.balanceOf(address);
    const usdc = parseFloat(formatUnits(usdcRaw, 6));

    return { usdc, pol };
  } catch (error) {
    console.error("Balance fetch error:", error);
    return { usdc: 0, pol: 0 };
  }
}

/**
 * PRODUCTION GUARD: Final check before settlement on Polygon
 */
export async function verifySettlementCapability(address: string | null, size: number): Promise<boolean> {
  if (!address) {
    log.error("Wallet not connected. Settlement blocked.");
    return false;
  }

  const { usdc, pol } = await getBalances(address);
  const minGas = 0.1; // Safe threshold for Polygon gas

  if (usdc < size) {
    log.error(`Insufficient balance for CLOB settlement. Trade size $${size} > Wallet $${usdc}. Aborted.`);
    return false;
  }

  if (pol < minGas) {
    log.error(`Insufficient POL for gas settlement. Gas ${pol.toFixed(4)} < Threshold ${minGas}. Aborted.`);
    return false;
  }

  return true;
}
