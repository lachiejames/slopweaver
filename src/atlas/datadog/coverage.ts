/**
 * Build this platform's coverage cell for one kind — the place a withheld field is finally SAID, and the
 * place a partial read is refused the word `synced`.
 *
 * ## Why this exists rather than the sync calling the kit directly
 *
 * The kit's `succeededCoverageCell`/`failedCoverageCell` take a `reason` string and know nothing about
 * projections. Left to itself, a sync writes `reason: "synced <N> monitors"` and the fact that every
 * integration record had a credential removed is nowhere. This module is the seam that makes the drop reach
 * the reader, and putting it beside the projection rather than in the sync means it is testable without a
 * network call and cannot be forgotten by whoever writes the sync.
 *
 * ## It FAILS CLOSED, and that is the load-bearing rule
 *
 * A cell builder that takes a record count and nothing else has no way to tell a family that finished from
 * one whose second page threw, so it publishes both as `synced` — and the kit's success predicate is
 * existential, meaning one such cell is enough to make a partly-failed generation look routable. So the
 * read's own outcome is a REQUIRED input: a caller must state that the family completed, and cannot get a
 * `synced` cell by omitting the bad news.
 *
 * ## The drops are not a separate argument, and that is deliberate
 *
 * An earlier shape in the sibling atlas took a record COUNT and a drop list as two independent inputs,
 * which let a caller pair a truncated projection with an empty drop list and get `synced` — the metadata
 * could disagree with the data it described and nothing noticed. So this takes the PROJECTIONS themselves.
 *
 * ## A cell's `surface` is the CHANNEL, and its `scope` is the kind
 *
 * Not a naming preference. `cli/commands/atlas/coverageCore.ts`'s `atlasSurfaceHasFilledCell` decides
 * whether a DECLARED surface is filled by looking for a stored cell whose `surface` equals the declared
 * surface's name, and `descriptor.ts` fixes those names to be exactly the three channels. So a cell
 * carrying the kind in `surface` matches no declared surface at all, and every surface reads
 * `declared-unfilled` however much the store holds — which is the Google Admin `admin-api` failure, in a different atlas, with the same cause. It also makes the
 * replace-my-own-cell filter every publisher runs (the one `kit/kindFileWithCell.ts` encodes) correct: three
 * channels write three cells into one kind file, and filtering on `surface` replaces one rather than all
 * three.
 *
 * ## A shape-indexed family says what it is NOT holding, every time
 *
 * The one thing that is Datadog's rather than inherited. When a kind's disposition is `shape-index`, its
 * cell states in words that the occurrence bodies and metric points were withheld by DESIGN and what was
 * kept instead. Without that sentence a reader of `atlas datadog coverage --kind logs` sees a `synced` cell
 * over a handful of shape entities and concludes this organisation barely logs, which is the most wrong
 * answer this atlas could give.
 */
import type { AtlasCoverageState, AtlasEvidenceRole } from "../kit/contract.js";
import { type AtlasCoverageCell, failedCoverageCell, succeededCoverageCell } from "../kit/coverage.js";

import type { AtlasDroppedField, AtlasProjection } from "../kit/projection.js";
import { stateFor } from "./coverageState.js";
import type { DatadogChannel, DatadogCoverageCell } from "./documents.js";
import type { DatadogAtlasError } from "./errors.js";
import { DATADOG_VISIBILITY_SCOPE } from "./model.js";
import type { DatadogDisposition } from "./surfaceRow.js";
import { summariseDatadogWithholding, withholdingIsTruncated, withholdingSentence } from "./withheld.js";

