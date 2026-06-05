// claude/scripts/lib/gws.test.ts
import { test } from 'node:test';
import assert from 'node:assert';
import { stripGwsNoise } from './gws';

test('stripGwsNoise removes keyring backend lines', () => {
  const raw = 'Using keyring backend: keyring\n{"a":1}';
  assert.equal(stripGwsNoise(raw), '{"a":1}');
});

test('stripGwsNoise leaves clean JSON untouched', () => {
  assert.equal(stripGwsNoise('{"a":1}'), '{"a":1}');
});
