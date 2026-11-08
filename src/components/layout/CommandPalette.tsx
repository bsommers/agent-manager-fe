import React, { useId, useMemo, useRef, useState } from 'react';
import { Command as CommandIcon } from 'lucide-react';
import { useUiStore } from '../../store/uiStore';
import { useAgentStore } from '../../store/agentStore';
import { useModalFocus } from '../../hooks/useModalFocus';
import { buildCommands, filterCommands, MAX_PALETTE_RESULTS } from '../../keyboard/commands';
import { formatKeys } from '../../keyboard/shortcuts';

const PaletteDialog: React.FC = () => {
  const closeOverlay = useUiStore((s) => s.closeOverlay);
  const isBroadcastOpen = useUiStore((s) => s.isBroadcastOpen);
  const agents = useAgentStore((s) => s.agents);
  const pending = useAgentStore((s) => s.pending);

  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const baseId = useId();
  const listboxId = `${baseId}-listbox`;

  const dialogRef = useModalFocus<HTMLDivElement>({
    isOpen: true,
    onClose: () => closeOverlay('palette'),
    initialFocusRef: inputRef,
  });

  // buildCommands reads live store state; recompute when the roster or broadcast flag changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const commands = useMemo(() => buildCommands(), [agents, pending, isBroadcastOpen]);
  const matched = useMemo(() => filterCommands(commands, query, commands.length), [commands, query]);
  const results = matched.slice(0, MAX_PALETTE_RESULTS);
  const truncated = matched.length > results.length;

  const safeIndex = results.length === 0 ? -1 : Math.min(activeIndex, results.length - 1);
  const optionId = (i: number) => `${baseId}-opt-${i}`;

  const runCommand = (index: number) => {
    const cmd = results[index];
    if (!cmd) return;
    closeOverlay('palette');
    cmd.run();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (results.length === 0) return;
      const delta = e.key === 'ArrowDown' ? 1 : -1;
      const next = (safeIndex + delta + results.length) % results.length;
      setActiveIndex(next);
      document.getElementById(optionId(next))?.scrollIntoView?.({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      if (e.nativeEvent.isComposing) return;
      e.preventDefault();
      runCommand(safeIndex);
    }
  };

  return (
    <div
      data-testid="palette-backdrop"
      className="fixed inset-0 z-[500] flex items-start justify-center pt-24 bg-black/60 backdrop-blur-sm"
      onClick={() => closeOverlay('palette')}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="w-full max-w-xl bg-[#0d1322] border border-slate-700 rounded-xl shadow-2xl shadow-black/60 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-4 border-b border-slate-800">
          <CommandIcon className="w-4 h-4 text-cyan-400 shrink-0" aria-hidden="true" />
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-label="Type a command"
            aria-expanded="true"
            aria-autocomplete="list"
            aria-controls={listboxId}
            aria-activedescendant={safeIndex >= 0 ? optionId(safeIndex) : undefined}
            placeholder={`Type a command (${formatKeys('Mod+/')} for shortcuts)`}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={handleKeyDown}
            className="flex-1 bg-transparent py-3 text-sm text-slate-100 placeholder-slate-500 focus:outline-none"
          />
        </div>

        <ul
          ref={listRef}
          id={listboxId}
          role="listbox"
          aria-label="Commands"
          className="max-h-80 overflow-y-auto py-1"
        >
          {results.map((cmd, i) => (
            <li
              key={cmd.id}
              id={optionId(i)}
              role="option"
              aria-selected={i === safeIndex}
              onMouseEnter={() => setActiveIndex(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => runCommand(i)}
              className={`flex items-center justify-between gap-3 px-4 py-2 text-sm cursor-pointer ${
                i === safeIndex ? 'bg-cyan-500/20 text-cyan-200' : 'text-slate-300'
              }`}
            >
              <span className="truncate">{cmd.title}</span>
              {cmd.hint && (
                <kbd className="shrink-0 px-1.5 py-0.5 text-[10px] font-mono bg-slate-800/80 text-slate-400 border border-slate-700/80 rounded">
                  {cmd.hint}
                </kbd>
              )}
            </li>
          ))}
        </ul>

        {results.length === 0 && <p className="px-4 py-3 text-xs text-slate-500">No matching commands</p>}
        {truncated && (
          <p className="px-4 py-2 text-xs text-slate-500 border-t border-slate-800">
            More commands exist. Keep typing to narrow the list.
          </p>
        )}
        <div role="status" aria-live="polite" className="sr-only">
          {results.length === 0
            ? 'No matching commands'
            : `${results.length} command${results.length === 1 ? '' : 's'}${truncated ? ' shown, more available' : ''}`}
        </div>
      </div>
    </div>
  );
};

export const CommandPalette: React.FC = () => {
  const isOpen = useUiStore((s) => s.overlay === 'palette');
  return isOpen ? <PaletteDialog /> : null;
};
