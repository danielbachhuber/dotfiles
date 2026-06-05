// claude/scripts/lib/gws-edit-pin.ts
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { tmpdir } from 'os';

export type PinType = 'doc' | 'sheet';

export interface Pin {
  type: PinType;
  id: string;
  alias: string;
  title: string;
  pinnedAt: string;
}

/** Kebab-case a title into a short alias, deduping against existing aliases. */
export function deriveAlias(title: string, existing: string[]): string {
  const base =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'doc';
  if (!existing.includes(base)) return base;
  let n = 2;
  while (existing.includes(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}
