/**
 * The scaffolding a COMPILED surface's sync needs, whatever platform's specification it reads.
 *
 * ## Why this exists, stated as a finding rather than as a tidy-up
 *
 * The first two atlases to publish a surface from a pinned vendor document, `microsoft365/sync.ts` among them,
 * were caught by the clone ratchet as a duplicate pair the moment the second one landed. That is the same
 * shape `kit/withheld.ts` records: two atlases had written one file byte-for-byte apart from their type names,
 * and the answer is to move the platform-free half here rather than to raise a floor.
 *
 * Four things turned out to be genuinely platform-free, and each is here for a reason a reader can check:
 * indexing rows by kind is a `Map` and nothing more; counting rows by disposition is a fold whose member
 * set is the caller's; finding a reviewed rule that matched nothing is a set difference; and the CENSUS
 * assertion is the same three-part message with different numbers in it.
 *
 * ## The census assertion is the load-bearing one
 *
 * Both callers pin an immutable document and verify its digest before parsing, so the document's own
 * numbers cannot move. The assertion therefore catches a change in the READER — a `$ref` that stopped being
 * resolved, an HTTP method quietly dropped from a walk — which is the failure a digest cannot see and the
 * one that actually happened in production: parameters arriving by reference were skipped, and every one of
 * Graph's 9,378 GETs reported as unpageable. Keeping that message in one place keeps its last line honest
 * for both atlases at once.
 */
import { err, ok, type Result } from "../../lib/result.js";

import type { AtlasGapRecheck } from "./gaps.js";

/**
 * One measured census, in the terms both callers already report.
 *
 * @internal
 */
export interface AtlasCompiledCensus {
  readonly pathCount: number;
  readonly operationCount: number;
  readonly methodCounts: Readonly<Record<string, number>>;
  readonly rootCount: number;
  /** Component schemas or model definitions — whatever the document calls the place field names resolve in. */
  readonly schemaCount: number;
}

/**
 * What the pin says the census must be. Same shape, so a mismatch is a field-by-field comparison.
 *
 * @internal
 */
export interface AtlasCompiledCensusPin {
  readonly pathCount: number;
  readonly operationCount: number;
  readonly rootCount: number;
  readonly schemaCount: number;
  /** The per-method census, keyed by the lower-case method name the reader counts under. */
  readonly methodCounts: Readonly<Record<string, number>>;
}

/**
 * Every way a measured census can disagree with the pinned one.
 *
 * @param census what this run measured
 * @param pin what was reviewed
 * @param platform the platform's own name, so the closing line names the right document
 * @returns every disagreement with the two framing lines, or `null` when the census is exactly the pinned one
 */
export function compiledCensusMismatch({
  census,
  pin,
  platform,
}: {
  census: AtlasCompiledCensus;
  pin: AtlasCompiledCensusPin;
  platform: string;
}): readonly string[] | null {
  const problems: string[] = [];
  const expect = ({ label, got, want }: { label: string; got: number; want: number }): void => {
    if (got !== want) {
      problems.push(`${label}: read ${String(got)}, pinned ${String(want)}`);
    }
  };
  expect({ got: census.pathCount, label: "paths", want: pin.pathCount });
  expect({ got: census.operationCount, label: "operations", want: pin.operationCount });
  expect({ got: census.rootCount, label: "resource roots", want: pin.rootCount });
  expect({ got: census.schemaCount, label: "schemas", want: pin.schemaCount });
  for (const [method, want] of Object.entries(pin.methodCounts)) {
    const label = `${method} operations`;
    // The reader keys a method only once it counts an operation under it, so a method the census holds no
    // entry for was measured at zero — and a pin expecting more is reported as the mismatch it is.
    const counted = census.methodCounts[method];
    if (counted === undefined) {
      expect({ got: 0, label, want });
      continue;
    }
    expect({ got: counted, label, want });
  }
  if (problems.length === 0) {
    return null;
  }
  return [
    `the compiled census does not match the pinned one, so nothing was published (${platform})`,
    ...problems,
    "the document is digest-verified before it is parsed, so this is a change in THIS reader rather than in the vendor's document — see `kit/compiledSync.ts` on why that is what the assertion is for",
  ];
}

