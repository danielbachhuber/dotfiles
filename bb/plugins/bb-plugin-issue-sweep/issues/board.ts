/**
 * The status an issue carries on one particular board.
 *
 * An issue can sit on several projects at once, and most of these sit on two —
 * a team board and someone's personal one. Reading "the first project item"
 * would pick whichever GitHub returned first, so the board is named and the
 * rest ignored.
 *
 * The board's name is a plugin setting rather than a constant: it identifies a
 * private org project, and this repository is public.
 */
export function boardStatus(
  items: Array<{ title?: string; status?: { name?: string } | null }> | null | undefined,
  board: string,
): string | null {
  const wanted = board.trim().toLowerCase();
  for (const item of items ?? []) {
    const title = (item.title ?? "").trim();
    if (wanted !== "" && title.toLowerCase() !== wanted) continue;
    const status = (item.status?.name ?? "").trim();
    if (status !== "") return status;
  }
  return null;
}

/**
 * The order the panel lists statuses in, as configured. Anything the board
 * reports that is not named here still gets a section, after these, so a new
 * column on the board shows up rather than vanishing.
 */
export function parseStatusOrder(raw: string): string[] {
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
}

/** Sections in configured order, then any other status, then the unfiled. */
export function sectionOrder(configured: string[], present: readonly string[]): string[] {
  const seen = new Set(configured.map((s) => s.toLowerCase()));
  const extra = [...new Set(present)]
    .filter((status) => !seen.has(status.toLowerCase()))
    .sort((a, b) => a.localeCompare(b));
  return [...configured, ...extra];
}
