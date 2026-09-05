/**
 * The row clock, stood down.
 *
 * The panels only render this behind `harvest.available`, which the fallback
 * bridge reports false, so this should never mount. It renders nothing rather
 * than throwing, so a stale listing cannot break the table.
 */
export function HarvestRowClock(_props: Record<string, unknown>): null {
  return null;
}
