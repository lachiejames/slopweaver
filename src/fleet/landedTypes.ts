/**
 * The shapes `fleet landed` reads and prints: a first-parent commit, the row its branch names, the owner's words behind it,
 * the proof its description carried and the standing rule its last act ran under. `./landed.ts` joins them and
 * `./landedWords.ts` decides whose words stand behind a change.
 */
import type { Result } from "#lib/result.js";

import type { AutonomyAction } from "../autonomy/types.js";
import type { HandoverDoc } from "../handover/doc.js";
import type { HisWords, HisWordsCut, HisWordsWhere } from "../handover/hisWords.js";
import type { HisWordsError } from "../handover/hisWordsErrors.js";
import type { RunEvent } from "../handover/ledger.js";
import type { LedgerFileUnread } from "../outbound/github/prLedgerByNumber.js";

/** One first-parent commit on main. */
export interface LandedCommit {
  readonly sha: string;
  readonly mergedIso: string;
  readonly subject: string;
}

/** Whose words, if anyone's, are behind a landed change — every way the join can end, named. */
export type LandedWords =
  /** The owner's words that asked for it, as the row stores them. */
  | {
      readonly kind: "asked";
      readonly words: string;
      readonly atIso: string;
      readonly where: HisWordsWhere;
      readonly anchor: string;
      readonly cut: HisWordsCut;
    }
  /**
   * The owner's ruling on the row, where the row stores no quote of the ask itself: the owner's words read off the
   * ruling's own anchor, and the ruling as the session that heard it `recorded` it — that session's words, never
   * quoted as the owner's.
   */
  | {
      readonly kind: "ruling";
      readonly words: string;
      readonly atIso: string;
      readonly where: HisWordsWhere;
      readonly anchor: string;
      readonly cut: HisWordsCut;
      readonly recorded: string;
      readonly decidedIso: string | undefined;
    }
  /** Words of the owner's may be behind the change and cannot be shown as theirs here; the reason says which step stopped. */
  | { readonly kind: "unread"; readonly why: string }
  /** The row points somewhere that is not a record of the owner's words — a Slack thread, a pull request. */
  | { readonly kind: "elsewhere"; readonly anchor: string }
  /** The row is read and nothing of the owner's is behind it. */
  | { readonly kind: "unasked"; readonly why: string }
  /** The change could not be joined to a row at all, and the reason says at which step. */
  | { readonly kind: "not-joined"; readonly why: string };

/** One side of the description's before-and-after: where it was seen, and what was seen. */
export interface LandedSide {
  readonly where: string;
  readonly evidence: string;
}

/** One claim the description made, and how it stood. */
export interface LandedClaim {
  readonly claim: string;
  readonly verdict: "proven" | "gap" | "failed";
  readonly detail: string;
}

/** The proof the description carried, or why there is none to show. */
export type LandedProof =
  | {
      readonly kind: "recorded";
      /** The description's explainer. A description publishes no grade, so none is carried. */
      readonly problem: string;
      readonly before: LandedSide | undefined;
      readonly after: LandedSide | undefined;
      readonly claims: readonly LandedClaim[];
    }
  | { readonly kind: "unrecorded"; readonly why: string };

/**
 * The owner's standing rule the fleet's newest act on the change was taken under — a licence to act, never the
 * owner's words on the change. The act is named because it is often not the merge: `github enqueue` records the self-review
 * threads it resolves, not the press itself.
 */
export type LandedUnder =
  | {
      readonly kind: "rule";
      /** The kind of the act the rule settled, e.g. `resolve-own-threads`. */
      readonly actKind: string;
      readonly classId: string;
      readonly words: string;
      readonly anchor: string;
    }
  /** The newest act on the pull request was not settled by a standing rule of the owner's, or there is no act on it. */
  | { readonly kind: "none" }
  /** The autonomy register would not read, so whether one was is unknown. */
  | { readonly kind: "unread"; readonly why: string };

/** The autonomy register as the reader found it. */
export type LandedActs =
  | { readonly kind: "read"; readonly acts: readonly AutonomyAction[] }
  | { readonly kind: "unread"; readonly why: string };

/**
 * The owner's words at an anchor, read off the record it names — `../handover/hisWordsResolve.ts`'s `resolveHisWords` with
 * the home bound, passed in so the join stays pure.
 */
export type LandedWordsAt = (at: { anchor: string }) => Result<HisWords, HisWordsError>;

/**
 * Why a `transcript:` turn is not the owner's though its record says it was typed — `../profile/supervisorWords.ts`'s
 * `outsideChairReason` with the home bound: a session outside the supervisor pin's tenure can be typed into by another.
 */
export type LandedOutsideChair = (at: { anchor: string; atIso: string }) => string | undefined;

/** The two reads past the row the join is given, so it stays pure. */
export interface LandedReads {
  readonly wordsAt: LandedWordsAt;
  readonly outsideChair: LandedOutsideChair;
}

/** Where a change's row was found. */
export interface LandedRowRef {
  readonly slug: string;
  readonly archived: boolean;
}

/** One landed change. */
export interface LandedEntry {
  readonly sha: string;
  readonly mergedIso: string;
  readonly number: number | undefined;
  readonly title: string;
  readonly url: string | undefined;
  readonly branch: string | undefined;
  readonly row: LandedRowRef | undefined;
  readonly words: LandedWords;
  readonly under: LandedUnder;
  readonly proof: LandedProof;
}

/** What `fleet landed --json` prints. */
export interface LandedReport {
  readonly observedAtIso: string;
  /** `owner/name` of the checkout's `origin`. */
  readonly repo: string;
  readonly ref: string;
  readonly refSha: string;
  /** How many first-parent commits were asked for — the window, so a reader never takes it for all of history. */
  readonly limit: number;
  /**
   * PR-ledger files that would not read. Any one of them may be a second record for a number shown here as joined,
   * so the page says how many there are rather than letting a single readable record stand unqualified.
   */
  readonly ledgerUnread: readonly LedgerFileUnread[];
  readonly landings: readonly LandedEntry[];
}

/** A row as the reader found it by its exact slug. */
export type LandedRow =
  | {
      readonly kind: "read";
      readonly doc: HandoverDoc;
      readonly archived: boolean;
      readonly events: readonly RunEvent[];
      /** Journal lines this checkout could not decode — any one of them may be a ruling. */
      readonly undecoded: number;
    }
  | { readonly kind: "absent" }
  /** The branch is not a shape a board row's slug can take, so no row was looked for. */
  | { readonly kind: "not-a-slug" }
  | { readonly kind: "unreadable"; readonly why: string };
