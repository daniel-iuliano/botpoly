
import React, { useEffect, useRef } from 'react';
import { LogEntry } from '../types';
import { ICONS } from '../constants';

interface Props {
  logs: LogEntry[];
}

export const Terminal: React.FC<Props> = ({ logs }) => {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Use scrollTop instead of scrollIntoView to prevent the whole page from jumping
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  const getLogColor = (level: string) => {
    switch (level) {
      case 'SUCCESS': return 'text-emerald-400';
      case 'WARNING': return 'text-amber-400';
      case 'ERROR': return 'text-rose-500';
      case 'SIGNAL': return 'text-blue-400';
      default: return 'text-gray-300';
    }
  };

  return (
    <div className="glass rounded-2xl overflow-hidden flex flex-col h-[300px] border-t-4 border-t-blue-500/50">
      <div className="bg-white/5 px-4 py-2 border-b border-white/10 flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs font-mono font-bold uppercase tracking-widest text-gray-400">
          {ICONS.Terminal} System Logs
        </div>
        <div className="flex gap-1.5">
          <div className="w-2 h-2 rounded-full bg-rose-500"></div>
          <div className="w-2 h-2 rounded-full bg-amber-500"></div>
          <div className="w-2 h-2 rounded-full bg-emerald-500"></div>
        </div>
      </div>
      <div 
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-4 font-mono text-[11px] leading-relaxed no-scrollbar space-y-1 scroll-smooth"
      >
        {logs.map((log, idx) => (
          <div key={idx} className="flex gap-3 group">
            <span className="text-gray-600 shrink-0">
              [{new Date(log.timestamp).toLocaleTimeString([], { hour12: false })}]
            </span>
            <span className={`${getLogColor(log.level)} font-bold shrink-0 min-w-[60px]`}>
              {log.level}
            </span>
            <span className="text-gray-200 group-hover:text-white transition-colors">
              {log.message}
            </span>
            {log.data && (
              <span className="text-gray-500 italic truncate opacity-50">
                {typeof log.data === 'string' ? log.data : JSON.stringify(log.data)}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
