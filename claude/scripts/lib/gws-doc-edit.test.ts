// claude/scripts/lib/gws-doc-edit.test.ts
import { test } from 'node:test';
import assert from 'node:assert';
import { collectTabs, buildOutline, parseMarkdownToBlocks, buildMarkdownRequests } from './gws-doc-edit';

const BODY_DOC = {
  documentId: 'DOC1',
  body: {
    content: [
      {
        startIndex: 1, endIndex: 13,
        paragraph: {
          paragraphStyle: { namedStyleType: 'HEADING_1' },
          elements: [{ textRun: { content: 'Section One\n' } }],
        },
      },
      {
        startIndex: 13, endIndex: 30,
        paragraph: {
          paragraphStyle: { namedStyleType: 'NORMAL_TEXT' },
          elements: [{ textRun: { content: 'First paragraph.\n' } }],
        },
      },
    ],
  },
};

const TABS_DOC = {
  documentId: 'DOC2',
  tabs: [
    {
      tabProperties: { tabId: 't.0', title: 'Main' },
      documentTab: { body: { content: BODY_DOC.body.content } },
    },
  ],
};

test('collectTabs handles legacy body docs', () => {
  const tabs = collectTabs(BODY_DOC);
  assert.equal(tabs.length, 1);
  assert.equal(tabs[0].tabId, null);
  assert.equal(tabs[0].content.length, 2);
});

const TWO_TABS_DOC = {
  documentId: 'DOC3',
  tabs: [
    {
      tabProperties: { tabId: 't.0', title: 'First' },
      documentTab: { body: { content: BODY_DOC.body.content } },
    },
    {
      tabProperties: { tabId: 't.1', title: 'Second' },
      documentTab: { body: { content: BODY_DOC.body.content } },
    },
  ],
};

test('collectTabs handles tabbed docs', () => {
  const tabs = collectTabs(TABS_DOC);
  assert.equal(tabs.length, 1);
  assert.equal(tabs[0].tabId, 't.0');
});

test('selectTab defaults to the first tab when no selector is given', () => {
  assert.equal(selectTab(collectTabs(TWO_TABS_DOC)).tabId, 't.0');
});

test('buildOutline lists paragraphs with style, text, and indices', () => {
  const outline = buildOutline(BODY_DOC);
  assert.equal(outline.length, 2);
  assert.deepEqual(outline[0], { tabId: null, style: 'HEADING_1', text: 'Section One', startIndex: 1, endIndex: 13 });
  assert.equal(outline[1].text, 'First paragraph.');
});

import {
  buildFindReplaceRequests, buildInsertTextRequests, findIndexAfterHeading, appendIndex, selectTab,
} from './gws-doc-edit';

test('buildFindReplaceRequests builds a replaceAllText request', () => {
  assert.deepEqual(buildFindReplaceRequests('old', 'new', { matchCase: true }), [
    { replaceAllText: { containsText: { text: 'old', matchCase: true }, replaceText: 'new' } },
  ]);
});

test('buildInsertTextRequests omits tabId when null and includes it otherwise', () => {
  assert.deepEqual(buildInsertTextRequests(5, 'hi', null), [
    { insertText: { location: { index: 5 }, text: 'hi' } },
  ]);
  assert.deepEqual(buildInsertTextRequests(5, 'hi', 't.0'), [
    { insertText: { location: { index: 5, tabId: 't.0' }, text: 'hi' } },
  ]);
});

test('findIndexAfterHeading returns the heading paragraph endIndex', () => {
  const tab = selectTab(collectTabs(BODY_DOC));
  assert.equal(findIndexAfterHeading(tab, 'Section One'), 13);
  assert.throws(() => findIndexAfterHeading(tab, 'Nope'), /Heading not found/);
});

test('findIndexAfterHeading matches case-insensitively and ignores trailing punctuation', () => {
  const tab = selectTab(collectTabs(BODY_DOC));
  assert.equal(findIndexAfterHeading(tab, 'section one:'), 13);
  assert.equal(findIndexAfterHeading(tab, 'SECTION ONE'), 13);
});

test('findIndexAfterHeading falls back to prefix/substring match', () => {
  const tab = selectTab(collectTabs(BODY_DOC));
  assert.equal(findIndexAfterHeading(tab, 'Section'), 13);
});

test('findIndexAfterHeading error lists available headings', () => {
  const tab = selectTab(collectTabs(BODY_DOC));
  assert.throws(() => findIndexAfterHeading(tab, 'Nope'), /Headings in this tab: "Section One"/);
});

