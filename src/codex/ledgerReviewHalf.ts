/**
 * The review half of the Codex pairing floor, as `./ledger.ts`'s `assessCodexLoop` reads it: one current,
 * conclusive review, and what a CURRENT `BROKEN` one means — a refusal before the second review pass, a named
 * leftover after it (`./reviewPassCap.ts`, `./reviewLeftovers.ts`). The plan half stays in `./ledger.ts`.
 */
import type { CodexLoopAssessment, LedgerEntry } from "./ledger.js";
import { cappedNextStep } from "./ledgerCapClauses.js";
import { concluded, newestDriftClause, newestFaultClause } from "./ledgerNewestClauses.js";
import type { CodexQuotaEvidence } from "./quotaTypes.js";
import { leftoverOf } from "./reviewLeftovers.js";
import { REVIEW_PASS_CAP, reviewedDiffs } from "./reviewPassCap.js";

/** The only verdicts a REVIEW pass can answer with. A plan's `READY` on a review record is not one of them. */
const REVIEW_VERDICTS: ReadonlySet<string> = new Set(["CLEAN", "BROKEN"]);

/**
 * The review half of the floor: one current, conclusive review, and no current `BROKEN` one before the second
 * review pass.
 *
 * @param entries the ledger for the branch, newest first
 * @param cap the live quota gate's evidence when Codex is currently capped
 * @returns one line per reason the review half is unsatisfied, and the leftovers past the second review pass
 */
export function reviewHalf({
  entries,
  cap,
}: {
  entries: readonly LedgerEntry[];
  cap: CodexQuotaEvidence | undefined;
}): CodexLoopAssessment {
  const failures = reviewFailures({ cap, entries });
  if (failures.broken.length === 0) {
    return { failures: failures.lines, leftovers: [] };
  }
  if (reviewedDiffs({ entries }).length < REVIEW_PASS_CAP) {
    return {
      failures: [
        ...failures.lines,
        ...failures.broken.map(
          (entry) =>
            `${entry.pass} is CURRENT and BROKEN${entry.propertyId === undefined ? "" : ` (${entry.propertyId})`} — ` +
            "fix it, then take the second and last review pass over the fixed diff",
        ),
      ],
      leftovers: [],
    };
  }
  return { failures: failures.lines, leftovers: failures.broken.map((entry) => leftoverOf({ entry })) };
}

/**
 * The review half's own refusals, and the CURRENT `BROKEN` rows {@link reviewHalf} decides about.
 *
 * @param entries the ledger for the branch, newest first
 * @param cap the live quota gate's evidence when Codex is currently capped
 * @returns the refusal lines, and every current conclusive `BROKEN` review once at least one current review stands
 */
function reviewFailures({ entries, cap }: { entries: readonly LedgerEntry[]; cap: CodexQuotaEvidence | undefined }): {
  readonly lines: readonly string[];
  readonly broken: readonly LedgerEntry[];
} {
  const reviews = entries.filter((entry) => entry.mode === "review");
  // A review arm answers CLEAN or BROKEN and nothing else. Testing only for "concluded" let a record whose
  // scope says review carry a PLAN's `READY` answer and satisfy the floor without any diff having been read —
  // `scanPassRecords` shallow-decodes, so scope and outcome are never checked against each other. Found by a
  // Codex review of this gate. Naming the two verdicts a review can produce closes it without a schema change.
  // A retired wording counts for NOTHING here, in both directions: it cannot block the landing, and it
  // cannot satisfy the floor either. Letting it do the second would turn the verb into a way to keep a
  // superseded pass as your only review — see `./supersession.ts` for the ruling this implements.
  const current = reviews.filter(
    (entry) =>
      entry.freshness.kind === "current" &&
      entry.superseded === undefined &&
      concluded({ entry }) &&
      REVIEW_VERDICTS.has(entry.verdict),
  );
  if (reviews.length === 0) {
    return {
      broken: [],
      lines: [
        "no review pass has run on this branch — the diff has never been read by the second brain" +
          cappedNextStep({ cap, entries: reviews }),
      ],
    };
  }
  if (current.length === 0) {
    return {
      broken: [],
      lines: [
        `${String(reviews.length)} review pass(es) ran but none is both current and conclusive — ` +
          "each either describes a tree that has since changed, has provenance that could not be established, " +
          "or produced no verdict a review can give" +
          newestFaultClause({ entries: reviews }) +
          newestDriftClause({ entries: reviews }) +
          unresolvedDriftedBrokenClause({ reviews }) +
          cappedNextStep({ cap, entries: reviews }),
      ],
    };
  }
  return { broken: current.filter((entry) => entry.verdict === "BROKEN"), lines: [] };
}

/**
 * The clause naming every BROKEN review that drifted from the tree with no later CLEAN answering its property,
 * appended only to the refusal that says no review is current — or nothing.
 *
 * Diagnostic, never a veto: it moves no verdict, only what the refusal says, so a waiver of it names what it lands
 * over. Measured: two pull requests landed on a relayed reason while r1 and r2 stood BROKEN on one property, both
 * STALE, and the refusal named only the newest row's drift (`docs/doctrine-rationale/rule-9.md`).
 *
 * @param reviews the branch's review rows, newest first
 * @returns ` — BROKEN with no later CLEAN under the same property: <pass> (<property>) is STALE; …`, or `""`
 */
function unresolvedDriftedBrokenClause({ reviews }: { reviews: readonly LedgerEntry[] }): string {
  const named = unresolvedDriftedBroken({ reviews }).map(
    // Shaped as a leftover line is (`./reviewLeftovers.ts`), so the id is the one `codex supersede` takes, and two rows
    // on one property — a re-run, a fallback beside a Codex pass — read as two rows rather than a stutter (measured on
    // a branch whose refusal named `r2 (no-credential-echo) is STALE` twice).
    (entry) =>
      `${entry.pass}/${propertyNamed({ entry })} (${entry.artifactId}) is ${entry.freshness.kind.toUpperCase()}`,
  );
  if (named.length === 0) {
    return "";
  }
  return ` — BROKEN with no later CLEAN under the same property: ${named.join("; ")}`;
}

/**
 * Every live BROKEN review that is STALE or UNKNOWN and that no LATER live CLEAN under the same property answers.
 * The later CLEAN may itself be stale: it still shows the property was re-reviewed clean after the BROKEN. A
 * superseded row counts for nothing in either direction (`./supersession.ts`).
 *
 * @param reviews the branch's review rows, newest first — a lower index is a later row
 * @returns the unanswered drifted BROKEN rows, newest first
 */
function unresolvedDriftedBroken({ reviews }: { reviews: readonly LedgerEntry[] }): readonly LedgerEntry[] {
  return reviews.filter(
    (entry, index) =>
      entry.verdict === "BROKEN" &&
      entry.superseded === undefined &&
      entry.freshness.kind !== "current" &&
      !reviews
        .slice(0, index)
        .some(
          (later) =>
            later.verdict === "CLEAN" && later.superseded === undefined && later.propertyId === entry.propertyId,
        ),
  );
}

/**
 * The property a row names: one recorded before property ids were kept carries none.
 *
 * @param entry the review row
 * @returns its property id, or `unknown` when it carries none
 */
function propertyNamed({ entry }: { entry: LedgerEntry }): string {
  if (entry.propertyId === undefined) {
    return "unknown";
  }
  return entry.propertyId;
}
