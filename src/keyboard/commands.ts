import { OPERATIONS } from '@agent-manager/protocol';
import type { OperationName, PaletteOperationName } from '@agent-manager/protocol';
import { useAgentStore } from '../store/agentStore';
import { useUiStore } from '../store/uiStore';
import { SHORTCUTS, formatKeys } from './shortcuts';

export interface Command {
  id: string;
  title: string;
  keywords: string;
  hint?: string;
  /** The catalog operation this command performs; absent for UI-only commands. */
  operation?: OperationName;
  run: () => void;
}

export const MAX_PALETTE_RESULTS = 50;

function hintFor(shortcutId: string): string | undefined {
  const entry = SHORTCUTS.find((s) => s.id === shortcutId);
  return entry ? formatKeys(entry.keys) : undefined;
}

type OperationCommandText = Omit<Command, 'id' | 'operation'>;

/**
 * FE-owned text and behavior of the palette commands that perform a catalog operation. Keyed by the operations
 * that have a palette binding, so adding a binding in the catalog without a command here is a compile error.
 * The command id comes from the catalog binding.
 */
const OPERATION_COMMANDS: Record<PaletteOperationName, OperationCommandText> = {
  'agent.create': {
    title: 'New agent',
    keywords: 'add create',
    run: () => useUiStore.getState().openOverlay('addAgent'),
  },
  'agent.broadcast': {
    title: 'Broadcast to agents',
    keywords: 'fan-out send command all',
    run: () => {
      const ui = useUiStore.getState;
      ui().setBroadcastOpen(true);
      ui().requestFocus('broadcast');
    },
  },
  'search.query': {
    title: 'Search agent output',
    keywords: 'global logs output find',
    hint: hintFor('search.toggle'),
    run: () => useUiStore.getState().openOverlay('search'),
  },
};

function operationCommand(operation: PaletteOperationName): Command {
  const binding = OPERATIONS[operation].palette;
  return { id: binding.id, operation, ...OPERATION_COMMANDS[operation] };
}

/**
 * Builds the palette command list from live store state. Destructive operations are excluded by the catalog
 * invariant (a destructive operation has no palette binding), not by convention (threat T-05-05).
 */
export function buildCommands(): Command[] {
  const agentState = useAgentStore.getState();
  const ui = useUiStore.getState;

  const commands: Command[] = [
    operationCommand('agent.create'),
    operationCommand('agent.broadcast'),
    operationCommand('search.query'),
    {
      id: 'filter.focus',
      title: 'Filter agents',
      keywords: 'search roster name host',
      run: () => ui().requestFocus('agent-filter'),
    },
    {
      id: 'help.open',
      title: 'Show keyboard shortcuts',
      keywords: 'help keys bindings hotkeys',
      hint: hintFor('help.toggle'),
      run: () => ui().openOverlay('help'),
    },
    {
      id: 'layout.grid',
      title: 'Layout: Grid',
      keywords: 'arrange tile snap',
      run: () => useAgentStore.getState().arrangeGrid(),
    },
    {
      id: 'layout.focus',
      title: 'Layout: Focus',
      keywords: 'arrange maximize',
      run: () => useAgentStore.getState().arrangeFocus(),
    },
    {
      id: 'layout.cascade',
      title: 'Layout: Cascade',
      keywords: 'arrange stack',
      run: () => useAgentStore.getState().arrangeCascade(),
    },
  ];

  for (const agent of agentState.agents) {
    if (Object.prototype.hasOwnProperty.call(agentState.pending, agent.id)) continue;
    commands.push({
      id: `agent.goto.${agent.id}`,
      title: `Go to ${agent.name}`,
      keywords: `${agent.mode} ${agent.targetHost} ${agent.status} agent terminal`,
      run: () => {
        const store = useAgentStore.getState();
        store.setActiveAgentId(agent.id);
        store.bringToFront(agent.id);
        ui().requestFocus(`terminal:${agent.id}`);
      },
    });
  }

  return commands;
}

/**
 * Filters commands: every whitespace-separated token must appear in title plus keywords.
 * Title-prefix matches rank before title-substring matches before keyword-only matches.
 */
export function filterCommands(commands: Command[], query: string, limit: number = MAX_PALETTE_RESULTS): Command[] {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return commands.slice(0, limit);

  const ranked: Array<{ cmd: Command; rank: number }> = [];
  for (const cmd of commands) {
    const title = cmd.title.toLowerCase();
    const haystack = `${title} ${cmd.keywords.toLowerCase()}`;
    if (!tokens.every((t) => haystack.includes(t))) continue;
    const inTitle = tokens.every((t) => title.includes(t));
    const rank = inTitle && title.startsWith(tokens[0]) ? 0 : inTitle ? 1 : 2;
    ranked.push({ cmd, rank });
  }
  // Array.prototype.sort is stable, so original order is kept within a rank.
  ranked.sort((a, b) => a.rank - b.rank);
  return ranked.slice(0, limit).map((r) => r.cmd);
}
