import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { classify } from "./classify.js";
import type { RawSearchResponse, SweepResult } from "./types.js";

const execFileAsync = promisify(execFile);

/**
 * `review-requested:@me`, not `user-review-requested:@me`. The two are not
 * synonyms: the former also matches a request that reached you through a team
 * you belong to, which is how most requests arrive in an org. The narrower
 * qualifier silently drops those.
 */
export const SEARCH_QUERY = "is:pr is:open review-requested:@me archived:false";

/** GitHub's search ceiling for one page. Hitting it is reported, not hidden. */
export const SEARCH_LIMIT = 50;

/**
 * One call for the whole sweep.
 *
 * pr-sweep discovers repositories and then fans out one `gh pr list` per repo,
 * because `statusCheckRollup` and `mergeable` are unavailable from search. This
 * plugin reads neither, and the field it does need most — when the review was
 * requested of you — has no `gh pr list --json` equivalent at all. So it asks
 * GraphQL directly and gets an exact timestamp instead of guessing from
 * `updatedAt`, which every unrelated comment bumps.
 */
export const SEARCH_GRAPHQL = `
query($q: String!, $limit: Int!) {
  viewer { login }
  search(query: $q, type: ISSUE, first: $limit) {
    nodes {
      ... on PullRequest {
        number
        title
        url
        isDraft
        createdAt
        additions
        deletions
        changedFiles
        repository { nameWithOwner }
        author { login }
        reviews(last: 100) {
          nodes { state submittedAt author { login } }
        }
        timelineItems(itemTypes: [REVIEW_REQUESTED_EVENT], last: 20) {
          nodes {
            ... on ReviewRequestedEvent {
              createdAt
              requestedReviewer {
                ... on User { login }
                ... on Team { slug }
              }
            }
          }
        }
      }
    }
  }
}`;

export class GhUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GhUnavailableError";
  }
}

export interface GhRunner {
  run(args: string[]): Promise<string>;
}

/** Argument-array spawn only. A shell string is never constructed. */
export function createGhRunner(ghPath: string): GhRunner {
  return {
    async run(args: string[]) {
      try {
        const { stdout } = await execFileAsync(ghPath, args, {
          maxBuffer: 32 * 1024 * 1024,
          timeout: 60_000,
        });
        return stdout;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (/ENOENT/.test(message)) {
          throw new GhUnavailableError(`\`${ghPath}\` was not found on PATH.`);
        }
        if (/auth|logged in|credentials|token/i.test(message)) {
          throw new GhUnavailableError("`gh` is not authenticated. Run `gh auth login`.");
        }
        throw error;
      }
    },
  };
}

/**
 * A GraphQL 200 can still carry errors alongside partial data. A response with
 * no viewer login is unusable — every classification compares against it — so
 * that is the one condition treated as a hard failure.
 */
export function parseSearch(raw: string): { viewer: string; nodes: RawSearchResponse } {
  const parsed = JSON.parse(raw) as RawSearchResponse & { errors?: Array<{ message?: string }> };
  const viewer = parsed.data?.viewer?.login;
  if (!viewer) {
    const detail = parsed.errors?.map((error) => error.message).filter(Boolean).join("; ");
    throw new Error(
      detail ? `GitHub rejected the query: ${detail}` : "GitHub returned no viewer login.",
    );
  }
  return { viewer, nodes: parsed };
}

export async function runSweep(gh: GhRunner, now: () => number): Promise<SweepResult> {
  const raw = await gh.run([
    "api",
    "graphql",
    "-f",
    `query=${SEARCH_GRAPHQL}`,
    // -f keeps the query a raw string; -F would type-coerce it. The limit is
    // the one parameter that genuinely has to arrive as an Int.
    "-f",
    `q=${SEARCH_QUERY}`,
    "-F",
    `limit=${SEARCH_LIMIT}`,
  ]);

  const { viewer, nodes } = parseSearch(raw);
  const found = nodes.data?.search?.nodes ?? [];

  return {
    rows: classify(found, viewer),
    truncated: found.length >= SEARCH_LIMIT,
    sweptAt: now(),
  };
}
