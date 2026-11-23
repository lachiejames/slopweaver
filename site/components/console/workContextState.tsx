"use client";

import { usePathname } from "next/navigation";
import { type ReactElement, useCallback, useEffect } from "react";

import { cn } from "../../lib/utils";
import {
  CONTEXT_PARAM,
  CONTEXT_STORAGE_KEY,
  canonicalSearch,
  chooseView,
  DEFAULT_CONTEXT,
  entryOf,
  hiddenNoteParts,
  isWorkContext,
  uncountedNoteParts,
  type WorkContext,
} from "../../lib/workContext";
import type { WorkspacePlacement } from "../../lib/workspacePlacement";
import { findingLabel, findingsLine, shownInContext } from "../../lib/workspacePlacementContext";
import { Badge } from "../ui/badge";
import { useTeamLabel } from "./organisationState";
import { usePreference } from "./preference";
import { WarningMark } from "./WarningMark";

/**
 * The context the console is being looked at in, shared by the switcher, the badges and every page.
 *
 * @returns the context, its setter, and a filter over a row's placement — exactly one context shows each row
 */
export function useWorkContext(): {
  readonly context: WorkContext;
  readonly setContext: (next: WorkContext) => void;
  readonly shows: (row: { readonly placement: WorkspacePlacement }) => boolean;
} {
  const { set, value } = usePreference<WorkContext>({
    accept: isWorkContext,
    alwaysAddressed: true,
    fallback: DEFAULT_CONTEXT,
    key: CONTEXT_STORAGE_KEY,
    param: CONTEXT_PARAM,
  });
  // Stable while the context is: pages memoise their filtered rows on it, and a fresh closure every render
  // would rebuild those rows every render.
  const shows = useCallback(
    (row: { readonly placement: WorkspacePlacement }): boolean =>
      shownInContext({ context: value, placement: row.placement }),
    [value],
  );
  return { context: value, setContext: set, shows };
}

/**
 * Write the shown context into the address of a page that arrived without one, so what the address bar holds —
 * and so a bookmark of it — always pins the view on screen.
 *
 * Mounted once, in the shell, and keyed on the path so it runs on every page the sidebar lands on. It resolves
 * the context from `window` itself rather than taking the hook's value, which is the server's default for the
 * first render and would write "work" over a stored Slopweaver. It never writes storage: an address is read,
 * and reading one never changes which context the next visit opens in. `null` state, for the reason
 * `preference.ts` gives.
 */
export function useContextAddress(): void {
  const pathname = usePathname();
  useEffect(() => {
    const { search, hash } = window.location;
    const shown = chooseView({
      accept: isWorkContext,
      fallback: DEFAULT_CONTEXT,
      fromUrl: new URLSearchParams(search).get(CONTEXT_PARAM),
      stored: window.localStorage.getItem(CONTEXT_STORAGE_KEY),
    });
    const next = canonicalSearch({ search, shown });
    if (next !== undefined) {
      // `pathname` is the router's: the console sets no `basePath`, so it is exactly the address's own path.
      window.history.replaceState(null, "", `${pathname}${next}${hash}`);
    }
  }, [pathname]);
}

/**
 * The chip a page head carries so the context is readable on the page itself, not only in the sidebar.
 *
 * @returns the chip
 */
export function ContextChip(): ReactElement {
  const { context } = useWorkContext();
  const entry = entryOf({ context, teamLabel: useTeamLabel() });
  return (
    <Badge
      size="sm"
      data-context={context}
      className={cn(
        "border-0 px-2 py-[0.1rem] leading-[1.5] font-semibold tracking-[0.02em]",
        context === "work" && "bg-[oklch(0.78_0.13_75)] text-[oklch(0.2_0.04_75)]",
      )}
      title={`showing the ${entry.label} context: ${entry.sub}`}
    >
      {entry.label}
    </Badge>
  );
}

/** A quiet line saying what the page is not listing, and why. */
export const CONTEXT_NOTE = "mt-0 mb-[0.6rem] text-[0.78rem] text-muted-foreground";