/**
 * Index rows by the kind whose file they belong in.
 *
 * @param rows every row this run compiled
 * @param kindOf reads a row's kind, since only the caller knows where it sits
 * @returns the rows, grouped, in the order they arrived
 */
export function groupRowsByKind<TKind extends string, TRow>({
  rows,
  kindOf,
}: {
  rows: readonly TRow[];
  kindOf: (row: TRow) => TKind;
}): ReadonlyMap<TKind, readonly TRow[]> {
  const byKind = new Map<TKind, TRow[]>();
  for (const row of rows) {
    const kind = kindOf(row);
    const held = byKind.get(kind);
    if (held === undefined) {
      byKind.set(kind, [row]);
      continue;
    }
    held.push(row);
  }
  return byKind;
}

/**
 * Count rows by their disposition, over whatever member set the caller declares.
 *
 * The zeroed record is the caller's, so a disposition nobody used still reports `0` rather than going
 * missing — a count that disappears when it reaches zero is a count a reader cannot rely on.
 *
 * @param rows every row this run compiled
 * @param empty a record with every disposition present and zero
 * @param dispositionOf reads a row's disposition
 * @returns the counts, with every declared member present
 */
export function countByDisposition<TDisposition extends string, TRow>({
  rows,
  empty,
  dispositionOf,
}: {
  rows: readonly TRow[];
  empty: Readonly<Record<TDisposition, number>>;
  dispositionOf: (row: TRow) => TDisposition;
}): Readonly<Record<TDisposition, number>> {
  const counts: Record<TDisposition, number> = { ...empty };
  for (const row of rows) {
    counts[dispositionOf(row)] += 1;
  }
  return counts;
}

/**
 * Reviewed rules that matched nothing at all in the pinned document.
 *
 * A dead rule reads as considered judgement and is not one, so both callers raise a gap for each — this is
 * the set difference behind it.
 *
 * @param rows every row this run compiled
 * @param declared every rule id the atlas's own ruling module can return
 * @param ruleIdOf reads which rule decided a row
 * @returns the declared ids that no row carries, in declaration order
 */
export function unfiredRuleIds<TRow>({
  rows,
  declared,
  ruleIdOf,
}: {
  rows: readonly TRow[];
  declared: readonly string[];
  ruleIdOf: (row: TRow) => string;
}): readonly string[] {
  const fired = new Set(rows.map((row) => ruleIdOf(row)));
  return declared.filter((id) => !fired.has(id));
}

/**
 * The four fields every atlas's kind file carries, which is all this module needs to assemble one.
 *
 * @internal
 */
interface AtlasKindFileShape<TEntity, TGap, TCell> {
  readonly entities: TEntity[];
  readonly gaps: TGap[];
  readonly coverage: TCell[];
  readonly updatedAt: string;
}

/**
 * Assemble one kind's next file from a merge, a gap reconciliation and a freshly built coverage list.
 *
 * The tail this replaces was the LAST thing the clone ratchet still matched between the two
 * specification-compiling atlases, and it matched because it is genuinely one idea: a merge and a gap
 * reconciliation are each fallible, either failure aborts the kind, and what survives is the stored file
 * with exactly four fields replaced. Spreading `stored` rather than rebuilding it is the load-bearing part
 * — a kind file carries its `platform`, `kind` and `schemaVersion`, and a rebuild that forgot one would be
 * refused at publication rather than here.
 *
 * @param stored the kind file as the generation holds it
 * @param merged this run's merged entity list, or why it could not be merged
 * @param gaps this run's reconciled gap list, or why it could not be reconciled
 * @param coverage the coverage cells this run computed for the kind
 * @param at this run's ISO timestamp
 * @returns the next file, or the first reason it cannot be built
 *
 * @internal
 */
