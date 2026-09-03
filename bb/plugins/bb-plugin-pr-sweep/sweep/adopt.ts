/**
 * Recognising a thread someone started by hand for a pull request this sweep
 * knows.
 *
 * A thread created from the composer carries no link to anything: bb names it
 * from the model's reading of the first prompt, the row keeps offering to start
 * a thread for work already underway, and the panel shows nothing about it.
 * What the thread does carry is whatever the prompt said, and a prompt about a
 * pull request almost always contains its URL.
 *
 * The URL is the whole basis for the match, deliberately. GitHub numbers issues
 * and pull requests in one sequence per repository, so a bare "#5879" cannot
 * say which of the two it means — but `/pull/5879` can, and `/issues/5837`
 * belongs to issue-sweep. Nothing here reads a number out of prose.
 */

/** Owner/name and number from a GitHub pull request URL, repository lowercased as GitHub compares it. */
export interface PullRequestReference {
  repo: string;
  number: number;
}

/**
 * Both kinds, in one pass, because the two sweeps have to agree on who claims
 * a thread and the only way to agree is to look at the same thing.
 *
 * A trailing path segment is normal and must not stop the match: links to a
 * diff (`/files`), a commit range, or a review comment all carry one, a link
 * pasted from a browser may carry a query string, and an issue comment
 * permalink ends in `#issuecomment-...`.
 */
const WORK_ITEM_URL =
  /https?:\/\/(?:www\.)?github\.com\/([A-Za-z0-9._-]+\/[A-Za-z0-9._-]+)\/(issues|pull)\/(\d+)/g;

type WorkItemKind = "issue" | "pull";

interface WorkItem extends PullRequestReference {
  kind: WorkItemKind;
}

/**
 * Every distinct issue or pull request the text links to, in the order they
 * first appear. De-duplicated: a prompt naming the same thing twice is still
 * about one thing.
 */
function workItems(text: string): WorkItem[] {
  const seen = new Set<string>();
  const found: WorkItem[] = [];
  for (const match of text.matchAll(WORK_ITEM_URL)) {
    const repo = match[1]!.toLowerCase();
    const kind: WorkItemKind = match[2] === "pull" ? "pull" : "issue";
    const number = Number(match[3]);
    // A number too large to be exact would match the wrong row, or no row.
    if (!Number.isSafeInteger(number) || number <= 0) continue;
    const key = `${kind}:${repo}#${number}`;
    if (seen.has(key)) continue;
    seen.add(key);
    found.push({ kind, repo, number });
  }
  return found;
}

/** Every distinct pull request the text links to. Issue links are not pull requests. */
export function pullRequestReferences(text: string): PullRequestReference[] {
  return workItems(text)
    .filter((item) => item.kind === "pull")
    .map(({ repo, number }) => ({ repo, number }));
}

/**
 * The one pull request a thread is about, or null.
 *
 * The rule is exactly one work item in the whole prompt, not one pull request.
 * Anything else and the two sweeps would disagree about who owns the thread:
 * "work on <issue 5934> as a stacked PR on top of <pull 5937>" names one of
 * each, and both plugins claimed it, renamed it, and linked it — the title
 * ended up belonging to whichever swept last. A prompt about two things is a
 * prompt neither sweep should touch.
 */
export function solePullRequestReference(text: string): PullRequestReference | null {
  const items = workItems(text);
  if (items.length !== 1) return null;
  const only = items[0]!;
  return only.kind === "pull" ? { repo: only.repo, number: only.number } : null;
}

/**
 * Whether a thread is a candidate for adoption at all, before the cost of
 * reading its prompt.
 *
 * `originPluginId` is the important one: a thread this plugin started is
 * already linked, and a thread another plugin started belongs to that plugin's
 * own accounting. Only a null origin is someone typing into the composer.
 */
export function isAdoptable(thread: {
  id: string;
  originPluginId: string | null;
  archivedAt: number | null;
}): boolean {
  return thread.originPluginId === null && thread.archivedAt === null;
}
