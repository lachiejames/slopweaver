/**
 * What a console walk could not see, in this atlas's own gap vocabulary.
 *
 * Every shortfall is a ROW in one table rather than a block of its own, so a ninth is one row and not
 * another twelve lines a reader has to check say the same thing. Each carries the count that decides
 * whether it happened at all, and `consoleRechecks` closes every condition a run did NOT raise — which is
 * what makes a gap a lifecycle rather than a report.
 */
import type { AtlasGapRecheck } from "../kit/gaps.js";

import { DATADOG_CONSOLE_NAV_READ_AT, type navDrift, undeclaredDestinations } from "./consolePages.js";
import type { DatadogPaletteSummary } from "./consolePalette.js";
import type { DatadogWalkResult } from "./consoleWalk.js";
import type { DatadogGap } from "./documents.js";
import { type DatadogGapCondition, openDatadogGap } from "./gaps.js";
import type { DatadogKind } from "./model.js";

/**
 * A one-line tally of how the walk's pages resolved, for a coverage reason to quote.
 *
 * @param walk what the walk produced
 * @returns the tally, as `outcome×count` pairs in a stable order
 *
 * @internal
 */
export function summariseOutcomes({ walk }: { walk: DatadogWalkResult }): string {
  const counts = new Map<string, number>();
  for (const page of walk.pages) {
    const held = counts.get(page.outcome);
    counts.set(page.outcome, held === undefined ? 1 : held + 1);
  }
  return [...counts.entries()]
    .toSorted(([left], [right]) => left.localeCompare(right))
    .map(([outcome, count]) => `${outcome}×${String(count)}`)
    .join(", ");
}

/** One way a walk can have covered less than its counts suggest, before it is known whether it happened. */
interface WalkGapCandidate {
  readonly condition: DatadogGapCondition;
  readonly count: number;
  readonly kind: DatadogKind;
  readonly reason: string;
}

/** The first few of a list, for a reason line. */
function head({ items }: { items: readonly string[] }): string {
  return `${items.slice(0, 6).join(", ")}${items.length > 6 ? ", …" : ""}`;
}

/**
 * Every gap this walk could raise, with the count that decides whether it did.
 *
 * A table rather than seven near-identical blocks, so an eighth shortfall is one row.
 */
function walkGapCandidates({
  walk,
  origin,
  drift,
  palette,
}: {
  walk: DatadogWalkResult;
  origin: string;
  drift: ReturnType<typeof navDrift> | null;
  palette: DatadogPaletteSummary | null;
}): readonly WalkGapCandidate[] {
  const unreachable = walk.pages.filter((page) => page.outcome !== "landed");
  const undeclared = undeclaredDestinations({ finalUrls: walk.finalUrls, origin });
  const drifted = drift === null ? [] : [...drift.undeclared, ...drift.gone];
  return [
    ...paletteCandidates({ palette, walk }),
    {
      condition: "console-page-unreachable",
      count: unreachable.length,
      kind: "console-page",
      reason: `${String(unreachable.length)} of ${String(walk.pages.length)} declared console page(s) did not render — ${summariseOutcomes({ walk })}`,
    },
    {
      condition: "console-page-unphotographed",
      count: walk.unrenderedPages.length,
      kind: "console-page",
      reason: `${String(walk.unrenderedPages.length)} page(s) were reached but photographed mid-load, so their capture is a loading frame rather than a picture of the page`,
    },
    {
      condition: "console-response-body-lost",
      count: walk.incompletePages.length,
      kind: "console-request",
      reason: `${String(walk.incompletePages.length)} page(s) lost at least one response body, so what the console asked for on them is recorded incompletely`,
    },
    {
      condition: "console-route-undeclared",
      count: undeclared.length,
      kind: "console-page",
      reason: `the walk settled on ${String(undeclared.length)} console path(s) this atlas's own registry does not declare — ${head({ items: undeclared })}. That is a defect in src/atlas/datadog/consolePages.ts, not in the console`,
    },
    {
      condition: "console-nav-drifted",
      count: drifted.length,
      kind: "console-page",
      reason:
        drift === null
          ? ""
          : `the live left nav differs from the list read on ${DATADOG_CONSOLE_NAV_READ_AT}: ${String(drift.undeclared.length)} page(s) it offers are undeclared (${head({ items: drift.undeclared })}) and ${String(drift.gone.length)} declared page(s) it no longer offers (${head({ items: drift.gone })}). Re-read the nav and update src/atlas/datadog/consolePages.ts`,
    },
    {
      condition: "console-nav-unread",
      count: walk.navError === null ? 0 : 1,
      kind: "console-page",
      reason: `the live left nav could not be read this run, so the declared list went unchecked against the console: ${String(walk.navError)}`,
    },
  ];
}

