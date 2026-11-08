import React, { useState, useRef, useId } from 'react';
import { Agent } from '../../types/agent';
import { AgentPane } from '../agent/AgentPane';
import { useAgentStore, agentStore } from '../../store/agentStore';
import { clampPaneZ } from '../../styles/zLayers';
import {
  PANE_MIN_X,
  PANE_MIN_Y,
  PANE_MIN_WIDTH,
  PANE_MIN_HEIGHT,
  isArrowKey,
  movePane,
  resizePane,
} from './paneKeyboard';

interface FloatingPaneProps {
  agent: Agent;
}

export const FloatingPane: React.FC<FloatingPaneProps> = ({ agent }) => {
  const { bringToFront, updateFloatingPosition } = useAgentStore();
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<{ x: number; y: number; posX: number; posY: number }>({
    x: 0,
    y: 0,
    posX: agent.layout.x || 120,
    posY: agent.layout.y || 120,
  });

  const moveHintId = useId();
  const resizeHintId = useId();

  const latestLayout = () =>
    useAgentStore.getState().agents.find((a) => a.id === agent.id)?.layout ?? agent.layout;

  // Keyboard move/resize deliberately never call bringToFront or setActiveAgentId:
  // that would activate the pane and TerminalView would pull focus into the terminal.
  const handleMoveKeyDown = (e: React.KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey || !isArrowKey(e.key)) return;
    e.preventDefault();
    const layout = latestLayout();
    const next = movePane({ x: layout.x || 120, y: layout.y || 120 }, e.key, e.shiftKey);
    updateFloatingPosition(agent.id, next.x, next.y);
  };

  const handleResizeKeyDown = (e: React.KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey || !isArrowKey(e.key)) return;
    e.preventDefault();
    e.stopPropagation();
    const layout = latestLayout();
    const next = resizePane(
      { width: layout.width || 650, height: layout.height || 400 },
      e.key,
      e.shiftKey
    );
    agentStore.updateFloatingBounds(
      agent.id,
      layout.x || 120,
      layout.y || 120,
      next.width,
      next.height
    );
  };

  const activeListenersRef = useRef<{ move: (e: MouseEvent) => void; up: () => void } | null>(null);

  React.useEffect(() => {
    return () => {
      if (activeListenersRef.current) {
        window.removeEventListener('mousemove', activeListenersRef.current.move);
        window.removeEventListener('mouseup', activeListenersRef.current.up);
      }
    };
  }, []);

  const handleMouseDown = (e: React.MouseEvent) => {
    bringToFront(agent.id);
    setIsDragging(true);
    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      posX: agent.layout.x || 120,
      posY: agent.layout.y || 120,
    };

    const handleMouseMove = (moveEvt: MouseEvent) => {
      const dx = moveEvt.clientX - dragStartRef.current.x;
      const dy = moveEvt.clientY - dragStartRef.current.y;
      updateFloatingPosition(
        agent.id,
        Math.max(PANE_MIN_X, dragStartRef.current.posX + dx),
        Math.max(PANE_MIN_Y, dragStartRef.current.posY + dy)
      );
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      activeListenersRef.current = null;
    };

    activeListenersRef.current = { move: handleMouseMove, up: handleMouseUp };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  const handleResizeMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation();
    bringToFront(agent.id);
    const startX = e.clientX;
    const startY = e.clientY;
    const startW = agent.layout.width || 650;
    const startH = agent.layout.height || 400;

    const handleMouseMove = (moveEvt: MouseEvent) => {
      const dw = moveEvt.clientX - startX;
      const dh = moveEvt.clientY - startY;
      const newW = Math.max(PANE_MIN_WIDTH, startW + dw);
      const newH = Math.max(PANE_MIN_HEIGHT, startH + dh);
      agentStore.updateFloatingBounds(
        agent.id,
        agent.layout.x || 120,
        agent.layout.y || 120,
        newW,
        newH
      );
    };

    const handleMouseUp = () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      activeListenersRef.current = null;
    };

    activeListenersRef.current = { move: handleMouseMove, up: handleMouseUp };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  return (
    <div
      style={{
        position: 'absolute',
        left: `${agent.layout.x || 120}px`,
        top: `${agent.layout.y || 120}px`,
        width: `${agent.layout.width || 650}px`,
        height: `${agent.layout.height || 400}px`,
        zIndex: clampPaneZ(agent.layout.zIndex),
      }}
      className={`flex flex-col shadow-2xl rounded-lg overflow-hidden border border-cyan-500/40 backdrop-blur-md bg-[#0d1322]/95 relative transition-shadow ${
        isDragging ? 'opacity-90 cursor-grabbing shadow-cyan-500/20' : ''
      }`}
    >
      {/* Draggable header drag handle */}
      <div
        onMouseDown={handleMouseDown}
        onKeyDown={handleMoveKeyDown}
        role="button"
        tabIndex={0}
        aria-label={`Move pane ${agent.name}`}
        aria-describedby={moveHintId}
        className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 bg-slate-900/90 hover:bg-slate-800/90 cursor-grab px-3 py-1.5 border-b border-slate-800 flex items-center justify-between text-xs font-mono text-cyan-400 select-none"
      >
        <span>⚡ PANE [{agent.name}]</span>
        <span className="text-[10px] text-slate-500">Drag to move</span>
        <span id={moveHintId} className="sr-only">
          Use the arrow keys to move this pane. Hold Shift for larger steps.
        </span>
      </div>

      <div className="flex-1 overflow-hidden">
        <AgentPane agent={agent} />
      </div>

      {/* Resize Handle at Bottom-Right Corner */}
      <div
        onMouseDown={handleResizeMouseDown}
        onKeyDown={handleResizeKeyDown}
        role="button"
        tabIndex={0}
        aria-label={`Resize pane ${agent.name}`}
        aria-describedby={resizeHintId}
        className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 absolute bottom-0 right-0 w-4 h-4 cursor-se-resize flex items-center justify-center z-50 text-slate-500 hover:text-cyan-400"
        title="Resize window"
      >
        <span id={resizeHintId} className="sr-only">
          Use the arrow keys to resize this pane. Hold Shift for larger steps.
        </span>
        <svg
          className="w-3 h-3"
          viewBox="0 0 6 6"
          fill="currentColor"
          aria-hidden="true"
          focusable="false"
        >
          <circle cx="5" cy="5" r="0.8" />
          <circle cx="5" cy="2" r="0.8" />
          <circle cx="2" cy="5" r="0.8" />
        </svg>
      </div>
    </div>
  );
};
