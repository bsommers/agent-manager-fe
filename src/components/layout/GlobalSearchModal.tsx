import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Search, X, Terminal, Server, ExternalLink, AlertCircle, Clock } from 'lucide-react';
import { useAgentStore } from '../../store/agentStore';
import { useLogBufferStore, LogSearchResult } from '../../store/logBufferStore';
import { Agent } from '../../types/agent';
import { useModalFocus } from '../../hooks/useModalFocus';

export interface GlobalSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const GlobalSearchModal: React.FC<GlobalSearchModalProps> = ({ isOpen, onClose }) => {
  const { agents, bringToFront } = useAgentStore();
  const searchLogs = useLogBufferStore((state) => state.searchLogs);

  const [query, setQuery] = useState('');
  const [isRegex, setIsRegex] = useState(false);
  const [selectedAgentId, setSelectedAgentId] = useState<string>('all');
  const [regexError, setRegexError] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);

  // Focus trap, Escape to close, initial focus on the search input, focus restoration
  const dialogRef = useModalFocus<HTMLDivElement>({ isOpen, onClose, initialFocusRef: inputRef });
  const titleId = React.useId();

  // Validate regex syntax
  useEffect(() => {
    if (!isRegex || !query) {
      setRegexError(null);
      return;
    }
    try {
      new RegExp(query, 'i');
      setRegexError(null);
    } catch (err: any) {
      setRegexError(err?.message || 'Invalid regular expression');
    }
  }, [query, isRegex]);

  // Execute search across buffers
  const searchResults: LogSearchResult[] = useMemo(() => {
    if (!query.trim()) return [];
    if (isRegex && regexError) return [];

    return searchLogs(query, {
      isRegex,
      agentId: selectedAgentId === 'all' ? undefined : selectedAgentId,
      caseSensitive: false,
    });
  }, [query, isRegex, regexError, selectedAgentId, searchLogs]);

  // Map agents for quick lookup
  const agentMap = useMemo(() => new Map<string, Agent>(agents.map((a) => [a.id, a])), [agents]);

  // Group search results by agent
  const groupedResults = useMemo(() => {
    const map = new Map<string, { agent?: Agent; results: LogSearchResult[] }>();

    for (const res of searchResults) {
      const aId = res.line.agentId;
      if (!map.has(aId)) {
        map.set(aId, {
          agent: agentMap.get(aId),
          results: [],
        });
      }
      map.get(aId)!.results.push(res);
    }

    return Array.from(map.entries()).map(([agentId, data]) => ({
      agentId,
      agentName: data.agent?.name || agentId,
      agentMode: data.agent?.mode || 'tmux',
      targetHost: data.agent?.targetHost || '',
      results: data.results,
    }));
  }, [searchResults, agentMap]);

  const handleJumpToAgent = (agentId: string) => {
    bringToFront(agentId);
    onClose();
  };

  const formatTimestamp = (ts: number) => {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  if (!isOpen) return null;

  return (
    <div
      data-testid="search-modal-backdrop"
      onClick={onClose}
      className="fixed inset-0 z-[500] bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-3xl bg-[#0d1322] border border-slate-800 rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh] animate-in fade-in zoom-in-95 duration-150"
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-800 bg-[#131b2e]">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400">
              <Search className="w-4 h-4" />
            </div>
            <div>
              <h3 id={titleId} className="font-bold text-sm text-slate-100 flex items-center gap-2">
                Global Output Search
                {query.trim() && !regexError && (
                  <span className="text-[11px] font-normal px-2 py-0.5 rounded-full bg-cyan-950 text-cyan-300 border border-cyan-800/60 font-mono">
                    {searchResults.length} {searchResults.length === 1 ? 'match' : 'matches'} across {groupedResults.length} {groupedResults.length === 1 ? 'agent' : 'agents'}
                  </span>
                )}
              </h3>
            </div>
          </div>
          <button
            data-testid="close-search-modal"
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-200 transition p-1 rounded-md hover:bg-slate-800/60"
            title="Close (Esc)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Search Controls */}
        <div className="p-4 border-b border-slate-800/80 bg-[#090d16]/70 space-y-3">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                ref={inputRef}
                type="text"
                aria-label="Search terminal logs"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search terminal logs across all agents..."
                className="w-full bg-[#0d1322] border border-slate-700/70 rounded-lg pl-10 pr-9 py-2 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 font-mono transition"
              />
              {query && (
                <button
                  type="button"
                  aria-label="Clear search"
                  onClick={() => setQuery('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Regex Toggle */}
            <button
              type="button"
              aria-pressed={isRegex}
              onClick={() => setIsRegex(!isRegex)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-mono font-medium transition ${
                isRegex
                  ? 'bg-cyan-950/60 text-cyan-300 border-cyan-500 shadow-sm shadow-cyan-500/20'
                  : 'bg-[#0d1322] text-slate-400 border-slate-700/60 hover:text-slate-200 hover:border-slate-600'
              }`}
              title="Toggle Regular Expression Search"
            >
              <span className="font-bold">.*</span>
              <span>Regex</span>
            </button>

            {/* Agent Filter Selector */}
            <select
              aria-label="Filter by agent"
              value={selectedAgentId}
              onChange={(e) => setSelectedAgentId(e.target.value)}
              className="bg-[#0d1322] border border-slate-700/60 rounded-lg px-2.5 py-2 text-xs text-slate-300 focus:outline-none focus:border-cyan-500 font-mono"
            >
              <option value="all">All Agents ({agents.length})</option>
              {agents.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name}
                </option>
              ))}
            </select>
          </div>

          {/* Regex Error Alert */}
          {regexError && (
            <div role="alert" className="flex items-center gap-2 text-xs text-rose-400 bg-rose-950/40 border border-rose-800/60 px-3 py-1.5 rounded-md">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              <span>Invalid regular expression: {regexError}</span>
            </div>
          )}
        </div>

        {/* Search Results Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 min-h-[220px]">
          {!query.trim() && (
            <div className="flex flex-col items-center justify-center h-48 text-center text-slate-500 space-y-2">
              <Search className="w-8 h-8 text-slate-600 mb-1" />
              <p className="text-xs font-medium text-slate-400">
                Type a search query to search across active agent terminal buffers
              </p>
              <p className="text-[11px] text-slate-600 max-w-sm">
                Matches are retrieved from bounded output buffers across all active sessions with jump-to-pane navigation.
              </p>
            </div>
          )}

          {query.trim() && !regexError && searchResults.length === 0 && (
            <div className="flex flex-col items-center justify-center h-48 text-center text-slate-500 space-y-2">
              <AlertCircle className="w-8 h-8 text-slate-600 mb-1" />
              <p className="text-xs font-medium text-slate-300">
                No log matches found for &ldquo;<span className="font-mono text-cyan-400">{query}</span>&rdquo;
              </p>
              <p className="text-[11px] text-slate-500">
                Try refining your search keyword or switching between plain text and regex mode.
              </p>
            </div>
          )}

          {query.trim() && !regexError && groupedResults.map((group) => (
            <div
              key={group.agentId}
              data-testid={`agent-group-${group.agentId}`}
              className="bg-[#090d16] border border-slate-800/90 rounded-lg overflow-hidden shadow-sm"
            >
              {/* Agent Group Header */}
              <div className="flex items-center justify-between px-3.5 py-2 bg-slate-900/80 border-b border-slate-800 text-xs">
                <div className="flex items-center gap-2">
                  {group.agentMode === 'ssh' ? (
                    <Server className="w-3.5 h-3.5 text-purple-400" />
                  ) : (
                    <Terminal className="w-3.5 h-3.5 text-cyan-400" />
                  )}
                  <span data-testid="agent-group-name" className="font-bold text-slate-200">{group.agentName}</span>
                  <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-slate-800 text-slate-400 border border-slate-700">
                    {group.agentMode.toUpperCase()}
                  </span>
                  {group.targetHost && (
                    <span className="text-[10px] font-mono text-slate-500 hidden sm:inline">
                      {group.targetHost}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-[11px] font-mono text-slate-400">
                    {group.results.length} {group.results.length === 1 ? 'match' : 'matches'}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleJumpToAgent(group.agentId)}
                    className="flex items-center gap-1 px-2 py-0.5 text-[11px] font-semibold rounded bg-cyan-950 text-cyan-300 hover:bg-cyan-900 border border-cyan-800/80 transition"
                  >
                    <span>Jump to Pane</span>
                    <ExternalLink className="w-3 h-3" />
                  </button>
                </div>
              </div>

              {/* Log Line Items */}
              <div className="divide-y divide-slate-800/40">
                {group.results.map((res) => (
                  <div
                    key={res.line.id}
                    data-testid="search-result-item"
                    onClick={() => handleJumpToAgent(group.agentId)}
                    className="flex items-start gap-3 px-3.5 py-2 hover:bg-cyan-950/20 hover:border-l-2 hover:border-l-cyan-400 cursor-pointer text-xs font-mono transition group"
                  >
                    <div className="flex items-center gap-1 text-[10px] text-slate-500 group-hover:text-slate-400 shrink-0 mt-0.5">
                      <Clock className="w-2.5 h-2.5" />
                      <span>{formatTimestamp(res.line.timestamp)}</span>
                    </div>
                    <div className="text-slate-300 group-hover:text-cyan-200 break-all flex-1 select-text">
                      {res.line.text}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Modal Footer */}
        <div className="px-4 py-2.5 border-t border-slate-800 bg-[#090d16] flex items-center justify-between text-[11px] text-slate-500">
          <div className="flex items-center gap-3">
            <span>
              <kbd className="px-1.5 py-0.5 bg-slate-800 border border-slate-700 rounded text-slate-400 text-[10px] font-mono">
                Esc
              </kbd>{' '}
              to close
            </span>
            <span>•</span>
            <span>Click any match to jump to agent pane</span>
          </div>
          <div className="font-mono text-[10px] text-slate-600">
            Bounded ring buffer search
          </div>
        </div>
      </div>
    </div>
  );
};
