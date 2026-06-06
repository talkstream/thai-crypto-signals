#!/usr/bin/env node
// Guard: wall-clock and randomness may only appear in the runtime adapter. Everything else
// takes Clock/Rng by injection so behaviour stays deterministic and testable.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = 'src';
const ALLOWED = new Set(['src/adapters/runtime.ts']);
const SKIP_DIRS = new Set(['cassettes']);
const BANNED = [
  { re: /\bDate\.now\s*\(/, what: 'Date.now()' },
  { re: /\bnew\s+Date\s*\(/, what: 'new Date()' },
  { re: /\bMath\.random\s*\(/, what: 'Math.random()' },
  { re: /unixepoch\s*\(\s*'now'/i, what: "unixepoch('now')" },
  { re: /datetime\s*\(\s*'now'/i, what: "datetime('now')" },
];

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (!SKIP_DIRS.has(name)) out.push(...walk(p));
    } else if (p.endsWith('.ts')) {
      out.push(p);
    }
  }
  return out;
}

const violations = [];
for (const file of walk(ROOT)) {
  if (ALLOWED.has(file)) continue;
  const text = readFileSync(file, 'utf8');
  for (const { re, what } of BANNED) {
    if (re.test(text)) violations.push(`${file}: ${what}`);
  }
}

if (violations.length > 0) {
  console.error('guard:clock — wall-clock/randomness outside the runtime adapter:');
  for (const v of violations) console.error(`  ${v}`);
  console.error(`Inject Clock/Rng instead. Allowed only in: ${[...ALLOWED].join(', ')}`);
  process.exit(1);
}
console.log('guard:clock — ok (no wall-clock/randomness outside the runtime adapter)');
