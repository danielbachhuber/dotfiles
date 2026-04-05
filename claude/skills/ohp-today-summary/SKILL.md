---
name: ohp-today-summary
description: Use when the user invokes /ohp-today-summary to summarize their daily Oregon Housing Project work for their Daniel Kaizen journal
user_invocable: true
---

# OHP Today Summary

Summarize Daniel's Oregon Housing Project work for a given day, formatted as a journal entry for his Daniel Kaizen Google Doc.

**Target document:** Google Doc `1_LtlsnK-vd63ucv6Q_nxnWHpoLdzNpDjLPBrRc8e5Vk` (Daniel Kaizen journal).

**Date:** Accept an optional date argument (e.g. `/ohp-today-summary 2026-04-03`). Default to today.

## Data Gathering

Gather from these sources in parallel:

1. **Harvest time entries** — `hrvst time-entries list --from <date> --to <date> --project_id 47008800 --output json --per_page 100`. Extract total hours and any notes.

2. **GitHub PRs merged** — `gh pr list --repo danielbachhuber/oregon-housing-project --state merged --search "merged:<date>" --json number,title,mergedAt,body --limit 50`. Include title and key details from body.

3. **GitHub PRs opened** — `gh pr list --repo danielbachhuber/oregon-housing-project --state open --author danielbachhuber --json number,title,createdAt,body --limit 20`. Filter to PRs created on the target date.

4. **GitHub commits on main** — `gh api "/repos/danielbachhuber/oregon-housing-project/commits?author=danielbachhuber&since=<date>T00:00:00Z&until=<next_day>T00:00:00Z&per_page=100" --jq '.[].commit.message'`. Captures direct pushes not associated with PRs.

5. **GitHub issues** — `gh issue list --repo danielbachhuber/oregon-housing-project --state all --search "author:danielbachhuber created:<date>" --json number,title,state,body --limit 20`. Captures issues opened.

## Output Format

Produce a journal entry ready to paste into the Google Doc. Use this exact format:

```
<Month Dayth, Year>
*Oregon Housing Project — <X> hours <Y> minutes of work*

<1 sentence of personal context about the day>

<1-3 narrative paragraphs with specific accomplishments>
```

Note: The date line has no markdown heading prefix (no `###`) — it's styled as a heading in Google Docs directly. Use ordinal suffixes on the day (e.g., "April 5th", "March 22nd", "January 1st").

### Style Guide — Match Existing Entries

Study these real entries for tone and structure:

> April 5th, 2026
> *Oregon Housing Project — 3 hours 55 minutes of work*
>
> I disappeared from the family on a Sunday morning to hack on the project for a few hours.
>
> Big day of structural improvements and new content. The headline effort was [reorganizing legislation by session](https://github.com/danielbachhuber/oregon-housing-project/pull/251) — legislation directories are now named like `2025-regular-session/` instead of just `2025/`, which supports Oregon's structure where bill numbers can repeat across sessions. Also [split Key Concepts into individual pages](https://github.com/danielbachhuber/oregon-housing-project/pull/242) and [hid sidebar subpages by default](https://github.com/danielbachhuber/oregon-housing-project/pull/243), showing only prominent people and organizations.

Key patterns:
- **Open with a personal context sentence** about the day (e.g., "I disappeared from the family on a Sunday morning to hack on the project for a few hours." or "Squeezed in some work between meetings."). This is a personal journal — set the scene before diving into accomplishments. Daniel will refine this himself, so a reasonable placeholder is fine.
- **Follow with 1-3 substantive paragraphs**, using a bullet list for specific items when there are multiple discrete accomplishments.
- **Be specific.** Name bills, people, cities, scripts. "Added a profile for Mary Kyle McCurdy covering her 35-year career in Oregon land use advocacy" not "added a new person profile."
- **Group related PRs into one bullet** rather than listing each separately. Three PRs about legislation reorganization = one bullet.
- **Link PRs inline** using markdown links woven into the narrative text: `[reorganized legislation by session](https://github.com/danielbachhuber/oregon-housing-project/pull/251)`. Every PR should be linked, but the link text should be descriptive prose, not a PR number. When grouping related PRs, link the most representative one.
- **Distinguish authored vs. merged work.** Some PRs merged on a given day may have been created earlier (e.g. automated article PRs queued up). Note this when relevant rather than implying all work happened that day.
- **Note tooling context** when relevant (Claude Code, GitHub Actions, workflows) — the journal tracks how the project is built, not just what.
- **Include reflections** if something was interesting, challenging, or led to a realization. The journal is personal, not a changelog.
- **Hours go in the italicized header** — derive from Harvest, round to nearest 5 minutes (e.g. "2 hours 25 minutes", "4 hours"). Omit minutes if zero.

## Source Data Appendix

After the drafted entry, print a "Source Data" section listing everything referenced so the user can spot-check. Format:

```
---

**Source Data**

Harvest: <total hours>, task: <task name>, notes: <notes or "none">

PRs merged (<count>):
- #123 — Title
- #124 — Title
...

PRs opened (<count>):
- #125 — Title
...

Issues (<count>):
- #126 — Title (state)
...

Commits not associated with PRs (<count>):
- <short commit message>
...
```

Omit any section that has zero items. This section is for review only — it is not part of the journal entry.

## Personal Context Prompt

After presenting the draft and source data, prompt Daniel for what's on his mind — the personal context sentence at the top of the entry. For example:

> What's on your mind for the personal opener? (e.g., "I disappeared from the family on a Sunday morning to hack on the project for a few hours.")
