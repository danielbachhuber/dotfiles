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

test('collectTabs handles tabbed docs', () => {
  const tabs = collectTabs(TABS_DOC);
  assert.equal(tabs.length, 1);
  assert.equal(tabs[0].tabId, 't.0');
});

test('buildOutline lists paragraphs with style, text, and indices', () => {
  const outline = buildOutline(BODY_DOC);
  assert.equal(outline.length, 2);
  assert.deepEqual(outline[0], { tabId: null, style: 'HEADING_1', text: 'Section One', startIndex: 1, endIndex: 13 });
  assert.equal(outline[1].text, 'First paragraph.');
});
