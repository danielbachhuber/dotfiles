import { useCallback, useState } from "react";
import { useBbNavigate, useRpc, UrlLink } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { rpcContract } from "../server.js";

type Resolved = {
  repo: string;
  number: number;
  title: string;
  headRef: string;
  url: string;
  isDraft: boolean;
};

/**
 * Opens an existing pull request into a worktree of its own and starts a
 * thread there.
 *
 * bb's managed worktree always cuts a fresh branch off the base, so a thread
 * started the ordinary way is never on the pull request. This page makes the
 * worktree on the pull request's own branch, which is why it exists at all.
 */
export function OpenPullRequestPage() {
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();

  const [input, setInput] = useState("");
  const [instructions, setInstructions] = useState("");
  const [resolved, setResolved] = useState<Resolved | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [opening, setOpening] = useState(false);

  // Confirming before opening means a typo'd number fails in the form rather
  // than in a spawned thread with a worktree already on disk.
  const check = useCallback(
    async (value: string) => {
      if (value.trim() === "") {
        setResolved(null);
        setError(null);
        return;
      }
      setChecking(true);
      try {
        const result = await rpc.call("resolvePullRequest", { input: value });
        setResolved(result.pr);
        setError(result.error);
      } finally {
        setChecking(false);
      }
    },
    [rpc],
  );

  const open = useCallback(async () => {
    setOpening(true);
    try {
      const result = await rpc.call("openPullRequest", { input, instructions });
      if (result.threadId) {
        toast.success(`Opened at ${result.worktree}`);
        navigate.toThread(result.threadId);
      } else {
        setError(result.error);
        toast.error(result.error ?? "Could not open the pull request.");
      }
    } finally {
      setOpening(false);
    }
  }, [input, instructions, navigate, rpc]);

  return (
    <div className="h-full overflow-auto p-4 md:p-5">
      <div className="mx-auto w-full max-w-2xl space-y-5">
        <p className="text-sm text-muted-foreground">
          Checks out an existing pull request in its own worktree, on its own branch, and starts a
          thread there. Commits land on the pull request and a push updates it.
        </p>

        <div className="space-y-2">
          <label htmlFor="pr" className="block text-sm font-medium">
            Pull request
          </label>
          <Input
            id="pr"
            value={input}
            placeholder="5801, #5801, or a GitHub URL"
            autoFocus
            onChange={(event) => {
              setInput(event.target.value);
              setResolved(null);
              setError(null);
            }}
            onBlur={(event) => void check(event.target.value)}
          />
          {checking ? <p className="text-xs text-muted-foreground">Looking it up…</p> : null}
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          {resolved ? (
            <div className="rounded-lg border border-border p-3 text-sm">
              <UrlLink
                href={resolved.url}
                target="_blank"
                rel="noreferrer"
                className="font-medium hover:underline"
              >
                {resolved.title} (#{resolved.number})
              </UrlLink>
              <p className="mt-1 text-xs text-muted-foreground">
                {resolved.repo} · branch <span className="font-mono">{resolved.headRef}</span>
                {resolved.isDraft ? " · draft" : ""}
              </p>
            </div>
          ) : null}
        </div>

        <div className="space-y-2">
          <label htmlFor="instructions" className="block text-sm font-medium">
            What to do <span className="font-normal text-muted-foreground">(optional)</span>
          </label>
          <textarea
            id="instructions"
            value={instructions}
            rows={4}
            placeholder="Leave blank to open it and wait."
            onChange={(event) => setInstructions(event.target.value)}
            className="w-full rounded-md border border-border bg-background p-2 text-sm"
          />
        </div>

        <div className="flex items-center gap-3">
          <Button disabled={!resolved || opening} onClick={() => void open()}>
            {opening ? "Opening…" : "Open pull request"}
          </Button>
          {resolved ? (
            <span className="text-xs text-muted-foreground">
              A worktree is created beside the checkout and is not removed when the thread is
              archived.
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
