// claude/scripts/lib/gws-doc-edit.ts
export interface TabContent {
  tabId: string | null;
  content: any[];
}

/** Flatten a documents.get response into per-tab content, with a legacy-body fallback. */
export function collectTabs(docJson: any): TabContent[] {
  if (Array.isArray(docJson.tabs) && docJson.tabs.length > 0) {
    const out: TabContent[] = [];
    const walk = (tabs: any[]) => {
      for (const t of tabs) {
        const content = t.documentTab?.body?.content;
        if (content) out.push({ tabId: t.tabProperties?.tabId ?? null, content });
        if (Array.isArray(t.childTabs)) walk(t.childTabs);
      }
    };
    walk(docJson.tabs);
    return out;
  }
  return [{ tabId: null, content: docJson.body?.content ?? [] }];
}

export function selectTab(tabs: TabContent[], tabSelector?: string): TabContent {
  if (tabs.length === 0) throw new Error('Document has no content.');
  // With no selector, default to the first tab.
  if (!tabSelector) return tabs[0];
  const match = tabs.find(t => t.tabId === tabSelector);
  if (!match) {
    throw new Error(`Tab not found: ${tabSelector}. Tabs: ${tabs.map(t => t.tabId).join(', ')}.`);
  }
  return match;
}

export interface OutlineEntry {
  tabId: string | null;
  style: string;
  text: string;
  startIndex: number;
  endIndex: number;
}

export function buildOutline(docJson: any): OutlineEntry[] {
  const entries: OutlineEntry[] = [];
  for (const tab of collectTabs(docJson)) {
    for (const block of tab.content) {
      const para = block.paragraph;
      if (!para) continue;
      let text = '';
      for (const el of para.elements ?? []) text += el.textRun?.content ?? '';
      entries.push({
        tabId: tab.tabId,
        style: para.paragraphStyle?.namedStyleType ?? 'NORMAL_TEXT',
        text: text.replace(/\n$/, ''),
        startIndex: block.startIndex ?? 0,
        endIndex: block.endIndex ?? 0,
      });
    }
  }
  return entries;
}

function locationFor(index: number, tabId: string | null) {
  return tabId ? { index, tabId } : { index };
}

function rangeFor(startIndex: number, endIndex: number, tabId: string | null) {
  return tabId ? { startIndex, endIndex, tabId } : { startIndex, endIndex };
}

export function buildFindReplaceRequests(
  find: string,
  replace: string,
  opts: { matchCase?: boolean } = {},
) {
  return [
    { replaceAllText: { containsText: { text: find, matchCase: !!opts.matchCase }, replaceText: replace } },
  ];
}

export function buildInsertTextRequests(index: number, text: string, tabId: string | null) {
  return [{ insertText: { location: locationFor(index, tabId), text } }];
}

/** Normalize a heading for forgiving comparison: lowercase, trim, drop trailing punctuation. */
function normalizeHeading(s: string): string {
  return s.trim().toLowerCase().replace(/[\s:.\-–—]+$/, '');
}

/**
 * Index just after a heading paragraph matching `headingText`. Matching is
 * forgiving: case-insensitive, ignores trailing punctuation, and falls back from
 * exact to prefix to substring. Throws listing the tab's headings if none match.
 */
export function findIndexAfterHeading(tab: TabContent, headingText: string): number {
  const wanted = normalizeHeading(headingText);
  const headings: { text: string; index: number; norm: string }[] = [];
  for (const block of tab.content) {
    const para = block.paragraph;
    if (!para) continue;
    const style = para.paragraphStyle?.namedStyleType ?? '';
    if (!style.startsWith('HEADING') && style !== 'TITLE') continue;
    let text = '';
    for (const el of para.elements ?? []) text += el.textRun?.content ?? '';
    headings.push({ text: text.replace(/\n$/, '').trim(), index: block.endIndex, norm: normalizeHeading(text) });
  }

  if (wanted) {
    const exact = headings.find(h => h.norm === wanted);
    if (exact) return exact.index;
    const prefix = headings.find(h => h.norm && (h.norm.startsWith(wanted) || wanted.startsWith(h.norm)));
    if (prefix) return prefix.index;
    const sub = headings.find(h => h.norm && (h.norm.includes(wanted) || wanted.includes(h.norm)));
    if (sub) return sub.index;
  }

  const avail = headings.length ? headings.map(h => `"${h.text}"`).join(', ') : '(none in this tab)';
  throw new Error(
    `Heading not found: "${headingText}". Headings in this tab: ${avail}. ` +
      'Use --tab <id> to search another tab, or --index <n> from `outline`.',
  );
}

