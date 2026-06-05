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

export function pinFilePath(): string {
  const override = process.env.GWS_EDIT_PIN_FILE;
  if (override) return override;
  const dir = process.env.CLAUDE_CODE_TMPDIR || tmpdir();
  const session = process.env.CLAUDE_CODE_SESSION_ID || 'default';
  return join(dir, `gws-edit-${session}.json`);
}

export function readPins(): Pin[] {
  const p = pinFilePath();
  if (!existsSync(p)) return [];
  try {
    const data = JSON.parse(readFileSync(p, 'utf-8'));
    return Array.isArray(data.pins) ? data.pins : [];
  } catch {
    return [];
  }
}

export function writePins(pins: Pin[]): void {
  const p = pinFilePath();
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify({ pins }, null, 2));
}

export function addPin(input: { type: PinType; id: string; title: string }): Pin {
  const pins = readPins();
  const existing = pins.find(p => p.id === input.id && p.type === input.type);
  if (existing) {
    existing.title = input.title;
    existing.pinnedAt = new Date().toISOString();
    writePins(pins);
    return existing;
  }
  const alias = deriveAlias(input.title, pins.map(p => p.alias));
  const pin: Pin = { ...input, alias, pinnedAt: new Date().toISOString() };
  pins.push(pin);
  writePins(pins);
  return pin;
}

export function removePin(aliasOrId: string): boolean {
  const pins = readPins();
  const next = pins.filter(p => p.alias !== aliasOrId && p.id !== aliasOrId);
  writePins(next);
  return next.length !== pins.length;
}

export function clearPins(): void {
  writePins([]);
}
