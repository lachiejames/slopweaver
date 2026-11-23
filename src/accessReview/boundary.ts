/**
 * The claim boundary every section of this report carries — what was measured, when, on which surface, and
 * what a zero here does and does not prove.
 *
 * ## It is DERIVED, never written
 *
 * Every clause below is computed from the snapshot the report was built from. A boundary typed by hand goes
 * stale the first time a resync moves a stamp, and a stale boundary is worse than none because it is
 * confident. The one thing an author chooses is which clauses a section owes; the values are the atlas's.
 *
 * ## The clauses, and what each is grounded in
 *
 * - The **read stamp** is the kind's own `lastSuccessAt` from `atlas/kit/read.ts`, or an attempted coverage
 *   cell's when that is earlier (`measuredAsOf`) — not the generation's `updatedAt`, because a publish that
 *   touched one kind moves the generation clock and says nothing about the kind this report read.
 * - **Whether the latest attempt FAILED** (`latestAttemptFailed`, the kind's or any coverage cell's) is what
 *   separates a stale atlas from a broken one. 1Password's identity kinds fail on an interactive `op signin`, so its section is degraded and
 *   must say so rather than presenting a clean-looking roster.
 * - The **declared boundary** is the manifest's `permissionBlocked` where it carries one, and the coverage
 *   cell's own `reason` otherwise. `kit/read.ts` calls a `null` block the fail-closed reading — dark for a
 *   reason the atlas could not name — which is a different report from a credential being fenced out.
 * - **An absent field inside a record is not evidence a setting is off**, which is the one clause with no
 *   value to compute and the one most often forgotten.
 */
import { parseStrictIsoInstantMs } from "#lib/date.js";

import type { AtlasCoverageCellView, AtlasKindView } from "../atlas/kit/read.js";

/** What one kind can and cannot say, computed from its own manifest cell. */
export interface KindBoundary {
  readonly platform: string;
  readonly kind: string;
  /** The kind's last successful read, or `null` when it has never had one. */
  readonly readStampIso: string | null;
  /** Whether the most recent attempt on this kind failed. */
  readonly latestAttemptFailed: boolean;
  /** What the manifest vouches for, which a half-write makes disagree with the rows read. */
  readonly publishedCount: number;
  /** How many entities actually read back. */
  readonly readCount: number;
  /** The declared permission block, or the coverage reasons when there is none. */
  readonly declaredBoundary: readonly string[];
}

/** The sentence that has no value to compute, and is the clause most often forgotten. */
export const ABSENT_FIELD_CLAUSE =
  "An absent field inside a record is not evidence a setting is off — it is evidence nothing was stored.";

/**
 * What excluding a rehire does NOT prove.
 *
 * A rehire holds their account legitimately TODAY, which is the question the three buckets ask. It is not the
 * same question as whether the account stayed live through the gap between their spells, and this report does
 * not examine that, so the case it cannot see is a rehired person whose `lastSuccessfulLogin` on some platform
 * falls between their earlier spell's end date and their current spell's start date. Saying so is the point —
 * an exclusion whose limit is unstated reads as a clearance.
 */
export const REHIRE_LIMIT_CLAUSE =
  "A rehire is excluded because a live employment spell means the account is held legitimately NOW. " +
  "The match is by address: a person rehired under a NEW address leaves the old address in its bucket, " +
  "because no live spell covers an account still keyed to it. " +
  "This report does not examine whether it stayed live through the gap between spells, and a last-login " +
  "inside such a gap is a separate question it cannot answer.";

/** What every count in this report is a count OF. */
export const STORED_RECORDS_CLAUSE =
  "Every count is of records STORED in an atlas, never of a provider's own population; a full table proves no completeness.";

/**
 * Compute one kind's boundary from the view the snapshot gave back.
 *
 * @param platform the atlas the kind belongs to
 * @param view the kind as `atlas/kit/read.ts` presented it
 * @returns the boundary clauses that kind can support
 */
export function kindBoundaryOf({ platform, view }: { platform: string; view: AtlasKindView }): KindBoundary {
  return {
    declaredBoundary: declaredBoundaryOf({ view }),
    kind: view.kind,
    latestAttemptFailed: view.latestAttemptFailed || view.coverage.some((cell) => cell.latestAttemptFailed),
    platform,
    publishedCount: view.publishedCount,
    readCount: view.entities.length,
    readStampIso: measuredAsOf({ view }),
  };
}

