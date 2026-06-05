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

import { addPin, readPins, removePin, clearPins } from './gws-edit-pin';
import { mkdtempSync } from 'fs';
import { join as pathJoin } from 'path';
import { tmpdir as osTmpdir } from 'os';

function withPinFile(fn: () => void) {
  const dir = mkdtempSync(pathJoin(osTmpdir(), 'gws-pin-'));
  process.env.GWS_EDIT_PIN_FILE = pathJoin(dir, 'pins.json');
  try { fn(); } finally { delete process.env.GWS_EDIT_PIN_FILE; }
}

test('addPin then readPins round-trips and assigns an alias', () => {
  withPinFile(() => {
    clearPins();
    const pin = addPin({ type: 'doc', id: 'DOC1', title: 'My Doc' });
    assert.equal(pin.alias, 'my-doc');
    const pins = readPins();
    assert.equal(pins.length, 1);
    assert.equal(pins[0].id, 'DOC1');
    assert.equal(pins[0].type, 'doc');
  });
});

test('re-pinning the same id keeps its alias and updates the title', () => {
  withPinFile(() => {
    clearPins();
    const first = addPin({ type: 'doc', id: 'DOC1', title: 'Old' });
    const second = addPin({ type: 'doc', id: 'DOC1', title: 'New' });
    assert.equal(second.alias, first.alias);
    assert.equal(readPins().length, 1);
    assert.equal(readPins()[0].title, 'New');
  });
});

test('two pin files are isolated', () => {
  const dirA = mkdtempSync(pathJoin(osTmpdir(), 'gws-a-'));
  const dirB = mkdtempSync(pathJoin(osTmpdir(), 'gws-b-'));
  process.env.GWS_EDIT_PIN_FILE = pathJoin(dirA, 'pins.json');
  addPin({ type: 'doc', id: 'A', title: 'A' });
  process.env.GWS_EDIT_PIN_FILE = pathJoin(dirB, 'pins.json');
  assert.equal(readPins().length, 0);
  delete process.env.GWS_EDIT_PIN_FILE;
});

test('removePin removes by alias or id', () => {
  withPinFile(() => {
    clearPins();
    addPin({ type: 'doc', id: 'DOC1', title: 'My Doc' });
    assert.equal(removePin('my-doc'), true);
    assert.equal(readPins().length, 0);
    assert.equal(removePin('nope'), false);
  });
});
