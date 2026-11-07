import { useAgentStore } from '../store/agentStore';

export interface Command {
  id: string;
  title: string;
  keywords: string;
  hint?: string;
  run: () => void;
}

export const MAX_PALETTE_RESULTS = 50;

export function buildCommands(): Command[] {
  const agents = useAgentStore.getState();
  return [
    { id: 'layout.grid', title: 'Layout: Grid', keywords: 'arrange tile snap', run: () => agents.arrangeGrid() },
    { id: 'layout.focus', title: 'Layout: Focus', keywords: 'arrange maximize', run: () => agents.arrangeFocus() },
    { id: 'layout.cascade', title: 'Layout: Cascade', keywords: 'arrange stack', run: () => agents.arrangeCascade() },
  ];
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
