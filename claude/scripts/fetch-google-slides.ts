#!/usr/bin/env npx tsx

import { execSync } from 'child_process';

const presentationId = process.argv[2];
if (!presentationId) {
    console.error('Usage: fetch-google-slides.ts <presentationId>');
    process.exit(1);
}

const raw = execSync(
    `gws slides presentations get --params '{"presentationId": "${presentationId}"}'`,
    { encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] }
);

// Strip stderr noise like "Using keyring backend: keyring"
const jsonStr = raw.replace(/^Using keyring backend:.*\n/, '');
const data = JSON.parse(jsonStr);

function extractTextFromTextElements(textElements: any[]): string {
    const parts: string[] = [];
    for (const te of textElements) {
        const content = te.textRun?.content;
        if (content) {
            parts.push(content);
        }
    }
    return parts.join('').trim();
}

function extractShapeText(shape: any): string {
    const textElements = shape?.text?.textElements ?? [];
    return extractTextFromTextElements(textElements);
}

function extractTableText(table: any): string {
    const rows: string[][] = [];
    for (const row of table.tableRows ?? []) {
        const cells: string[] = [];
        for (const cell of row.tableCells ?? []) {
            const textElements = cell.text?.textElements ?? [];
            cells.push(extractTextFromTextElements(textElements));
        }
        rows.push(cells);
    }
    if (rows.length === 0) return '';

    const lines: string[] = [];
    lines.push('| ' + rows[0].join(' | ') + ' |');
    lines.push('| ' + rows[0].map(() => '---').join(' | ') + ' |');
    for (let i = 1; i < rows.length; i++) {
        lines.push('| ' + rows[i].join(' | ') + ' |');
    }
    return lines.join('\n');
}

function extractGroupText(group: any): string {
    const parts: string[] = [];
    for (const child of group.children ?? []) {
        const text = extractElementText(child);
        if (text) parts.push(text);
    }
    return parts.join('\n');
}

function extractElementText(element: any): string {
    if (element.shape) return extractShapeText(element.shape);
    if (element.table) return extractTableText(element.table);
    if (element.elementGroup) return extractGroupText(element.elementGroup);
    return '';
}

const title = data.title ?? 'Untitled Presentation';
console.log(`# ${title}\n`);

const slides = data.slides ?? [];
for (let i = 0; i < slides.length; i++) {
    const slide = slides[i];
    console.log(`## Slide ${i + 1}`);

    const elements = slide.pageElements ?? [];
    for (const element of elements) {
        const text = extractElementText(element);
        if (text) {
            console.log(text);
        }
    }
    console.log();
}
