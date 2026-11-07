import { describe, it, expect } from 'vitest';
import { filterCommands, MAX_PALETTE_RESULTS, type Command } from '../commands';

const cmd = (id: string, title: string, keywords = ''): Command => ({ id, title, keywords, run: () => {} });

describe('filterCommands', () => {
  const list = [
    cmd('a', 'Layout: Grid', 'arrange tile'),
    cmd('b', 'Search agent output', 'global logs'),
    cmd('c', 'Go to build box', 'agent terminal'),
    cmd('d', 'Filter agents', 'search roster'),
  ];

  it('returns every command in order for an empty query', () => {
    expect(filterCommands(list, '').map((c) => c.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(filterCommands(list, '   ').map((c) => c.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('requires every token to appear in title plus keywords, case-insensitively', () => {
    expect(filterCommands(list, 'LAYOUT tile').map((c) => c.id)).toEqual(['a']);
    expect(filterCommands(list, 'layout nothing')).toEqual([]);
  });

  it('ranks title-prefix before title-substring before keyword-only, stable within a rank', () => {
    const ranked = filterCommands(list, 'search').map((c) => c.id);
    // prefix: b (Search agent output); keyword-only: d (Filter agents, keyword "search")
    expect(ranked).toEqual(['b', 'd']);
    const sub = [cmd('x', 'Go to agent', ''), cmd('y', 'Agent first', ''), cmd('z', 'Other', 'agent')];
    expect(filterCommands(sub, 'agent').map((c) => c.id)).toEqual(['y', 'x', 'z']);
  });

  it('keeps original order within a rank', () => {
    const same = [cmd('1', 'Go one', ''), cmd('2', 'Go two', ''), cmd('3', 'Go three', '')];
    expect(filterCommands(same, 'go').map((c) => c.id)).toEqual(['1', '2', '3']);
  });

  it('caps results at MAX_PALETTE_RESULTS', () => {
    expect(MAX_PALETTE_RESULTS).toBe(50);
    const many = Array.from({ length: 120 }, (_, i) => cmd(`c${i}`, `Go to ${i}`));
    expect(filterCommands(many, '')).toHaveLength(50);
    expect(filterCommands(many, 'go')).toHaveLength(50);
    expect(filterCommands(many, '', 5)).toHaveLength(5);
  });
});
