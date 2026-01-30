
import { LogEntry } from "../types";

type LogCallback = (log: LogEntry) => void;
let subscriber: LogCallback | null = null;

export const setLogSubscriber = (cb: LogCallback) => {
  subscriber = cb;
};

export const log = {
  info: (msg: string) => emit('INFO', msg),
  success: (msg: string) => emit('SUCCESS', msg),
  warn: (msg: string) => emit('WARNING', msg),
  error: (msg: string) => emit('ERROR', msg),
  signal: (msg: string) => emit('SIGNAL', msg)
};

function emit(level: LogEntry['level'], message: string) {
  const entry: LogEntry = { timestamp: Date.now(), level, message };
  console.log(`[${level}] ${message}`);
  if (subscriber) subscriber(entry);
}