/**
 * The two candidates the PALETTE leg raises: what it could not do, and what it can reach that the nav
 * cannot.
 *
 *  palette the palette summary, or `null` when the leg did not run
 *  walk what the walk produced
 *  the candidates, in the order they are reported
 */
function paletteCandidates({
  palette,
  walk,
}: {
  palette: DatadogPaletteSummary | null;
  walk: DatadogWalkResult;
}): readonly WalkGapCandidate[] {
  const pages = palette === null ? [] : palette.pagesUndeclared;
  const listed = palette === null ? 0 : palette.pageCount;
  const opened = walk.paletteError === null && walk.palette !== null && walk.palette.dialogOpen;
  const unreadReason =
    walk.paletteError === null
      ? "the command palette did not open on its shortcut this run, so its own calls were not captured"
      : `the command palette leg failed this run: ${walk.paletteError}`;
  return [
    {
      condition: "console-palette-page-undeclared",
      count: pages.length,
      kind: "console-page",
      reason: `the command palette lists ${String(listed)} page address(es), of which ${String(pages.length)} the left nav does not offer — ${head({ items: pages })}. The nav is the accepted denominator; these are what the palette can open beyond it`,
    },
    { condition: "console-palette-unread", count: opened ? 0 : 1, kind: "console-request", reason: unreadReason },
  ];
}

/**
 * The gaps a walk's own shortfalls raise, stamped and open.
 *
 * @param walk what the walk produced
 * @param origin the console origin
 * @param drift how the live nav differed, or `null` when the nav leg did not run
 * @param palette the palette summary, or `null` when that leg did not run
 * @param at this run's ISO timestamp
 * @returns the gaps this run raised
 */
export function walkGaps({
  walk,
  origin,
  drift,
  palette,
  at,
}: {
  walk: DatadogWalkResult;
  origin: string;
  drift: ReturnType<typeof navDrift> | null;
  palette: DatadogPaletteSummary | null;
  at: string;
}): readonly DatadogGap[] {
  return walkGapCandidates({ drift, origin, palette, walk })
    .filter((candidate) => candidate.count > 0)
    .map((candidate) =>
      openDatadogGap({
        at,
        channel: "console",
        condition: candidate.condition,
        kind: candidate.kind,
        reason: candidate.reason,
        scope: candidate.kind,
      }),
    );
}

/** Every console gap condition, so a run that did not raise one closes it on recheck. */
const CONSOLE_GAP_CONDITIONS: readonly DatadogGapCondition[] = [
  "console-page-unreachable",
  "console-page-unphotographed",
  "console-response-body-lost",
  "console-route-undeclared",
  "console-nav-drifted",
  "console-palette-page-undeclared",
  "console-nav-unread",
  "console-palette-unread",
];

/**
 * Rechecks that close every console condition this run did not raise on one kind.
 *
 * @param kind the kind being folded
 * @returns one recheck per console condition
 */
export function consoleRechecks({ kind }: { kind: DatadogKind }): readonly AtlasGapRecheck[] {
  return CONSOLE_GAP_CONDITIONS.map((condition) => ({ condition, resolved: true, scope: kind }));
}
