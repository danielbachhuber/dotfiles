// claude/scripts/lib/gws-sheet-edit.ts
/** Parse a values argument: a JSON 2-D array, a flat JSON array (one column),
 *  or newline/comma-delimited CSV. Returns a 2-D array of cell values. */
export function parseValues(input: string): any[][] {
  const trimmed = input.trim();
  if (trimmed.startsWith('[')) {
    const parsed = JSON.parse(trimmed);
    if (!Array.isArray(parsed)) throw new Error('Values JSON must be an array.');
    return parsed.map(row => (Array.isArray(row) ? row : [row]));
  }
  return trimmed.split('\n').map(line => line.split(','));
}