/** End-of-body insertion point: just before the final newline of the last block. */
export function appendIndex(tab: TabContent): number {
  const content = tab.content;
  if (content.length === 0) return 1;
  const last = content[content.length - 1];
  return Math.max(1, (last.endIndex ?? 1) - 1);
}

/** Visible text of the tab's final paragraph (trailing newline stripped). */
export function lastParagraphText(tab: TabContent): string {
  const content = tab.content;
  if (content.length === 0) return '';
  const para = content[content.length - 1].paragraph;
  let text = '';
  for (const el of para?.elements ?? []) text += el.textRun?.content ?? '';
  return text.replace(/\n$/, '');
}

const NAMED_STYLES = new Set([
  'NORMAL_TEXT', 'TITLE', 'SUBTITLE',
  'HEADING_1', 'HEADING_2', 'HEADING_3', 'HEADING_4', 'HEADING_5', 'HEADING_6',
]);

/** Normalize a style token (e.g. "h2", "heading2", "normal") to a Docs namedStyleType. */
export function normalizeStyle(s: string): string {
  const raw = s.trim().toUpperCase().replace(/[\s-]+/g, '_');
  const alias: Record<string, string> = {
    NORMAL: 'NORMAL_TEXT', BODY: 'NORMAL_TEXT', TEXT: 'NORMAL_TEXT',
    H1: 'HEADING_1', H2: 'HEADING_2', H3: 'HEADING_3', H4: 'HEADING_4', H5: 'HEADING_5', H6: 'HEADING_6',
    HEADING1: 'HEADING_1', HEADING2: 'HEADING_2', HEADING3: 'HEADING_3',
    HEADING4: 'HEADING_4', HEADING5: 'HEADING_5', HEADING6: 'HEADING_6',
  };
  const out = alias[raw] ?? raw;
  if (!NAMED_STYLES.has(out)) {
    throw new Error(`Unknown style: "${s}". Use NORMAL_TEXT, TITLE, SUBTITLE, or HEADING_1..6 (aliases: h1..h6, normal).`);
  }
  return out;
}

export function buildParagraphStyleRequests(
  startIndex: number, endIndex: number, namedStyle: string, tabId: string | null,
) {
  return [{
    updateParagraphStyle: {
      range: rangeFor(startIndex, endIndex, tabId),
      paragraphStyle: { namedStyleType: namedStyle },
      fields: 'namedStyleType',
    },
  }];
}

export function buildBulletRequests(
  startIndex: number, endIndex: number, ordered: boolean, tabId: string | null,
) {
  return [{
    createParagraphBullets: {
      range: rangeFor(startIndex, endIndex, tabId),
      bulletPreset: ordered ? 'NUMBERED_DECIMAL_ALPHA_ROMAN' : 'BULLET_DISC_CIRCLE_SQUARE',
    },
  }];
}

export function buildDeleteRequests(startIndex: number, endIndex: number, tabId: string | null) {
  return [{ deleteContentRange: { range: rangeFor(startIndex, endIndex, tabId) } }];
}

// --- Lightweight Markdown → Docs requests --------------------------------

interface InlineRun {
  start: number;
  end: number;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
  url?: string;
}

export interface MdBlock {
  text: string;
  style: string;
  list: 'bullet' | 'number' | null;
  /** Nesting depth for list items (0 = top level), from the markdown's leading indentation. */
  depth: number;
  runs: InlineRun[];
}

