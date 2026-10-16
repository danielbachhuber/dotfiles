#!/usr/bin/env npx tsx
import { readFileSync } from 'fs';
import { gwsJson, runGws } from './lib/gws';
import { resolveTarget } from './lib/gws-edit-pin';
import {
  buildOutline, collectTabs, selectTab, findIndexAfterHeading, appendIndex,
  lastParagraphText, normalizeStyle,
  buildFindReplaceRequests, buildInsertTextRequests, buildParagraphStyleRequests,
  buildBulletRequests, buildDeleteRequests, parseMarkdownToBlocks, buildMarkdownRequests,
  collectTableRows, findTableRow, findSectionRow, rowsInSection, resolveColumn,
  buildCellMarkdownRequests, buildRowMarkdownRequests, buildInsertRowRequests, buildDeleteRowRequests,
  TableRowRef, TabContent,
} from './lib/gws-doc-edit';

function fail(msg: string): never {
  console.error(msg);
  process.exit(1);
}
function getFlag(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}
function getAllFlags(args: string[], name: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) if (args[i] === `--${name}` && i + 1 < args.length) out.push(args[i + 1]);
  return out;
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

// Tabs to search for table rows: the --tab one, or every tab.
function tableTabs(docJson: any, tabSel?: string): TabContent[] {
  const tabs = collectTabs(docJson);
  return tabSel ? [selectTab(tabs, tabSel)] : tabs;
}
// The row at the same table position as `ref` (plus `offset` rows), from a fresh fetch.
function rowAt(rows: TableRowRef[], ref: TableRowRef, offset = 0): TableRowRef | undefined {
  return rows.find(r => r.tabId === ref.tabId && r.tableStart === ref.tableStart && r.rowIndex === ref.rowIndex + offset);
}
function oneLine(s: string, max = 100): string {
  const flat = s.replace(/\n/g, ' / ');
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}
function printRow(r: TableRowRef): void {
  const tab = r.tabId ? `[${r.tabId}] ` : '';
  const sec = r.section ? ` in "${r.section}"` : '';
  console.log(`${tab}table ${r.tableNumber + 1}, row ${r.rowIndex + 1}${sec}: ${r.name}`);
  r.cells.forEach((c, i) => console.log(`  ${i + 1}: ${oneLine(c)}`));
}
// Markdown for each cell of a new row, from repeated --cell flags or a --file JSON array.
function readCells(args: string[]): string[] {
  const file = getFlag(args, 'file');
  if (file !== undefined) {
    const parsed = JSON.parse(readFileSync(file, 'utf-8'));
    if (!Array.isArray(parsed) || !parsed.every(c => typeof c === 'string')) {
      fail('--file must be a JSON array of markdown strings, one per column.');
    }
    return parsed;
  }
  return getAllFlags(args, 'cell');
}

