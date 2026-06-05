// claude/scripts/lib/gws-sheet-edit.test.ts
import { test } from 'node:test';
import assert from 'node:assert';
import { parseValues } from './gws-sheet-edit';

test('parseValues parses a 2-D JSON array', () => {
  assert.deepEqual(parseValues('[["a","b"],["c","d"]]'), [['a', 'b'], ['c', 'd']]);
});

test('parseValues wraps a flat JSON array into rows', () => {
  assert.deepEqual(parseValues('["a","b"]'), [['a'], ['b']]);
});

test('parseValues parses CSV lines', () => {
  assert.deepEqual(parseValues('a,b\nc,d'), [['a', 'b'], ['c', 'd']]);
});
