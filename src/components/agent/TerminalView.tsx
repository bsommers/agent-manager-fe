import React, { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { agentSocket } from '../../services/agentSocket';
import { matchGlobalShortcut } from '../../keyboard/shortcuts';
import { useFocusRequest } from '../../keyboard/hooks';
import { suppressTerminalReports } from './terminalReports';
import { disposeTerminal } from './terminalDispose';

interface TerminalViewProps {
  agentId: string;
  agentName: string;
  mode: string;
  targetHost: string;
  isActive: boolean;
}

export const TerminalView: React.FC<TerminalViewProps> = ({
  agentId,
  agentName,
  mode,
  targetHost,
  isActive,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const currentInputRef = useRef<string>('');

  useFocusRequest(`terminal:${agentId}`, () => terminalRef.current?.focus());

  useEffect(() => {
    if (!containerRef.current) return;

    // Initialize xterm terminal instance
    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: 'block',
      fontSize: 13,
      fontFamily: "'JetBrains Mono', monospace",
      theme: {
        background: '#0d1322',
        foreground: '#f1f5f9',
        cursor: '#00f2fe',
        selectionBackground: '#1e293b',
        black: '#0f172a',
        red: '#ef4444',
        green: '#10b981',
        yellow: '#f59e0b',
        blue: '#3b82f6',
        magenta: '#a855f7',
        cyan: '#06b6d4',
        white: '#f8fafc',
      },
      convertEol: true,
    });

    // Never let xterm type its own answers to terminal queries into the shell (QA-01).
    suppressTerminalReports(term);

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();

    term.loadAddon(fitAddon);
    term.loadAddon(webLinksAddon);
    term.open(containerRef.current);
    fitAddon.fit();

    // Accessible name for the terminal's input element.
    if (term.textarea) {
      term.textarea.setAttribute('aria-label', `Terminal input: ${agentName}`);
    }
    // Registered global chords (Ctrl+K, Ctrl+Shift+F, Ctrl+/) are withheld from the program so they
    // bubble to the window listener; every other key still reaches the terminal.
    if (typeof term.attachCustomKeyEventHandler === 'function') {
      term.attachCustomKeyEventHandler((event: KeyboardEvent) => matchGlobalShortcut(event) === null);
    }

    terminalRef.current = term;
    fitAddonRef.current = fitAddon;

    // Start mock output stream or listen for WS output
    agentSocket.startMockStream(agentId, agentName, mode, targetHost);

    const unsubscribe = agentSocket.subscribe((msg) => {
      if (msg.type === 'agent:output' && msg.agentId === agentId) {
        term.write(msg.data);
      }
    });

    // Handle user keystrokes in xterm: forward raw PTY stream data directly to socket
    term.onData((data) => {
      agentSocket.send({
        type: 'agent:input',
        agentId,
        data,
      });
    });

    // Handle container resize
    let disposed = false;
    const handleResize = () => {
      if (disposed) return;
      try {
        fitAddon.fit();
        if (term.cols && term.rows) {
          agentSocket.send({
            type: 'agent:resize',
            agentId,
            cols: term.cols,
            rows: term.rows,
          });
        }
      } catch (err) {
        // Ignore container zero height during layout transition
      }
    };

    const observer = new ResizeObserver(() => handleResize());
    observer.observe(containerRef.current);

    return () => {
      disposed = true;
      observer.disconnect();
      unsubscribe();
      agentSocket.stopMockStream(agentId);
      // Drop the refs so the isActive effect never fits or focuses a disposed terminal.
      if (terminalRef.current === term) terminalRef.current = null;
      if (fitAddonRef.current === fitAddon) fitAddonRef.current = null;
      // Not term.dispose(): xterm 5.5 leaves a Viewport timer that throws after disposal.
      disposeTerminal(term);
    };
  }, [agentId, agentName, mode, targetHost]);

  useEffect(() => {
    if (isActive && fitAddonRef.current && terminalRef.current) {
      const timerId = setTimeout(() => {
        fitAddonRef.current?.fit();
        terminalRef.current?.focus();
      }, 50);
      return () => clearTimeout(timerId);
    }
    return undefined;
  }, [isActive]);

  return <div ref={containerRef} className="w-full h-full min-h-[180px] bg-[#0d1322] rounded-b-lg" />;
};
