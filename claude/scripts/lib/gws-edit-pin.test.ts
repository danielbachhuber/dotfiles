// claude/scripts/lib/gws-edit-pin.test.ts
import { test } from 'node:test';
import assert from 'node:assert';
import { deriveAlias } from './gws-edit-pin';

test('deriveAlias kebab-cases the title', () => {
  assert.equal(deriveAlias('Rob — Priorities', []), 'rob-priorities');
});

test('deriveAlias dedups with a numeric suffix', () => {
  assert.equal(deriveAlias('Budget', ['budget']), 'budget-2');
  assert.equal(deriveAlias('Budget', ['budget', 'budget-2']), 'budget-3');
});

test('deriveAlias falls back to "doc" for empty titles', () => {
  assert.equal(deriveAlias('—', []), 'doc');
});
