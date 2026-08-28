import { useEffect, useRef, useState } from "react";
import { UrlLink } from "@get-bb/plugin-sdk/app";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * Whether an element's content is wider than the box drawn for it.
 *
 * Defaults to true and stays true when the element cannot be measured — a
 * width of zero means it is not laid out, so there is no answer. Showing the
 * tooltip is the safer of the two failures: a redundant tooltip costs a
 * glance, an unreadable title costs the row.
 */
function useIsTruncated(text: string) {
  const ref = useRef<HTMLSpanElement>(null);
  const [truncated, setTruncated] = useState(true);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const measure = () =>
      setTruncated(element.clientWidth === 0 || element.scrollWidth > element.clientWidth);
    measure();

    if (typeof ResizeObserver === "undefined") return;
    // The column is fluid, so the answer changes with the window, not just
    // with the text.
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [text]);

  return { ref, truncated };
}

/**
 * A row's title, linked out to the git host, with the full text on hover when
 * the column has cut it.
 *
 * The tooltip goes on a wrapping span rather than on the link: `UrlLink` is
 * typed `ComponentPropsWithoutRef<"a">`, so it takes no ref, and Radix needs
 * one on its trigger. The span carries the truncation too, which keeps the
 * measured element and the clipped element the same element.
 *
 * No tooltip when nothing is cut. Repeating a title that is already fully
 * readable, on every row of a long list, is noise.
 */
export function TitleLink({ href, text }: { href: string; text: string }) {
  const { ref, truncated } = useIsTruncated(text);

  const label = (
    <span ref={ref} className="block truncate font-medium">
      {/*
        An explicit target opts out of BB's in-app browser: BB uses its URL
        preference only for ordinary activation and leaves explicit targets to
        the browser. A pull request or issue belongs in a real browser tab,
        where the session, extensions and history are.
      */}
      <UrlLink href={href} target="_blank" rel="noreferrer" className="hover:underline">
        {text}
      </UrlLink>
    </span>
  );

  if (!truncated) return label;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{label}</TooltipTrigger>
      {/* Wraps, because the whole point is the part that did not fit. */}
      <TooltipContent className="max-w-md whitespace-normal break-words">{text}</TooltipContent>
    </Tooltip>
  );
}