const HELP = `Usage: edit-google-doc.ts <command> [--doc <alias|id>]

Edits the Google Doc pinned via /edit-google. Omit --doc when only one doc is
pinned; otherwise pass the alias or id shown by \`edit-google-pin.ts list\`.

Commands:
  outline                 List every paragraph with its start/end index, style,
                          and tab id. Run this first to find indices for insert.
  find-replace <find> <replace> [--match-case]
                          Replace text across the WHOLE document (all tabs).
  insert --text "<s>" (--after-heading "<heading>" | --index <n>) [--tab <id>]
                          Insert text after a matching heading, or at an explicit
                          index (from \`outline\`). Defaults to the first tab.
  append --text "<s>" [--tab <id>]
                          Append text to the end of the (first or --tab) tab.
  markdown --text "<md>" [--after-heading "<h>" | --index <n>] [--tab <id>]
                          Insert Markdown with formatting: # / ## headings, - / *
                          bullets, 1. numbered lists, **bold**, *italic*, \`code\`,
                          [text](url). Indent nested bullets with a tab or two spaces
                          per level. Default appends to the end of the tab; styles
                          each paragraph explicitly so nothing inherits a heading
                          style. Use --file <path> instead of --text to read a file.
                          Add --nest-under-previous (with --index/--after-heading) to
                          nest the fragment under the top-level bullet right before the
                          insertion point instead of starting a new top-level list.
  style --index <n> [--end <m>] --as <h1..h6|normal|title|HEADING_2|...>
                          Set the paragraph style on a paragraph (or the range
                          --index..--end, from \`outline\`).
  bullets --start <n> --end <m> [--ordered] [--tab <id>]
                          Turn the paragraphs in a range into a bulleted (or, with
                          --ordered, numbered) list.
  delete --start <n> --end <m> [--tab <id>]
                          Delete the content in an index range (from \`outline\`).

Table rows (a row is named by the first paragraph of its first cell; matching is
case-insensitive and falls back from exact to prefix to substring. A section row is
one whose first cell spans the whole table, such as "Fruit (13)"; --section
limits matching to the rows between that section row and the next. Rows in every
tab are searched unless --tab is given):
  rows [--section "<s>"]  List table rows with their section and cell text.
  find-row "<row>" [--section "<s>"]
                          Show one row's position and the text of each cell.
  set-cell "<row>" --column <n|header> (--text "<md>" | --file <path>) [--section "<s>"]
                          Replace one cell's content with Markdown (same syntax as
                          \`markdown\`: bullets, **bold**, *italic*, [text](url)).
                          --column is 1-based or text from the header row. To
                          change a section row's title or count, name the section
                          row itself, e.g. set-cell "Fruit" --column 1.
  insert-row (--after "<row>" | --section "<s>") (--cell "<md>" ... | --file <cells.json>)
                          Insert a row after the named row (with --section too, the
                          row is looked up in that section), or at the end of the
                          section when only --section is given. Pass one --cell per
                          column in order, or --file with a JSON array of Markdown
                          strings. Missing trailing cells are left empty. The new row
                          copies the cell styling of the row above it.
  delete-row "<row>" [--section "<s>"]
                          Delete the row.
  apply <requests.json>   Escape hatch: apply a raw JSON array of Docs batchUpdate
                          request objects (or {"requests":[...]}). Use for
                          anything not covered above.`;

const [sub, ...rest] = process.argv.slice(2);
const docSel = getFlag(rest, 'doc');

