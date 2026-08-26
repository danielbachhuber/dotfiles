// bb-plugin-new-issue — frontend entry.
//
// A "New issue" row in the sidebar nav list opens this page: BB's own
// new-thread composer, wired to a backend that prepends the
// draft-issue-description instruction before spawning. Components under
// components/ui/ are vendored source (shadcn model) — edit them freely; add
// more with `npx shadcn add @bb/<name>`.
import { useCallback, useEffect, useState } from "react";
import {
  definePluginApp,
  experimental_NewThreadComposer as NewThreadComposer,
  useBbContext,
  useBbNavigate,
  useComposerView,
  useRpc,
} from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import type { rpcContract } from "./server";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";

/**
 * BB's composer owns every selection, so the page is the surrounding copy and
 * the submit wiring. Do not hand-roll a textarea and a start-thread button.
 */
function NewIssuePage() {
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  const { projectId } = useBbContext();

  const submit = useCallback(
    async (request: Parameters<
      React.ComponentProps<typeof NewThreadComposer>["onSubmit"]
    >[0]) => {
      try {
        const { threadId } = await rpc.call("issue_thread_create", {
          request: request as never,
        });
        navigate.toThread(threadId);
      } catch (cause) {
        toast.error(
          cause instanceof Error ? cause.message : "Could not start the thread.",
        );
        // Rethrow so the composer keeps the draft rather than clearing it.
        throw cause;
      }
    },
    [navigate, rpc],
  );

  return (
    <div className="h-full min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto box-border w-full max-w-3xl px-4 pb-4 pt-3 md:px-5 md:pt-4">
        <p className="text-sm text-muted-foreground">
          Say what the issue should cover. BB starts a thread in the project you
          pick and runs the <code>draft-issue-description</code> skill, which
          gathers context, pins permalinks, and shows you a draft before
          anything is filed. That skill is a Claude Code skill, so pick a Claude
          Code model unless you want the issue written without it.
        </p>
        <div className="mt-4">
          <NewThreadComposer
            defaultProjectId={projectId ?? undefined}
            placeholder="What exists today, why leaving it is a cost, and what done would look like."
            layout="document"
            onSubmit={submit}
          />
        </div>
      </div>
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
