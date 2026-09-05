/**
 * Timer defaults for a GitHub row.
 *
 * Unlike the clock, this one *is* called unconditionally — `isRunningFor`
 * reads `externalReference.groupId` on every row, whether or not Harvest is
 * available — so it has to return the real shape. A null groupId is the same
 * answer the real function gives for a row it cannot place.
 */
export function timerDefaultsForItem(_row: unknown): {
  notes: string;
  externalReference: {
    id: string;
    groupId: string | null;
    accountId: string | null;
    permalink: string | null;
  };
} {
  return {
    notes: "",
    externalReference: { id: "", groupId: null, accountId: null, permalink: null },
  };
}
