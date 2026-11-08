import React, { useId, useRef } from 'react';
import { X } from 'lucide-react';
import { useUiStore } from '../../store/uiStore';
import { useModalFocus } from '../../hooks/useModalFocus';
import { SHORTCUTS, formatKeys } from '../../keyboard/shortcuts';
import type { Shortcut } from '../../keyboard/shortcuts';

const HelpDialog: React.FC = () => {
  const closeOverlay = useUiStore((s) => s.closeOverlay);
  const closeRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();

  const dialogRef = useModalFocus<HTMLDivElement>({
    isOpen: true,
    onClose: () => closeOverlay('help'),
    initialFocusRef: closeRef,
  });

  // Group in order of first appearance in the registry.
  const groups: Array<{ name: string; rows: Shortcut[] }> = [];
  for (const entry of SHORTCUTS) {
    let group = groups.find((g) => g.name === entry.group);
    if (!group) {
      group = { name: entry.group, rows: [] };
      groups.push(group);
    }
    group.rows.push(entry);
  }

  return (
    <div
      data-testid="shortcut-help-backdrop"
      className="fixed inset-0 z-[500] bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={() => closeOverlay('help')}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-2xl bg-[#0d1322] border border-slate-800 rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]"
      >
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-800 bg-[#131b2e]">
          <h3 id={titleId} className="font-bold text-sm text-slate-100">
            Keyboard shortcuts
          </h3>
          <button
            ref={closeRef}
            type="button"
            aria-label="Close"
            title="Close (Esc)"
            onClick={() => closeOverlay('help')}
            className="text-slate-400 hover:text-slate-200 transition p-1 rounded-md hover:bg-slate-800/60"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="overflow-y-auto px-5 py-4 space-y-5">
          <p className="text-xs text-slate-400">
            Mod is Ctrl (Cmd on macOS). The global chords also work while a terminal has focus.
          </p>
          {groups.map((group) => (
            <section key={group.name}>
              <h4 className="text-[11px] font-semibold uppercase tracking-wider text-cyan-400 mb-2">{group.name}</h4>
              <dl className="space-y-1.5">
                {group.rows.map((row) => (
                  <div key={row.id} className="flex items-start justify-between gap-4 text-xs">
                    <dt className="text-slate-300">{row.description}</dt>
                    <dd className="shrink-0">
                      <kbd className="px-1.5 py-0.5 text-[10px] font-mono bg-slate-800/80 text-slate-300 border border-slate-700/80 rounded">
                        {formatKeys(row.keys)}
                      </kbd>
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
};

export const ShortcutHelp: React.FC = () => {
  const isOpen = useUiStore((s) => s.overlay === 'help');
  return isOpen ? <HelpDialog /> : null;
};
