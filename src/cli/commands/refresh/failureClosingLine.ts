/**
 * The ONE stderr line a failed `refresh` ends on, naming every leg that failed and why.
 *
 * A scheduled resync runs `refresh` in process, and its slot record keeps only the last three non-blank stderr
 * lines of the whole verb (`../../../live/automation/verbFailureWhy.ts`), two of which `automation resync` writes
 * itself. So exactly one refresh line survives: its LAST. The legs run ingest → store → voice → members →
 * structures → derive, and the two hydration lanes are warning-only progress on stderr, so a `--store` failure printed before
 * them was pushed out of that tail every time. MEASURED: `resync-corpus-slack`'s firing kept
 * `refresh · Mapping structure · slack · 100% · 13 written` as its why, the store's own words were gone, and a
 * hand rerun two hours later passed — so nothing was left to say what had broken. Repro: `grep -h '"detail"'
 * $SLOPWEAVER_HOME/live/recipe/slot-attempts/<attempt>*.json`.
 *
 * Restating the failure at the end, rather than reordering the legs, keeps the order the legs depend on and
 * covers an ingest failure too, which every later leg buries just the same.
 */
import { WITHHELD } from "#lib/numbersOnly.js";
import type { CorpusSource } from "../../../corpus/types.js";
import type { RefreshResult } from "./core.js";

/** One failure a leg after ingest reports: the source it was replaying, when it had one, and why. */
export interface RefreshLegFailure {
  readonly source: CorpusSource | null;
  readonly reason: string;
}

/** What one leg after ingest reports: empty when it reached its outcome or was skipped, else why it failed. */
export interface RefreshLegFailures {
  readonly failures: readonly RefreshLegFailure[];
}

/**
 * A hydration lane that THREW. A lane that returns is warning-only, but one that throws ends the run, and it would
 * otherwise end it before this line is printed.
 */
export interface HydrationLaneFailure {
  readonly lane: "members" | "structures";
  readonly reason: string;
}

/** The reason a failure stands on when its leg reported no error text of its own. */
const UNSTATED_REASON = "failed without an error message";

/** One failure, located by leg, with its source when it has one. */
interface LocatedFailure extends RefreshLegFailure {
  readonly leg: "ingest" | "store" | "voice" | HydrationLaneFailure["lane"] | "derive";
}

/**
 * The closing line for a refresh run, or `null` when nothing failed. Pure.
 *
 * Every failure is kept, in the order the legs ran, on ONE physical line: an embedded line break would make the
 * logger write two lines and put the last half of a reason, alone, in the tail this line exists to fill.
 *
 * @param results the per-source ingest results, in run order
 * @param storeFailures the `--store` leg's failures, in replay order
 * @param voiceFailures the voice-measurement leg's failures (`./voiceLeg.ts`); absent from a caller with no such leg
 * @param hydrationFailures the hydration lanes that threw, in the order they ran
 * @param deriveFailures the derive leg's failures
 * @param numbersOnly whether output is a paste-safe capture, which keeps each leg and source but withholds reasons
 * @returns the line, or `null` when every leg succeeded
 */
export function refreshFailureClosingLine({
  results,
  storeFailures,
  voiceFailures = [],
  hydrationFailures,
  deriveFailures,
  numbersOnly,
}: {
  readonly results: readonly RefreshResult[];
  readonly storeFailures: readonly RefreshLegFailure[];
  readonly voiceFailures?: readonly RefreshLegFailure[];
  readonly hydrationFailures: readonly HydrationLaneFailure[];
  readonly deriveFailures: readonly RefreshLegFailure[];
  readonly numbersOnly: boolean;
}): string | null {
  const located: LocatedFailure[] = [
    ...results.filter((result) => !result.ok).flatMap((result) => ingestFailures({ result })),
    ...storeFailures.map((failure): LocatedFailure => ({ ...failure, leg: "store" })),
    ...voiceFailures.map((failure): LocatedFailure => ({ ...failure, leg: "voice" })),
    ...hydrationFailures.map(({ lane, reason }): LocatedFailure => ({ leg: lane, reason, source: null })),
    ...deriveFailures.map((failure): LocatedFailure => ({ ...failure, leg: "derive" })),
  ];
  if (located.length === 0) {
    return null;
  }
  const clauses = located.map((failure) => {
    const said = oneLine({ text: failure.reason });
    // A blank reason from any leg still names its failure, or the line would end on a bare `<leg>: `.
    const stated = said.length === 0 ? UNSTATED_REASON : said;
    // A reason is free prose a `--numbers-only` paste must not carry; the leg and source stay.
    const reason = numbersOnly ? WITHHELD : stated;
    return failure.source === null ? `${failure.leg}: ${reason}` : `${failure.leg}: ${failure.source}: ${reason}`;
  });
  return `refresh failed: ${clauses.join("; ")}`;
}

/** A failed ingest source's stated errors, each its own failure; one standing reason when it stated none. */
function ingestFailures({ result }: { result: RefreshResult }): readonly LocatedFailure[] {
  const stated = result.errors.filter((reason) => reason.trim().length > 0);
  if (stated.length === 0) {
    return [{ leg: "ingest", reason: UNSTATED_REASON, source: result.source }];
  }
  return stated.map((reason): LocatedFailure => ({ leg: "ingest", reason, source: result.source }));
}

/** Every run of whitespace, line breaks included, collapsed to one space. */
function oneLine({ text }: { text: string }): string {
  return text.replace(/\s+/g, " ").trim();
}
