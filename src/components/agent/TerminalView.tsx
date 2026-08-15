import React, { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { agentSocket } from '../../services/agentSocket';

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

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();

    term.loadAddon(fitAddon);
    term.loadAddon(webLinksAddon);
    term.open(containerRef.current);
    fitAddon.fit();

    terminalRef.current = term;
    fitAddonRef.current = fitAddon;

    // Start mock output stream or listen for WS output
    agentSocket.startMockStream(agentId, agentName, mode, targetHost);

    const unsubscribe = agentSocket.subscribe((msg) => {
      if (msg.type === 'agent:output' && msg.agentId === agentId) {
        term.write(msg.data);
      }
    });

    // Handle user keystrokes in xterm
    term.onData((data) => {
      if (data === '\r') {
        // Enter pressed: send line to socket
        term.write('\r\n');
        const inputToSend = currentInputRef.current;
        currentInputRef.current = '';
        agentSocket.send({
          type: 'agent:input',
          agentId,
          data: inputToSend,
        });
      } else if (data === '\u007F') {
        // Backspace pressed
        if (currentInputRef.current.length > 0) {
          currentInputRef.current = currentInputRef.current.slice(0, -1);
          term.write('\b \b');
        }
      } else if (data >= ' ' || data === '\t') {
        currentInputRef.current += data;
        term.write(data);
      }
    });

    // Handle container resize
    const handleResize = () => {
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
      observer.disconnect();
      unsubscribe();
      agentSocket.stopMockStream(agentId);
      term.dispose();
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
