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

/** Parse a markdown string into paragraph blocks. Blank lines separate; each non-blank line is a paragraph. */
export function parseMarkdownToBlocks(md: string): MdBlock[] {
  const blocks: MdBlock[] = [];
  for (const rawLine of md.split('\n')) {
    const line = rawLine.replace(/\s+$/, '');
    if (line.trim() === '') continue;
    let m: RegExpMatchArray | null;
    if ((m = line.match(/^(#{1,6})\s+(.*)$/))) {
      const { clean, runs } = parseInline(m[2].trim());
      blocks.push({ text: clean, style: `HEADING_${m[1].length}`, list: null, runs });
    } else if ((m = line.match(/^\s*[-*+]\s+(.*)$/))) {
      const { clean, runs } = parseInline(m[1]);
      blocks.push({ text: clean, style: 'NORMAL_TEXT', list: 'bullet', runs });
    } else if ((m = line.match(/^\s*\d+[.)]\s+(.*)$/))) {
      const { clean, runs } = parseInline(m[1]);
      blocks.push({ text: clean, style: 'NORMAL_TEXT', list: 'number', runs });
    } else {
      const { clean, runs } = parseInline(line);
      blocks.push({ text: clean, style: 'NORMAL_TEXT', list: null, runs });
    }
  }
  return blocks;
}

/**
 * Build batchUpdate requests that insert markdown `blocks` at `startIndex` and apply
 * paragraph styles, lists, and inline formatting. `leadingBreak` prepends a newline so
 * appended content starts a fresh paragraph; `trailingNewline` terminates the final block
 * so it stays separate from following content (use when inserting before existing paragraphs).
 */
export function buildMarkdownRequests(
  blocks: MdBlock[],
  startIndex: number,
  tabId: string | null,
  opts: { leadingBreak?: boolean; trailingNewline?: boolean } = {},
) {
  if (blocks.length === 0) return [];
  const lead = opts.leadingBreak ? '\n' : '';
  const text = lead + blocks.map(b => b.text).join('\n') + (opts.trailingNewline ? '\n' : '');
  const requests: any[] = [{ insertText: { location: locationFor(startIndex, tabId), text } }];

  let cursor = startIndex + lead.length;
  const placed = blocks.map(b => {
    const start = cursor;
    cursor += b.text.length + 1; // text + the joining newline
    return { b, start };
  });

  // Explicit paragraph style for every block — guards against inheriting the insertion point's style.
  for (const { b, start } of placed) {
    requests.push(...buildParagraphStyleRequests(start, start + b.text.length + 1, b.style, tabId));
  }

  // Inline text styling.
  for (const { b, start } of placed) {
    for (const run of b.runs) {
      const textStyle: any = {};
      const fields: string[] = [];
      if (run.bold) { textStyle.bold = true; fields.push('bold'); }
      if (run.italic) { textStyle.italic = true; fields.push('italic'); }
      if (run.code) { textStyle.weightedFontFamily = { fontFamily: 'Courier New' }; fields.push('weightedFontFamily'); }
      if (run.url) { textStyle.link = { url: run.url }; fields.push('link'); }
      if (!fields.length) continue;
      requests.push({
        updateTextStyle: {
          range: rangeFor(start + run.start, start + run.end, tabId),
          textStyle,
          fields: fields.join(','),
        },
      });
    }
  }

  // Bullets/numbers over contiguous runs of same-type list blocks.
  let i = 0;
  while (i < placed.length) {
    const lt = placed[i].b.list;
    if (!lt) { i++; continue; }
    let j = i;
    while (j + 1 < placed.length && placed[j + 1].b.list === lt) j++;
    const runStart = placed[i].start;
    const runEnd = placed[j].start + placed[j].b.text.length + 1;
    requests.push(...buildBulletRequests(runStart, runEnd, lt === 'number', tabId));
    i = j + 1;
  }

  return requests;
}