export function assembleKindFile<TEntity, TGap, TCell, TFile extends AtlasKindFileShape<TEntity, TGap, TCell>>({
  stored,
  merged,
  gaps,
  coverage,
  at,
}: {
  stored: TFile;
  merged: Result<readonly TEntity[]>;
  gaps: Result<readonly TGap[]>;
  coverage: readonly TCell[];
  at: string;
}): Result<TFile> {
  if (merged.isErr()) {
    return err(merged.error);
  }
  if (gaps.isErr()) {
    return err(gaps.error);
  }
  return ok({
    ...stored,
    coverage: [...coverage],
    entities: [...merged.value],
    gaps: [...gaps.value],
    updatedAt: at,
  });
}

/**
 * The two gap conditions a successful compile always rechecks, for one kind.
 *
 * Both specification-compiling atlases refuse to publish at all when their census moves or when the
 * document declares a root they do not — so reaching the publish step IS the recheck, and having reached
 * it, both close the same two conditions. Naming them here means the strings live once: a rename that
 * changed one and not the other would leave a gap open forever with nothing to close it.
 *
 * @param kind the kind these rechecks are scoped to
 * @returns the two rechecks, both resolved
 *
 * @internal
 */
export function compiledSyncRechecks({ kind }: { kind: string }): readonly AtlasGapRecheck[] {
  return [
    { condition: "spec-census-moved", resolved: true, scope: kind },
    { condition: "spec-root-undeclared", resolved: true, scope: kind },
  ];
}

/**
 * Build one compiled operation kind's next file: merge this run's projections on, reconcile its gaps, and
 * assemble.
 *
 * The last thing the clone ratchet matched between the two specification-compiling atlases, and it matched
 * because it is one idea rather than two similar ones: a compiled sync refreshes exactly one channel, the
 * gap reconciliation always closes the same two conditions ({@link compiledSyncRechecks}), and the coverage
 * is whatever the platform computed. Everything platform-specific arrives as an injected function, so this
 * knows no platform's vocabulary — which is the same seam `kit/merge.ts` and `kit/gaps.ts` already draw one
 * level down.
 *
 * @param kind the kind being built
 * @param stored the kind file as the generation holds it
 * @param observed this run's freshly projected entities
 * @param observedGaps the gaps this run detected for the kind
 * @param coverage the coverage cells this run computed for the kind
 * @param at this run's ISO timestamp
 * @param mergeChannel folds the observations onto the stored entities, refreshing one channel
 * @param reconcile folds this run's gaps and rechecks into what is stored
 * @returns the next file, or the first reason it cannot be built
 */
export function buildCompiledKindFile<TEntity, TGap, TCell, TFile extends AtlasKindFileShape<TEntity, TGap, TCell>>({
  kind,
  stored,
  observed,
  observedGaps,
  coverage,
  at,
  mergeChannel,
  reconcile,
}: {
  kind: string;
  stored: TFile;
  observed: readonly TEntity[];
  observedGaps: readonly TGap[];
  coverage: readonly TCell[];
  at: string;
  mergeChannel: (input: { stored: readonly TEntity[]; observed: readonly TEntity[] }) => Result<readonly TEntity[]>;
  reconcile: (input: {
    stored: readonly TGap[];
    observed: readonly TGap[];
    rechecks: readonly AtlasGapRecheck[];
  }) => Result<readonly TGap[]>;
}): Result<TFile> {
  return assembleKindFile({
    at,
    coverage,
    gaps: reconcile({ observed: observedGaps, rechecks: compiledSyncRechecks({ kind }), stored: stored.gaps }),
    merged: mergeChannel({ observed, stored: stored.entities }),
    stored,
  });
}