/** Parse inline markdown (**bold**, *italic*, `code`, [text](url)) into clean text + styled runs. */
function parseInline(src: string): { clean: string; runs: InlineRun[] } {
  let clean = '';
  const runs: InlineRun[] = [];
  let i = 0;
  while (i < src.length) {
    const rest = src.slice(i);
    let m: RegExpMatchArray | null;
    if ((m = rest.match(/^\[([^\]]+)\]\(([^)\s]+)\)/))) {
      const s = clean.length; clean += m[1];
      runs.push({ start: s, end: clean.length, url: m[2] });
      i += m[0].length; continue;
    }
    if ((m = rest.match(/^(?:\*\*|__)([^*_]+)(?:\*\*|__)/))) {
      const s = clean.length; clean += m[1];
      runs.push({ start: s, end: clean.length, bold: true });
      i += m[0].length; continue;
    }
    if ((m = rest.match(/^`([^`]+)`/))) {
      const s = clean.length; clean += m[1];
      runs.push({ start: s, end: clean.length, code: true });
      i += m[0].length; continue;
    }
    if ((m = rest.match(/^(?:\*|_)([^*_]+)(?:\*|_)/))) {
      const s = clean.length; clean += m[1];
      runs.push({ start: s, end: clean.length, italic: true });
      i += m[0].length; continue;
    }
    clean += src[i]; i++;
  }
  return { clean, runs };
}

const LINK_BLUE = { red: 0x11 / 255, green: 0x55 / 255, blue: 0xcc / 255 };

/** Max list nesting depth Google Docs' default bullet presets define (levels 0..8). */
const MAX_LIST_DEPTH = 8;

/** Nesting depth from a list item's leading whitespace: one level per tab, or per two spaces. */
function indentDepth(indent: string): number {
  let depth = 0;
  for (const ch of indent) depth += ch === '\t' ? 1 : 0.5; // 1 tab or 2 spaces == one level
  return Math.min(MAX_LIST_DEPTH, Math.floor(depth));
}

/** Parse a markdown string into paragraph blocks. Blank lines separate; each non-blank line is a paragraph. */
export function parseMarkdownToBlocks(md: string): MdBlock[] {
  const blocks: MdBlock[] = [];
  for (const rawLine of md.split('\n')) {
    const line = rawLine.replace(/\s+$/, '');
    if (line.trim() === '') continue;
    let m: RegExpMatchArray | null;
    if ((m = line.match(/^(#{1,6})\s+(.*)$/))) {
      const { clean, runs } = parseInline(m[2].trim());
      blocks.push({ text: clean, style: `HEADING_${m[1].length}`, list: null, depth: 0, runs });
    } else if ((m = line.match(/^([ \t]*)[-*+]\s+(.*)$/))) {
      const { clean, runs } = parseInline(m[2]);
      blocks.push({ text: clean, style: 'NORMAL_TEXT', list: 'bullet', depth: indentDepth(m[1]), runs });
    } else if ((m = line.match(/^([ \t]*)\d+[.)]\s+(.*)$/))) {
      const { clean, runs } = parseInline(m[2]);
      blocks.push({ text: clean, style: 'NORMAL_TEXT', list: 'number', depth: indentDepth(m[1]), runs });
    } else {
      const { clean, runs } = parseInline(line);
      blocks.push({ text: clean, style: 'NORMAL_TEXT', list: null, depth: 0, runs });
    }
  }
  return blocks;
}

/**
 * Build batchUpdate requests that insert markdown `blocks` at `startIndex` and apply
 * paragraph styles, lists, and inline formatting. `leadingBreak` prepends a newline so
 * appended content starts a fresh paragraph; `trailingNewline` terminates the final block
 * so it stays separate from following content (use when inserting before existing paragraphs).
 *
 * Nesting: a list item's `depth` is encoded as that many leading tab characters in the
 * inserted text. `createParagraphBullets` sets each paragraph's nesting level from its
 * leading tabs and then strips them — this is the only reliable lever for nested lists
 * (paragraph `indentStart` does not drive nesting level, and a magnitude of 0 is dropped).
 * Because that strip shifts indices, the bullet requests are emitted last and in descending
 * order so each range stays valid; the earlier style requests run against the tab-prefixed
 * text, and their styles ride along with the characters when the tabs are removed.
 *
 * `nestUnder` is the start index of an existing top-level (level 0) bullet immediately before
 * `startIndex`. When set, every inserted list item is pushed one level deeper and that anchor
 * paragraph joins the first bullet group, so `createParagraphBullets` keeps the anchor at level
 * 0 and nests the fragment beneath it (the only way to beat the "shallowest item becomes level
 * 0" normalization). The anchor is re-bulleted with the same preset, so it must already be a
 * level-0 bullet or it would be flattened to one.
 */
export function buildMarkdownRequests(
  blocks: MdBlock[],
  startIndex: number,
  tabId: string | null,
  opts: { leadingBreak?: boolean; trailingNewline?: boolean; nestUnder?: number } = {},
) {
  if (blocks.length === 0) return [];
  const extraDepth = opts.nestUnder != null ? 1 : 0;
  const tabsFor = (b: MdBlock) => (b.list ? '\t'.repeat(b.depth + extraDepth) : '');
  const lead = opts.leadingBreak ? '\n' : '';
  const text = lead + blocks.map(b => tabsFor(b) + b.text).join('\n') + (opts.trailingNewline ? '\n' : '');
  const requests: any[] = [{ insertText: { location: locationFor(startIndex, tabId), text } }];

  let cursor = startIndex + lead.length;
  const placed = blocks.map(b => {
    const tabs = tabsFor(b).length;
    const start = cursor;           // start of the tab prefix
    const textStart = start + tabs; // start of the visible text
    cursor += tabs + b.text.length + 1; // tabs + text + the joining newline
    return { b, start, textStart };
  });

  // Explicit paragraph style for every block — guards against inheriting the insertion point's style.
  for (const { b, start, textStart } of placed) {
    requests.push(...buildParagraphStyleRequests(start, textStart + b.text.length + 1, b.style, tabId));
  }

  // Inline text styling (offsets are relative to the visible text, past the tab prefix).
  for (const { b, textStart } of placed) {
    for (const run of b.runs) {
      const textStyle: any = {};
      const fields: string[] = [];
      if (run.bold) { textStyle.bold = true; fields.push('bold'); }
      if (run.italic) { textStyle.italic = true; fields.push('italic'); }
      if (run.code) { textStyle.weightedFontFamily = { fontFamily: 'Courier New' }; fields.push('weightedFontFamily'); }
      if (run.url) {
        // The API doesn't apply the editor's link color, so set Docs' default link blue (#1155cc).
        textStyle.link = { url: run.url };
        textStyle.foregroundColor = { color: { rgbColor: LINK_BLUE } };
        fields.push('link', 'foregroundColor');
      }
      if (!fields.length) continue;
      requests.push({
        updateTextStyle: {
          range: rangeFor(textStart + run.start, textStart + run.end, tabId),
          textStyle,
          fields: fields.join(','),
        },
      });
    }
  }

  // Bullets/numbers over contiguous runs of same-type list blocks. Collect first, then emit
  // in descending start order so createParagraphBullets stripping tabs never shifts a range
  // we haven't applied yet.
  const bulletGroups: { start: number; end: number; ordered: boolean }[] = [];
  let i = 0;
  while (i < placed.length) {
    const lt = placed[i].b.list;
    if (!lt) { i++; continue; }
    let j = i;
    while (j + 1 < placed.length && placed[j + 1].b.list === lt) j++;
    const runStart = placed[i].start;
    const runEnd = placed[j].textStart + placed[j].b.text.length + 1;
    bulletGroups.push({ start: runStart, end: runEnd, ordered: lt === 'number' });
    i = j + 1;
  }
  // Extend the first (document-order) group back over the anchor so it becomes the group's
  // level-0 baseline and the inserted items nest under it.
  if (opts.nestUnder != null && bulletGroups.length) bulletGroups[0].start = opts.nestUnder;
  for (const g of bulletGroups.sort((a, b) => b.start - a.start)) {
    requests.push(...buildBulletRequests(g.start, g.end, g.ordered, tabId));
  }

  return requests;
}

// --- Tables -----------------------------------------------------------------

export interface TableRowRef {
  tabId: string | null;
  /** Start index of the table element; identifies the table in tableCellLocation. */
  tableStart: number;
  /** Position of the table among the tab's top-level tables (0-based). */
  tableNumber: number;
  rowIndex: number;
  columns: number;
  /** First paragraph of the first cell: the row's name. */
  name: string;
  /** Full visible text of each cell, paragraphs joined by "\n". */
  cells: string[];
  /** Name of the nearest section row above this one, if any. */
  section: string | null;
  /** True when the first cell spans every column (a grouping row such as "Fruit (13)"). */
  isSection: boolean;
  row: any;
}

function cellParagraphTexts(cell: any): string[] {
  const out: string[] = [];
  for (const block of cell.content ?? []) {
    if (!block.paragraph) continue;
    let text = '';
    for (const el of block.paragraph.elements ?? []) text += el.textRun?.content ?? '';
    out.push(text.replace(/\n$/, ''));
  }
  return out;
}

/** Every row of every top-level table in the given tabs, with its name and section. */
export function collectTableRows(tabs: TabContent[]): TableRowRef[] {
  const rows: TableRowRef[] = [];
  for (const tab of tabs) {
    let tableNumber = 0;
    for (const block of tab.content) {
      const table = block.table;
      if (!table) continue;
      const columns = table.columns ?? table.tableRows?.[0]?.tableCells?.length ?? 0;
      let section: string | null = null;
      (table.tableRows ?? []).forEach((row: any, rowIndex: number) => {
        const cellTexts = (row.tableCells ?? []).map(cellParagraphTexts);
        const name = (cellTexts[0]?.find((t: string) => t.trim() !== '') ?? '').trim();
        const span = row.tableCells?.[0]?.tableCellStyle?.columnSpan ?? 1;
        const isSection = columns > 1 && span >= columns;
        if (isSection) section = name;
        rows.push({
          tabId: tab.tabId,
          tableStart: block.startIndex,
          tableNumber,
          rowIndex,
          columns,
          name,
          cells: cellTexts.map((ps: string[]) => ps.join('\n')),
          section: isSection ? null : section,
          isSection,
          row,
        });
      });
      tableNumber++;
    }
  }
  return rows;
}

/** Lowercase, collapse whitespace, drop quotes/backticks and trailing punctuation or "(12)" counts. */
function normalizeRowName(s: string): string {
  return s
    .toLowerCase()
    .replace(/[`"“”‘’]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\s*\(\d+\)$/, '')
    .replace(/[\s:.\-–—]+$/, '');
}

