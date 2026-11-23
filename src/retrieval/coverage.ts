/**
 * The coverage manifest — what the query path actually read, stated so that it cannot flatter itself.
 *
 * ## Why this module exists
 *
 * Every measurement in the retrieval programme is taken THROUGH the query path, so the path must not lie.
 * It did. Three completely different situations all reached the CLI as the same silence:
 *
 *  - the corpus file could not be read (permissions, a truncated write, a bad mount) — a **failure**;
 *  - there is no corpus for that source yet — an **absence**;
 *  - there is one, but its newest record predates the question — **staleness**.
 *
 * Collapsing those into "no records" is what hid a broken retrieval path for weeks: the query path answered
 * from whatever legs happened to work and looked exactly like a healthy run. The three states have three
 * different fixes (`chmod`, `slopweaver refresh`, `slopweaver refresh --since`), so a manifest that cannot
 * tell them apart is worse than no manifest — it is a confident wrong answer about the instrument itself.
 *
 * ## The conservation law
 *
 * Per leg: `ingested = indexed + Σ skipped`. Every row read off disk either reaches the ranker or lands in a
 * counted skip class carrying a reason. A leg where that arithmetic does not hold is reported as a BREACH
 * rather than quietly rebalanced, because an unexplained shortfall is precisely the silent text loss this
 * step exists to expose. `unreadable` is kept OUT of the arithmetic on purpose: an unreadable file
 * contributes an unknown number of rows, so counting it as a skip would make the law trivially satisfiable.
 *
 * Pure — no clock, no disk. The caller supplies `nowIso`.
 */

import type { SkipTally } from "../corpus/corpusTallyCore.js";
import { type SubsetManifest, subsetBanner } from "../corpus/subset.js";
import { type CorpusSource, CURSORLESS_SOURCES } from "../corpus/types.js";
import { BRONZE_SOURCES } from "../integrations/corpusSources.js";

/**
 * How old a leg's newest record may be before the leg is reported STALE.
 *
 * Seven days, and it is a reporting threshold rather than a policy: nothing refuses because of it. The corpus
 * scope is three months, so a source whose newest record is over a week old is
 * not necessarily wrong — it is a fact the reader of an answer is entitled to know before trusting a
 * recency-sensitive claim. All three of the eval's recency cases score 0%, and this is the number that would
 * have shown why.
 */
export const STALE_AFTER_DAYS = 7;

/**
 * How old a leg's newest record may be before an answer is REFUSED rather than merely annotated.
 *
 * This is the threshold {@link STALE_AFTER_DAYS} deliberately is not: a policy. The reporting threshold was
 * doing its job and nobody was reading it — MEASURED on the owner's own home, off the coverage
 * block the query path then printed on stderr: notion's watermark stood
 * 11.4 days behind, and every answer for eleven days printed
 * `notion [stale] … newest record is 11.4d old (> 7d)` on stderr and answered anyway. A signal a reader may
 * skip is the same as no signal for the one question it exists to guard — "do we have the last couple of
 * weeks?" — so past this line the query refuses and names the command.
 *
 * Fourteen days, from the owner's own framing of the gap ("I don't really know if we even have the last
 * couple of weeks of activity"). It is twice the reporting threshold on purpose: a source that is merely
 * quiet for a week is annotated, and one that has gone dark for a fortnight stops answering. `--stale-ok`
 * waives it for the deliberate historical question, which is the case where old is the point.
 */
export const REFUSE_AFTER_DAYS = 14;

/** Milliseconds in a day — the unit `STALE_AFTER_DAYS` is converted through. */
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * The state of one retrieval leg. Four values, and the three that are not `ok` are the whole point: they used
 * to be one.
 */
export type LegState = "ok" | "failed" | "absent" | "stale";

