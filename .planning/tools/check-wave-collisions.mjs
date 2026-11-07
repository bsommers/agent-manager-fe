#!/usr/bin/env node
// Wave file-ownership checker for GSD plans.
//
// Usage: node .planning/tools/check-wave-collisions.mjs [--wave N] [--pending]
//   --wave N    only check plans whose frontmatter `wave` equals N
//   --pending   skip plans that already have a *-SUMMARY.md (already executed and merged)
//
// Checks (exit 1 on any failure):
//   1. Same-wave plans own disjoint files (frontmatter files_modified). Entries ending in
//      "/**" claim a whole directory subtree.
//   2. Every <files> path in a plan's tasks is listed in that plan's files_modified.
//   3. A plan's wave is greater than the wave of every plan in depends_on.
//   4. Shared hot files (package.json, lockfiles, configs, setupTests, App.tsx, Header.tsx,
//      Toolbar.tsx) are owned by at most one plan per wave (a subset of check 1, reported
//      separately so the reason is obvious).
// Read-only: it only reads .planning/phases/*/*-PLAN.md.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const phasesDir = join(root, '.planning', 'phases');
const args = process.argv.slice(2);
const waveArg = args.includes('--wave') ? Number(args[args.indexOf('--wave') + 1]) : null;
const pendingOnly = args.includes('--pending');

const HOT = [
  /(^|\/)package\.json$/,
  /(^|\/)package-lock\.json$/,
  /(^|\/)tsconfig[^/]*\.json$/,
  /(^|\/)vite\.config\.ts$/,
  /(^|\/)vitest\.config\.ts$/,
  /(^|\/)tailwind\.config\.js$/,
  /(^|\/)postcss\.config\.js$/,
  /(^|\/)setupTests\.ts$/,
  /(^|\/)vite-env\.d\.ts$/,
  /(^|\/)src\/App\.tsx$/,
  /(^|\/)Header\.tsx$/,
  /(^|\/)Toolbar\.tsx$/,
  /\.github\/workflows\//,
];

function frontmatter(text) {
  const m = /^---\n([\s\S]*?)\n---/.exec(text);
  if (!m) return null;
  const lines = m[1].split('\n');
  const out = {};
  let key = null;
  for (const line of lines) {
    const kv = /^([A-Za-z_][\w]*):\s*(.*)$/.exec(line);
    if (kv && !line.startsWith(' ') && !line.startsWith('-')) {
      key = kv[1];
      const v = kv[2].replace(/\s+#.*$/, '').trim();
      if (v === '') out[key] = [];
      else if (v.startsWith('[')) {
        out[key] = v
          .slice(1, v.lastIndexOf(']'))
          .split(',')
          .map((s) => s.trim().replace(/^["']|["']$/g, ''))
          .filter(Boolean);
      } else out[key] = v.replace(/^["']|["']$/g, '');
      continue;
    }
    const item = /^\s*-\s+(.*)$/.exec(line);
    if (item && key && Array.isArray(out[key])) {
      out[key].push(item[1].replace(/\s+#.*$/, '').trim().replace(/^["']|["']$/g, ''));
    }
  }
  return out;
}

function taskFiles(text) {
  const files = [];
  for (const m of text.matchAll(/<files>([\s\S]*?)<\/files>/g)) {
    for (const f of m[1].split(/[,\n]/)) {
      const t = f.trim();
      if (t) files.push(t);
    }
  }
  return files;
}

const plans = [];
for (const dir of readdirSync(phasesDir)) {
  const full = join(phasesDir, dir);
  for (const f of readdirSync(full)) {
    const m = /^(\d+(?:\.\d+)?)-(\d+)-PLAN\.md$/.exec(f);
    if (!m) continue;
    const text = readFileSync(join(full, f), 'utf8');
    const fm = frontmatter(text);
    if (!fm) {
      console.error(`FAIL ${f}: no frontmatter`);
      process.exitCode = 1;
      continue;
    }
    const id = `${m[1]}-${m[2]}`;
    const executed = existsSync(join(full, `${m[1]}-${m[2]}-SUMMARY.md`));
    plans.push({
      id,
      wave: Number(fm.wave),
      depends: Array.isArray(fm.depends_on) ? fm.depends_on : [],
      files: Array.isArray(fm.files_modified) ? fm.files_modified : [],
      tasks: taskFiles(text),
      executed,
    });
  }
}

let failures = 0;
const fail = (msg) => {
  failures++;
  console.error(`FAIL ${msg}`);
};

const claims = (entry, path) =>
  entry === path || (entry.endsWith('/**') && path.startsWith(entry.slice(0, -2)));
const overlap = (a, b) =>
  [...a.files, ...b.files].some(
    (p) => a.files.some((x) => claims(x, p)) && b.files.some((y) => claims(y, p)),
  );
const overlapList = (a, b) => {
  const hits = new Set();
  for (const x of a.files) for (const y of b.files) {
    if (claims(x, y) || claims(y, x)) hits.add(x.length >= y.length ? x : y);
  }
  return [...hits];
};

const considered = plans.filter(
  (p) => (waveArg === null || p.wave === waveArg) && !(pendingOnly && p.executed),
);

for (const p of considered) {
  for (const t of p.tasks) {
    if (!p.files.some((x) => claims(x, t))) fail(`${p.id}: task <files> path not in files_modified: ${t}`);
  }
  for (const d of p.depends) {
    const dep = plans.find((q) => q.id === d);
    if (!dep) fail(`${p.id}: depends_on ${d} does not exist`);
    else if (dep.wave >= p.wave) fail(`${p.id} (wave ${p.wave}): depends on ${d} in wave ${dep.wave}`);
  }
}

const byWave = new Map();
for (const p of considered) byWave.set(p.wave, [...(byWave.get(p.wave) ?? []), p]);
for (const [wave, ps] of [...byWave.entries()].sort((a, b) => a[0] - b[0])) {
  for (let i = 0; i < ps.length; i++) {
    for (let j = i + 1; j < ps.length; j++) {
      if (!overlap(ps[i], ps[j])) continue;
      const hits = overlapList(ps[i], ps[j]);
      const hot = hits.filter((h) => HOT.some((re) => re.test(h)));
      fail(
        `wave ${wave}: ${ps[i].id} and ${ps[j].id} both own ${hits.join(', ')}` +
          (hot.length ? ` (shared hot file: ${hot.join(', ')})` : ''),
      );
    }
  }
  console.log(`wave ${wave}: ${ps.map((p) => p.id).join(', ')}`);
}

if (failures === 0) console.log('OK: disjoint ownership, task files covered, dependencies ordered');
else console.error(`${failures} problem(s)`);
process.exit(failures === 0 ? 0 : 1);