/**
 * The coverage cells an attempt was actually made on — one that failed, or one that has read. A cell never
 * attempted describes a channel this kind was not read through, so it moves neither the stamp nor DEGRADED.
 *
 * @param view the kind as `atlas/kit/read.ts` presented it
 * @returns the attempted cells, in the view's order
 */
export function attemptedCells({ view }: { view: AtlasKindView }): readonly AtlasCoverageCellView[] {
  return view.coverage.filter((cell) => cell.latestAttemptFailed || cell.lastSuccessAt !== null);
}

/**
 * The instant a kind is measured AS OF: the EARLIEST success across the kind and every attempted coverage cell.
 *
 * The kind's own stamp can be fresh while one of its cells failed — a JumpCloud walk that completes with a
 * depth-limited projection publishes an `unreadable` cell beside a new kind stamp — and a failed cell keeps only
 * its previous success. Taking the kind's stamp alone would judge every departure against a read that cell did
 * not make. Fails closed like the roster's last day: any cell that has never read answers `null`, and a stamp
 * that does not parse is returned verbatim so the join leaves everyone measured against it unmeasured.
 *
 * @param view the kind as `atlas/kit/read.ts` presented it
 * @returns the earliest success, verbatim, or `null` when the kind or an attempted cell has never read
 */
function measuredAsOf({ view }: { view: AtlasKindView }): string | null {
  let earliest: { readonly iso: string; readonly ms: number } = { iso: "", ms: Number.POSITIVE_INFINITY };
  for (const stamp of [view.lastSuccessAt, ...attemptedCells({ view }).map((cell) => cell.lastSuccessAt)]) {
    if (stamp === null) {
      return null;
    }
    const ms = parseStrictIsoInstantMs({ text: stamp });
    if (ms === undefined) {
      return stamp;
    }
    if (ms < earliest.ms) {
      earliest = { iso: stamp, ms };
    }
  }
  // The kind's own stamp is always first in the list, so a list that did not return holds at least one instant.
  return earliest.iso;
}

/** The declared boundary: the permission block if the manifest carries one, else every coverage reason. */
function declaredBoundaryOf({ view }: { view: AtlasKindView }): readonly string[] {
  const blocked = view.permissionBlocked;
  if (blocked !== null) {
    return [`permission-blocked since ${blocked.at} — ${blocked.detail} (unblocked by ${blocked.unblockedBy})`];
  }
  const reasons = view.coverage
    .filter((cell) => cell.reason.length > 0)
    .map((cell) => `${cell.surface}/${cell.scope}: ${cell.state} — ${cell.reason}`);
  if (reasons.length === 0) {
    return ["no permission block declared and no coverage reason recorded for this kind"];
  }
  return [...new Set(reasons)].toSorted();
}

/**
 * Whether a kind's own state means its section of the report is DEGRADED rather than current.
 *
 * @param boundary the computed boundary
 * @returns true when the kind has never read, its latest attempt failed, or it read back fewer entities than
 *   the manifest vouches for
 */
export function isDegraded({ boundary }: { boundary: KindBoundary }): boolean {
  if (boundary.readStampIso === null || boundary.latestAttemptFailed) {
    return true;
  }
  return boundary.readCount < boundary.publishedCount;
}

/**
 * How a read stamp prints, including the one that has never been taken.
 *
 * Shared with the privileged table's own header, because a kind that has never read successfully and one
 * read a moment ago must print in the same place and the same shape wherever a stamp appears.
 *
 * @param readStampIso the kind's last successful read, or `null` when it has never had one
 * @returns the instant, or the sentence that says there is none
 */
export function readStampText({ readStampIso }: { readStampIso: string | null }): string {
  if (readStampIso === null) {
    return "never read successfully";
  }
  return readStampIso;
}

/**
 * The boundary as lines a reader sees, one clause each.
 *
 * @param boundary the computed boundary
 * @returns the lines, in reading order
 */
export function boundaryLines({ boundary }: { boundary: KindBoundary }): readonly string[] {
  const stamp = readStampText({ readStampIso: boundary.readStampIso });
  const lines = [
    `read stamp · ${boundary.platform}/${boundary.kind} last successful read ${stamp}`,
    `records · ${String(boundary.readCount)} read back, ${String(boundary.publishedCount)} vouched for by the manifest`,
    ...boundary.declaredBoundary.map((clause) => `declared boundary · ${clause}`),
  ];
  if (boundary.latestAttemptFailed) {
    return [...lines, `DEGRADED · the latest attempt on ${boundary.platform}/${boundary.kind} FAILED`];
  }
  return lines;
}
