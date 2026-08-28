import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@/components/ui/icon";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/** How long the tick stays up before the icon returns to the copy glyph. */
const COPIED_MS = 1500;

/**
 * Escapes text for an HTML attribute or text node.
 *
 * Not optional here. Real titles carry angle brackets — "Consider switching
 * <RichText> to use <UtilityText>" is a live issue — and pasting that raw into
 * a document would swallow everything between them.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** `<a href="…">title</a>`, which is what a document or a chat window wants. */
export function linkHtml(title: string, url: string): string {
  return `<a href="${escapeHtml(url)}">${escapeHtml(title)}</a>`;
}

/**
 * The plain-text flavour, for editors and terminals that take no HTML.
 *
 * Markdown rather than "title (url)": the places a plain-text paste lands from
 * here are GitHub comments, commit messages and editors, all of which render
 * it as the same link the HTML flavour produces.
 */
export function linkMarkdown(title: string, url: string): string {
  return `[${title}](${url})`;
}

/**
 * Writes both flavours in one clipboard entry, so the paste target picks.
 *
 * Falls back to plain text when the rich write is unavailable — a non-secure
 * context, or a browser without ClipboardItem. Copying something is better
 * than copying nothing, and the caller cannot tell the difference.
 */
export async function writeLinkToClipboard(title: string, url: string): Promise<boolean> {
  const html = linkHtml(title, url);
  const text = linkMarkdown(title, url);

  try {
    if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([text], { type: "text/plain" }),
        }),
      ]);
      return true;
    }
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * Copies a row's title and link as a rich-text link.
 *
 * Sized and coloured to sit in the muted line under the title: it is a quiet
 * affordance beside the metadata, not a third action competing with the row's
 * button.
 */
export function CopyLink({ title, url }: { title: string; url: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A row can be unmounted by a sweep landing mid-tick, and setting state on a
  // gone component is how this kind of button leaks a warning into every test.
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const onCopy = useCallback(async () => {
    if (!(await writeLinkToClipboard(title, url))) return;
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), COPIED_MS);
  }, [title, url]);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          // The label changes with the state so a screen reader hears the
          // confirmation the tick gives everyone else.
          aria-label={copied ? "Copied" : "Copy"}
          onClick={() => void onCopy()}
          className="inline-flex size-4 shrink-0 items-center justify-center rounded text-muted-foreground/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <Icon name={copied ? "Check" : "Copy"} className="size-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent>{copied ? "Copied" : "Copy"}</TooltipContent>
    </Tooltip>
  );
}
