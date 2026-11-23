/**
 * `atlas braze report` — where Braze's two published descriptions of its own API disagree.
 *
 * `docs/atlas-intent/04-corroboration.md` makes corroboration an OUTPUT rather than a build-time check that gets
 * discarded, and the rule is narrow and specific: the real INSTANCES come first, case by
 * case, before anything picks a winner between surfaces, because a disagreement may be evidence the atlas is
 * built wrong rather than evidence the platform is inconsistent. So this verb reports and never adjudicates,
 * and both records are kept on the entity regardless of which channel saw it.
 *
 * ## Why this atlas can produce that card on the day it lands
 *
 * Its two filled channels are both PUBLISHED documents, so neither waits on a credential. Every other atlas
 * here needed a live browser walk before it could disagree with anything.
 *
 * ## The report is read from the STORE, not recomputed
 *
 * The disagreements are already gaps, written by `sync.ts` with their own conditions and scopes and carried
 * through the kit's accumulate-never-replace lifecycle. Recomputing them here would let the verb and the
 * store drift, and a reader chasing a row would have no way to tell which was authoritative.
 */
import { err, ok, type Result } from "../../lib/result.js";

import { BrazeAtlasErrors, brazeAtlasErrorLines } from "./errors.js";
import { openBrazeGaps } from "./gaps.js";
import { BRAZE_KINDS, type BrazeAtlasGap, type BrazeKind } from "./model.js";
import { type BrazeAtlasPaths, readBrazeAtlas } from "./store.js";

/** One disagreement between the two published channels. */
interface BrazeDisagreement {
  /** `<METHOD> <normalised path>` — the operation both channels are indexed by. */
  readonly providerId: string;
  readonly kind: BrazeKind;
  readonly reason: string;
}

/** What the two published channels disagree about, and what neither could tell us. */
export interface BrazeReport {
  /** Operations the reference describes and the official collection does not ship. */
  readonly missingFromCollection: readonly BrazeDisagreement[];
  /** Operations the collection ships with no reference page at all. */
  readonly missingFromDocumentation: readonly BrazeDisagreement[];
  /** Addresses a published source spells in a way that does not resolve. */
  readonly malformedPaths: readonly BrazeDisagreement[];
  /** Families entirely absent from the collection — the shape of the drift, not just its size. */
  readonly familiesAbsentFromCollection: readonly { readonly kind: BrazeKind; readonly operations: number }[];
  /** Every other open gap's condition, counted, so the report never hides what it did not itemise. */
  readonly otherOpenGaps: readonly { readonly condition: string; readonly count: number }[];
}

/** The two conditions this report itemises as disagreements between the published channels. */
const MISSING_FROM_COLLECTION = "collection-missing-documented-operation";
const MISSING_FROM_DOCUMENTATION = "documentation-missing-collection-operation";
const MALFORMED_PATH = "published-path-malformed";

/**
 * Read where the two published channels disagree.
 *
 * @param paths the resolved atlas paths
 * @returns the report, or why the store could not be read
 */
export function reportBrazeDisagreements({ paths }: { paths: BrazeAtlasPaths }): Result<BrazeReport> {
  const snapshot = readBrazeAtlas({ paths });
  if (snapshot.isErr()) {
    return err(snapshot.error);
  }
  if (snapshot.value.manifest === null) {
    return err(brazeAtlasErrorLines({ error: BrazeAtlasErrors.nothingPublished() }));
  }
  const bins = emptyBins();
  const documentedPerKind = new Map<BrazeKind, number>();
  for (const kind of BRAZE_KINDS) {
    const file = snapshot.value.files[kind];
    if (file === null) {
      continue;
    }
    documentedPerKind.set(kind, file.entities.length);
    for (const gap of openBrazeGaps({ gaps: file.gaps })) {
      binGap({ bins, gap, kind });
    }
  }
  return ok({
    familiesAbsentFromCollection: familiesFullyAbsent({
      documentedPerKind,
      missingFromCollection: bins.missingFromCollection,
    }),
    malformedPaths: bins.malformedPaths.toSorted(byProviderId),
    missingFromCollection: bins.missingFromCollection.toSorted(byProviderId),
    missingFromDocumentation: bins.missingFromDocumentation.toSorted(byProviderId),
    otherOpenGaps: [...bins.others.entries()]
      .map(([condition, count]) => ({ condition, count }))
      .toSorted((left, right) => right.count - left.count || left.condition.localeCompare(right.condition)),
  });
}

