---
name: psi-weekly-review
description: Use when the user invokes /psi-weekly-review to prepare their weekly work journal entry
user_invocable: true
---

# PSI Weekly Review

Prepare Daniel's weekly work journal entry for New_ Public / PSI. Gather context from multiple data sources, facilitate executive-coaching-style reflection, and review the final journal entry for substance and completeness.

**Target document:** Google Doc `1uu2O_n2BtjQmTiyUHB4PcFPYkfe1FUoB7xbDs1HnwAI` (Daniel's New_ Public work journal).

**Date range:** Accept an optional date range argument. Default to the current work week (Monday of this week through today). If invoked on a weekend, default to the most recent full work week (Monday-Friday).

## Phase 1: Context Gathering

Gather data from 8 sources, running queries in parallel where possible. Then present a structured "Week in Review" summary.

### Data Sources

1. **Harvest time entries** — `hrvst time-entries list --from <start> --to <end> --project_id 45188004 --per_page 2000 --page all --fields task.name,hours,notes,spent_date`. Aggregate hours by category (Development, Code Review, Documentation, Support, Meetings, Admin, Biz, etc.) and surface any notable entry notes. Note: "Biz" is a general catch-all category for overhead work (responding to email, chatting in Slack, etc.). Treat it as necessary daily overhead (~1h/day) rather than a category worth questioning or drilling into.

2. **GitHub PRs authored** — PRs created or merged by `danielbachhuber` in `wearenewpublic/psi-product` during the period. Include title, status, merge date, and key details.

3. **GitHub PRs reviewed** — PRs where Daniel left reviews in `wearenewpublic/psi-product`. Include title, author, and review outcome.

4. **Todoist completed tasks** — `td completed --since <start> --until <end> --json` for tasks completed during the week. Note: `td completed` only returns completed tasks.

5. **Todoist incomplete tasks** — `td task list --json` to get all incomplete (not yet completed) tasks. Note: `td task list` only returns incomplete tasks. Do not cross-reference these two lists to infer completion status — treat each as authoritative for its own domain. Flag:
   - **Overdue tasks** — incomplete tasks past their due date
   - **Stale tasks** — incomplete tasks with no due date and not recently touched
   - **Upcoming tasks** — incomplete tasks due in the next week or two

6. **Reflect daily notes** — Daily notes within the date range via Reflect MCP. Captures meeting notes, ad-hoc observations, and context.

7. **Slack conversations** — Search recent messages/conversations for the week via Slack MCP. Captures discussions, decisions, and interpersonal dynamics not reflected in other sources.

8. **Google Docs (1:1s and goals)** — Fetch via `~/.claude/scripts/fetch-google-doc.ts`:
   - `1crn913WdQoSeUVwTTjMdERQd4AtHkBk6-ODF1MhH8MI` — Annual goals
   - `12zcKSshHLQNYjS1kgFUFnnWTBHjkjNNLxcp3vxEASr0` — Daniel and Brendan check-ins
   - `1lRLDo5ykuU2P_vuWnGA-WjbkJRxXZ8hjj1qPg5Y48GA` — Daniel and Rob check-ins
   - `1zXjK_GJ3sJVEi7qExn68N94eDZpPkrWZK5opEpmjgmI` — Daniel and Kasiana check-ins
   - `1d5MRwf9_SJtIEaXr2i6b8aqy7x7wgN33dcfMRUwnfSg` — PSI Team check-in

### Summary Presentation

Present a structured overview including:
- Hours breakdown by category with totals
- PRs authored (title, status, key details)
- PRs reviewed (title, author)
- Notable Todoist completions
- Overdue, stale, and upcoming tasks
- Key Slack threads and decisions
- Highlights from Reflect daily notes
- Open threads from 1:1 docs relevant to the week

## Phase 2: Day-by-Day Walkthrough & Coaching Questions

After the weekly summary, walk through each day of the week individually. For each day, present:
- What you worked on (from Harvest entries, Reflect notes, PRs, Slack)
- Hours breakdown for that day
- 1-2 targeted questions specific to that day's events

When summarizing conversations, meetings, or events, include the actual substance — names, decisions, key points, outcomes — not just that they happened. "1:1 with Corey about your future" is too vague. Include the scenarios discussed, what was decided, and what was left open.

This surfaces patterns that get lost in the aggregate: a day that was all meetings, a day where you got pulled into reactive work, a day where you were in flow. After completing the day-by-day walkthrough, present 3-5 additional questions about the week as a whole.

### Week-Level Question Framework

Generate targeted reflection questions grounded in the week's actual data.

### Question Framework

The 11 reflection questions from the journal doc serve as a starting framework:
- What did I accomplish that I'm genuinely proud of?
- What felt like wasted effort or low-leverage work? Why did it happen?
- Where can I make my peers' or boss' jobs easier? Where did I make their jobs harder?
- Did I push on anything that made me uncomfortable? What was the result?
- What decisions or bets did I make? How would I evaluate them now?
- Where am I slipping behind? What do I feel ahead on?
- How aligned is my current work with what matters to me long-term?
- What did I automate, delegate, or eliminate this month?
- What patterns in my energy, focus, or motivation did I notice?
- Where am I assuming constraints that might not be real?
- What feedback did I receive?

### Tailoring

Select the most relevant questions and sharpen them with specifics from the data. Generate novel questions when the data suggests them. Examples:
- Harvest shows heavy development, zero documentation hours — ask about the recurring docs gap
- A 1:1 doc has an unresolved thread — ask how it landed
- Overdue Todoist tasks accumulating — ask if they're still relevant
- A tense Slack exchange — ask how it felt and how it resolved

### Conversational

This phase is a dialogue, not a one-shot list. Present the questions as a numbered list, then:
- Engage in back-and-forth as the user reflects on answers
- Push back gently, ask follow-ups, help sharpen thinking
- Continue until the user is ready to write

## Phase 3: Journal Entry Review

The user writes their journal entry — either in the conversation or in the Google Doc (read via `~/.claude/scripts/fetch-google-doc.ts 1uu2O_n2BtjQmTiyUHB4PcFPYkfe1FUoB7xbDs1HnwAI`).

### Review Criteria

Focus on substance, not template compliance. The journal template (Done/Wins/Reflections/Up Next) is a reference point, not a rubric. Narrative-style entries that cover the ground well are fine.

Review for:
- **Missed context** — Did you skip something significant the data showed? A big PR, a key Slack conversation, a win worth calling out?
- **Depth** — Are you being too vague, underselling wins, or skipping hard reflections?
- **Coaching thread** — If you explored something meaningful in Phase 2 dialogue, did it make it into the entry?
- **Consistency** — Do the Harvest hours roughly match what you describe?
- **Up Next clarity** — Is there a sense of what's ahead, informed by Todoist backlog and ongoing threads?

### Feedback Style

Be direct and specific, not generic cheerleading. Examples:
- "You merged 4 PRs this week but only mentioned 2 — the Firebase deploy fix seems worth noting"
- "Your reflections are thin relative to the situation with [person] you spent time discussing in Phase 2"
- "The Done section accounts for 15 hours but Harvest shows 32 — worth filling in the gap"

Multiple revision rounds supported. The user decides when they're done.