/**
 * Whether a kind's read actually finished, stated by the caller that ran it.
 *
 * Deliberately not inferable from a record count: 100 records is what a complete family and a family whose
 * second page threw both look like from here.
 *
 * ## `nothing-callable` is the case a zero record count reads exactly like, and it is NOT a success
 *
 * FOUND BY THE REVIEW PASS on this module's own first live generation, against the property
 * "the live pass cannot publish a generation claiming more coverage than it earned". **18 of the 144 kinds
 * published `api: synced` having made no call at all** — every operation in each is `excluded` or
 * `probe-only`, so the pass had nothing to issue, no remainder to defer, and no failure to report, and the
 * three-way decision below therefore fell through to `complete`. The cell read `0 record(s) from api`
 * beside the word `synced`, which is the "reported N, reached one" failure `descriptor.ts`'s header names,
 * reproduced inside the atlas that refuses it. Reproduce on any generation:
 *
 * ```bash
 * slopweaver atlas datadog coverage --surface api --state synced --json
 * ```
 *
 * So "nothing was asked" is its own arm, graded `excluded` — the kit's word for a bound of CONDUCT rather
 * than of reach. An empty record count can mean the organisation holds none, or that nothing looked, and a
 * cell that cannot tell them apart is worse than no cell.
 *
 * ## `bounded` is a SUCCESS that is not `synced`, and it is a third case rather than either of the others
 *
 * A live pass that issues a paging operation's first page did not fail — every request it made was
 * answered — so reporting it as `incomplete` would put `latestAttemptFailed: true` on a cell nothing went
 * wrong in, and the freshness judgement reads that field. Reporting it as `complete` would earn it
 * `synced`, which is the claim-more-than-you-earned failure this whole module exists against. So the caller
 * must say which, and a bounded read carries its own two sentences: what bounds it and what would widen it.
 * @internal
 */
export type DatadogReadOutcome =
  | { readonly status: "complete" }
  | { readonly status: "bounded"; readonly because: string; readonly unblockedBy: string }
  | { readonly status: "nothing-callable"; readonly because: string }
  | { readonly status: "incomplete"; readonly error: DatadogAtlasError };

/**
 * Every removal across a family's projections, read without calling a method off the caller's array.
 *
 * Indexed for the same reason `projection.ts` walks arrays by index: the array is the caller's, and calling
 * a method off it lets the caller decide what the drop report says about its own documents.
 *
 * @param projections the family's projected records, each carrying its own removals
 * @returns every removal, in projection order
 */
function everyDrop({ projections }: { projections: readonly AtlasProjection[] }): readonly AtlasDroppedField[] {
  const dropped: AtlasDroppedField[] = [];
  for (let index = 0; index < projections.length; index += 1) {
    // `index` stays below `projections.length`, so a projection sits there, and `dropped` is required on it.
    const drops = projections[index]!.dropped;
    for (let at = 0; at < drops.length; at += 1) {
      const drop = drops[at];
      if (drop !== undefined) {
        dropped.push(drop);
      }
    }
  }
  return dropped;
}

/**
 * The sentence a shape-indexed family carries, so nobody reads its entity count as a volume.
 *
 * @param kind the family being described
 * @returns one sentence stating what was deliberately not held
 */
function shapeIndexSentence({ kind }: { kind: string }): string {
  return `${kind} is SHAPE-INDEXED by design: the occurrence bodies and any metric points were never stored, only which attribute paths exist, the JSON types seen at each, and values for the closed set of structural facets. The entity count here is a count of SHAPES over a bounded window, never of what this organisation holds`;
}

/** What a truncated projection needs, stated once so the exported function stays within its length cap. */
const TRUNCATION_REMEDY =
  "the projection hit its depth bound on at least one record, so part of a stored document is neither held nor known. Raise the bound or find out why a Datadog payload nests that deeply";

/**
 * The English half of a cell: how many records, whether the family is shape-indexed, and what was withheld.
 *
 * @param channel which channel performed the read
 * @param disposition what the registry says this atlas does with the family
 * @param kind the atlas kind
 * @param projections the family's projected records
 * @param withholding their removals, already summarised
 * @returns the reason string, with empty parts dropped
 */
