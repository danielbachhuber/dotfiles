/**
 * A prompt and its caller drift apart quietly: the prompt grows a placeholder,
 * nothing substitutes it, and the agent is handed the literal `{{FROM}}`. The
 * keys below are the ones `server.ts` passes for each step, so a new
 * placeholder fails here rather than in a thread.
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_FEEDBACK_PROMPT,
  DEFAULT_NOTES_PROMPT,
  DEFAULT_SLACK_PROMPT,
  renderPrompt,
} from "./agents.js";

const CALLERS = {
  notes: {
    prompt: DEFAULT_NOTES_PROMPT,
    values: {
      FROM: "2026-09-07",
      TO: "2026-09-11",
      MEETINGS_COMMAND: "bb weekly-review meetings 2026-09-07",
      COMMAND: "bb weekly-review notes 2026-09-07 --file <path>",
    },
  },
  slack: {
    prompt: DEFAULT_SLACK_PROMPT,
    values: {
      FROM: "2026-09-07",
      TO: "2026-09-11",
      SEARCH_AFTER: "2026-09-06",
      SEARCH_BEFORE: "2026-09-12",
      COMMAND: "bb weekly-review slack 2026-09-07 --file <path>",
    },
  },
  feedback: {
    prompt: DEFAULT_FEEDBACK_PROMPT,
    values: {
      ENTRY: "### September 11th\n\nWrote some things.",
      DIGEST: "# Week of 2026-09-07 through 2026-09-11",
      MONDAY: "2026-09-07",
      COMMAND: "bb weekly-review feedback 2026-09-07 --file <path>",
    },
  },
};

describe("the agent prompts", () => {
  for (const [kind, { prompt, values }] of Object.entries(CALLERS)) {
    it(`${kind} has every placeholder its caller substitutes`, () => {
      const rendered = renderPrompt(prompt, values);
      expect(rendered).not.toMatch(/\{\{[A-Z_]+\}\}/);
    });
  }

  it("bounds the Slack search a day either side of the week", () => {
    const rendered = renderPrompt(DEFAULT_SLACK_PROMPT, CALLERS.slack.values);
    // Slack's after: and before: are exclusive. Passing the week's own dates
    // would silently drop the Monday and the Friday.
    expect(rendered).toContain("after:2026-09-06 before:2026-09-12");
  });

  it("asks the Slack step to record one entry per thread, not per message", () => {
    expect(DEFAULT_SLACK_PROMPT).toContain("one entry per thread");
  });
});
