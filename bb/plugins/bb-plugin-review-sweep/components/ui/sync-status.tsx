import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * How long ago the last sweep landed, in the header's own budget.
 *
 * Relative rather than a clock time: "synced 4m ago" answers the question the
 * header is there for — is this list current — where "Last synced 5:57:16 AM"
 * makes you do the subtraction, and does not fit beside a button anyway.
 */
export function syncedAgo(sweptAt: number, now: number): string {
  const elapsed = Math.max(0, now - sweptAt);
  if (elapsed < MINUTE) return "just now";
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)}m ago`;
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)}h ago`;
  return `${Math.floor(elapsed / DAY)}d ago`;
}

/** How often the label re-reads the clock. See the comment in SyncStatus. */
const TICK_MS = 30_000;

/**
 * The sweep's freshness and its refresh control, for a panel's title bar.
 *
 * Presentation only. Each panel wires its own listing hook and refresh call,
 * because the contract and realtime channel differ per plugin, but they all
 * read identically in the title bar.
 */
export function SyncStatus({
  sweptAt,
  busy,
  onRefresh,
}: {
  sweptAt: number | null;
  busy: boolean;
  onRefresh: () => void;
}) {
  // The label ages on its own, so it has to re-read the clock rather than wait
  // for the next sweep. Without this it would sit on "just now" for the whole
  // sync interval and then jump.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="flex items-center gap-2">
      <span className="whitespace-nowrap text-xs text-muted-foreground">
        {sweptAt === null ? "not synced yet" : `synced ${syncedAgo(sweptAt, now)}`}
      </span>
      <Button size="sm" variant="outline" disabled={busy} onClick={onRefresh}>
        <Icon name="ArrowReloadHorizontal" aria-hidden="true" />
        {busy ? "Refreshing…" : "Refresh"}
      </Button>
    </div>
  );
}
