import { create } from 'zustand';
import { agentSocket } from '../services/agentSocket';

export interface LogLine {
  id: string;
  agentId: string;
  timestamp: number;
  text: string;
}

export interface LogSearchResult {
  line: LogLine;
  matchIndex: number;
}

export interface SearchOptions {
  isRegex?: boolean;
  agentId?: string;
  caseSensitive?: boolean;
}

export interface LogBufferState {
  buffers: Record<string, LogLine[]>;
  maxLinesPerAgent: number;
  appendOutput: (agentId: string, text: string) => void;
  getAgentLogs: (agentId: string) => LogLine[];
  searchLogs: (query: string, options?: SearchOptions) => LogSearchResult[];
  clearBuffer: (agentId?: string) => void;
}

const MAX_LINES_PER_AGENT = 10000;
const ANSI_REGEX = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;

function cleanLogText(raw: string): string {
  return raw.replace(ANSI_REGEX, '').replace(/\r/g, '');
}

let counter = 0;

export const useLogBufferStore = create<LogBufferState>((set, get) => ({
  buffers: {},
  maxLinesPerAgent: MAX_LINES_PER_AGENT,

  appendOutput: (agentId: string, text: string) => {
    if (!text) return;

    const cleaned = cleanLogText(text);
    if (!cleaned) return;

    const splitLines = cleaned.split('\n');
    // If output ends with newline, trailing element is empty; omit trailing empty line if it resulted from ending \n
    if (splitLines.length > 1 && splitLines[splitLines.length - 1] === '') {
      splitLines.pop();
    }

    if (splitLines.length === 0) return;

    const now = Date.now();
    const newLogLines: LogLine[] = splitLines.map((line) => ({
      id: `${agentId}-${now}-${++counter}`,
      agentId,
      timestamp: now,
      text: line,
    }));

    set((state) => {
      const current = state.buffers[agentId] || [];
      const combined = current.concat(newLogLines);
      const trimmed = combined.length > MAX_LINES_PER_AGENT
        ? combined.slice(combined.length - MAX_LINES_PER_AGENT)
        : combined;

      return {
        buffers: {
          ...state.buffers,
          [agentId]: trimmed,
        },
      };
    });
  },

  getAgentLogs: (agentId: string) => {
    return get().buffers[agentId] || [];
  },

  searchLogs: (query: string, options?: SearchOptions) => {
    if (!query) return [];

    const buffers = get().buffers;
    const agentIds = options?.agentId ? [options.agentId] : Object.keys(buffers);
    const results: LogSearchResult[] = [];

    if (options?.isRegex) {
      let regex: RegExp;
      try {
        const flags = options.caseSensitive ? '' : 'i';
        regex = new RegExp(query, flags);
      } catch {
        return [];
      }

      for (const agentId of agentIds) {
        const lines = buffers[agentId] || [];
        for (const line of lines) {
          const match = regex.exec(line.text);
          if (match) {
            results.push({
              line,
              matchIndex: match.index,
            });
          }
        }
      }
    } else {
      const caseSensitive = options?.caseSensitive ?? false;
      const normalizedQuery = caseSensitive ? query : query.toLowerCase();

      for (const agentId of agentIds) {
        const lines = buffers[agentId] || [];
        for (const line of lines) {
          const textToSearch = caseSensitive ? line.text : line.text.toLowerCase();
          const matchIndex = textToSearch.indexOf(normalizedQuery);
          if (matchIndex !== -1) {
            results.push({
              line,
              matchIndex,
            });
          }
        }
      }
    }

    return results;
  },

  clearBuffer: (agentId?: string) => {
    if (agentId) {
      set((state) => {
        const nextBuffers = { ...state.buffers };
        delete nextBuffers[agentId];
        return { buffers: nextBuffers };
      });
    } else {
      set({ buffers: {} });
    }
  },
}));

// Automatic subscription to WebSocket agent output events
agentSocket.subscribe((msg) => {
  if (msg.type === 'agent:output') {
    useLogBufferStore.getState().appendOutput(msg.agentId, msg.data);
  }
});

// Proxy for direct access
export const logBufferStore = new Proxy({} as LogBufferState & { subscribe: (listener: () => void) => () => void }, {
  get(_target, prop: string | symbol) {
    const state = useLogBufferStore.getState();
    if (prop === 'subscribe') {
      return (listener: (state: LogBufferState) => void) => useLogBufferStore.subscribe(listener);
    }
    if (prop in state) {
      return (state as any)[prop];
    }
    return undefined;
  },
});
