/**
 * How an ask ENDED, or was judged still open — the `settlement*` front-matter fields `handover settle` writes
 * together, and the `trunkRechecked*` pair `handover recheck` writes on a finding the trunk moved under. Grouped
 * out of `./doc.ts` along that seam (the file-size ratchet), exactly as `./docNested.ts` groups the nested ones.
 */

import { type AskSettlement, asAskSettlement } from "./rowKind.js";

/** The settlement fields a handover doc carries, every one absent while the ask is open. */
export interface DocSettlement {
  /**
   * `settlement:` — how an ask ENDED, absent while it is still open.
   *
   * The three terminal states an ask settles into. Deliberately its own field
   * rather than a reuse of `status`: `done` on a doc means the work shipped, and an ask that was
   * declined or answered in one line shipped nothing at all. Collapsing them would make the board unable to
   * report the number that matters — how many of the owner's asks were actioned versus talked away.
   */
  readonly settlement: AskSettlement | undefined;
  /**
   * `settlementWitness:` — the checkable thing behind a settlement: the doc slug a `filed` ask became, the
   * permalink an `answered` ask was answered at, the anchor a `declined` ask was declined against.
   *
   * Required for every settlement, and that is the mechanism rather than a convention: a settled ask with no
   * witness is reported as a defect by `./askRow.ts`, so an agent cannot close one of the owner's asks by
   * asserting that it is closed.
   */
  readonly settlementWitness: string | undefined;
  /** `settlementReason:` — why a `declined` ask will not be done, in the owner's own words. */
  readonly settlementReason: string | undefined;
  /**
   * `settledIso:` — the instant `handover settle` wrote the settlement, which is the instant the ask left the owner's
   * Queue. Never inferred from `askedIso`, the journal or the file's mtime: a row settled before the field
   * existed honestly carries none, so nothing can say when it left (the voice must still find a card after it
   * leaves the Queue, and say when).
   */
  readonly settledIso?: string | undefined;
}

/** When a session last confirmed a held finding still real against the trunk, and what it re-ran. */
export interface DocTrunkRecheck {
  /**
   * `trunkRecheckedIso:` — when `handover recheck` last confirmed this row still real against the trunk, off
   * its own clock. Absent until one does; `./trunkMoved.ts` reads only trunk commits after it.
   */
  readonly trunkRecheckedIso?: string;
  /** `trunkRechecked:` — the check that recheck re-ran, written beside {@link trunkRecheckedIso}. */
  readonly trunkRechecked?: string;
  /**
   * `trunkRecheckedSha:` — the trunk tip that recheck ran against. Every commit it already carried was seen, so
   * none of them holds the row again, whatever date it carries.
   */
  readonly trunkRecheckedSha?: string;
}

/**
 * The settlement fields and the `handover recheck` fields as a doc carries them. The recheck keys are present
 * only when the doc declares them — never a placeholder, so a row nobody rechecked has neither key.
 *
 * @param named reads one declared flat front-matter value, `undefined` when the doc does not declare it
 * @returns the fields to spread into the parsed doc
 */
export function docSettlementFields({
  named,
}: {
  named: (field: { key: string }) => string | undefined;
}): DocSettlement & DocTrunkRecheck {
  const iso = named({ key: "trunkRecheckedIso" });
  const check = named({ key: "trunkRechecked" });
  const sha = named({ key: "trunkRecheckedSha" });
  return {
    settledIso: named({ key: "settledIso" }),
    settlement: asAskSettlement({ value: named({ key: "settlement" }) }),
    settlementReason: named({ key: "settlementReason" }),
    settlementWitness: named({ key: "settlementWitness" }),
    ...(iso === undefined ? {} : { trunkRecheckedIso: iso }),
    ...(check === undefined ? {} : { trunkRechecked: check }),
    ...(sha === undefined ? {} : { trunkRecheckedSha: sha }),
  };
}
