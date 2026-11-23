import { ChevronRight } from "lucide-react";
import type { ReactElement, ReactNode } from "react";

import { cn } from "../../lib/utils";

/**
 * A quiet, labelled disclosure: one line the reader opens, with the rest of a list behind it.
 *
 * The console's pages take a minimalist approach with progressive disclosure: sleek, with few paragraphs. Its label
 * always says what opening it shows; there is no default, because a generic "how this was read" fold is exactly
 * what the owner never opens. It is a native `<details>` on purpose: it renders on the server, needs no script to
 * open, and is the same element a row's fold already is. It folds DATA, never method prose: how a figure is counted
 * or ordered is not on the page at all, because the owner ignores any text announcing how a page is derived; it
 * lives in `docs/console`, where the voice reads it when the owner asks.
 *
 * A failure is never put behind it. A NOT MEASURED line or a FIXTURE stamp stays where the value would have
 * been, because a caveat a reader must open to see is a caveat that reads as fine.
 *
 * @param label the summary line — what opening it shows
 * @param className spacing the caller gives the fold
 * @param children the contents, drawn only once opened
 * @returns the fold
 */
export function About({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}): ReactElement {
  return (
    <details className={cn("group/about text-[0.72rem] text-muted-foreground", className)}>
      <summary className="inline-flex cursor-pointer list-none items-center gap-1 select-none transition-colors hover:text-foreground [&::-webkit-details-marker]:hidden">
        <ChevronRight aria-hidden className="size-3 transition-transform group-open/about:rotate-90" />
        {label}
      </summary>
      <div className="mt-2 flex flex-col gap-1.5 border-0 border-l border-solid border-border pl-3 leading-[1.55] [&_p]:m-0">
        {children}
      </div>
    </details>
  );
}
