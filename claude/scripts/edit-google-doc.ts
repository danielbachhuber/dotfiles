#!/usr/bin/env npx tsx
import { readFileSync } from 'fs';
import { gwsJson, runGws } from './lib/gws';
import { resolveTarget } from './lib/gws-edit-pin';
import {
  buildOutline, collectTabs, selectTab, findIndexAfterHeading, appendIndex,
  buildFindReplaceRequests, buildInsertTextRequests,
} from './lib/gws-doc-edit';

function fail(msg: string): never {
  console.error(msg);
  process.exit(1);
}
function getFlag(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}
function hasFlag(args: string[], name: string): boolean {
  return args.includes(`--${name}`);
}
// Positionals = non-flag tokens, excluding the value that follows a value-taking flag.
function getPositionals(args: string[], valueFlags: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('--')) continue;
    const prev = args[i - 1];
    if (prev && prev.startsWith('--') && valueFlags.includes(prev.slice(2))) continue;
    out.push(a);
  }
  return out;
}

function fetchDoc(id: string): any {
  return gwsJson([
    'docs', 'documents', 'get',
    '--params', JSON.stringify({ documentId: id, includeTabsContent: true }),
  ]);
}
function applyBatch(id: string, requests: any[]): void {
  runGws([
    'docs', 'documents', 'batchUpdate',
    '--params', JSON.stringify({ documentId: id }),
    '--json', JSON.stringify({ requests }),
  ]);
  console.log(`Applied ${requests.length} request(s) to doc ${id}.`);
}

const [sub, ...rest] = process.argv.slice(2);
const docSel = getFlag(rest, 'doc');

try {
  if (!sub || sub === 'help') {
    console.log('Usage: edit-google-doc.ts <outline|find-replace|insert|append|apply> [--doc <alias|id>] ...');
    process.exit(0);
  }

  if (sub === 'outline') {
    const pin = resolveTarget('doc', docSel);
    for (const e of buildOutline(fetchDoc(pin.id))) {
      const tab = e.tabId ? `[${e.tabId}] ` : '';
      console.log(`${tab}${e.startIndex}-${e.endIndex} ${e.style}: ${e.text}`);
    }
    process.exit(0);
  }

  if (sub === 'find-replace') {
    const pos = getPositionals(rest, ['doc']);
    const find = pos[0];
    const replace = pos[1];
    if (find === undefined || replace === undefined) {
      fail('Usage: find-replace <find> <replace> [--match-case] [--doc <alias|id>]');
    }
    const pin = resolveTarget('doc', docSel);
    applyBatch(pin.id, buildFindReplaceRequests(find, replace, { matchCase: hasFlag(rest, 'match-case') }));
    process.exit(0);
  }

  if (sub === 'insert') {
    const text = getFlag(rest, 'text');
    if (text === undefined) fail('insert requires --text <s>');
    const pin = resolveTarget('doc', docSel);
    const tab = selectTab(collectTabs(fetchDoc(pin.id)), getFlag(rest, 'tab'));
    const heading = getFlag(rest, 'after-heading');
    const idxFlag = getFlag(rest, 'index');
    let index: number;
    if (heading !== undefined) index = findIndexAfterHeading(tab, heading);
    else if (idxFlag !== undefined) {
      index = parseInt(idxFlag, 10);
      if (Number.isNaN(index)) fail('--index must be a number');
    }
    else fail('insert requires --after-heading "<text>" or --index <n>');
    applyBatch(pin.id, buildInsertTextRequests(index, text, tab.tabId));
    process.exit(0);
  }

  if (sub === 'append') {
    const text = getFlag(rest, 'text');
    if (text === undefined) fail('append requires --text <s>');
    const pin = resolveTarget('doc', docSel);
    const tab = selectTab(collectTabs(fetchDoc(pin.id)), getFlag(rest, 'tab'));
    applyBatch(pin.id, buildInsertTextRequests(appendIndex(tab), text, tab.tabId));
    process.exit(0);
  }

  if (sub === 'apply') {
    const file = getPositionals(rest, ['doc'])[0];
    if (!file) fail('apply requires <requests.json>');
    const parsed = JSON.parse(readFileSync(file, 'utf-8'));
    const arr = Array.isArray(parsed) ? parsed : parsed.requests;
    if (!Array.isArray(arr)) fail('requests file must be a JSON array or {"requests":[...]}.');
    const pin = resolveTarget('doc', docSel);
    applyBatch(pin.id, arr);
    process.exit(0);
  }

  fail(`Unknown subcommand: ${sub}`);
} catch (err: any) {
  console.error(err?.stderr?.toString?.() || err?.message || String(err));
  process.exit(1);
}