function describeRow(r: TableRowRef): string {
  const where = r.section ? ` in "${r.section}"` : '';
  return `"${r.name}" (table ${r.tableNumber + 1}, row ${r.rowIndex + 1}${where})`;
}

/**
 * Pick the single row matching `wanted` from `rows`. Tries, in order: exact row name,
 * exact first-cell text, row-name prefix, row-name substring, first-cell substring. The
 * first tier with any match wins; more than one match in that tier is an error.
 */
function pickRow(rows: TableRowRef[], wanted: string, what: string): TableRowRef {
  const w = normalizeRowName(wanted);
  const tiers: ((r: TableRowRef) => boolean)[] = [
    r => normalizeRowName(r.name) === w,
    r => normalizeRowName(r.cells[0] ?? '') === w,
    r => normalizeRowName(r.name).startsWith(w),
    r => normalizeRowName(r.name).includes(w),
    r => normalizeRowName(r.cells[0] ?? '').includes(w),
  ];
  if (w) {
    for (const tier of tiers) {
      const hits = rows.filter(tier);
      if (hits.length === 1) return hits[0];
      if (hits.length > 1) {
        throw new Error(
          `"${wanted}" matches ${hits.length} ${what}s: ${hits.map(describeRow).join(', ')}. ` +
            'Use the full name, or narrow with --section "<section row>".',
        );
      }
    }
  }
  throw new Error(`No ${what} matching "${wanted}". Run \`rows\` to list the table rows.`);
}