function reasonFor({
  channel,
  disposition,
  kind,
  projections,
  withholding,
}: {
  channel: string;
  disposition: DatadogDisposition;
  kind: string;
  projections: readonly AtlasProjection[];
  withholding: Parameters<typeof withholdingSentence>[0]["withholding"];
}): string {
  const shaped = disposition === "shape-index" ? shapeIndexSentence({ kind }) : "";
  return [`${String(projections.length)} record(s) from ${channel}`, shaped, withholdingSentence({ withholding })]
    .filter((part) => part.length > 0)
    .join("; ");
}

/**
 * A failed or defect-bearing cell, with this platform's own scope and claim boundary already filled in.
 *
 * Split out because the two non-`synced` returns differ only in their state and reason, and inlining both
 * put the exported function over the module's function-length cap for no reader's benefit.
 */
function failedCell({
  channel,
  kind,
  previous,
  reason,
  role,
  state,
  unblockedBy,
}: {
  channel: string;
  kind: string;
  previous: AtlasCoverageCell | null;
  reason: string;
  role: AtlasEvidenceRole;
  state: AtlasCoverageState;
  unblockedBy: string | null;
}): AtlasCoverageCell {
  return failedCoverageCell({
    previous,
    reason,
    role,
    scope: kind,
    state,
    surface: channel,
    unblockedBy,
    visibilityScope: DATADOG_VISIBILITY_SCOPE,
  });
}

/**
 * A read that SUCCEEDED and is still bounded — the third arm, and the one neither kit constructor fits.
 *
 * `failedCoverageCell` would set `latestAttemptFailed` on a cell nothing went wrong in, and the freshness
 * judgement reads that field. `succeededCoverageCell` fits, with a `state` other than `synced` and the
 * `unblockedBy` this run computed.
 */
function boundedCell({
  at,
  channel,
  kind,
  outcome,
  reason,
  role,
}: {
  at: string;
  channel: string;
  kind: string;
  outcome: { readonly because: string; readonly unblockedBy: string };
  reason: string;
  role: AtlasEvidenceRole;
}): AtlasCoverageCell {
  return succeededCoverageCell({
    artifacts: [],
    at,
    reason: `${reason}; ${outcome.because}`,
    role,
    scope: kind,
    // `deferred`, not `synced`: every request was answered, and part of what this kind holds was never
    // asked for. The success is real and so is the remainder, which is why both are on one cell.
    state: "deferred",
    surface: channel,
    unblockedBy: outcome.unblockedBy,
    visibilityScope: DATADOG_VISIBILITY_SCOPE,
  });
}

/**
 * Build the coverage cell for one kind's read.
 *
 * @param kind the atlas kind this read populated
 * @param channel which of the three channels performed it
 * @param role what that channel's evidence is worth for this kind
 * @param disposition what the registry says this atlas does with the family, so a shape index says so
 * @param outcome whether the read actually finished — required, so a partial read cannot claim `synced`
 * @param projections the family's projected records, each carrying its own removals
 * @param at the ISO instant of this attempt
 * @param previous the cell as it stood before this attempt, so a failure does not erase an earlier success
 * @returns the cell to publish
 */
