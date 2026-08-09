import React, { useState, useRef } from 'react';
import { Agent } from '../../types/agent';
import { AgentPane } from '../agent/AgentPane';
import { useAgentStore } from '../../store/agentStore';

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
        Math.max(10, dragStartRef.current.posX + dx),
        Math.max(50, dragStartRef.current.posY + dy)
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

  return (
    <div
      style={{
        position: 'absolute',
        left: `${agent.layout.x || 120}px`,
        top: `${agent.layout.y || 120}px`,
        width: `${agent.layout.width || 650}px`,
        height: `${agent.layout.height || 400}px`,
        zIndex: agent.layout.zIndex || 100,
      }}
      className={`flex flex-col shadow-2xl rounded-lg overflow-hidden border border-cyan-500/40 backdrop-blur-md bg-[#0d1322]/95 ${
        isDragging ? 'opacity-90 cursor-grabbing' : ''
      }`}
    >
      {/* Draggable header drag handle */}
      <div
        onMouseDown={handleMouseDown}
        className="bg-slate-900/90 hover:bg-slate-800/90 cursor-grab px-3 py-1.5 border-b border-slate-800 flex items-center justify-between text-xs font-mono text-cyan-400 select-none"
      >
        <span>⚡ FLOATING PANE [{agent.name}]</span>
        <span className="text-[10px] text-slate-500">Drag to move</span>
      </div>

      <div className="flex-1 overflow-hidden">
        <AgentPane agent={agent} />
      </div>
    </div>
  );
};
