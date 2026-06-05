#!/usr/bin/env npx tsx
import { gwsJson } from './lib/gws';
import { parseGoogleUrl, addPin, readPins, removePin, PinType } from './lib/gws-edit-pin';

const args = process.argv.slice(2);
const cmd = args[0];

try {
  if (!cmd || cmd === 'help') {
    console.log('Usage: edit-google-pin.ts <url-or-id> | list | remove <alias|id>');
    process.exit(0);
  }

  if (cmd === 'list') {
    const pins = readPins();
    if (!pins.length) {
      console.log('No documents pinned this session.');
      process.exit(0);
    }
    for (const p of pins) console.log(`${p.alias}  [${p.type}]  ${p.title}  (${p.id})`);
    process.exit(0);
  }

  if (cmd === 'remove') {
    if (!args[1]) {
      console.error('Usage: edit-google-pin.ts remove <alias|id>');
      process.exit(1);
    }
    const ok = removePin(args[1]);
    console.log(ok ? `Removed ${args[1]}.` : `No pin matching ${args[1]}.`);
    process.exit(0);
  }

  // Otherwise: pin a URL or bare id.
  const { type, id } = parseGoogleUrl(cmd);

  // When the URL already tells us the type, read the title from the type-specific
  // API so pinning works without the Drive API enabled. Fall back to a Drive
  // lookup only for bare ids, where the type is unknown.
  let resolvedType: PinType;
  let title: string;
  if (type === 'doc') {
    resolvedType = 'doc';
    title = gwsJson(['docs', 'documents', 'get', '--params', JSON.stringify({ documentId: id })]).title;
  } else if (type === 'sheet') {
    resolvedType = 'sheet';
    const sheet = gwsJson([
      'sheets', 'spreadsheets', 'get',
      '--params', JSON.stringify({ spreadsheetId: id, fields: 'properties.title' }),
    ]);
    title = sheet.properties?.title;
  } else {
    const info = gwsJson([
      'drive', 'files', 'get',
      '--params', JSON.stringify({ fileId: id, fields: 'name,mimeType', supportsAllDrives: true }),
    ]);
    if (info.mimeType === 'application/vnd.google-apps.document') {
      resolvedType = 'doc';
    } else if (info.mimeType === 'application/vnd.google-apps.spreadsheet') {
      resolvedType = 'sheet';
    } else {
      console.error(`Unsupported file type: ${info.mimeType} (only Google Docs and Sheets).`);
      process.exit(1);
    }
    title = info.name;
  }

  const pin = addPin({ type: resolvedType, id, title: title || id });
  console.log(`Pinned ${resolvedType}: "${pin.title}" as "${pin.alias}" (${pin.id}).`);
  process.exit(0);
} catch (err: any) {
  console.error(err?.stderr?.toString?.() || err?.message || String(err));
  process.exit(1);
}
