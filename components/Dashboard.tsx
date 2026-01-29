
import React from 'react';
import { 
  ResponsiveContainer,
  AreaChart,
  Area,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip
} from 'recharts';
import { BotStats, Trade, BotStep } from '../types';
import { ICONS, COLORS } from '../constants';

const pnlData = [
  { time: '09:00', pnl: 0 },
  { time: '10:00', pnl: 120 },
  { time: '11:00', pnl: 80 },
  { time: '12:00', pnl: 250 },
  { time: '13:00', pnl: 400 },
  { time: '14:00', pnl: 350 },
  { time: '15:00', pnl: 600 },
];

interface Props {
  stats: BotStats;
  activeTrades: Trade[];
  currentStep: BotStep;
}

const StatCard = ({ title, value, icon, trend, subValue }: { title: string, value: string, icon: React.ReactNode, trend?: string, subValue?: string }) => (
  <div className="glass p-5 rounded-2xl flex flex-col gap-2 relative overflow-hidden group">
    <div className="flex justify-between items-center text-gray-400">
      <span className="text-xs font-medium uppercase tracking-wider">{title}</span>
      {icon}
    </div>
    <div className="text-2xl font-bold tracking-tight group-hover:text-blue-400 transition-colors">{value}</div>
    {subValue && <div className="text-[10px] font-mono text-gray-500">{subValue}</div>}
    {trend && (
      <div className={`text-xs font-medium ${trend.startsWith('+') ? 'text-emerald-400' : 'text-rose-400'}`}>
        {trend} vs yesterday
      </div>
    )}
  </div>
);

const ProcessStep = ({ label, active, completed, icon, exhausted }: { label: string, active: boolean, completed: boolean, icon: React.ReactNode, exhausted?: boolean }) => (
  <div className={`flex flex-col items-center gap-2 transition-all duration-500 ${active || exhausted ? 'scale-110' : 'opacity-40 grayscale'}`}>
    <div className={`w-10 h-10 rounded-full flex items-center justify-center border-2 transition-all ${
      exhausted ? 'border-rose-500 bg-rose-500/20 text-rose-500' :
      active ? 'border-blue-500 bg-blue-500/20 shadow-[0_0_15px_rgba(59,130,246,0.5)] animate-pulse' : 
      completed ? 'border-emerald-500 bg-emerald-500/10 text-emerald-500' : 'border-white/10'
    }`}>
      {icon}
    </div>
    <span className={`text-[10px] font-bold uppercase tracking-tighter ${exhausted ? 'text-rose-400' : active ? 'text-blue-400' : 'text-gray-500'}`}>
      {label}
    </span>
  </div>
);

