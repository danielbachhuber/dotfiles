import * as React from "react";

/**
 * The frame every panel's empty state sits in.
 *
 * Deliberately the same measurements as `LoadingGraphic` — centred, `py-20`,
 * one graphic over one line of type — so a panel that is still fetching and a
 * panel with nothing to show occupy the same space, and the transition between
 * them is only ever a change of content.
 *
 * No `role="status"` here, unlike the loading frame: an empty result is not a
 * busy state, and announcing it as one leaves a screen reader waiting for
 * something that has already finished. The glyph carries its own `role="img"`.
 *
 * Still, deliberately. Motion in these panels means work is happening, so an
 * empty state that moves reads as something still on its way.
 */
export function EmptyGraphic({
  graphic,
  headline,
  children,
}: {
  graphic: React.ReactNode;
  headline: string;
  /** The line under the headline: what to do next, or why the list is short. */
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-5 py-20 text-center">
      {graphic}
      <div className="max-w-md space-y-1">
        <p className="text-sm font-medium">{headline}</p>
        {children ? (
          <p className="text-xs break-words text-muted-foreground">{children}</p>
        ) : null}
      </div>
    </div>
  );
}
