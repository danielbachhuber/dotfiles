#!/usr/bin/env npx tsx

import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';

const path = process.argv[2];
if (!path) {
    console.error('Usage: create-gmail-draft.ts <path-to-markdown-file>');
    console.error('');
    console.error('The markdown file must have frontmatter with: from, to, subject (cc optional).');
    console.error('Body is rendered as HTML.');
    process.exit(1);
}

const content = readFileSync(path, 'utf-8');
const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
if (!match) {
    console.error('Failed to parse frontmatter from', path);
    process.exit(1);
}

const [, frontmatter, rawBody] = match;
const body = rawBody.replace(/^\n+/, '').replace(/\n+$/, '');

function parseScalar(field: string): string | null {
    const re = new RegExp(`^${field}:\\s*(.+)$`, 'm');
    const m = frontmatter.match(re);
    return m ? m[1].trim() : null;
}

function parseList(field: string): string[] {
    const lines = frontmatter.split('\n');
    const out: string[] = [];
    let inField = false;
    for (const line of lines) {
        if (line.startsWith(`${field}:`)) {
            const rest = line.slice(field.length + 1).trim();
            if (rest) {
                return [rest];
            }
            inField = true;
            continue;
        }
        if (inField) {
            if (line.startsWith('  - ')) {
                out.push(line.slice(4).trim());
            } else if (line.length > 0 && !line.startsWith(' ')) {
                break;
            }
        }
    }
    return out;
}

const from = parseScalar('from');
const subject = parseScalar('subject');
const to = parseList('to');
const cc = parseList('cc');

if (!from || !subject || to.length === 0) {
    console.error('Frontmatter must include from, subject, and at least one to recipient.');
    process.exit(1);
}

function escapeHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function mdToHtml(md: string): string {
    const lines = md.split('\n');
    const out: string[] = [];
    const listIndents: number[] = [];
    const paraBuf: string[] = [];

    function flushPara() {
        if (paraBuf.length) {
            out.push(`<p>${paraBuf.map(escapeHtml).join('<br>')}</p>`);
            paraBuf.length = 0;
        }
    }
    function closeListsTo(targetIndent: number | null) {
        while (listIndents.length && (targetIndent === null || listIndents[listIndents.length - 1] > targetIndent)) {
            out.push('</li></ul>');
            listIndents.pop();
        }
    }

    for (const line of lines) {
        const bullet = line.match(/^( *)- (.*)$/);
        if (bullet) {
            flushPara();
            const indent = bullet[1].length;
            const text = bullet[2];
            if (listIndents.length === 0) {
                out.push('<ul>');
                listIndents.push(indent);
                out.push(`<li>${escapeHtml(text)}`);
            } else {
                const top = listIndents[listIndents.length - 1];
                if (indent > top) {
                    out.push('<ul>');
                    listIndents.push(indent);
                    out.push(`<li>${escapeHtml(text)}`);
                } else {
                    closeListsTo(indent);
                    if (listIndents.length === 0 || listIndents[listIndents.length - 1] < indent) {
                        out.push('<ul>');
                        listIndents.push(indent);
                        out.push(`<li>${escapeHtml(text)}`);
                    } else {
                        out.push('</li>');
                        out.push(`<li>${escapeHtml(text)}`);
                    }
                }
            }
        } else if (line.trim() === '') {
            flushPara();
            closeListsTo(null);
        } else {
            closeListsTo(null);
            paraBuf.push(line);
        }
    }
    flushPara();
    closeListsTo(null);
    return out.join('\n');
}

const html = `<!DOCTYPE html><html><body>\n${mdToHtml(body)}\n</body></html>`;

const headers: string[] = [
    `From: ${from}`,
    `To: ${to.join(', ')}`,
];
if (cc.length > 0) {
    headers.push(`Cc: ${cc.join(', ')}`);
}
headers.push(`Subject: ${subject}`);
headers.push('MIME-Version: 1.0');
headers.push('Content-Type: text/html; charset=utf-8');

const rfc822 = headers.join('\r\n') + '\r\n\r\n' + html.replace(/\r?\n/g, '\r\n');
const raw = Buffer.from(rfc822, 'utf-8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

const payload = JSON.stringify({ message: { raw } });

const result = execFileSync(
    'gws',
    ['gmail', 'users', 'drafts', 'create',
     '--params', '{"userId": "me"}',
     '--json', payload],
    { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }
);

const cleaned = result.replace(/^Using keyring backend:.*\n/, '');
const draft = JSON.parse(cleaned);
console.log(`Draft created: ${draft.id}`);
console.log(`Recipients: To=${to.join(', ')}${cc.length ? `; Cc=${cc.join(', ')}` : ''}`);
console.log(`Open: https://mail.google.com/mail/u/0/#drafts/${draft.message?.id ?? draft.id}`);
