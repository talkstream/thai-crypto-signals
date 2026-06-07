#!/usr/bin/env node
// Guard: the coverage exclude list must stay EXACTLY these entries, so coverage can never be
// silently widened to hide untested code. The signals entries carve out only the genuinely DEAD
// producer-side scaffold (zero runtime callers, frozen phase-2, type-checked via
// src/signals/contract.ts). The LIVE consumer (src/signals/consumer.ts) is intentionally NOT here —
// it is covered by a real test. Changing this list requires editing this guard too: no silent widening.

import { readFileSync } from 'node:fs';

const EXPECTED = [
  'src/adapters/bitkub/cassettes/**',
  'src/spike/**',
  'worker-configuration.d.ts',
  'test/**',
  'src/signals/producer.ts',
  'src/signals/indicators.ts',
  'src/signals/notifier.ts',
  'src/adapters/signals/queue-dispatcher.ts',
];

const config = readFileSync('vitest.config.ts', 'utf8');
const block = config.match(/exclude:\s*\[([\s\S]*?)\]/);
if (!block) {
  console.error('guard:coverage-exclude — could not find coverage.exclude in vitest.config.ts');
  process.exit(1);
}
const found = [...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);

const expectedSet = new Set(EXPECTED);
const foundSet = new Set(found);
const ok =
  found.length === EXPECTED.length &&
  EXPECTED.every((e) => foundSet.has(e)) &&
  found.every((f) => expectedSet.has(f));

if (!ok) {
  console.error('guard:coverage-exclude — exclude list drifted.');
  console.error(`  expected: ${EXPECTED.join(', ')}`);
  console.error(`  found:    ${found.join(', ')}`);
  process.exit(1);
}
console.log(`guard:coverage-exclude — ok (exactly ${EXPECTED.length} expected entries)`);
