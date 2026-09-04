import type { PickerExternalReference } from "../components/timer-picker.js";

export interface IssueTimerDefaults {
  notes: string;
  externalReference: PickerExternalReference;
}

/**
 * What a timer started from an issue row should be linked to and called.
 *
 * The reference deliberately mirrors the convention the Harvest Chrome
 * extension uses for GitHub: the bare issue number as `id`, the repository as
 * `groupId`, the owner as `accountId`. Harvest can only filter on `id`, so the
 * plugin narrows by group after the fetch. Inventing a tidier composite id
 * here would split the hours tracked in Chrome from the hours tracked in bb,
 * and each total would silently understate the work.
 */
export function timerDefaultsForIssue(row: {
  repo: string;
  number: number;
  title: string;
  url: string;
}): IssueTimerDefaults {
  const separator = row.repo.lastIndexOf("/");
  const owner = separator === -1 ? null : row.repo.slice(0, separator);
  const name = separator === -1 ? row.repo : row.repo.slice(separator + 1);

  return {
    notes: `#${row.number}: ${row.title}`,
    externalReference: {
      id: String(row.number),
      groupId: name,
      accountId: owner,
      permalink: row.url,
    },
  };
}