/**
 * The line a page prints when the context hid rows, so a short list is never mistaken for a quiet one.
 *
 * The words come from `hiddenNoteParts`, which is where the count, the noun and the verb are made to agree
 * and where the unit case lives, and from `uncountedNoteParts` while the count is unread; this draws them.
 *
 * @param hidden how many rows the other context holds, `undefined` while that could not be counted
 * @param what the rows' name, plural — "pull requests", "rows"
 * @param one the same name in the singular, for the one-row case
 * @returns the line, or nothing when none were hidden
 */
export function HiddenNote({
  hidden,
  what,
  one,
}: {
  hidden: number | undefined;
  what: string;
  one: string;
}): ReactElement | null {
  const { context } = useWorkContext();
  const teamLabel = useTeamLabel();
  if (hidden === undefined) {
    const uncounted = uncountedNoteParts({ context, teamLabel, what });
    return (
      <p className={CONTEXT_NOTE}>
        {uncounted.name} in the <b>{uncounted.otherLabel}</b> context are not shown, and could not be counted yet.
      </p>
    );
  }
  const parts = hiddenNoteParts({ context, hidden, one, teamLabel, what });
  if (parts === undefined) {
    return null;
  }
  return (
    <p className={CONTEXT_NOTE}>
      {parts.count} {parts.name} in the <b>{parts.otherLabel}</b> context {parts.verb} not shown. Switch at the top of
      the sidebar.
    </p>
  );
}

/**
 * The findings half of a count, inline: how many rows no field places, and how many name both workspaces.
 *
 * @param tally the page's tally, from `contextTally`
 * @returns the words, or nothing when every row is placed
 */
export function FindingsCount({
  tally,
}: {
  tally: { readonly unplaced: number; readonly conflict: number };
}): ReactElement | null {
  const line = findingsLine({ conflict: tally.conflict, unplaced: tally.unplaced });
  if (line === undefined) {
    return null;
  }
  return (
    <span className="text-warning" data-workspace-findings={String(tally.unplaced + tally.conflict)}>
      {line}.
    </span>
  );
}

/**
 * The findings line on its own, for a page with no other count to sit beside.
 *
 * @returns the line, or nothing when every row is placed
 */
export function FindingsNote({
  tally,
}: {
  tally: { readonly unplaced: number; readonly conflict: number };
}): ReactElement | null {
  if (tally.unplaced + tally.conflict === 0) {
    return null;
  }
  return (
    <p className={CONTEXT_NOTE}>
      <FindingsCount tally={tally} />
    </p>
  );
}

/**
 * The label a row wears when it is a finding — no workspace, or both — with what it rests on in its title.
 *
 * @returns the label, or nothing for a placed row
 */
export function FindingMark({ placement }: { placement: WorkspacePlacement }): ReactElement | null {
  const finding = findingLabel({ placement });
  if (finding === undefined) {
    return null;
  }
  const badge = (
    <Badge size="sm" variant="warning" title={finding.title} data-workspace-finding={placement.kind}>
      {finding.label}
    </Badge>
  );
  if (placement.kind !== "unplaced" || placement.warning === undefined) {
    return badge;
  }
  // The read that left it unplaced, said plainly with its raw folded in the mark's hover — never in the badge's own
  // title, which a browser draws whole (steer 7).
  return (
    <>
      {badge}
      <WarningMark facts={[{ subject: placement.warning.subject, why: placement.warning.why }]} />
    </>
  );
}

/**
 * How many of the rows a fold or a page window leaves out wear a workspace mark, so a finding is never folded out
 * of sight with nothing saying so.
 *
 * @returns the count as a badge, or nothing when none of the rest is marked
 */
export function FoldedMarked({ count }: { count: number }): ReactElement | null {
  if (count === 0) {
    return null;
  }
  return (
    <Badge size="sm" variant="warning" data-workspace-finding="folded">
      {String(count)} with a workspace mark
    </Badge>
  );
}