/** Where each open gap lands while the store is walked. */
interface ReportBins {
  readonly missingFromCollection: BrazeDisagreement[];
  readonly missingFromDocumentation: BrazeDisagreement[];
  readonly malformedPaths: BrazeDisagreement[];
  readonly others: Map<string, number>;
}

/** A fresh set of bins. */
function emptyBins(): ReportBins {
  return { malformedPaths: [], missingFromCollection: [], missingFromDocumentation: [], others: new Map() };
}

/**
 * File one open gap into the group the report itemises it under, or count it among the rest.
 *
 * Split out of the walk above so the walk stays a walk: the routing is the branchy part, and inlining it made
 * one function that both iterated the store and decided what every condition means.
 */
function binGap({ bins, gap, kind }: { bins: ReportBins; gap: BrazeAtlasGap; kind: BrazeKind }): void {
  const row = { kind, providerId: gap.scope, reason: gap.reason };
  if (gap.condition === MISSING_FROM_COLLECTION) {
    bins.missingFromCollection.push(row);
    return;
  }
  if (gap.condition === MISSING_FROM_DOCUMENTATION) {
    bins.missingFromDocumentation.push(row);
    return;
  }
  if (gap.condition === MALFORMED_PATH) {
    bins.malformedPaths.push(row);
    return;
  }
  // A condition no earlier gap carried is on its first gap.
  const counted = bins.others.get(gap.condition);
  bins.others.set(gap.condition, counted === undefined ? 1 : counted + 1);
}

/**
 * Families where EVERY operation is missing from the collection.
 *
 * The shape of the drift matters more than its size: 55 scattered omissions would be sloppiness, while whole
 * product areas absent is the collection having been frozen before those areas shipped. A reader deciding
 * whether to trust the collection needs to know which of those it is.
 */
function familiesFullyAbsent({
  missingFromCollection,
  documentedPerKind,
}: {
  missingFromCollection: readonly BrazeDisagreement[];
  documentedPerKind: ReadonlyMap<BrazeKind, number>;
}): readonly { kind: BrazeKind; operations: number }[] {
  const missingPerKind = new Map<BrazeKind, number>();
  for (const row of missingFromCollection) {
    // A kind no earlier row was missing from is on its first missing operation.
    const tallied = missingPerKind.get(row.kind);
    missingPerKind.set(row.kind, tallied === undefined ? 1 : tallied + 1);
  }
  const absent: { kind: BrazeKind; operations: number }[] = [];
  for (const [kind, missing] of missingPerKind) {
    if (missing > 0 && missing === documentedPerKind.get(kind)) {
      absent.push({ kind, operations: missing });
    }
  }
  return absent.toSorted((left, right) => right.operations - left.operations || left.kind.localeCompare(right.kind));
}

/** Stable ordering, so a diff of two reports shows what changed rather than how they were iterated. */
function byProviderId(left: BrazeDisagreement, right: BrazeDisagreement): number {
  return left.providerId.localeCompare(right.providerId);
}

/**
 * Every open gap this report itemised rather than counted, for a caller printing a total.
 *
 * @param report the report to total
 * @returns how many disagreements were itemised
 *
 * @internal
 */
export function brazeItemisedGapCount({ report }: { report: BrazeReport }): number {
  return report.missingFromCollection.length + report.missingFromDocumentation.length + report.malformedPaths.length;
}

/**
 * Whether a stored gap is one of the disagreement conditions this report itemises.
 *
 * @param gap the stored gap
 * @returns true when the report would itemise rather than count it
 *
 * @internal
 */
export function isBrazeDisagreementGap({ gap }: { gap: BrazeAtlasGap }): boolean {
  return (
    gap.condition === MISSING_FROM_COLLECTION ||
    gap.condition === MISSING_FROM_DOCUMENTATION ||
    gap.condition === MALFORMED_PATH
  );
}