test('appendIndex returns the position before the final newline', () => {
  const tab = selectTab(collectTabs(BODY_DOC));
  assert.equal(appendIndex(tab), 29);
});

test('parseMarkdownToBlocks records nesting depth from tabs and spaces', () => {
  const blocks = parseMarkdownToBlocks('- top\n  - two-space child\n\t- tab child\n    - four-space grandchild');
  assert.deepEqual(blocks.map(b => b.depth), [0, 1, 1, 2]);
  assert.deepEqual(blocks.map(b => b.text), ['top', 'two-space child', 'tab child', 'four-space grandchild']);
});

test('buildMarkdownRequests prefixes nested bullets with tabs so createParagraphBullets nests them', () => {
  const blocks = parseMarkdownToBlocks('- name\n  - detail');
  const reqs = buildMarkdownRequests(blocks, 10, 't.0');
  // Inserted text carries one tab on the nested item; createParagraphBullets strips it later.
  assert.equal(reqs[0].insertText.text, 'name\n\tdetail');
  assert.equal(reqs[0].insertText.location.index, 10);
  // Exactly one bullet group spanning both paragraphs.
  const bullets = reqs.filter(r => r.createParagraphBullets);
  assert.equal(bullets.length, 1);
  assert.equal(bullets[0].createParagraphBullets.range.startIndex, 10);
});

test('buildMarkdownRequests nestUnder pushes items one level deeper and anchors on the previous bullet', () => {
  const blocks = parseMarkdownToBlocks('- name\n  - detail');
  const reqs = buildMarkdownRequests(blocks, 20, 't.0', { nestUnder: 11 });
  // Both items gain one extra tab: name -> 1 tab (level 1), detail -> 2 tabs (level 2).
  assert.equal(reqs[0].insertText.text, '\tname\n\t\tdetail');
  const bullets = reqs.filter(r => r.createParagraphBullets);
  assert.equal(bullets.length, 1);
  // The bullet range starts at the anchor (11), not the first inserted paragraph (20).
  assert.equal(bullets[0].createParagraphBullets.range.startIndex, 11);
});

test('buildMarkdownRequests links land past the tab prefix on nested items', () => {
  const blocks = parseMarkdownToBlocks('  - [Person](https://example.com/p)');
  const reqs = buildMarkdownRequests(blocks, 100, null);
  const link = reqs.find(r => r.updateTextStyle?.textStyle?.link);
  // One leading tab (depth 1) sits before "Person", so the link starts at 101, not 100.
  assert.equal(link.updateTextStyle.range.startIndex, 101);
  assert.equal(link.updateTextStyle.range.endIndex, 101 + 'Person'.length);
  assert.equal(link.updateTextStyle.textStyle.link.url, 'https://example.com/p');
});

import {
  collectTableRows, findTableRow, resolveColumn, buildCellMarkdownRequests,
  buildRowMarkdownRequests, buildInsertRowRequests, buildDeleteRowRequests,
} from './gws-doc-edit';

function para(start: number, text: string) {
  return {
    startIndex: start, endIndex: start + text.length + 1,
    paragraph: { elements: [{ textRun: { content: text + '\n' } }] },
  };
}
// A cell holding the given paragraphs, starting at `start` (its first paragraph starts at start + 1).
function cell(start: number, texts: string[], span = 1) {
  let i = start + 1;
  const content = texts.map(t => { const p = para(i, t); i = p.endIndex; return p; });
  return { startIndex: start, endIndex: i, content, tableCellStyle: { columnSpan: span } };
}
// Rows of [col1, col2] cells, or a single string for a spanning section row.
function table(start: number, rows: (string | [string[], string[]])[]) {
  let i = start + 1;
  const tableRows = rows.map(r => {
    const rowStart = i;
    const cells = typeof r === 'string'
      ? [cell(i + 1, [r], 2), cell(0, [''])]
      : [cell(i + 1, r[0]), null as any];
    if (typeof r === 'string') {
      cells[1] = cell(cells[0].endIndex, ['']);
    } else {
      cells[1] = cell(cells[0].endIndex, r[1]);
    }
    i = cells[1].endIndex;
    return { startIndex: rowStart, endIndex: i, tableCells: cells };
  });
  return { startIndex: start, endIndex: i + 1, table: { rows: rows.length, columns: 2, tableRows } };
}

