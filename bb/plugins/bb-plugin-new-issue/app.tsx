// bb-plugin-new-issue — frontend entry.
//
// A "New issue" row in the sidebar nav list opens this page: pick a project
// and an execution selection, say what the issue should cover, submit, and
// land in the thread that drafts it. Components under components/ui/ are
// vendored source (shadcn model) — edit them freely; add more with
// `npx shadcn add @bb/<name>`.
import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import {
  definePluginApp,
  experimental_ProviderModelPicker as ProviderModelPicker,
  experimental_useProviders as useProviders,
  useBbContext,
  useBbNavigate,
  useComposerView,
  useRpc,
} from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import type { Execution, rpcContract } from "./server";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

interface Project {
  id: string;
  name: string;
}

/**
 * draft-issue-description is a user-level Claude Code skill, so a thread on
 * any other provider cannot resolve it by name. The picker still allows it —
 * this is the warning, not a lock.
 */
const SKILL_PROVIDER_ID = "claude-code";

/** The projects the thread can be spawned into, loaded once per mount. */
function useProjects() {
  const rpc = useRpc<typeof rpcContract>();
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    rpc.call("projects_list").then(
      (result) => {
        if (cancelled) return;
        setProjects(result.projects);
        setError(null);
      },
      (cause: unknown) => {
        if (cancelled) return;
        setError(cause instanceof Error ? cause.message : String(cause));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [rpc]);
  return { projects, error };
}

/**
 * The execution selection for one project: seeded from BB's own remembered
 * defaults, then owned by the picker. Re-seeds when the project changes, so
 * switching projects reloads that project's preferences rather than carrying
 * the previous one's over.
 */
function useExecution(projectId: string | null) {
  const rpc = useRpc<typeof rpcContract>();
  const [execution, setExecution] = useState<Execution | null>(null);
  useEffect(() => {
    if (projectId === null) return;
    let cancelled = false;
    setExecution(null);
    rpc.call("execution_defaults", { projectId }).then(
      (result) => {
        if (!cancelled) setExecution(result.execution);
      },
      (cause: unknown) => {
        if (cancelled) return;
        toast.error(
          cause instanceof Error
            ? cause.message
            : "Could not resolve the default model.",
        );
      },
    );
    return () => {
      cancelled = true;
    };
  }, [projectId, rpc]);
  return { execution, setExecution };
}

function NewIssuePage() {
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  const { projectId: contextProjectId } = useBbContext();
  const { projects, error } = useProjects();
  const { providers } = useProviders();
  const [picked, setPicked] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [pending, setPending] = useState(false);

  // Derived rather than seeded through an effect, so the picker is controlled
  // from its first render: the user's choice wins, then the project in view,
  // then whatever BB lists first.
  const projectId =
    picked ??
    projects?.find((project) => project.id === contextProjectId)?.id ??
    projects?.[0]?.id ??
    null;
  const { execution, setExecution } = useExecution(projectId);

  const submit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const brief = notes.trim();
      if (brief === "" || projectId === null || execution === null || pending) {
        return;
      }
      setPending(true);
      try {
        const { threadId } = await rpc.call("issue_thread_create", {
          projectId,
          notes: brief,
          execution,
        });
        // Only clear on success, so a failed spawn never loses what was typed.
        setNotes("");
        navigate.toThread(threadId);
      } catch (cause) {
        toast.error(
          cause instanceof Error ? cause.message : "Could not start the thread.",
        );
      } finally {
        setPending(false);
      }
    },
    [execution, navigate, notes, pending, projectId, rpc],
  );

  const canSubmit =
    !pending && notes.trim() !== "" && projectId !== null && execution !== null;
  const wrongProvider =
    execution !== null && execution.providerId !== SKILL_PROVIDER_ID;
  const providerName =
    providers.find((provider) => provider.id === execution?.providerId)
      ?.displayName ?? execution?.providerId;

  return (
    <div className="h-full min-h-0 flex-1 overflow-y-auto">
      <form
        onSubmit={submit}
        className="mx-auto box-border w-full max-w-3xl space-y-4 px-4 pb-4 pt-3 md:px-5 md:pt-4"
      >
        <p className="text-sm text-muted-foreground">
          Say what the issue should cover. BB starts a thread in the project you
          pick and runs the <code>draft-issue-description</code> skill, which
          gathers context, pins permalinks, and shows you a draft before
          anything is filed.
        </p>

        <div className="space-y-1.5">
          <Label htmlFor="new-issue-project">Project</Label>
          {error !== null ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : projects === null ? (
            <p className="text-sm text-muted-foreground">Loading projects…</p>
          ) : projectId === null ? (
            <p className="text-sm text-muted-foreground">
              No projects yet. Add one before filing an issue.
            </p>
          ) : (
            <Select
              value={projectId}
              onValueChange={setPicked}
              disabled={pending}
            >
              <SelectTrigger id="new-issue-project" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {projects.map((project) => (
                  <SelectItem key={project.id} value={project.id}>
                    {project.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        <div className="space-y-1.5">
          <Label>Agent</Label>
          {/* BB's own picker, so the catalog, defaults, and capability
              reconciliation match every other composer in the app. */}
          {projectId === null ? null : execution === null ? (
            <p className="text-sm text-muted-foreground">Loading models…</p>
          ) : (
            <ProviderModelPicker
              value={execution}
              onChange={setExecution}
              disabled={pending}
            />
          )}
          {wrongProvider ? (
            <p className="text-sm text-muted-foreground">
              <Icon
                name="AlertTriangle"
                className="mr-1 inline size-3.5 align-[-2px]"
              />
              {providerName} cannot load <code>draft-issue-description</code> —
              it is a Claude Code skill. The thread will still start, but it
              will write the issue without it.
            </p>
          ) : null}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="new-issue-notes">What the issue should cover</Label>
          <Textarea
            id="new-issue-notes"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            disabled={pending}
            rows={10}
            placeholder={
              "What exists today, why leaving it is a cost, and what done would look like.\n\nPaste review comments, file paths, or links — the agent can read the repo from there."
            }
            className="min-h-48 resize-y"
          />
        </div>

        <div className="flex items-center gap-3">
          <Button type="submit" disabled={!canSubmit}>
            <Icon name="Plus" className="size-4" />
            {pending ? "Starting thread…" : "Submit"}
          </Button>
          <span className="text-xs text-muted-foreground">
            Opens the new thread when it starts.
          </span>
        </div>
      </form>
    </div>
  );
}

/**
 * The one-click confirmation for a thread this plugin started. Renders nothing
 * anywhere else, so the control never appears in an unrelated composer.
 */
function useCreateIssue(threadId: string | null) {
  const rpc = useRpc<typeof rpcContract>();
  const [isOurs, setIsOurs] = useState(false);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (threadId === null) {
      setIsOurs(false);
      return;
    }
    let cancelled = false;
    rpc.call("thread_is_ours", { threadId }).then(
      (result) => {
        if (!cancelled) setIsOurs(result.isOurs);
      },
      // A failed lookup hides the button rather than showing a broken one.
      () => {
        if (!cancelled) setIsOurs(false);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [rpc, threadId]);

  const run = useCallback(async () => {
    if (threadId === null || pending) return;
    setPending(true);
    try {
      const { sent } = await rpc.call("issue_create_send", { threadId });
      if (!sent) toast.error("That thread was not started by New issue.");
    } catch (cause) {
      toast.error(
        cause instanceof Error ? cause.message : "Could not send the message.",
      );
    } finally {
      setPending(false);
    }
  }, [pending, rpc, threadId]);

  return { isOurs, pending, run };
}

/** In the composer action row, beside the native voice and submit controls. */
function CreateIssueComposerAction() {
  const { scope } = useComposerView();
  const threadId = scope.kind === "thread" ? scope.threadId : null;
  const { isOurs, pending, run } = useCreateIssue(threadId);
  if (!isOurs) return null;
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      disabled={pending}
      onClick={() => void run()}
    >
      <Icon name="CircleCheck" className="size-4" />
      Create issue
    </Button>
  );
}

/**
 * In the thread header's action row. The host clamps this row to 28px
 * controls, so it collapses to an icon on compact viewports.
 */
function CreateIssueHeaderAction({
  threadId,
  isCompactViewport,
}: {
  threadId: string;
  isCompactViewport: boolean;
}) {
  const { isOurs, pending, run } = useCreateIssue(threadId);
  if (!isOurs) return null;
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="h-7"
      disabled={pending}
      aria-label="Create issue"
      onClick={() => void run()}
    >
      <Icon name="CircleCheck" className="size-4" />
      {isCompactViewport ? null : "Create issue"}
    </Button>
  );
}

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "new-issue",
    title: "New issue",
    icon: "Plus",
    // Routed at /plugins/new-issue/new-issue.
    path: "new-issue",
    component: NewIssuePage,
  });

  app.composer.customize({
    id: "create-issue",
    scopes: ["thread"],
    actions: [{ id: "create-issue", component: CreateIssueComposerAction }],
  });

  app.slots.experimental_threadHeaderAction({
    id: "create-issue",
    title: "Create issue",
    component: CreateIssueHeaderAction,
  });
});
