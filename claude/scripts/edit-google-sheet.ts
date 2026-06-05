#!/usr/bin/env npx tsx
import { readFileSync } from 'fs';
import { runGws } from './lib/gws';
import { resolveTarget } from './lib/gws-edit-pin';
import { parseValues } from './lib/gws-sheet-edit';

function fail(msg: string): never {
  console.error(msg);
  process.exit(1);
}
function getFlag(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

const HELP = `Usage: edit-google-sheet.ts <command> [--sheet <alias|id>]

Edits the Google Sheet pinned via /edit-google. Omit --sheet when only one sheet
is pinned; otherwise pass the alias or id shown by \`edit-google-pin.ts list\`.

<values> is a JSON 2-D array (e.g. '[["a","b"],["c","d"]]') or naive
newline/comma-delimited text; use JSON for values containing commas.

Commands:
  get [range]             Read an A1 range (e.g. "Sheet1!A1:C10"). With no range,
                          returns whole-spreadsheet metadata.
  set <range> <values>    Overwrite a range (USER_ENTERED).
  append <range> <values> Append rows after the values in a range.
  apply <requests.json>   Escape hatch: apply a raw JSON array of spreadsheets
                          batchUpdate request objects (or {"requests":[...]}).
                          Use for formatting, adding/deleting rows or sheets, etc.`;

const [sub, ...rest] = process.argv.slice(2);
const sheetSel = getFlag(rest, 'sheet');
const positional = rest.filter((a, i) => !a.startsWith('--') && rest[i - 1] !== '--sheet');

try {
  if (!sub || sub === 'help' || sub === '--help' || sub === '-h' || rest.includes('--help') || rest.includes('-h')) {
    console.log(HELP);
    process.exit(0);
  }

  if (sub === 'get') {
    const range = positional[0];
    const pin = resolveTarget('sheet', sheetSel);
    const params: any = { spreadsheetId: pin.id };
    if (range) params.range = range;
    const method = range ? ['sheets', 'spreadsheets', 'values', 'get'] : ['sheets', 'spreadsheets', 'get'];
    console.log(runGws([...method, '--params', JSON.stringify(params)]));
    process.exit(0);
  }

  if (sub === 'set') {
    const range = positional[0];
    const valuesArg = positional[1];
    if (!range || valuesArg === undefined) fail('Usage: set <range> <values> [--sheet <alias|id>]');
    const pin = resolveTarget('sheet', sheetSel);
    runGws([
      'sheets', 'spreadsheets', 'values', 'update',
      '--params', JSON.stringify({ spreadsheetId: pin.id, range, valueInputOption: 'USER_ENTERED' }),
      '--json', JSON.stringify({ values: parseValues(valuesArg) }),
    ]);
    console.log(`Updated ${range} in sheet ${pin.id}.`);
    process.exit(0);
  }

  if (sub === 'append') {
    const range = positional[0];
    const valuesArg = positional[1];
    if (!range || valuesArg === undefined) fail('Usage: append <range> <values> [--sheet <alias|id>]');
    const pin = resolveTarget('sheet', sheetSel);
    runGws([
      'sheets', 'spreadsheets', 'values', 'append',
      '--params', JSON.stringify({ spreadsheetId: pin.id, range, valueInputOption: 'USER_ENTERED' }),
      '--json', JSON.stringify({ values: parseValues(valuesArg) }),
    ]);
    console.log(`Appended to ${range} in sheet ${pin.id}.`);
    process.exit(0);
  }

  if (sub === 'apply') {
    const file = positional[0];
    if (!file) fail('apply requires <requests.json>');
    const parsed = JSON.parse(readFileSync(file, 'utf-8'));
    const arr = Array.isArray(parsed) ? parsed : parsed.requests;
    if (!Array.isArray(arr)) fail('requests file must be a JSON array or {"requests":[...]}.');
    const pin = resolveTarget('sheet', sheetSel);
    runGws([
      'sheets', 'spreadsheets', 'batchUpdate',
      '--params', JSON.stringify({ spreadsheetId: pin.id }),
      '--json', JSON.stringify({ requests: arr }),
    ]);
    console.log(`Applied ${arr.length} request(s) to sheet ${pin.id}.`);
    process.exit(0);
  }

  fail(`Unknown subcommand: ${sub}`);
} catch (err: any) {
  console.error(err?.stderr?.toString?.() || err?.message || String(err));
  process.exit(1);
}
