#!/usr/bin/env npx tsx

import { execSync } from 'child_process';

const docId = process.argv[2];
if (!docId) {
    console.error('Usage: fetch-google-doc.ts <documentId>');
    process.exit(1);
}

const raw = execSync(
    `gws docs documents get --params '{"documentId": "${docId}"}'`,
    { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] }
);

// Strip stderr noise like "Using keyring backend: keyring"
const jsonStr = raw.replace(/^Using keyring backend:.*\n/, '');
const data = JSON.parse(jsonStr);

function extractText(content: any[]): string {
    const lines: string[] = [];

    for (const block of content) {
        if (block.paragraph) {
            const para = block.paragraph;
            const style = para.paragraphStyle?.namedStyleType ?? '';
            let text = '';
            for (const elem of para.elements ?? []) {
                text += elem.textRun?.content ?? '';
            }
            const isBullet = !!para.bullet;
            const nestingLevel = para.bullet?.nestingLevel ?? 0;

            if (style === 'HEADING_1') {
                lines.push(`# ${text.trim()}`);
            } else if (style === 'HEADING_2') {
                lines.push(`## ${text.trim()}`);
            } else if (style === 'HEADING_3') {
                lines.push(`### ${text.trim()}`);
            } else if (style === 'HEADING_4') {
                lines.push(`#### ${text.trim()}`);
            } else if (isBullet) {
                const indent = '  '.repeat(nestingLevel);
                lines.push(`${indent}- ${text.trimEnd()}`);
            } else {
                lines.push(text.replace(/\n$/, ''));
            }
        } else if (block.table) {
            const rows: string[][] = [];
            for (const row of block.table.tableRows ?? []) {
                const cells: string[] = [];
                for (const cell of row.tableCells ?? []) {
                    let cellText = '';
                    for (const content of cell.content ?? []) {
                        if (content.paragraph) {
                            for (const elem of content.paragraph.elements ?? []) {
                                cellText += (elem.textRun?.content ?? '').trim();
                            }
                        }
                    }
                    cells.push(cellText);
                }
                rows.push(cells);
            }
            if (rows.length > 0) {
                // Print as markdown table
                lines.push('| ' + rows[0].join(' | ') + ' |');
                lines.push('| ' + rows[0].map(() => '---').join(' | ') + ' |');
                for (let i = 1; i < rows.length; i++) {
                    lines.push('| ' + rows[i].join(' | ') + ' |');
                }
            }
        }
    }

    return lines.join('\n');
}

const body = data.body?.content ?? [];
console.log(extractText(body));
