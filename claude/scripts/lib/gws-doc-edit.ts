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
