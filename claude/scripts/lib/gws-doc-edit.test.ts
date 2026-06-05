// claude/scripts/lib/gws-doc-edit.test.ts
import { test } from 'node:test';
import assert from 'node:assert';
import { collectTabs, buildOutline } from './gws-doc-edit';

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

test('appendIndex returns the position before the final newline', () => {
  const tab = selectTab(collectTabs(BODY_DOC));
  assert.equal(appendIndex(tab), 29);
});