/** One leg of the query path — a bronze source directory, or the gold layer — and everything it contributed. */
export interface CoverageLeg {
  /** The leg's name: a bronze source (`github`, `slack`, …), `gold`, or `(root)` for a flat `--corpus` dir. */
  readonly leg: string;
  readonly state: LegState;
  /** Rows read off disk for this leg. */
  readonly ingested: number;
  /** Records from this leg that reached the ranker. */
  readonly indexed: number;
  readonly skipped: readonly SkipTally[];
  /** Why the leg is in this state — never empty, so a manifest line always says something. */
  readonly detail: string;
  /** The newest `tsIso` this leg contributed, when it contributed anything. */
  readonly newestIso?: string;
  /**
   * The leg's stored RESUME CURSOR (`corpus/watermarks/<source>.json`), when the leg is a source that has
   * one — **the instant through which the world was successfully OBSERVED**, which is a different claim from
   * `newestIso`'s "the newest thing we happen to hold".
   *
   * The two come apart in both directions, and each direction is a real ingest behaviour rather than a
   * hypothetical:
   *
   *  - a run that could not see its whole window — `--sample`, `--fetch-cap`, or a connector-reported gap —
   *    WRITES what arrived and deliberately HOLDS the cursor (`../corpus/ingestSource.shouldHoldCursor`). So
   *    a knowingly incomplete corpus carries a brand-new `newestIso` and an old cursor.
   *  - a run that saw the whole window and found NOTHING advances the cursor to the window end
   *    (`../corpus/ingestSource`'s empty-fetch branch) without producing a record. So a healthy, quiet source
   *    carries a current cursor and an old `newestIso`.
   *
   * That is why {@link legsBeyondRefusal} judges THIS field and not `newestIso`: age policy is a claim about
   * whether the world was looked at, and only the cursor makes that claim. `classifyLeg`'s `[stale]`
   * ANNOTATION still reads `newestIso`, correctly — it is telling a reader how old the evidence is, which is
   * a different and also useful fact.
   */
  readonly cursorIso?: string;
}

/** The manifest emitted alongside every answer: one row per leg, in the order the legs were read. */
export interface CoverageManifest {
  readonly legs: readonly CoverageLeg[];
  /**
   * Present only when the home this query read is a TIME-BOUNDED SUBSET of a bigger corpus.
   *
   * It rides on the coverage manifest rather than on its own channel because this manifest is already the
   * answer to "what did the query path actually read", and a window is part of that answer in exactly the way
   * a stale leg is. Four leg states existed to stop three different situations reaching the reader as one
   * silence; a subset is a fifth, and it is the one a reader is least able to detect for themselves — a
   * complete, well-cited, entirely wrong-because-partial answer looks identical to a right one.
   */
  readonly subset?: SubsetManifest;
}

/**
 * Total rows accounted for by a leg's skip classes. Pure.
 *
 * @param skipped the leg's skip tallies
 * @returns the summed count
 */
export function skippedTotal({ skipped }: { skipped: readonly SkipTally[] }): number {
  return skipped.reduce((total, tally) => total + tally.count, 0);
}

/** Whole days between two ISO timestamps, or `undefined` when either is unparseable. */
function daysBetween({ fromIso, toIso }: { fromIso: string; toIso: string }): number | undefined {
  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);
  return Number.isNaN(from) || Number.isNaN(to) ? undefined : (to - from) / MS_PER_DAY;
}

/**
 * Classify one leg into its state. Pure, and the order of the tests is the contract: a FAILURE outranks an
 * absence (an unreadable leg has no business claiming it is merely empty), and an absence outranks staleness
 * (nothing is not old, it is nothing).
 *
 * @param unreadable paths in this leg that could not be read at all
 * @param indexed how many records the leg contributed to the ranker
 * @param newestIso the newest record's timestamp, when the leg contributed any
 * @param nowIso the reference "now"
 * @param staleAfterDays how old the newest record may be before the leg reads as stale
 * @returns the leg's state and the reason for it
 */
export function classifyLeg({
  unreadable,
  indexed,
  newestIso,
  nowIso,
  staleAfterDays,
}: {
  unreadable: readonly string[];
  indexed: number;
  newestIso: string | undefined;
  nowIso: string;
  staleAfterDays: number;
}): { state: LegState; detail: string } {
  if (unreadable.length > 0) {
    return { detail: `${String(unreadable.length)} path(s) could not be read`, state: "failed" };
  }
  if (indexed === 0) {
    return { detail: "no records on disk for this leg", state: "absent" };
  }
  if (newestIso === undefined) {
    return { detail: `${String(indexed)} record(s), none carrying a readable timestamp`, state: "stale" };
  }
  const age = daysBetween({ fromIso: newestIso, toIso: nowIso });
  if (age === undefined) {
    return { detail: `${String(indexed)} record(s); newest timestamp ${newestIso} is unparseable`, state: "stale" };
  }
  if (age > staleAfterDays) {
    return { detail: `newest record is ${age.toFixed(1)}d old (> ${String(staleAfterDays)}d)`, state: "stale" };
  }
  return { detail: `newest record is ${Math.max(0, age).toFixed(1)}d old`, state: "ok" };
}

