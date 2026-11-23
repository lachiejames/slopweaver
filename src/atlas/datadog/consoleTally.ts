/**
 * Reduce one console walk to the numbers and the sentences every coverage cell and gap reads.
 *
 * Split out of `consoleSurface.ts` along its own seam: that file ORCHESTRATES a publish — it folds kinds,
 * merges channels, reconciles gaps and hands a generation to the enforcing store — while everything here is
 * a pure read of one walk result. Nothing in this module touches disk, and nothing in it knows a generation
 * exists.
 *
 * ## The whole point of the file is that `complete` counts BOTH ways a route can be missing
 *
 * A lost session leaves routes in `notAttempted`; a `--limit` leaves them in `omitted`. Reading only the
 * first is what let a three-page smoke run publish the console surface `synced` over every declared page —
 * the failure `cli/commands/datadogAtlas/walkRun.ts`'s own header says the flag must not produce, and the
 * class `devLint/atlasContentCoverage.ts` exists to refuse. They stay APART rather than being summed
 * because the two have different remedies, and a cell that cannot tell them apart prints the wrong one.
 */
import { summariseOutcomes } from "./consoleGaps.js";
import { DATADOG_CONSOLE_NAV_READ_AT, DATADOG_CONSOLE_ROUTES, navDrift } from "./consolePages.js";
import { type DatadogPaletteSummary, paletteLine, paletteSummary } from "./consolePalette.js";
import { DATADOG_PALETTE_PAGE, type DatadogWalkResult } from "./consoleWalk.js";
import type { DatadogConsoleKind } from "./model.js";

/** What one walk came to, computed once: the numbers and the two observations every cell and row reads. */
export interface WalkTally {
  readonly attempted: number;
  readonly landed: number;
  /**
   * Whether every declared route was attempted — the difference between `synced` and `deferred`.
   *
   * BOTH ways a route can be missing count, and that is the whole point: a lost session leaves routes in
   * `notAttempted`, and a `--limit` leaves them in `omitted`. Reading only the first published a
   * three-page smoke run as a fully synced console surface, because the caller had sliced the registry
   * before the walk ever saw it.
   */
  readonly complete: boolean;
  /** Declared routes this run was never asked to visit, so a bounded run can say which remedy it needs. */
  readonly omitted: number;
  /** Declared routes the run WAS handed and never reached, because the session went part-way through. */
  readonly notAttempted: number;
  readonly drift: ReturnType<typeof navDrift> | null;
  readonly palette: DatadogPaletteSummary | null;
}

/**
 * Reduce a walk to the handful of facts every coverage cell, gap and outcome field reads.
 *
 * @param walk what the walk produced
 * @returns the tally
 */
export function walkTally({ walk }: { walk: DatadogWalkResult }): WalkTally {
  return {
    attempted: walk.pages.filter((page) => page.outcome !== "not-attempted").length,
    complete: walk.notAttempted.length === 0 && walk.omitted.length === 0,
    drift: walk.nav === null ? null : navDrift({ hovered: walk.nav.sections, live: walk.nav.links }),
    landed: walk.pages.filter((page) => page.outcome === "landed").length,
    notAttempted: walk.notAttempted.length,
    omitted: walk.omitted.length,
    palette: walk.palette === null ? null : paletteSummary({ walk }),
  };
}

/**
 * What re-running would have to change for a deferred console cell to become a synced one.
 *
 * The two incompletenesses have different remedies and naming the wrong one sends a reader to re-run a
 * command that will do exactly the same thing again. BOTH are named when both apply: a bounded walk
 * that ALSO lost its session must not be told only to drop `--limit`, which would leave
 * it failing the same way for the other reason.
 *
 * @param tally this run's numbers
 * @returns the remedy, or `null` when the walk was complete
 */
export function consoleUnblockedBy({ tally }: { tally: WalkTally }): string | null {
  if (tally.complete) {
    return null;
  }
  const remedies: string[] = [];
  if (tally.omitted > 0) {
    remedies.push(`re-running it without --limit, which left ${String(tally.omitted)} declared page(s) unvisited`);
  }
  if (tally.notAttempted > 0) {
    remedies.push(
      `re-running it with the browser session intact, which went part-way through ${String(tally.notAttempted)} declared page(s)`,
    );
  }
  if (remedies.length === 0) {
    return "re-running slopweaver atlas datadog walk with the browser session intact";
  }
  return `slopweaver atlas datadog walk: ${remedies.join("; and ")}`;
}

/**
 * One console kind's coverage reason: what was attempted against what is declared, and what came back.
 *
 * @param kind which of the two console kinds
 * @param tally this walk's numbers
 * @param walk what the walk produced
 * @returns the reason to publish on the cell
 */
export function consoleReason({
  kind,
  tally,
  walk,
}: {
  kind: DatadogConsoleKind;
  tally: WalkTally;
  walk: DatadogWalkResult;
}): string {
  if (kind === "console-request") {
    return `recorded ${String(walk.requests.length)} distinct first-party endpoint(s) the console called across ${String(tally.landed)} rendered page(s) and the command palette (${DATADOG_PALETTE_PAGE}); method, path shape, parameter names and response field names only; ${paletteLine({ palette: tally.palette })}`;
  }
  const navClause =
    tally.drift === null
      ? "the live nav was not re-read this run"
      : `the live nav re-read this run offers ${String(tally.drift.undeclared.length)} undeclared page(s) and lacks ${String(tally.drift.gone.length)} declared one(s)`;
  const boundClause =
    tally.omitted === 0 ? "" : `; --limit left ${String(tally.omitted)} declared page(s) unvisited this run`;
  return `attempted ${String(tally.attempted)} of ${String(DATADOG_CONSOLE_ROUTES.length)} declared console page(s) read from the live left nav on ${DATADOG_CONSOLE_NAV_READ_AT}; ${String(tally.landed)} rendered — ${summariseOutcomes({ walk })}${boundClause}; ${navClause}`;
}