const TABLE_TAB = {
  tabId: 't.0',
  content: [
    para(1, 'Intro'),
    table(7, [
      [['Feature'], ['Details']],
      'Fruit (2)',
      [['Apple pie', 'A baked dessert.'], ['Made with:', 'apples']],
      [['Apple sauce'], ['Stewed.']],
      'Vegetables',
      [['CARROT_CAKE'], ['Sweet.']],
    ]),
  ],
};

test('collectTableRows names rows by their first paragraph and tracks sections', () => {
  const rows = collectTableRows([TABLE_TAB]);
  assert.equal(rows.length, 6);
  assert.equal(rows[1].isSection, true);
  assert.equal(rows[2].name, 'Apple pie');
  assert.equal(rows[2].section, 'Fruit (2)');
  assert.equal(rows[5].section, 'Vegetables');
  assert.equal(rows[2].tableStart, 7);
});

test('findTableRow prefers exact names and reports ambiguous matches', () => {
  const rows = collectTableRows([TABLE_TAB]);
  assert.equal(findTableRow(rows, 'apple pie').rowIndex, 2);
  assert.equal(findTableRow(rows, '"CARROT_CAKE"').rowIndex, 5);
  assert.throws(() => findTableRow(rows, 'Apple'), /matches 2 rows/);
  assert.throws(() => findTableRow(rows, 'Nope'), /No row matching/);
});

test('findTableRow narrows by section, ignoring the section row count', () => {
  const rows = collectTableRows([TABLE_TAB]);
  assert.equal(findTableRow(rows, 'sauce', 'Fruit').rowIndex, 3);
  assert.throws(() => findTableRow(rows, 'CARROT_CAKE', 'Fruit'), /No row/);
});

test('resolveColumn accepts a 1-based number or header text', () => {
  const rows = collectTableRows([TABLE_TAB]);
  const ref = rows[2];
  assert.equal(resolveColumn(rows, ref, '2'), 1);
  assert.equal(resolveColumn(rows, ref, 'details'), 1);
  assert.throws(() => resolveColumn(rows, ref, '3'), /out of range/);
});

test('buildCellMarkdownRequests clears the cell then inserts markdown with links', () => {
  const rows = collectTableRows([TABLE_TAB]);
  const target = rows[2].row.tableCells[1];
  const start = target.content[0].startIndex;
  const reqs = buildCellMarkdownRequests(
    target, parseMarkdownToBlocks('Made with:\n- [apples](https://x/apples) from the orchard'), 't.0',
  );
  assert.deepEqual(reqs[0], { deleteParagraphBullets: { range: { startIndex: start, endIndex: target.endIndex, tabId: 't.0' } } });
  assert.deepEqual(reqs[1], { deleteContentRange: { range: { startIndex: start, endIndex: target.endIndex - 1, tabId: 't.0' } } });
  assert.equal(reqs[2].insertText.location.index, start);
  assert.equal(reqs[2].insertText.text, 'Made with:\napples from the orchard');
  assert.equal(reqs[3].updateTextStyle.fields.includes('link'), true);
  const link = reqs.find(r => r.updateTextStyle?.textStyle?.link);
  assert.equal(link.updateTextStyle.range.startIndex, start + 'Made with:\n'.length);
  assert.ok(link.updateTextStyle.textStyle.foregroundColor);
  assert.ok(reqs.some(r => r.createParagraphBullets));
});

test('buildRowMarkdownRequests fills cells last to first', () => {
  const rows = collectTableRows([TABLE_TAB]);
  const row = rows[5].row;
  const reqs = buildRowMarkdownRequests(row, [parseMarkdownToBlocks('A'), parseMarkdownToBlocks('B')], null);
  const inserts = reqs.filter(r => r.insertText).map(r => r.insertText.text);
  assert.deepEqual(inserts, ['B', 'A']);
});

test('row insert and delete requests target the table start and row index', () => {
  const rows = collectTableRows([TABLE_TAB]);
  assert.deepEqual(buildInsertRowRequests(rows[3]), [{
    insertTableRow: {
      tableCellLocation: { tableStartLocation: { index: 7, tabId: 't.0' }, rowIndex: 3, columnIndex: 0 },
      insertBelow: true,
    },
  }]);
  assert.deepEqual(buildDeleteRowRequests(rows[5]), [{
    deleteTableRow: { tableCellLocation: { tableStartLocation: { index: 7, tabId: 't.0' }, rowIndex: 5, columnIndex: 0 } },
  }]);
});
