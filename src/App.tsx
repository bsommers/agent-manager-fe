import React, { useEffect } from 'react';
import { Header } from './components/layout/Header';
import { ConnectionBanner } from './components/layout/ConnectionBanner';
import { Toolbar } from './components/layout/Toolbar';
import { Workspace } from './components/layout/Workspace';
import { AddAgentModal } from './components/agent/AddAgentModal';
import { NotificationToastManager } from './components/layout/NotificationToastManager';
import { CommandPalette } from './components/layout/CommandPalette';
import { ShortcutHelp } from './components/layout/ShortcutHelp';
import { useUiStore } from './store/uiStore';

export default function App() {
  const isAddModalOpen = useUiStore((s) => s.overlay === 'addAgent');
  const openOverlay = useUiStore((s) => s.openOverlay);
  const closeOverlay = useUiStore((s) => s.closeOverlay);

  // Do not leak an open overlay across mounts.
  useEffect(() => () => useUiStore.getState().closeOverlay(), []);

  return (
    <div className="h-screen w-screen flex flex-col bg-[#090d16] text-slate-100 overflow-hidden">
      <Header />
      <ConnectionBanner />
      <Toolbar onOpenAddModal={() => openOverlay('addAgent')} />
      <Workspace />
      <AddAgentModal isOpen={isAddModalOpen} onClose={() => closeOverlay('addAgent')} />
      <CommandPalette />
      <ShortcutHelp />
      <NotificationToastManager />
    </div>
  );
}