/**
 * Build one manifest leg from what a read of it actually produced. Pure.
 *
 * @param leg the leg's name
 * @param ingested rows read off disk
 * @param indexed records that reached the ranker
 * @param skipped the counted skip classes
 * @param unreadable paths that could not be read at all
 * @param newestIso the newest contributed timestamp, when there is one
 * @param nowIso the reference "now"
 * @param staleAfterDays the staleness threshold in days
 * @returns the classified leg
 */
export function buildLeg({
  leg,
  ingested,
  indexed,
  skipped,
  unreadable,
  newestIso,
  nowIso,
  staleAfterDays,
}: {
  leg: string;
  ingested: number;
  indexed: number;
  skipped: readonly SkipTally[];
  unreadable: readonly string[];
  newestIso: string | undefined;
  nowIso: string;
  staleAfterDays: number;
}): CoverageLeg {
  const { state, detail } = classifyLeg({ indexed, newestIso, nowIso, staleAfterDays, unreadable });
  return {
    detail,
    indexed,
    ingested,
    leg,
    skipped,
    state,
    ...(newestIso !== undefined ? { newestIso } : {}),
  };
}

/**
 * The conservation breach for one leg, if any: the sentence naming the rows that went missing. Pure.
 *
 * @param leg the leg to check
 * @returns the breach description, or `undefined` when `ingested = indexed + Σ skipped` holds
 */
export function conservationBreach({ leg }: { leg: CoverageLeg }): string | undefined {
  const accounted = leg.indexed + skippedTotal({ skipped: leg.skipped });
  if (accounted === leg.ingested) {
    return undefined;
  }
  const lost = leg.ingested - accounted;
  return `${leg.leg}: ${String(leg.ingested)} ingested but ${String(accounted)} accounted for (${String(lost)} unexplained)`;
}

/**
 * Every conservation breach in a manifest. Pure.
 *
 * @param manifest the coverage manifest
 * @returns one description per breaching leg (empty when the law holds everywhere)
 */
export function conservationBreaches({ manifest }: { manifest: CoverageManifest }): readonly string[] {
  return manifest.legs.flatMap((leg) => {
    const breach = conservationBreach({ leg });
    return breach === undefined ? [] : [breach];
  });
}

/**
 * The legs whose read FAILED — the ones that must never be mistaken for an empty corpus. Pure.
 *
 * @param manifest the coverage manifest
 * @returns the failed legs, in manifest order
 */
export function failedLegs({ manifest }: { manifest: CoverageManifest }): readonly CoverageLeg[] {
  return manifest.legs.filter((leg) => leg.state === "failed");
}

/**
 * How long ago a leg's world was last successfully OBSERVED, in days, at `nowIso` — the age of its stored
 * resume cursor. `undefined` when the leg has no cursor, or its cursor will not parse. Pure.
 *
 * @param leg the leg to age
 * @param nowIso the reference "now"
 * @returns the age in days, or `undefined` when there is nothing to age
 */
export function legObservationAgeDays({ leg, nowIso }: { leg: CoverageLeg; nowIso: string }): number | undefined {
  return leg.cursorIso === undefined ? undefined : daysBetween({ fromIso: leg.cursorIso, toIso: nowIso });
}

/**
 * The legs whose newest record is older than `refuseAfterDays` — the ones a query refuses over. Pure.
 *
 * Three exclusions, and each is the reason this is its own selector rather than a filter on
 * `state === "stale"`. Every one of them was a leg that WOULD have refused every query on the owner's own
 * machine the day this shipped:
 *
 *  - an **`absent`** leg — a source that was never connected has nothing to age, and would otherwise refuse
 *    forever. The class being closed is a source that WAS being ingested and silently stopped.
 *  - a leg with **no stored cursor, or one that will not parse** — nothing ever recorded an observation for
 *    it, so there is no claim to test. A corrupt cursor is a defect in the file, not evidence about the
 *    calendar; `refresh --if-stale` treats the same state as BEHIND, which is the right polarity there
 *    (refresh anyway) and the wrong one here (do not refuse an answer over an unreadable file).
 *  - a leg that `refresh` cannot bring current on its own: `gold` (synthesised per question), `(root)` (a
 *    flat `--corpus` dir), and every {@link ../corpus/types.CURSORLESS_SOURCES} member. MEASURED:
 *    `self` — the owner's own writing, scanned off disk only when `refresh --self` is typed — stood at 26.4
 *    days old and every other leg was inside a day. Refusing on it would have made both query verbs useless
 *    on a corpus that was in fact current, and the command the refusal names would not have been the fix.
 *    {@link isRefreshableLeg} is the mechanical test, and judging the cursor excludes the same set a second
 *    way (a cursorless source has no cursor to be old), which is why a seeded demo home — whose records
 *    carry fixed June dates and whose sources have never been refreshed — never refuses either.
 *
 * @param manifest the coverage manifest
 * @param nowIso the reference "now"
 * @param refuseAfterDays the age past which a leg refuses
 * @returns the offending legs paired with their measured age, in manifest order
 */
