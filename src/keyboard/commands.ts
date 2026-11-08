import { useAgentStore } from '../store/agentStore';
import { useUiStore } from '../store/uiStore';
import { SHORTCUTS, formatKeys } from './shortcuts';

export interface Command {
  id: string;
  title: string;
  keywords: string;
  hint?: string;
  run: () => void;
}

export const MAX_PALETTE_RESULTS = 50;

function hintFor(shortcutId: string): string | undefined {
  const entry = SHORTCUTS.find((s) => s.id === shortcutId);
  return entry ? formatKeys(entry.keys) : undefined;
}

/**
 * Builds the palette command list from live store state. Deliberately contains no
 * destructive command: nothing kills or closes an agent, sends terminal input or
 * sends a broadcast (threat T-05-05).
 */
export function buildCommands(): Command[] {
  const agentState = useAgentStore.getState();
  const ui = useUiStore.getState;

  const commands: Command[] = [
    {
      id: 'agent.new',
      title: 'New agent',
      keywords: 'add create',
      run: () => ui().openOverlay('addAgent'),
    },
    {
      id: 'broadcast.open',
      title: 'Broadcast to agents',
      keywords: 'fan-out send command all',
      run: () => {
        ui().setBroadcastOpen(true);
        ui().requestFocus('broadcast');
      },
    },
    {
      id: 'search.open',
      title: 'Search agent output',
      keywords: 'global logs output find',
      hint: hintFor('search.toggle'),
      run: () => ui().openOverlay('search'),
    },
    {
      id: 'filter.focus',
      title: 'Filter agents',
      keywords: 'search roster name host',
      run: () => ui().requestFocus('agent-filter'),
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
