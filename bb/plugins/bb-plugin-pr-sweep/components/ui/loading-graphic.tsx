import * as React from "react";

/**
 * Whether the viewer has asked their system to keep motion to a minimum.
 *
 * The loading glyphs are the one place these panels animate on their own,
 * without anyone having clicked anything, so they are exactly the motion this
 * setting is about. Each glyph reads its answer and draws itself settled
 * instead of moving.
 */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = React.useState(false);

  React.useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(query.matches);
    const onChange = (event: MediaQueryListEvent) => setReduced(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  return reduced;
}

/**
 * The frame every panel's loading glyph sits in.
 *
 * Deliberately the same measurements as the empty states — centred, `py-20`,
 * one graphic over one line of type — so a panel that is still fetching and a
 * panel with nothing to show occupy the same space and the transition between
 * them is only ever a change of content.
 *
 * The caption says what the panel is doing in the panel's own vocabulary, and
 * says it once: `role="status"` carries it to a screen reader, so there is no
 * second hidden "Loading…" underneath.
 */
export function LoadingGraphic({
  caption,
  children,
}: {
  caption: string;
  children: React.ReactNode;
}) {
  return (
    <div
      role="status"
      aria-busy="true"
      className="flex flex-col items-center gap-5 py-20 text-center"
    >
      {children}
      <p className="text-sm text-muted-foreground">{caption}</p>
    </div>
  );
}
