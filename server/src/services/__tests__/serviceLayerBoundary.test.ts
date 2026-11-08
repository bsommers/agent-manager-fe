// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { AgentService } from '../AgentService.js';

const here = (name: string) => fileURLToPath(new URL(`../${name}`, import.meta.url));

function importsOf(file: string): string[] {
  const src = readFileSync(here(file), 'utf8');
  const out: string[] = [];
  for (const m of src.matchAll(/(?:^|\n)\s*(?:import|export)\s[^;]*?from\s+['"]([^'"]+)['"]/g)) out.push(m[1]);
  for (const m of src.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g)) out.push(m[1]);
  return out;
}

describe('service layer boundary', () => {
  it('SessionManager.ts imports AgentService', () => {
    expect(importsOf('SessionManager.ts'), 'SessionManager.ts must import ./AgentService.js').toContain(
      './AgentService.js'
    );
  });

  it.each(['./TmuxDriver.js', './SshDriver.js', './TmuxDiscovery.js', './tmuxKill.js'])(
    'SessionManager.ts must not value-import %s',
    (mod) => {
      const src = readFileSync(here('SessionManager.ts'), 'utf8');
      const valueImport = new RegExp(`import\\s+(?!type\\b)[^;]*from\\s+['"]${mod.replace('.', '\\.')}['"]`);
      expect(
        valueImport.test(src),
        `SessionManager.ts must not import ${mod} (rule: drivers and tmux live in AgentService)`
      ).toBe(false);
    }
  );

  it.each(['AgentService.ts', 'serviceResult.ts'])('%s imports no transport or SessionManager', (file) => {
    const forbidden = ['ws', 'express', 'http', 'node:http', 'node:https', './SessionManager.js'];
    const bad = importsOf(file).filter((m) => forbidden.includes(m) || m.startsWith('express/'));
    expect(bad, `${file} must not import a transport or SessionManager (found: ${bad.join(', ')})`).toEqual([]);
  });

  it('AgentService exposes the full operation set as own prototype methods', () => {
    const own = Object.getOwnPropertyNames(AgentService.prototype);
    for (const m of [
      'initialize',
      'list',
      'get',
      'count',
      'driverOf',
      'create',
      'close',
      'destroy',
      'input',
      'resize',
      'broadcast',
      'update',
    ]) {
      expect(own, `AgentService.prototype must define ${m}`).toContain(m);
    }
  });
});
