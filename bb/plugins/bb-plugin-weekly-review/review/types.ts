/**
 * Shared data contract between the fetch and render halves, inferred from the
 * zod schemas in `schema.ts`. Import these as types only: the frontend needs
 * the shapes, not zod's runtime.
 */
import type { z } from "zod";
import type {
  docRefSchema,
  githubDataSchema,
  harvestEntrySchema,
  issueSchema,
  pullRequestSchema,
  reflectNoteSchema,
  reviewSchema,
  slackThreadSchema,
  taskSchema,
  todoistDataSchema,
  weekDataSchema,
} from "./schema.js";

/** A calendar day, `YYYY-MM-DD`, in local time. */
export type Day = string;
/** A full ISO-8601 instant, as the upstream APIs return it. */
export type Instant = string;

export interface SourceResult<T> {
  ok: boolean;
  error?: string;
  fetchedAt: Instant;
  data: T;
}

export type HarvestEntry = z.infer<typeof harvestEntrySchema>;
export type PullRequest = z.infer<typeof pullRequestSchema>;
export type Review = z.infer<typeof reviewSchema>;
export type Issue = z.infer<typeof issueSchema>;
export type Task = z.infer<typeof taskSchema>;
export type ReflectNote = z.infer<typeof reflectNoteSchema>;
export type SlackThread = z.infer<typeof slackThreadSchema>;
export type DocRef = z.infer<typeof docRefSchema>;
export type GithubData = z.infer<typeof githubDataSchema>;
export type TodoistData = z.infer<typeof todoistDataSchema>;
export type WeekData = z.infer<typeof weekDataSchema>;