export function findSectionRow(rows: TableRowRef[], section: string): TableRowRef {
  return pickRow(rows.filter(r => r.isSection), section, 'section row');
}

/** Rows after a section row, up to the next section row in the same table. */
export function rowsInSection(rows: TableRowRef[], sectionRow: TableRowRef): TableRowRef[] {
  const sameTable = rows.filter(r => r.tabId === sectionRow.tabId && r.tableStart === sectionRow.tableStart);
  const out: TableRowRef[] = [];
  for (const r of sameTable) {
    if (r.rowIndex <= sectionRow.rowIndex) continue;
    if (r.isSection) break;
    out.push(r);
  }
  return out;
}

/**
 * Find a row by the text of its first cell. With `section`, only rows between that section
 * row and the next section row are considered.
 */
export function findTableRow(rows: TableRowRef[], name: string, section?: string): TableRowRef {
  if (!section) return pickRow(rows.filter(r => !r.isSection), name, 'row');
  const sec = findSectionRow(rows, section);
  return pickRow(rowsInSection(rows, sec), name, `row under "${sec.name}"`);
}

/** Resolve a column given as a 1-based number or as text matching the table's header row. */
export function resolveColumn(rows: TableRowRef[], ref: TableRowRef, column: string): number {
  if (/^\d+$/.test(column)) {
    const n = parseInt(column, 10);
    if (n < 1 || n > ref.columns) throw new Error(`--column ${column} is out of range; the table has ${ref.columns} columns.`);
    return n - 1;
  }
  const header = rows.find(r => r.tabId === ref.tabId && r.tableStart === ref.tableStart && r.rowIndex === 0);
  const cells = header?.cells ?? [];
  const w = normalizeRowName(column);
  const names = cells.map(c => normalizeRowName(c.split('\n')[0]));
  let i = names.findIndex(n => n === w);
  if (i < 0) i = names.findIndex(n => n.startsWith(w));
  if (i < 0) i = names.findIndex(n => n.includes(w));
  if (i < 0) {
    throw new Error(`No column matching "${column}". Header: ${cells.map(c => `"${c.split('\n')[0]}"`).join(', ')}.`);
  }
  return i;
}

