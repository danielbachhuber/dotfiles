/**
 * One entry in an issue's `projectItems`, narrowed to what placement needs.
 *
 * An issue can sit on several projects at once, and most of these sit on two —
 * a team board and someone's personal one. Reading "the first project item"
 * would pick whichever GitHub returned first, so the board is named and the
 * rest ignored.
 *
 * The board's name is a plugin setting rather than a constant: it identifies a
 * private org project, and this repository is public.
 */
export interface ProjectItem {
  title?: string;
  status?: { name?: string } | null;
}

/**
 * Whether an issue sits on the configured board, and what its Status column
 * says there.
 *
 * These are two questions, not one. An issue added to a board without a status
 * is on it, in the board's own "No Status" column, and reporting that as "not
 * on a board" would offer to add an issue that is already there.
 */
export interface BoardPlacement {
  onBoard: boolean;
  status: string | null;
}

export function boardPlacement(
  items: ProjectItem[] | null | undefined,
  board: string,
): BoardPlacement {
  const wanted = board.trim().toLowerCase();
  let onBoard = false;
  for (const item of items ?? []) {
    const title = (item.title ?? "").trim();
    if (wanted !== "" && title.toLowerCase() !== wanted) continue;
    onBoard = true;
    const status = (item.status?.name ?? "").trim();
    if (status !== "") return { onBoard: true, status };
  }
  return { onBoard, status: null };
}

/** The status alone, for callers that do not care about membership. */
export function boardStatus(
  items: ProjectItem[] | null | undefined,
  board: string,
): string | null {
  return boardPlacement(items, board).status;
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
