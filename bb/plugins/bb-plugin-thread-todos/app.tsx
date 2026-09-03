import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  definePluginApp,
  useBbNavigate,
  useRealtime,
  useRpc,
  type PluginThreadHeaderActionProps,
  type PluginThreadPanelProps,
} from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { REALTIME_CHANNEL } from "./todos/contract.js";
import {
  countsFor,
  headerAriaLabel,
  headerLabel,
  orderForDisplay,
  rowStatusFor,
} from "./todos/list.js";
import type { Todo } from "./todos/types.js";
import type { rpcContract } from "./server.js";

const PANEL_ACTION_ID = "todos";

/** The realtime payload the server publishes on every mutation. */
type Signal = { threadId?: unknown };

/**
 * One thread's list, kept fresh by the realtime channel. Shared by the panel
 * and the header count so the two can never disagree about what is open.
 *
 * Every signal triggers a re-read rather than carrying rows, so a client that
 * missed a message recovers on the next one instead of drifting.
 */
function useTodos(threadId: string) {
  const rpc = useRpc<typeof rpcContract>();
  const [todos, setTodos] = useState<Todo[] | null>(null);

  const reload = useCallback(async () => {
    try {
      const result = await rpc.call("todos_list", { threadId });
      setTodos(result.todos);
    } catch (error) {
      // A failed read leaves the last good list on screen; an empty panel
      // would read as "nothing to do", which is the opposite of the truth.
      console.error("todos: list failed", error);
    }
  }, [rpc, threadId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useRealtime(
    REALTIME_CHANNEL,
    useCallback(
      (payload: unknown) => {
        if ((payload as Signal)?.threadId !== threadId) return;
        void reload();
      },
      [reload, threadId],
    ),
  );

  return { todos, setTodos, rpc, reload };
}

/**
 * The "Todo" tab in bb's thread panel. The add field sits at the top, above
 * the list; checkboxes run down the left.
 */
function TodoPanel({ threadId }: PluginThreadPanelProps) {
  const { todos, setTodos, rpc } = useTodos(threadId);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const ordered = useMemo(() => orderForDisplay(todos ?? []), [todos]);
  const counts = useMemo(() => countsFor(threadId, todos ?? []), [threadId, todos]);
  const doneCount = counts.done;

  const run = useCallback(
    async (work: () => Promise<{ todos: Todo[] }>, failure: string) => {
      try {
        setTodos((await work()).todos);
      } catch (error) {
        toast.error(failure, {
          description: error instanceof Error ? error.message : undefined,
        });
      }
    },
    [setTodos],
  );

  const toggle = useCallback(
    (todo: Todo) =>
      run(
        () =>
          rpc.call("todos_set_status", {
            threadId,
            ids: [todo.id],
            status: todo.status === "open" ? "done" : "open",
          }),
        "Could not update that item",
      ),
    [rpc, run, threadId],
  );

  const submitDraft = useCallback(() => {
    const text = draft.trim();
    if (text === "") return;
    setDraft("");
    inputRef.current?.focus();
    void run(
      () => rpc.call("todos_add", { threadId, texts: [text] }),
      "Could not add that item",
    );
  }, [draft, rpc, run, threadId]);

  if (todos === null) {
    return (
      <p className="px-3 py-3 text-sm text-muted-foreground">Loading…</p>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/*
        The composer sits above the list, not below it. A list that grows
        downward pushes a bottom-anchored field further from the item you just
        read, and on a long list the field is the thing you came for.
      */}
      <div className="flex flex-col gap-2 border-b px-3 py-3">
        <div className="flex items-center gap-2">
          <Input
            ref={inputRef}
            value={draft}
            placeholder="Add a step…"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              submitDraft();
            }}
          />
          <Button onClick={submitDraft} disabled={draft.trim() === ""}>
            Add
          </Button>
        </div>
        {doneCount > 0 && (
          <button
            type="button"
            className="cursor-pointer self-start text-xs text-muted-foreground hover:text-foreground"
            onClick={() =>
              void run(
                () => rpc.call("todos_clear_done", { threadId }),
                "Could not clear the finished items",
              )
            }
          >
            Clear {doneCount} finished
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-3">
        {ordered.length === 0 ? (
          <EmptyState />
        ) : (
          <ul className="flex flex-col gap-0.5">
            {ordered.map((todo) => (
              <TodoRow
                key={todo.id}
                todo={todo}
                onToggle={() => void toggle(todo)}
                onRemove={() =>
                  void run(
                    () => rpc.call("todos_remove", { threadId, id: todo.id }),
                    "Could not remove that item",
                  )
                }
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function TodoRow({
  todo,
  onToggle,
  onRemove,
}: {
  todo: Todo;
  onToggle: () => void;
  onRemove: () => void;
}) {
  const done = todo.status === "done";
  return (
    <li className="group flex items-start gap-2.5 rounded py-1.5">
      <Checkbox
        checked={done}
        onCheckedChange={onToggle}
        className="mt-0.5 cursor-pointer"
        aria-label={done ? `Reopen ${todo.text}` : `Complete ${todo.text}`}
      />
      <span
        className={`flex-1 text-sm break-words ${
          done ? "text-muted-foreground line-through" : ""
        }`}
      >
        {todo.text}
      </span>
      {todo.source === "user" && (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="mt-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                You
              </span>
            </TooltipTrigger>
            <TooltipContent>You added this item</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${todo.text}`}
        className="cursor-pointer opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
      >
        <Icon name="X" className="size-3.5 text-muted-foreground" />
      </button>
    </li>
  );
}

/**
 * An empty list is the normal state at the start of a thread, so this explains
 * what will fill it rather than apologising. The glyph is the same one the
 * sidebar uses, so the two read as one feature.
 */
function EmptyState() {
  return (
    <div className="flex flex-col items-center gap-2 py-10 text-center">
      <Icon name="ListTodo" className="size-8 text-muted-foreground/50" />
      <p className="text-sm text-muted-foreground">Nothing on the list yet.</p>
      <p className="max-w-[38ch] text-xs text-muted-foreground/80">
        The agent adds its steps here as it plans, and checks them off as it
        goes. You can add your own below.
      </p>
    </div>
  );
}

/**
 * The live count in the thread header. Renders nothing on a thread with no
 * list at all, so it stays out of the way until there is something to say.
 */
function TodoCount({ threadId, isCompactViewport }: PluginThreadHeaderActionProps) {
  const { todos } = useTodos(threadId);
  const navigate = useBbNavigate();

  const counts = useMemo(
    () => (todos ? countsFor(threadId, todos) : null),
    [threadId, todos],
  );
  // Only the first load is silent. Rendering "Add todo" before the list
  // arrives would flash a call to action on a thread that already has one.
  if (counts === null) return null;
  const label = headerLabel(counts);

  return (
    <Button
      variant="ghost"
      size="sm"
      // The header is a 48px chrome row of 28px controls, and it is short on a
      // phone — there, the glyph carries the meaning and the label is the
      // accessible name.
      className="h-7 cursor-pointer gap-1.5"
      aria-label={headerAriaLabel(counts)}
      onClick={() => {
        if (!navigate.openThreadPanel({ actionId: PANEL_ACTION_ID })) {
          toast.error("This surface has no thread panel to open the list in.");
        }
      }}
    >
      <Icon name="ListTodo" className="size-3.5" />
      {isCompactViewport ? null : label}
    </Button>
  );
}

export default definePluginApp((app) => {
  app.slots.threadPanelAction({
    id: PANEL_ACTION_ID,
    title: "Todo",
    icon: "ListTodo",
    component: TodoPanel,
    layout: "flush",
  });

  app.slots.experimental_threadHeaderAction({
    id: "todo-count",
    title: "Todo list",
    component: TodoCount,
  });

  // The sidebar indicator. A content script, not a slot: `setThreadRowStatus`
  // lives only on the content-script context, and decorating rows for threads
  // you are not looking at is the entire point of the indicator.
  //
  // It polls rather than subscribing. The realtime channel reaches plugin
  // components through `useRealtime`, and a content script is not a component,
  // so there is no hook context to subscribe from. The read is one grouped
  // count over a small local table, and it pauses while the window is hidden.
  app.contentScripts.register({
    id: "sidebar-todo-glyph",
    mount: (context) => {
      const setRowStatus = context.experimental_setThreadRowStatus;
      // Feature-detected: the SDK marks it optional while it rolls out across
      // 0.x clients, and an older client should lose the glyph, not the plugin.
      //
      // It says so out loud. No shipped bb implements this yet — 0.40 and 0.41
      // carry neither `setThreadRowStatus` nor content scripts at all — so this
      // branch is currently the only one taken, and a decorator that vanishes
      // without a word is indistinguishable from one that is broken.
      if (!setRowStatus) {
        console.info(
          "todos: this bb client has no experimental_setThreadRowStatus, so " +
            "sidebar row glyphs are unavailable. The header count and panel " +
            "are unaffected.",
        );
        return;
      }

      const decorated = new Set<string>();
      let disposed = false;
      let timer: number | null = null;

      async function refresh(): Promise<void> {
        if (disposed) return;
        let body: { counts?: { threadId: string; open: number; done: number }[] };
        try {
          const response = await fetch(
            `/api/v1/plugins/${context.pluginId}/rpc/todos_counts`,
            {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({}),
            },
          );
          if (!response.ok) return;
          body = await response.json();
        } catch {
          // A failed poll leaves the last painted glyphs alone. Clearing them
          // on a transient error would read as "this thread is finished".
          return;
        }
        if (disposed) return;

        const seen = new Set<string>();
        for (const counts of body.counts ?? []) {
          const status = rowStatusFor(counts);
          if (!status) continue;
          seen.add(counts.threadId);
          setRowStatus!(counts.threadId, status);
        }
        // Clear rows that had a glyph and no longer earn one, or the badge
        // outlives the work it described.
        for (const threadId of decorated) {
          if (!seen.has(threadId)) setRowStatus!(threadId, null);
        }
        decorated.clear();
        for (const threadId of seen) decorated.add(threadId);
      }

      /** Poll while the window is visible; stand down while it is not. */
      function reschedule(): void {
        if (timer !== null) window.clearInterval(timer);
        timer = null;
        if (disposed || document.hidden) return;
        void refresh();
        timer = window.setInterval(() => void refresh(), 5_000);
      }

      document.addEventListener("visibilitychange", reschedule);
      reschedule();

      const stop = () => {
        disposed = true;
        if (timer !== null) window.clearInterval(timer);
        document.removeEventListener("visibilitychange", reschedule);
      };
      context.signal.addEventListener("abort", stop);
      return stop;
    },
  });
});
