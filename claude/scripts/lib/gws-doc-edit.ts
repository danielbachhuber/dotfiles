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