export function legsBeyondRefusal({
  manifest,
  nowIso,
  refuseAfterDays,
}: {
  manifest: CoverageManifest;
  nowIso: string;
  refuseAfterDays: number;
}): readonly { leg: CoverageLeg; ageDays: number }[] {
  return manifest.legs.flatMap((leg) => {
    if (!isRefreshableLeg({ leg })) {
      return [];
    }
    const ageDays = legObservationAgeDays({ leg, nowIso });
    return ageDays !== undefined && ageDays > refuseAfterDays ? [{ ageDays, leg }] : [];
  });
}

/**
 * Whether a leg names a source `slopweaver refresh` keeps current on its own — the precondition for
 * refusing over its age. Pure.
 *
 * @param leg the leg to test
 * @returns true when the leg is a corpus source that carries a resume cursor
 */
export function isRefreshableLeg({ leg }: { leg: CoverageLeg }): boolean {
  return refreshableLegSource({ leg }) !== undefined;
}

/**
 * The SOURCE a refreshable leg names, or `undefined` when the leg is not one. Pure.
 *
 * The same test {@link isRefreshableLeg} answers as a boolean, returning the source itself so a caller that
 * needs it — {@link ./justInTime.sourcesBehind}, which names sources in a refresh command — reaches it
 * without a type assertion over `leg.leg`.
 *
 * `BRONZE_SOURCES` minus the cursorless ones is exactly "has bytes in bronze AND a resume cursor", which is
 * the property being tested. Composed from the two published lists rather than restated as a third, so a
 * source added to either one is classified without anyone remembering this file exists.
 *
 * @param leg the leg to classify
 * @returns the corpus source it names, when it names a refreshable one
 */
export function refreshableLegSource({ leg }: { leg: CoverageLeg }): CorpusSource | undefined {
  const source = BRONZE_SOURCES.find((candidate) => candidate === leg.leg);
  return source !== undefined && !CURSORLESS_SOURCES.includes(source) ? source : undefined;
}

/** One leg's skip tallies rendered compactly (`invalid-json ×3, superseded ×12`), or `-` when it skipped none. */
function renderSkips({ skipped }: { skipped: readonly SkipTally[] }): string {
  return skipped.length === 0 ? "-" : skipped.map((s) => `${s.reason} ×${String(s.count)}`).join(", ");
}

/**
 * Render the manifest as stderr lines: one per leg, then the conservation verdict. Pure — the shell just
 * emits them, so the exact text is unit-testable.
 *
 * @param manifest the coverage manifest
 * @returns the lines to emit
 */
export function renderCoverageLines({ manifest }: { manifest: CoverageManifest }): readonly string[] {
  // The subset banner goes FIRST, above the legs. A reader who stops after one line must still learn the
  // thing that changes how every number below it should be read.
  const lines = manifest.subset === undefined ? [] : [subsetBanner({ manifest: manifest.subset })];
  lines.push("coverage:");
  for (const leg of manifest.legs) {
    // The cursor is appended rather than woven into `detail`, so a leg that has none reads exactly as it did
    // before and the two facts stay separately assertable: what is on disk, and where the next refresh resumes.
    const cursor = leg.cursorIso === undefined ? "" : ` · cursor ${leg.cursorIso}`;
    lines.push(
      `  ${leg.leg} [${leg.state}] ingested=${String(leg.ingested)} indexed=${String(leg.indexed)} skipped=${renderSkips({ skipped: leg.skipped })} — ${leg.detail}${cursor}`,
    );
  }
  const breaches = conservationBreaches({ manifest });
  if (breaches.length === 0) {
    lines.push("  conservation: ingested = indexed + skipped holds for every leg");
  } else {
    for (const breach of breaches) {
      lines.push(`  CONSERVATION BREACH — ${breach}`);
    }
  }
  return lines;
}
