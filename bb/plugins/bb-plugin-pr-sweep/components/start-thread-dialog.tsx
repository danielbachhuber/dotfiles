// Shared across the sweep plugins; kept byte-identical, like components/ui/*.
import { useEffect, useState } from "react";
import {
  experimental_NewThreadComposer as NewThreadComposer,
  UrlLink,
  type NewThreadComposerProps,
  type NewThreadRequest,
} from "@get-bb/plugin-sdk/app";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * What the plugin knows before BB's composer opens. Every field is a seed the
 * user may override; the plugin's settings decide them, the composer decides
 * what actually gets spawned.
 */
export type StartThreadSeed = {
  projectId: string;
  providerId: string | null;
  model: string | null;
  permissionMode: "accept-edits" | "auto" | "full";
  prompt: string;
  /**
   * Seeds the environment and branch pickers. Omitted where the plugin has no
   * opinion, which leaves the composer on its own default.
   */
  environment?: NewThreadComposerProps["defaultEnvironment"];
  /** The row itself, drawn as a card. Facts, not instructions: not editable. */
  preview: {
    title: string;
    number: number;
    url: string;
    meta: string;
  };
};

/**
 * A 32-bit digest of the seeded text, as a short base-36 string. Not a
 * checksum anyone depends on — just enough to tell one seeding from another.
 */
function digest(text: string): string {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

/**
 * The key BB persists this dialog's draft under.
 *
 * Per row, so editing one row's steer does not leak into the next row's. Per
 * seeding as well, because `initialPrompt` only seeds a draft that is still
 * empty: without the digest, a draft saved from an earlier open shadows the
 * seed forever, and a row whose findings have changed — or whose prompt this
 * plugin has since rewritten — keeps showing the old text with no way back.
 *
 * So an edit survives reopening the same row while the panel still says the
 * same thing, and is dropped once it no longer does. That is the right way
 * round: an edit is an argument with a particular steer, and it stops meaning
 * anything when that steer changes.
 */
export function draftKeyFor(row: string, seededPrompt: string): string {
  return `${row}:${digest(seededPrompt)}`;
}

/**
 * BB's own new-thread composer in a dialog: the prompt editor with @-mentions
 * and attachments, the provider/model/reasoning picker, and the row beneath
 * with project, environment, branch-from and permission mode. The plugin
 * supplies the seeds and receives the resolved request; it hand-rolls none of
 * those controls, which is the whole point of using this component.
 */
export function StartThreadDialog({
  open,
  onOpenChange,
  heading,
  description,
  draftKey,
  seed,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  heading: string;
  /**
   * For screen readers only. The card below carries the visible context, so
   * this says what the dialog is for rather than repeating the row's title.
   */
  description: string;
  /**
   * Identifies the row. The key actually used adds a digest of what was
   * seeded — see {@link draftKeyFor}.
   */
  draftKey: string;
  seed: StartThreadSeed | null;
  onSubmit: (request: NewThreadRequest) => Promise<void>;
}) {
  // Bumped on each open so the composer takes focus every time, not just on
  // the first mount.
  const [focusRequest, setFocusRequest] = useState(0);
  useEffect(() => {
    if (open) setFocusRequest((count) => count + 1);
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{heading}</DialogTitle>
          <DialogDescription className="sr-only">{description}</DialogDescription>
        </DialogHeader>
        {seed === null ? null : (
          <div className="max-h-[65vh] space-y-3 overflow-y-auto">
            {/*
              What the thread is for, as a card rather than as the first
              paragraph of an editable prompt. It identifies the row, so there
              is nothing to steer in it and editing it could only break the
              link between the thread and the row it came from.
            */}
            <div className="rounded-lg border border-border p-3 text-sm">
              <UrlLink
                href={seed.preview.url}
                target="_blank"
                rel="noreferrer"
                className="font-medium hover:underline"
              >
                {seed.preview.title} (#{seed.preview.number})
              </UrlLink>
              {seed.preview.meta ? (
                <p className="mt-1 text-xs text-muted-foreground">{seed.preview.meta}</p>
              ) : null}
            </div>
            <NewThreadComposer
              defaultProjectId={seed.projectId}
              defaultProviderId={seed.providerId ?? undefined}
              defaultModel={seed.model ?? undefined}
              defaultPermissionMode={seed.permissionMode}
              defaultEnvironment={seed.environment}
              initialPrompt={seed.prompt}
              placeholder="What should this thread do?"
              draftKey={draftKeyFor(draftKey, seed.prompt)}
              layout="document"
              focusRequest={focusRequest}
              onSubmit={onSubmit}
            />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
