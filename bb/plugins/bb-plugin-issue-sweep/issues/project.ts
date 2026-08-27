import type { GhRunner } from "./gh.js";

/**
 * Reading a board's status is one thing; changing it is another, and this
 * module owns the second. The listing sweep only ever needs the status name,
 * which `gh issue list --json projectItems` hands over. Writing one needs three
 * opaque node ids GitHub never volunteers: the project, its Status field, and
 * the option being selected.
 *
 * None of them may be committed — the board is a private org project and this
 * repository is public — so all three are resolved at runtime from the board's
 * name, which is already a setting.
 */

export interface StatusOption {
  /** The option's node id, which is what `item-edit` actually takes. */
  id: string;
  name: string;
}

export interface BoardProject {
  /** `PVT_…`, required by `item-edit` alongside the item's own id. */
  id: string;
  /** The human-facing number, which is what `item-add` takes instead. */
  number: number;
  owner: string;
  title: string;
  /** `PVTSSF_…`, or null on a board with no single-select Status field. */
  statusFieldId: string | null;
  statusOptions: StatusOption[];
}

interface RawProject {
  id?: string;
  number?: number;
  title?: string;
  owner?: { login?: string };
}

/**
 * The named board among an owner's projects, matched case-insensitively on
 * title. Returns null rather than throwing so the caller can say which board
 * it looked for.
 */
export function parseProjectList(raw: string, board: string): BoardProject | null {
  const wanted = board.trim().toLowerCase();
  if (wanted === "") return null;

  let parsed: { projects?: RawProject[] };
  try {
    parsed = JSON.parse(raw) as { projects?: RawProject[] };
  } catch {
    return null;
  }

  for (const project of parsed.projects ?? []) {
    if ((project.title ?? "").trim().toLowerCase() !== wanted) continue;
    const id = project.id;
    const number = project.number;
    const owner = project.owner?.login;
    if (!id || typeof number !== "number" || !owner) continue;
    return {
      id,
      number,
      owner,
      title: (project.title ?? "").trim(),
      statusFieldId: null,
      statusOptions: [],
    };
  }
  return null;
}

interface RawField {
  id?: string;
  name?: string;
  type?: string;
  options?: Array<{ id?: string; name?: string }>;
}

/**
 * The board's own Status options, in the board's own order.
 *
 * Worth taking from the board rather than from the `statusOrder` setting: that
 * setting is a display preference and can name a column that does not exist,
 * whereas an option offered in the picker has to be one `item-edit` will
 * accept.
 */
export function parseStatusField(raw: string): { id: string; options: StatusOption[] } | null {
  let parsed: { fields?: RawField[] };
  try {
    parsed = JSON.parse(raw) as { fields?: RawField[] };
  } catch {
    return null;
  }

  for (const field of parsed.fields ?? []) {
    if ((field.name ?? "").trim().toLowerCase() !== "status") continue;
    if (!field.id) continue;
    const options: StatusOption[] = [];
    for (const option of field.options ?? []) {
      if (option.id && option.name) options.push({ id: option.id, name: option.name });
    }
    return { id: field.id, options };
  }
  return null;
}

export const ITEM_ID_QUERY = `
query($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    issue(number: $number) {
      projectItems(first: 20) { nodes { id project { id } } }
    }
  }
}`;

/**
 * The issue's item id on one project, or null when it is not on it.
 *
 * `gh issue list --json projectItems` reports a project item's status but not
 * its id, so this second lookup is unavoidable. It is deliberately per-issue
 * and on demand: the alternative, listing every item on the board to build a
 * map, costs hundreds of rows on every sweep to serve the rare click.
 */
export function parseIssueItemId(raw: string, projectId: string): string | null {
  let parsed: {
    data?: {
      repository?: {
        issue?: { projectItems?: { nodes?: Array<{ id?: string; project?: { id?: string } }> } };
      };
    };
  };
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  const nodes = parsed.data?.repository?.issue?.projectItems?.nodes ?? [];
  for (const node of nodes) {
    if (node.project?.id === projectId && node.id) return node.id;
  }
  return null;
}

/** The item id `item-add` reports, so a fresh add can be edited immediately. */
export function parseAddedItemId(raw: string): string | null {
  try {
    const parsed = JSON.parse(raw) as { id?: string };
    return parsed.id ?? null;
  } catch {
    return null;
  }
}

export class BoardUnavailableError extends Error {}

/**
 * Resolves the board and its Status field. Two calls, both cheap, and the
 * caller is expected to cache the result: a board's id and columns change far
 * less often than its contents.
 */
export async function fetchBoardProject(
  gh: GhRunner,
  owner: string,
  board: string,
): Promise<BoardProject> {
  if (board.trim() === "") {
    throw new BoardUnavailableError(
      "No project board is configured, so there is no board to place issues on.",
    );
  }

  const listed = await gh.run([
    "project", "list",
    "--owner", owner,
    "--format", "json",
  ]);
  const project = parseProjectList(listed, board);
  if (!project) {
    throw new BoardUnavailableError(`${owner} has no project board named "${board}".`);
  }

  const fields = await gh.run([
    "project", "field-list", String(project.number),
    "--owner", owner,
    "--format", "json",
  ]);
  const status = parseStatusField(fields);
  if (!status) return project;

  return { ...project, statusFieldId: status.id, statusOptions: status.options };
}

/** The owner half of an `owner/name` slug, which is who owns the board. */
export function ownerOf(repo: string): string {
  return repo.split("/")[0] ?? "";
}

export interface SetStatusArgs {
  project: BoardProject;
  repo: string;
  number: number;
  url: string;
  /** The option to select, or null to add to the board and set nothing. */
  option: StatusOption | null;
}

/**
 * Places an issue on the board at a given status, adding it first when it is
 * not there yet.
 *
 * Add-then-set rather than two separate user actions: an issue added to a board
 * with no status lands in the board's "No Status" column, which is the state
 * this panel exists to get issues out of.
 */
export async function setBoardStatus(
  gh: GhRunner,
  { project, repo, number, url, option }: SetStatusArgs,
): Promise<{ added: boolean }> {
  const [owner, name] = repo.split("/");
  if (!owner || !name) throw new BoardUnavailableError(`Not a repository slug: ${repo}`);

  const found = await gh.run([
    "api", "graphql",
    "-f", `query=${ITEM_ID_QUERY}`,
    "-f", `owner=${owner}`,
    "-f", `repo=${name}`,
    "-F", `number=${number}`,
  ]);

  let itemId = parseIssueItemId(found, project.id);
  const added = itemId === null;

  if (itemId === null) {
    const created = await gh.run([
      "project", "item-add", String(project.number),
      "--owner", project.owner,
      "--url", url,
      "--format", "json",
    ]);
    itemId = parseAddedItemId(created);
    if (!itemId) {
      throw new BoardUnavailableError(`Added #${number} to ${project.title}, but got no item id back.`);
    }
  }

  if (option) {
    if (!project.statusFieldId) {
      throw new BoardUnavailableError(`${project.title} has no Status field to set.`);
    }
    await gh.run([
      "project", "item-edit",
      "--id", itemId,
      "--project-id", project.id,
      "--field-id", project.statusFieldId,
      "--single-select-option-id", option.id,
    ]);
  }

  return { added };
}