try {
  if (!sub || sub === 'help' || sub === '--help' || sub === '-h' || rest.includes('--help') || rest.includes('-h')) {
    console.log(HELP);
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

  if (sub === 'markdown' || sub === 'md') {
    let text = getFlag(rest, 'text');
    const file = getFlag(rest, 'file');
    if (text === undefined && file !== undefined) text = readFileSync(file, 'utf-8');
    if (text === undefined) fail('markdown requires --text "<md>" or --file <path>');
    const blocks = parseMarkdownToBlocks(text);
    if (blocks.length === 0) fail('markdown produced no content.');
    const pin = resolveTarget('doc', docSel);
    const tab = selectTab(collectTabs(fetchDoc(pin.id)), getFlag(rest, 'tab'));
    const heading = getFlag(rest, 'after-heading');
    const idxFlag = getFlag(rest, 'index');
    let index: number;
    let opts: { leadingBreak?: boolean; trailingNewline?: boolean; nestUnder?: number };
    if (heading !== undefined) {
      index = findIndexAfterHeading(tab, heading);
      opts = { trailingNewline: true };
    } else if (idxFlag !== undefined) {
      index = parseInt(idxFlag, 10);
      if (Number.isNaN(index)) fail('--index must be a number');
      opts = { trailingNewline: true };
    } else {
      index = appendIndex(tab);
      opts = { leadingBreak: lastParagraphText(tab).length > 0 };
    }
    if (hasFlag(rest, 'nest-under-previous')) {
      const prev = tab.content.find((p: any) => p.endIndex === index && p.paragraph?.bullet);
      if (!prev) fail('--nest-under-previous: the paragraph before the insertion point is not a bullet.');
      if (prev.paragraph.bullet.nestingLevel) {
        fail('--nest-under-previous: the preceding bullet must be top-level (level 0); nesting under a deeper bullet is not supported.');
      }
      opts.nestUnder = prev.startIndex;
    }
    applyBatch(pin.id, buildMarkdownRequests(blocks, index, tab.tabId, opts));
    process.exit(0);
  }

  if (sub === 'style') {
    const idxFlag = getFlag(rest, 'index');
    const as = getFlag(rest, 'as');
    if (idxFlag === undefined) fail('style requires --index <n>');
    if (as === undefined) fail('style requires --as <style>');
    const start = parseInt(idxFlag, 10);
    if (Number.isNaN(start)) fail('--index must be a number');
    const endFlag = getFlag(rest, 'end');
    const end = endFlag !== undefined ? parseInt(endFlag, 10) : start + 1;
    if (Number.isNaN(end)) fail('--end must be a number');
    const pin = resolveTarget('doc', docSel);
    const tab = selectTab(collectTabs(fetchDoc(pin.id)), getFlag(rest, 'tab'));
    applyBatch(pin.id, buildParagraphStyleRequests(start, end, normalizeStyle(as), tab.tabId));
    process.exit(0);
  }

  if (sub === 'bullets') {
    const startFlag = getFlag(rest, 'start');
    const endFlag = getFlag(rest, 'end');
    if (startFlag === undefined || endFlag === undefined) fail('bullets requires --start <n> --end <m>');
    const start = parseInt(startFlag, 10);
    const end = parseInt(endFlag, 10);
    if (Number.isNaN(start) || Number.isNaN(end)) fail('--start and --end must be numbers');
    const pin = resolveTarget('doc', docSel);
    const tab = selectTab(collectTabs(fetchDoc(pin.id)), getFlag(rest, 'tab'));
    applyBatch(pin.id, buildBulletRequests(start, end, hasFlag(rest, 'ordered'), tab.tabId));
    process.exit(0);
  }

  if (sub === 'delete') {
    const startFlag = getFlag(rest, 'start');
    const endFlag = getFlag(rest, 'end');
    if (startFlag === undefined || endFlag === undefined) fail('delete requires --start <n> --end <m>');
    const start = parseInt(startFlag, 10);
    const end = parseInt(endFlag, 10);
    if (Number.isNaN(start) || Number.isNaN(end)) fail('--start and --end must be numbers');
    const pin = resolveTarget('doc', docSel);
    const tab = selectTab(collectTabs(fetchDoc(pin.id)), getFlag(rest, 'tab'));
    applyBatch(pin.id, buildDeleteRequests(start, end, tab.tabId));
    process.exit(0);
  }

  if (sub === 'rows') {
    const pin = resolveTarget('doc', docSel);
    let rows = collectTableRows(tableTabs(fetchDoc(pin.id), getFlag(rest, 'tab')));
    const section = getFlag(rest, 'section');
    if (section !== undefined) rows = rowsInSection(rows, findSectionRow(rows, section));
    if (rows.length === 0) fail('No table rows found.');
    for (const r of rows) {
      const tab = r.tabId ? `[${r.tabId}] ` : '';
      const label = r.isSection ? `== ${r.name} ==` : `${r.name}${r.section ? `  (${r.section})` : ''}`;
      console.log(`${tab}table ${r.tableNumber + 1}, row ${r.rowIndex + 1}: ${label}`);
    }
    process.exit(0);
  }

  if (sub === 'find-row') {
    const name = getPositionals(rest, ['doc', 'tab', 'section'])[0];
    if (name === undefined) fail('Usage: find-row "<row>" [--section "<s>"]');
    const pin = resolveTarget('doc', docSel);
    const rows = collectTableRows(tableTabs(fetchDoc(pin.id), getFlag(rest, 'tab')));
    printRow(findTableRow(rows, name, getFlag(rest, 'section')));
    process.exit(0);
  }

  if (sub === 'set-cell') {
    const name = getPositionals(rest, ['doc', 'tab', 'section', 'column', 'text', 'file'])[0];
    const column = getFlag(rest, 'column');
    let text = getFlag(rest, 'text');
    const file = getFlag(rest, 'file');
    if (text === undefined && file !== undefined) text = readFileSync(file, 'utf-8');
    if (name === undefined || column === undefined || text === undefined) {
      fail('Usage: set-cell "<row>" --column <n|header> (--text "<md>" | --file <path>) [--section "<s>"]');
    }
    const pin = resolveTarget('doc', docSel);
    const rows = collectTableRows(tableTabs(fetchDoc(pin.id), getFlag(rest, 'tab')));
    const section = getFlag(rest, 'section');
    // A section row can be targeted by name (to change its title or count) when no --section is given.
    let ref: TableRowRef;
    try {
      ref = findTableRow(rows, name, section);
    } catch (err) {
      if (section !== undefined) throw err;
      try { ref = findSectionRow(rows, name); } catch { throw err; }
    }
    const col = resolveColumn(rows, ref, column);
    const cell = ref.row.tableCells?.[col];
    if (!cell) fail(`Row "${ref.name}" has no cell in column ${col + 1}.`);
    applyBatch(pin.id, buildCellMarkdownRequests(cell, parseMarkdownToBlocks(text), ref.tabId));
    const updated = rowAt(collectTableRows(tableTabs(fetchDoc(pin.id), getFlag(rest, 'tab'))), ref);
    if (updated) printRow(updated);
    process.exit(0);
  }

  if (sub === 'insert-row') {
    const after = getFlag(rest, 'after');
    const section = getFlag(rest, 'section');
    if (after === undefined && section === undefined) fail('insert-row requires --after "<row>" and/or --section "<s>".');
    const cells = readCells(rest);
    if (cells.length === 0) fail('insert-row requires --cell "<md>" (one per column) or --file <cells.json>.');
    const pin = resolveTarget('doc', docSel);
    const tabSel = getFlag(rest, 'tab');
    const rows = collectTableRows(tableTabs(fetchDoc(pin.id), tabSel));
    let ref: TableRowRef;
    if (after !== undefined) ref = findTableRow(rows, after, section);
    else {
      const sec = findSectionRow(rows, section!);
      const inSection = rowsInSection(rows, sec);
      if (inSection.length === 0) fail(`Section "${sec.name}" has no rows to copy styling from; use --after "<row>".`);
      ref = inSection[inSection.length - 1];
    }
    if (cells.length > ref.columns) fail(`Got ${cells.length} cells but the table has ${ref.columns} columns.`);
    applyBatch(pin.id, buildInsertRowRequests(ref));
    const added = rowAt(collectTableRows(tableTabs(fetchDoc(pin.id), tabSel)), ref, 1);
    if (!added) fail('Inserted the row but could not find it again to fill its cells.');
    applyBatch(pin.id, buildRowMarkdownRequests(added.row, cells.map(c => parseMarkdownToBlocks(c)), added.tabId));
    const done = rowAt(collectTableRows(tableTabs(fetchDoc(pin.id), tabSel)), added);
    if (done) printRow(done);
    process.exit(0);
  }

  if (sub === 'delete-row') {
    const name = getPositionals(rest, ['doc', 'tab', 'section'])[0];
    if (name === undefined) fail('Usage: delete-row "<row>" [--section "<s>"]');
    const pin = resolveTarget('doc', docSel);
    const rows = collectTableRows(tableTabs(fetchDoc(pin.id), getFlag(rest, 'tab')));
    const ref = findTableRow(rows, name, getFlag(rest, 'section'));
    applyBatch(pin.id, buildDeleteRowRequests(ref));
    console.log(`Deleted ${ref.name ? `"${ref.name}"` : 'the row'} (table ${ref.tableNumber + 1}, row ${ref.rowIndex + 1}).`);
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
