
import React from 'react';
import { WalletType } from '../types';
import { ICONS } from '../constants';
import { X } from 'lucide-react';

interface Props {
  onSelect: (type: WalletType) => void;
  onClose: () => void;
  isConnecting: boolean;
}

export const WalletSelector: React.FC<Props> = ({ onSelect, onClose, isConnecting }) => {
  const wallets: { type: WalletType; name: string; icon: string; description: string }[] = [
    { 
      type: 'METAMASK', 
      name: 'MetaMask', 
      icon: 'https://upload.wikimedia.org/wikipedia/commons/3/36/MetaMask_Logo.svg',
      description: 'Standard EVM Browser Extension' 
    },
    { 
      type: 'PHANTOM', 
      name: 'Phantom', 
      icon: 'https://phantom.app/img/logo-dark.png',
      description: 'Multi-chain (Solana & EVM)' 
    },
    { 
      type: 'TRUST', 
      name: 'Trust Wallet', 
      icon: 'https://trustwallet.com/assets/images/media/assets/trust_wallet_logo.svg',
      description: 'Mobile & Browser Wallet' 
    }
  ];

  return (
    <div 
      className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4 transition-opacity duration-300"
      onClick={(e) => { if (e.target === e.currentTarget && !isConnecting) onClose(); }}
    >
      <div className="glass max-w-md w-full rounded-3xl p-8 border border-white/10 shadow-2xl animate-in zoom-in-95 duration-300 relative">
        <button 
          onClick={onClose}
          disabled={isConnecting}
          className="absolute top-6 right-6 text-gray-500 hover:text-white transition-colors disabled:opacity-0"
        >
          <X className="w-6 h-6" />
        </button>

        <div className="flex items-center gap-4 mb-8">
          <div className="w-12 h-12 bg-blue-600 rounded-2xl flex items-center justify-center text-white shadow-lg shadow-blue-500/20">
            {ICONS.Wallet}
          </div>
          <div>
            <h2 className="text-xl font-bold">Connect Wallet</h2>
            <p className="text-sm text-gray-400">Mainnet execution environment</p>
          </div>
        </div>

        <div className="space-y-3">
          {wallets.map((wallet) => (
            <button
              key={wallet.type}
              onClick={() => onSelect(wallet.type)}
              disabled={isConnecting}
              className={`w-full flex items-center justify-between p-4 rounded-2xl bg-white/5 border border-white/5 hover:border-blue-500/50 hover:bg-blue-500/5 transition-all group disabled:opacity-50 ${isConnecting ? 'cursor-not-allowed' : 'cursor-pointer'}`}
            >
              <div className="flex items-center gap-4">
                <img src={wallet.icon} alt={wallet.name} className="w-8 h-8 object-contain" />
                <div className="text-left">
                  <div className="font-bold group-hover:text-blue-400 transition-colors">{wallet.name}</div>
                  <div className="text-[10px] text-gray-500 uppercase tracking-widest">{wallet.description}</div>
                </div>
              </div>
              <div className="text-gray-600 group-hover:text-blue-500 transition-colors">
                {isConnecting ? <div className="animate-spin w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full" /> : ICONS.Zap}
              </div>
            </button>
          ))}
        </div>

        <div className="mt-8 p-4 rounded-xl bg-amber-500/5 border border-amber-500/10 flex gap-3">
          <div className="text-amber-500 shrink-0">{ICONS.Alert}</div>
          <p className="text-[11px] text-amber-200/70 leading-relaxed italic">
            Notice: Funds at risk. Bot will execute on Polygon Mainnet. MATIC (gas) and USDC (collateral) are required.
          </p>
        </div>
      </div>
    </div>
  );
};
