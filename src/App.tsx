import React, { useEffect, useState } from 'react';
import { Header } from './components/layout/Header';
import { ConnectionBanner } from './components/layout/ConnectionBanner';
import { Toolbar } from './components/layout/Toolbar';
import { Workspace } from './components/layout/Workspace';
import { AddAgentModal } from './components/agent/AddAgentModal';
import { NotificationToastManager } from './components/layout/NotificationToastManager';
import { CommandPalette } from './components/layout/CommandPalette';
import { useUiStore } from './store/uiStore';

export default function App() {
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);

  // Do not leak an open overlay across mounts.
  useEffect(() => () => useUiStore.getState().closeOverlay(), []);

  return (
    <div className="h-screen w-screen flex flex-col bg-[#090d16] text-slate-100 overflow-hidden">
      <Header />
      <ConnectionBanner />
      <Toolbar onOpenAddModal={() => setIsAddModalOpen(true)} />
      <Workspace />
      <AddAgentModal isOpen={isAddModalOpen} onClose={() => setIsAddModalOpen(false)} />
      <CommandPalette />
      <NotificationToastManager />
    </div>
  );
}
