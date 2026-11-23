"use client";

/**
 * The sidebar's status fold — the build line — drawn one way: a one-line summary that
 * stays exactly where it is, and behind it a short panel that opens ABOVE it, the first few entries shown and the
 * rest behind a "N more" fold the reader opens themselves.
 *
 * An in-flow build fold draws hundreds of lines of about three words each, pushes the sidebar off the screen and cannot be collapsed
 * again. Measured in the desktop app against that shape: a 50-commit build fold opened
 * 4,396px tall in the 220px column, the page grew to 4,968px, and because the status block is pinned to the
 * sidebar's foot it grew UPWARD — the summary just clicked jumped from 653px to 477px, so a second click in
 * the same place landed on fold text. The panel is out of flow, so opening it moves nothing; it is capped and
 * scrolls inside itself; and the folds share one native `name`, so opening one closes the other. On a narrow
 * window, where the sidebar sits in the page's flow, the panel sits under its summary instead.
 */
import type { ReactElement, ReactNode } from "react";

/** The `name` every status fold shares, so the browser keeps at most one of them open. */
const STATUS_FOLD_NAME = "sidebar-status";

/**
 * One status fold: its summary line, and the panel it opens.
 *
 * @param fold names the fold for the page's own probes (`data-sidebar-fold`)
 * @param title the summary's hover text
 * @param summary the summary line's contents — its dot and its words
 * @param children the panel's contents
 * @returns the fold
 */
export function SidebarFold({
  fold,
  title,
  summary,
  children,
}: {
  fold: string;
  title: string;
  summary: ReactNode;
  children: ReactNode;
}): ReactElement {
  return (
    <details
      name={STATUS_FOLD_NAME}
      data-sidebar-fold={fold}
      className="group/fold relative text-[0.74rem] text-muted-foreground group-data-[sidebar=icons]/console:flex group-data-[sidebar=icons]/console:justify-center"
    >
      <summary
        className="flex cursor-pointer list-none items-center gap-[0.45rem] rounded-lg px-[0.55rem] py-[0.3rem] hover:bg-muted/70 group-open/fold:bg-muted/70 group-data-[sidebar=icons]/console:px-0"
        title={title}
      >
        {summary}
      </summary>
      <div
        data-sidebar-fold-body=""
        className="absolute inset-x-0 bottom-full z-40 mb-[0.25rem] max-h-[50vh] overflow-y-auto overscroll-contain rounded-xl border border-solid border-border bg-popover px-[0.65rem] py-[0.5rem] leading-[1.45] shadow-lg group-data-[sidebar=icons]/console:hidden max-[760px]:static max-[760px]:mb-0 max-[760px]:max-h-[40vh] max-[760px]:shadow-none"
      >
        {children}
      </div>
    </details>
  );
}

/**
 * The "N more" fold inside a panel: closed until the reader opens it, and closed again by a second click.
 *
 * @param label the count of what it holds, such as `47 more commits`
 * @param children every remaining entry
 * @returns the fold
 */
export function MoreFold({ label, children }: { label: string; children: ReactNode }): ReactElement {
  return (
    <details className="group/more mt-[0.2rem]">
      <summary className="cursor-pointer list-none rounded-md py-[0.15rem] text-foreground underline decoration-dotted underline-offset-2 hover:bg-muted/70">
        <span className="group-open/more:hidden">{label}</span>
        <span className="hidden group-open/more:inline">Show fewer</span>
      </summary>
      {children}
    </details>
  );
}

/**
 * A list drawn as a preview and the rest behind a "N more" fold.
 *
 * @param folded the list already split by `foldList`
 * @param render draws one stretch of entries — the preview, then the rest
 * @returns the preview and, when anything is hidden, the fold holding the rest
 */
export function FoldedEntries<T>({
  folded,
  render,
}: {
  folded: { readonly shown: readonly T[]; readonly hidden: readonly T[]; readonly more: string | undefined };
  render: (entries: readonly T[]) => ReactNode;
}): ReactElement {
  return (
    <>
      {render(folded.shown)}
      {folded.more === undefined ? null : <MoreFold label={folded.more}>{render(folded.hidden)}</MoreFold>}
    </>
  );
}
