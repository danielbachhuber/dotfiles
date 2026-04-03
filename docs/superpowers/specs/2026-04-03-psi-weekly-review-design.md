# psi-weekly-review Skill Design

## Overview

A user-invocable Claude Code skill that helps Daniel prepare his weekly work journal entry for New_ Public / PSI. The skill gathers context from multiple data sources, facilitates executive-coaching-style reflection, and reviews the final journal entry for substance and completeness.

**Location:** `./claude/skills/psi-weekly-review/SKILL.md`, symlinked to `~/.claude/skills/psi-weekly-review/SKILL.md`

**Invocation:** `/psi-weekly-review` with an optional date range argument. Defaults to the current work week (Monday of this week through today). If invoked on a weekend, defaults to the most recent full work week (Monday–Friday).

**Target document:** Google Doc `1uu2O_n2BtjQmTiyUHB4PcFPYkfe1FUoB7xbDs1HnwAI` (Daniel's public work journal).

## Three-Phase Workflow

### Phase 1: Context Gathering

Gather data from 8 sources, running queries in parallel where possible. Then present a structured "Week in Review" summary.

**Data sources:**

1. **Harvest time entries** — `hrvst time-entries list --from <start> --to <end> --project_id 45188004 --per_page 2000 --page all --fields task.name,hours,notes,spent_date`. Aggregate hours by category (Development, Code Review, Documentation, Support, Meetings, Admin, Biz, etc.) and surface any notable entry notes.

2. **GitHub PRs authored** — PRs created or merged by `danielbachhuber` in `wearenewpublic/psi-product` during the period. Include title, status, merge date, and key details.

3. **GitHub PRs reviewed** — PRs where Daniel left reviews in `wearenewpublic/psi-product`. Include title, author, and review outcome.

4. **Todoist completed tasks** — `td completed --since <start> --until <end> --json` for tasks completed during the week.

5. **Todoist all incomplete tasks** — `td task list --json` to get the full backlog (typically a few dozen). Flag:
   - **Overdue tasks** — past their due date
   - **Stale tasks** — no due date and not recently touched
   - **Upcoming tasks** — due in the next week or two

6. **Reflect daily notes** — Daily notes within the date range via Reflect MCP. Captures meeting notes, ad-hoc observations, and context.

7. **Slack conversations** — Search recent messages/conversations for the week via Slack MCP. Captures discussions, decisions, and interpersonal dynamics not reflected in other sources.

8. **Google Docs (1:1s and goals)** — Fetch via `~/.claude/scripts/fetch-google-doc.ts`:
   - `1crn913WdQoSeUVwTTjMdERQd4AtHkBk6-ODF1MhH8MI` — Annual goals
   - `12zcKSshHLQNYjS1kgFUFnnWTBHjkjNNLxcp3vxEASr0` — Daniel and Brendan check-ins
   - `1lRLDo5ykuU2P_vuWnGA-WjbkJRxXZ8hjj1qPg5Y48GA` — Daniel and Rob check-ins

**Summary presentation:** A structured overview including:
- Hours breakdown by category with totals
- PRs authored (title, status, key details)
- PRs reviewed (title, author)
- Notable Todoist completions
- Overdue, stale, and upcoming tasks
- Key Slack threads and decisions
- Highlights from Reflect daily notes
- Open threads from 1:1 docs relevant to the week

### Phase 2: Coaching Questions & Dialogue

Generate 5-7 targeted reflection questions grounded in the week's actual data.

**Question framework:** The 11 reflection questions from the journal doc serve as a starting framework:
- What did I accomplish that I'm genuinely proud of?
- What felt like wasted effort or low-leverage work? Why did it happen?
- Where can I make Kasiana or Corey's jobs easier? Where did I make their jobs harder?
- Did I push on anything that made me uncomfortable? What was the result?
- What decisions or bets did I make? How would I evaluate them now?
- Where am I slipping behind? What do I feel ahead on?
- How aligned is my current work with what matters to me long-term?
- What did I automate, delegate, or eliminate this month?
- What patterns in my energy, focus, or motivation did I notice?
- Where am I assuming constraints that might not be real?
- What feedback did I receive?

**Tailoring:** The skill selects the most relevant questions and sharpens them with specifics from the data. It may also generate novel questions that the data suggests. Examples:
- Harvest shows heavy development, zero documentation hours → ask about the recurring docs gap
- A 1:1 doc has an unresolved thread → ask how it landed
- Overdue Todoist tasks accumulating → ask if they're still relevant
- A tense Slack exchange → ask how it felt and how it resolved

**Conversational:** This phase is a dialogue, not a one-shot list. The skill:
- Presents the questions as a numbered list
- Engages in back-and-forth as the user reflects on answers
- Pushes back gently, asks follow-ups, helps sharpen thinking
- Continues until the user is ready to write

### Phase 3: Journal Entry Review

The user writes their journal entry — either in the conversation or in the Google Doc (skill reads via fetch-google-doc.ts).

**Review criteria — substance, not template compliance:**
- **Missed context** — Did you skip something significant the data showed? A big PR, a key Slack conversation, a win worth calling out?
- **Depth** — Are you being too vague, underselling wins, or skipping hard reflections?
- **Coaching thread** — If you explored something meaningful in Phase 2 dialogue, did it make it into the entry?
- **Consistency** — Do the Harvest hours roughly match what you describe?
- **Up Next clarity** — Is there a sense of what's ahead, informed by Todoist backlog and ongoing threads?

The journal template (Done/Wins/Reflections/Up Next) is a reference point, not a rubric. Narrative-style entries that cover the ground well are fine. The skill focuses on whether the entry reflects genuine, useful self-reflection — not whether it follows a format.

**Feedback style:** Direct and specific, not generic cheerleading. E.g.:
- "You merged 4 PRs this week but only mentioned 2 — the Firebase deploy fix seems worth noting"
- "Your reflections are thin relative to the situation with [person] you spent time discussing in Phase 2"
- "The Done section accounts for 15 hours but Harvest shows 32 — worth filling in the gap"

Multiple revision rounds supported. The user decides when they're done.

## Key Tools & Access

| Source | Tool | Notes |
| --- | --- | --- |
| Harvest | `hrvst` CLI | Always scope to `--project_id 45188004` |
| GitHub | `gh` CLI | Scope to `wearenewpublic/psi-product` |
| Todoist | `td` CLI | Completed + all incomplete tasks |
| Reflect | Reflect MCP (`mcp__reflect-notes__*`) | Daily notes + search |
| Slack | Slack MCP (`mcp__claude_ai_Slack__*`) | Conversations and messages |
| Google Docs | `~/.claude/scripts/fetch-google-doc.ts <docId>` | Journal, goals, 1:1 docs |
