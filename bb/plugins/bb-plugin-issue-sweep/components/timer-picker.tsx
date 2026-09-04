/**
 * The Harvest timer picker.
 *
 * DUPLICATED SOURCE. An identical copy lives in
 * `~/.dotfiles/bb/plugins/bb-plugin-issue-sweep/components/timer-picker.tsx`,
 * because bb plugins cannot render each other's React components and the two
 * plugins live in different repositories. `components/timer-picker.sha256`
 * records the expected hash of this file in both places, so editing one copy
 * fails its own test until the change is ported and both hashes updated.
 *
 * Two constraints keep the copy literal, and both are load-bearing:
 *   1. It imports only from `./picker-state.js`, `./time-format.js`, and
 *      `@/components/ui/*`, all of which exist in both plugins.
 *   2. It takes an injected `client` instead of calling `useRpc`, so the same
 *      source works over either plugin's transport.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

import {
  resolveSelection,
  tasksFor,
  withProject,
  type PickerProject,
  type PickerSelection,
} from "./picker-state.js";
import { formatHours } from "./time-format.js";

export interface PickerExternalReference {
  id: string;
  groupId: string | null;
  accountId: string | null;
  permalink: string | null;
}

export interface PickerEntry {
  id: number;
  projectName: string;
  taskName: string;
  notes: string | null;
  hours: number;
  timerStartedAt: string | null;
  externalReference: PickerExternalReference | null;
}

export interface HarvestTimerClient {
  assignments(): Promise<{ projects: PickerProject[] }>;
  trackedHours(input: { externalId: string; groupId?: string | null }): Promise<{ hours: number }>;
  startTimer(input: {
    projectId: number;
    taskId: number;
    notes: string;
    externalReference?: PickerExternalReference;
  }): Promise<{ entry: PickerEntry | null }>;
  lastSelection(input: { scope: string | null }): Promise<PickerSelection | null>;
}

export interface HarvestTimerPickerProps {
  client: HarvestTimerClient;
  defaults: { notes: string; externalReference?: PickerExternalReference };
  onStarted: (entry: PickerEntry | null) => void;
  onCancel: () => void;
}

export function HarvestTimerPicker({
  client,
  defaults,
  onStarted,
  onCancel,
}: HarvestTimerPickerProps) {
  const reference = defaults.externalReference;
  const scope = reference?.groupId ?? null;

  const [projects, setProjects] = useState<PickerProject[] | null>(null);
  const [selection, setSelection] = useState<PickerSelection | null>(null);
  const [notes, setNotes] = useState(defaults.notes);
  const [trackedHours, setTrackedHours] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);

  // A resolved load must not overwrite state after the popover closed.
  const isMounted = useRef(true);
  useEffect(() => {
    return () => {
      isMounted.current = false;
    };
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const [{ projects: loaded }, remembered] = await Promise.all([
          client.assignments(),
          client.lastSelection({ scope }),
        ]);
        if (!isMounted.current) return;

        setProjects(loaded);
        setSelection(resolveSelection(loaded, remembered));
      } catch {
        if (!isMounted.current) return;
        setProjects([]);
        setError("Could not reach Harvest.");
      }
    })();
  }, [client, scope]);

  useEffect(() => {
    if (reference === undefined) return;

    void (async () => {
      try {
        const { hours } = await client.trackedHours({
          externalId: reference.id,
          groupId: reference.groupId,
        });
        if (isMounted.current) setTrackedHours(hours);
      } catch {
        // A missing total is not worth a visible failure; the picker still
        // starts timers without it.
      }
    })();
  }, [client, reference]);

  const tasks = useMemo(
    () => tasksFor(projects ?? [], selection?.projectId ?? null),
    [projects, selection?.projectId],
  );

  const start = useCallback(async () => {
    if (selection === null || isStarting) return;

    setIsStarting(true);
    setError(null);

    try {
      const { entry } = await client.startTimer({
        projectId: selection.projectId,
        taskId: selection.taskId,
        notes,
        ...(reference === undefined ? {} : { externalReference: reference }),
      });
      onStarted(entry);
    } catch {
      // The draft stays exactly as typed. Clearing it because a request
      // failed is the worst possible response to a failed request.
      if (isMounted.current) setError("Could not start the timer. Try again.");
    } finally {
      if (isMounted.current) setIsStarting(false);
    }
  }, [client, isStarting, notes, onStarted, reference, selection]);

  const isLoading = projects === null;
  const hasProjects = projects !== null && projects.length > 0;

  return (
    <div className="flex w-full flex-col gap-3 p-3">
      <div className="flex flex-col gap-2">
        <Label className="text-xs text-muted-foreground">Project / Task</Label>

        {isLoading ? (
          <div className="h-9 animate-pulse rounded-md bg-muted" />
        ) : hasProjects ? (
          <>
            <Select
              value={String(selection?.projectId ?? "")}
              onValueChange={(value) =>
                setSelection(withProject(projects, Number(value)) ?? selection)
              }
            >
              <SelectTrigger aria-label="Project">
                <SelectValue placeholder="Choose a project" />
              </SelectTrigger>
              <SelectContent>
                {projects.map((project) => (
                  <SelectItem key={project.id} value={String(project.id)}>
                    {projectLabel(project)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={String(selection?.taskId ?? "")}
              onValueChange={(value) =>
                setSelection((current) =>
                  current === null ? current : { ...current, taskId: Number(value) },
                )
              }
            >
              <SelectTrigger aria-label="Task">
                <SelectValue placeholder="Choose a task" />
              </SelectTrigger>
              <SelectContent>
                {tasks.map((task) => (
                  <SelectItem key={task.id} value={String(task.id)}>
                    {task.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            No projects are assigned to you in Harvest.
          </p>
        )}
      </div>

      <div className="flex items-start gap-2">
        <div className="flex-1">
          <Label htmlFor="harvest-notes" className="sr-only">
            Notes
          </Label>
          <Textarea
            id="harvest-notes"
            value={notes}
            rows={2}
            onChange={(event) => setNotes(event.target.value)}
            className="resize-none"
          />
        </div>
        <div
          className="flex h-[3.75rem] w-20 shrink-0 items-center justify-center rounded-md border border-border text-xl tabular-nums"
          aria-label="Elapsed"
        >
          {formatHours(0)}
        </div>
      </div>

      {error === null ? null : (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="flex items-center gap-2">
        {hasProjects ? (
          <Button onClick={() => void start()} disabled={selection === null || isStarting}>
            {isStarting ? "Starting…" : "Start timer"}
          </Button>
        ) : null}
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      </div>

      {reference !== undefined && trackedHours > 0 ? (
        <p className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{defaults.notes}</span> has{" "}
          <span className="font-medium text-foreground">{formatHours(trackedHours)}</span> tracked
          to it.
        </p>
      ) : null}
    </div>
  );
}

function projectLabel(project: PickerProject): string {
  const name = project.code === null ? project.name : `${project.name} (${project.code})`;
  return project.clientName === null ? name : `${project.clientName} · ${name}`;
}
