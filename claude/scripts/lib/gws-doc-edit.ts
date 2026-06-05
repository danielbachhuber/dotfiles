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

/** Index just after a heading paragraph whose trimmed text matches. */
export function findIndexAfterHeading(tab: TabContent, headingText: string): number {
  const wanted = headingText.trim();
  for (const block of tab.content) {
    const para = block.paragraph;
    if (!para) continue;
    const style = para.paragraphStyle?.namedStyleType ?? '';
    if (!style.startsWith('HEADING') && style !== 'TITLE') continue;
    let text = '';
    for (const el of para.elements ?? []) text += el.textRun?.content ?? '';
    if (text.replace(/\n$/, '').trim() === wanted) return block.endIndex;
  }
  throw new Error(`Heading not found: "${headingText}".`);
}

/** End-of-body insertion point: just before the final newline of the last block. */
export function appendIndex(tab: TabContent): number {
  const content = tab.content;
  if (content.length === 0) return 1;
  const last = content[content.length - 1];
  return Math.max(1, (last.endIndex ?? 1) - 1);
}