function tableCellLocation(ref: TableRowRef, rowIndex: number, columnIndex = 0) {
  return {
    tableStartLocation: locationFor(ref.tableStart, ref.tabId),
    rowIndex,
    columnIndex,
  };
}

/**
 * Replace a table cell's whole content with markdown. Clears the cell's bullets and text,
 * resets character styling and list indents on the leftover paragraph so nothing carries
 * over from the old content, then inserts and formats the markdown.
 */
export function buildCellMarkdownRequests(cell: any, blocks: MdBlock[], tabId: string | null) {
  const cellStart = cell.content?.[0]?.startIndex ?? cell.startIndex + 1;
  const cellEnd = cell.endIndex;
  const requests: any[] = [
    { deleteParagraphBullets: { range: rangeFor(cellStart, cellEnd, tabId) } },
  ];
  // The cell's final newline can't be deleted; everything before it can.
  if (cellEnd - 1 > cellStart) requests.push(...buildDeleteRequests(cellStart, cellEnd - 1, tabId));
  if (blocks.length === 0) return requests;

  const md = buildMarkdownRequests(blocks, cellStart, tabId);
  const insertedLength: number = md[0].insertText.text.length;
  requests.push(md[0]);
  requests.push({
    updateTextStyle: {
      range: rangeFor(cellStart, cellStart + insertedLength, tabId),
      textStyle: {},
      fields: 'bold,italic,underline,strikethrough,link,foregroundColor,weightedFontFamily',
    },
  });
  requests.push({
    updateParagraphStyle: {
      range: rangeFor(cellStart, cellStart + insertedLength + 1, tabId),
      paragraphStyle: {},
      fields: 'indentStart,indentFirstLine',
    },
  });
  requests.push(...md.slice(1));
  return requests;
}

/** Fill several cells of one row; cells are written last-to-first so earlier indices stay valid. */
export function buildRowMarkdownRequests(row: any, cellBlocks: (MdBlock[] | null)[], tabId: string | null) {
  const requests: any[] = [];
  for (let c = cellBlocks.length - 1; c >= 0; c--) {
    const blocks = cellBlocks[c];
    const cell = row.tableCells?.[c];
    if (blocks === null || !cell) continue;
    requests.push(...buildCellMarkdownRequests(cell, blocks, tabId));
  }
  return requests;
}

export function buildInsertRowRequests(ref: TableRowRef, below = true) {
  return [{ insertTableRow: { tableCellLocation: tableCellLocation(ref, ref.rowIndex), insertBelow: below } }];
}

export function buildDeleteRowRequests(ref: TableRowRef) {
  return [{ deleteTableRow: { tableCellLocation: tableCellLocation(ref, ref.rowIndex) } }];
}