export function datadogCoverageCell({
  kind,
  channel,
  role,
  disposition,
  outcome,
  projections,
  at,
  previous = null,
}: {
  kind: string;
  channel: string;
  role: AtlasEvidenceRole;
  disposition: DatadogDisposition;
  outcome: DatadogReadOutcome;
  projections: readonly AtlasProjection[];
  at: string;
  previous?: AtlasCoverageCell | null;
}): AtlasCoverageCell {
  const withholding = summariseDatadogWithholding({ dropped: everyDrop({ projections }) });
  const parts = reasonFor({ channel, disposition, kind, projections, withholding });
  // Checked before truncation, because a bounded read's own bound is the more specific thing to report and
  // a truncating projection would still deny it `synced` either way.
  if (outcome.status === "nothing-callable") {
    return failedCell({
      channel,
      kind,
      previous,
      reason: `${parts}; ${outcome.because}`,
      role,
      // `excluded`, not `synced` and not `unavailable`: nothing was refused by the provider and nothing
      // failed. The bound is this atlas's own conduct, which is exactly what the kit's word means.
      state: "excluded",
      unblockedBy: null,
    });
  }
  if (outcome.status === "bounded" && !withholdingIsTruncated({ withholding })) {
    return boundedCell({ at, channel, kind, outcome, reason: parts, role });
  }
  if (outcome.status === "incomplete") {
    const { state, unblockedBy } = stateFor({ error: outcome.error });
    return failedCell({
      channel,
      kind,
      previous,
      reason: `${parts}; ${outcome.error.message}`,
      role,
      state,
      unblockedBy,
    });
  }
  return completedCell({ at, channel, kind, previous, reason: parts, role, withholding });
}

/**
 * A read the caller reported COMPLETE — `synced`, unless its own projection truncated a document.
 *
 * A truncated document is a DEFECT, not a policy, so the family that carries one is never `synced`: it is
 * the one thing that can deny a completed read the word. The projection is what says so, and it cannot be
 * separated from the records it truncated because both arrive in the same value.
 */
function completedCell({
  at,
  channel,
  kind,
  previous,
  reason,
  role,
  withholding,
}: {
  at: string;
  channel: string;
  kind: string;
  previous: AtlasCoverageCell | null;
  reason: string;
  role: AtlasEvidenceRole;
  withholding: Parameters<typeof withholdingIsTruncated>[0]["withholding"];
}): AtlasCoverageCell {
  if (withholdingIsTruncated({ withholding })) {
    return failedCell({
      channel,
      kind,
      previous,
      reason,
      role,
      state: "unreadable",
      unblockedBy: TRUNCATION_REMEDY,
    });
  }
  return succeededCoverageCell({
    artifacts: [],
    at,
    reason,
    role,
    scope: kind,
    state: "synced",
    surface: channel,
    visibilityScope: DATADOG_VISIBILITY_SCOPE,
  });
}

/**
 * The same cell in the shape a Datadog generation stores.
 *
 * `documents.ts`'s stored cell is the kit cell plus a TYPED `channel` and minus two fields, and the sync is
 * where the two shapes meet. Both omissions are deliberate rather than lossy:
 *
 * - `visibilityScope` is {@link DATADOG_VISIBILITY_SCOPE}, one module constant identical on every cell this
 *   atlas can build, so storing it would write the same 300-character sentence into all 144 kind files. The
 *   read view (`kit/read.ts`'s {@link import("../kit/read.js").AtlasCoverageCellView}) does not carry it
 *   either, so nothing downstream can tell the difference.
 * - `artifacts` has no home in the stored schema. Every cell reaching here is built by
 *   {@link datadogCoverageCell}, which passes an empty list, and the only channel that could ever produce a
 *   screenshot is `console` — which is `declared-unfilled` and cannot publish. **A console walk must widen
 *   `datadogCoverageCellSchema` before it publishes its first artifact**, and `coverage.test.ts` pins that
 *   the compiled path produces none, so this stays a stated precondition rather than a silent drop.
 *
 * @param cell the kit cell this run built
 * @param channel which of the three channels produced it, typed
 * @returns the cell as a generation stores it
 */
export function storedDatadogCoverageCell({
  cell,
  channel,
}: {
  cell: AtlasCoverageCell;
  channel: DatadogChannel;
}): DatadogCoverageCell {
  return {
    channel,
    lastSuccessAt: cell.lastSuccessAt,
    latestAttemptFailed: cell.latestAttemptFailed,
    reason: cell.reason,
    role: cell.role,
    scope: cell.scope,
    state: cell.state,
    surface: cell.surface,
    unblockedBy: cell.unblockedBy,
  };
}
