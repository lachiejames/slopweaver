/**
 * THE PRIVATE-WORDS REVIEW — the records it keeps. A write a private term matches, on a row carrying the owner's
 * meaning, is HELD (`./gate.ts`); a fresh reviewer judges the match against that meaning over a packet repository
 * (`./packet.ts`); the verdict becomes a receipt (`./record.ts`); and a CLEAN receipt releases exactly that write,
 * once (`./store.ts`).
 *
 * Every record lives under `$SLOPWEAVER_HOME/hygiene/private-term-reviews/`, owner-only, because a hold keeps the
 * exact text it held. Nothing here is ever printed whole: a refusal prints ids, classes, loci and counts.
 */
import type { PrivateTermClass } from "../../hygiene/privateTerms.js";
import type { VisibleSupervisorSession } from "../../supervisor/session.js";

/** The property a reviewer judges, by id: a review answering another one never releases a write. */
export const PRIVATE_TERM_REVIEW_PROPERTY_ID = "private-term-context-review";

/**
 * The property statement, exactly as `codex review --property` takes it. It opens on a READ the diff cannot carry:
 * the meanings and the destination sit at the base commit on purpose (`./packet.ts`), so the review packet holds only
 * the write, and the reviewer is told to open both from the repository the prompt names before judging.
 */
export const PRIVATE_TERM_REVIEW_PROPERTY =
  "Before answering, read every terms/<term-id>.md and write/destination.txt in the repository the review names: " +
  "they sit at the base commit on purpose, so the diff does not carry them, and a verdict from write/contexts.md " +
  "alone is not a review. " +
  "Every match marked in write/contexts.md uses its private term only as the owner's recorded meaning for that " +
  "term (terms/<term-id>.md) allows, at this write's destination (write/destination.txt). CLEAN when no marked " +
  "match discloses what the meaning protects and, where a term names where it is allowed, the destination fits " +
  "it. BROKEN when any match discloses it or the destination falls outside where it is allowed, naming the match " +
  "by its number.";

/** The write families a hold can come from: the guarded families of `../../devLint/outboundPrivacyRegistry.ts`. */
export type PrivateTermWriteFamily = "github" | "slack" | "linear" | "notion" | "google-calendar" | "gmail";

/** One string the write would send, under the locus a refusal names it by. */
export interface PrivateTermHeldContent {
  readonly locus: string;
  readonly text: string;
}

/** One match of one row, by offsets into its content's text with line breaks as `\n`. */
export interface PrivateTermHeldMatch {
  /** Index into the hold's contents. */
  readonly content: number;
  readonly termId: string;
  readonly className: PrivateTermClass;
  readonly line: number;
  readonly start: number;
  readonly end: number;
}

/** One matched row as the hold saw it: what the reviewer judges each match against. */
export interface PrivateTermHeldTerm {
  readonly termId: string;
  /** The row's exact-bytes digest: an edit of the row after the hold makes a later release a different write. */
  readonly rowDigest: string;
  readonly className: PrivateTermClass;
  readonly meaning: string;
  readonly allowedWhere: string | undefined;
}

/** One write as the gate judged it, before it is held. */
export interface PrivateTermWriteDraft {
  readonly family: PrivateTermWriteFamily;
  /** The operation, `github POST /repos/{owner}/{repo}/issues/{issue_number}/comments` or `slack chat.postMessage`. */
  readonly command: string;
  /** Where the write goes, in words the reviewer reads: a repository, a channel, a workspace. */
  readonly destination: string;
  readonly contents: readonly PrivateTermHeldContent[];
  readonly matches: readonly PrivateTermHeldMatch[];
  readonly terms: readonly PrivateTermHeldTerm[];
  /**
   * sha256 over the whole request the door would send (`requestDigest`): the target ids the contents never carry,
   * so the same words aimed at another channel, issue or event are another write.
   */
  readonly requestSha256: string;
  /** sha256 over everything above: the one value a receipt releases. */
  readonly holdKey: string;
}

/** A held write. */
export interface PrivateTermHold extends PrivateTermWriteDraft {
  readonly schemaVersion: 1;
  readonly holdId: string;
  readonly createdAtIso: string;
  /** The visible session the write was attempted from, or null when the environment names none. */
  readonly heldBy: VisibleSupervisorSession | null;
}

/** What `private-terms review-prepare` committed for one hold. */
export interface PrivateTermReviewPreparation {
  readonly schemaVersion: 1;
  readonly preparationId: string;
  readonly holdId: string;
  readonly holdKey: string;
  readonly baseSha: string;
  readonly headSha: string;
  readonly createdAtIso: string;
  readonly preparedBy: VisibleSupervisorSession | null;
}

/** Who took a review: Codex, or a visible Claude session when Codex was capped. */
export type PrivateTermReviewer = "codex" | "claude-fallback";

/** A verdict recorded against one hold. */
export interface PrivateTermReviewReceipt {
  readonly schemaVersion: 1;
  readonly receiptId: string;
  readonly holdId: string;
  readonly holdKey: string;
  readonly preparationId: string;
  readonly reviewId: string;
  readonly reviewer: PrivateTermReviewer;
  readonly verdict: "CLEAN" | "BROKEN";
  readonly summary: string;
  readonly recordedAtIso: string;
  readonly recordedBy: VisibleSupervisorSession | null;
}

/** What the store answered a held write's retry with. */
export type PrivateTermGateOutcome =
  | { readonly kind: "released"; readonly receiptId: string }
  | { readonly kind: "held"; readonly holdId: string; readonly broken: readonly PrivateTermReviewReceipt[] };

/** The README a packet's base commit carries, so a reviewer opening it cold knows what it judges. */
export const PRIVATE_TERM_REVIEW_PACKET_README = [
  "# A held write, and the private terms it matched",
  "",
  "An outbound write matched one or more of the owner's private terms and was held before it was sent.",
  "",
  "- `terms/<term-id>.md` (base) is each matched term: its class, what the owner said it means, and where the owner said",
  "  it is fine, if anywhere. The term's pattern is not here, on purpose.",
  "- `write/destination.txt` (base) is where the write goes and which operation sends it.",
  "- `write/contexts.md` (head) is each match, numbered, in its surrounding text, the match between ⟦ and ⟧.",
  "- `write/contents/` (head) is every string the write sends, whole.",
  "",
  "The diff under review carries only the two head entries. The meanings and the destination stay at the base so",
  "they are never copied into a review packet: open `terms/` and `write/destination.txt` in this repository before",
  "judging anything.",
  "",
  "Judge each numbered match against its term's meaning: does this use disclose what the meaning protects, here?",
  "A word that matches by spelling but means something else (an ordinary engineering word, say) is CLEAN.",
  "",
].join("\n");