export const Dashboard: React.FC<Props> = ({ stats, activeTrades, currentStep }) => {
  const steps: { key: BotStep, label: string, icon: React.ReactNode }[] = [
    { key: 'SCANNING', label: 'Scan', icon: ICONS.Trend },
    { key: 'ANALYZING', label: 'Think', icon: ICONS.Brain },
    { key: 'RISK_CHECK', label: 'Risk', icon: ICONS.Shield },
    { key: 'EXECUTING', label: 'Trade', icon: ICONS.Zap },
    { key: 'MONITORING', label: 'Watch', icon: ICONS.Activity }
  ];

  const currentIdx = steps.findIndex(s => s.key === currentStep);
  const utilization = stats.allocatedCapital > 0 
    ? (stats.cumulativeSpent / stats.allocatedCapital) * 100 
    : 0;

  return (
    <div className="space-y-6">
      {/* Bot Lifecycle & Budget Progress */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        <div className="lg:col-span-3 glass p-6 rounded-2xl overflow-hidden relative border-b-4 border-b-blue-500/20">
          <div className="flex justify-between items-center relative z-10 px-4 md:px-12">
            {steps.map((step, idx) => (
              <React.Fragment key={step.key}>
                <ProcessStep 
                  label={step.label} 
                  active={currentStep === step.key} 
                  completed={currentIdx > idx}
                  icon={step.icon}
                  exhausted={currentStep === 'EXHAUSTED' && idx === steps.length - 1}
                />
                {idx < steps.length - 1 && (
                  <div className={`flex-1 h-[1px] mx-2 mb-4 transition-colors duration-500 ${currentIdx > idx ? 'bg-emerald-500/50' : 'bg-white/5'}`} />
                )}
              </React.Fragment>
            ))}
          </div>
          <div className="absolute inset-0 bg-gradient-to-r from-blue-500/5 via-transparent to-emerald-500/5 opacity-50" />
        </div>

        {/* Budget Utilization Guard */}
        <div className="glass p-6 rounded-2xl flex flex-col justify-between border-l-4 border-l-amber-500/50">
          <div>
            <div className="flex justify-between items-center mb-1">
              <span className="text-[10px] font-black uppercase text-amber-500 tracking-widest">Budget Utility</span>
              <span className="text-[10px] font-mono text-gray-500">{utilization.toFixed(1)}%</span>
            </div>
            <div className="w-full h-1.5 bg-white/5 rounded-full overflow-hidden">
              <div 
                className={`h-full transition-all duration-1000 ${utilization > 90 ? 'bg-rose-500' : 'bg-amber-500'}`}
                style={{ width: `${Math.min(100, utilization)}%` }}
              />
            </div>
          </div>
          <div className="flex justify-between items-end">
            <div className="flex flex-col">
              <span className="text-[9px] text-gray-500 uppercase font-bold">Allocated</span>
              <span className="text-xs font-bold font-mono">${stats.allocatedCapital.toFixed(2)}</span>
            </div>
            <div className="flex flex-col items-end">
              <span className="text-[9px] text-gray-500 uppercase font-bold">Spent</span>
              <span className="text-xs font-bold font-mono text-amber-400">${stats.cumulativeSpent.toFixed(2)}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard 
          title="Tradeable Capital" 
          value={`$${stats.usdcBalance.toLocaleString()}`} 
          subValue="USDC (Polygon)"
          icon={ICONS.Wallet} 
        />
        <StatCard 
          title="Gas Fuel" 
          value={`${stats.maticBalance.toFixed(4)}`} 
          subValue="MATIC (Polygon)"
          icon={ICONS.Fuel} 
        />
        <StatCard 
          title="Total PnL" 
          value={`$${stats.totalPnL.toLocaleString()}`} 
          icon={ICONS.Trend} 
          trend="+12.5%" 
        />
        <StatCard 
          title="Exposure" 
          value={`$${stats.activeExposure.toLocaleString()}`} 
          icon={ICONS.Shield} 
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 glass p-6 rounded-2xl h-[400px]">
          <div className="flex justify-between items-center mb-6">
            <h3 className="text-lg font-semibold flex items-center gap-2">
              {ICONS.Activity} Performance Curve
            </h3>
            <div className="flex gap-2">
              <span className="px-2 py-1 bg-emerald-500/10 text-emerald-500 text-[10px] rounded border border-emerald-500/20 font-bold uppercase">Mainnet Feed</span>
            </div>
          </div>
          <ResponsiveContainer width="100%" height="80%">
            <AreaChart data={pnlData}>
              <defs>
                <linearGradient id="colorPnl" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={COLORS.primary} stopOpacity={0.3}/>
                  <stop offset="95%" stopColor={COLORS.primary} stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" vertical={false} />
              <XAxis dataKey="time" stroke="#6b7280" fontSize={12} tickLine={false} axisLine={false} />
              <YAxis stroke="#6b7280" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(val) => `$${val}`} />
              <Tooltip 
                contentStyle={{ backgroundColor: COLORS.card, border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px' }}
                itemStyle={{ color: '#fff' }}
              />
              <Area type="monotone" dataKey="pnl" stroke={COLORS.primary} fillOpacity={1} fill="url(#colorPnl)" strokeWidth={3} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="glass p-6 rounded-2xl flex flex-col">
          <div className="flex justify-between items-center mb-6">
            <h3 className="text-lg font-semibold flex items-center gap-2">
              {ICONS.Zap} Positions
            </h3>
            <span className="text-[10px] text-gray-500 font-mono tracking-tighter">USDC_ACTIVE</span>
          </div>
          <div className="flex-1 overflow-y-auto space-y-3 no-scrollbar">
            {activeTrades.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-gray-500 text-sm">
                <div className="opacity-20 mb-2">{ICONS.Zap}</div>
                No active exposure
              </div>
            ) : (
              activeTrades.map(trade => (
                <div key={trade.id} className="p-4 rounded-xl bg-white/5 border border-white/5 hover:border-white/10 transition-colors">
                  <div className="flex justify-between items-start mb-2">
                    <span className="text-xs font-bold text-blue-400">#{trade.marketId.slice(0, 8)}</span>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${trade.side === 'YES' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'}`}>
                      {trade.side}
                    </span>
                  </div>
                  <div className="text-sm font-medium line-clamp-1 mb-2">{trade.marketQuestion}</div>
                  <div className="flex justify-between text-xs text-gray-400">
                    <span>${trade.size.toFixed(2)} @ {trade.entryPrice.toFixed(2)}</span>
                    <span className={trade.pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                      {trade.pnl >= 0 ? '+' : ''}{trade.pnl.toFixed(2)}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
