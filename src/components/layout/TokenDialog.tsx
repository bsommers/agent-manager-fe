import React, { useRef, useState } from 'react';
import { KeyRound } from 'lucide-react';
import { useUiStore } from '../../store/uiStore';
import { useConnectionStore } from '../../store/connectionStore';
import { useModalFocus } from '../../hooks/useModalFocus';
import { submitToken } from '../../services/session/submitToken';
import { OverlayPortal } from './OverlayPortal';

/** The typed value lives only in this component's state, which is discarded when the dialog closes. */
const TokenDialogBody: React.FC = () => {
  const closeOverlay = useUiStore((s) => s.closeOverlay);
  const failed = useConnectionStore((s) => s.state === 'auth_failed');
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const close = () => closeOverlay('token');
  const dialogRef = useModalFocus<HTMLDivElement>({ isOpen: true, onClose: close, initialFocusRef: inputRef });
  const titleId = React.useId();
  const inputId = React.useId();
  const errorId = React.useId();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const r = submitToken(value);
    if (!r.ok) {
      setError(r.reason);
      return;
    }
    setValue('');
    close();
  };

  return (
    <OverlayPortal>
      <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          className="w-full max-w-md bg-[#0d1322] border border-slate-800 rounded-xl shadow-2xl overflow-hidden"
        >
          <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-800 bg-[#131b2e]">
            <KeyRound className="w-4 h-4 text-cyan-400" />
            <h3 id={titleId} className="font-bold text-sm text-slate-200">Authentication required</h3>
          </div>

          <form onSubmit={handleSubmit} className="p-4 space-y-4 text-xs" autoComplete="off">
            <p className="text-slate-400">
              This gateway needs an access token. It is kept in this tab only and cleared on logout or when the
              tab closes.
            </p>
            {failed && (
              <p className="text-red-300" role="status">
                Authentication failed
              </p>
            )}
            <div>
              <label htmlFor={inputId} className="block text-slate-400 mb-1 font-medium">Access token</label>
              <input
                id={inputId}
                ref={inputRef}
                type="password"
                autoComplete="off"
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
                aria-describedby={error ? errorId : undefined}
                aria-invalid={error ? true : undefined}
                value={value}
                onChange={(e) => {
                  setValue(e.target.value);
                  if (error) setError(null);
                }}
                className="w-full bg-[#090d16] border border-slate-800 rounded-md px-3 py-2 text-slate-100 font-mono focus:outline-none focus:border-cyan-500"
              />
              {error && (
                <p id={errorId} role="alert" className="mt-1 text-red-300">
                  {error}
                </p>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-800/80">
              <button
                type="button"
                onClick={close}
                className="px-3 py-1.5 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-300"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-3 py-1.5 rounded-md bg-cyan-600 hover:bg-cyan-500 text-white font-medium"
              >
                Connect
              </button>
            </div>
          </form>
        </div>
      </div>
    </OverlayPortal>
  );
};

export const TokenDialog: React.FC = () => {
  const isOpen = useUiStore((s) => s.overlay === 'token');
  return isOpen ? <TokenDialogBody /> : null;
};
