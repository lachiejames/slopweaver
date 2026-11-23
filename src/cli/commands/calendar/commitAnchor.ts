/**
 * `calendar commit --anchor`: the owner's yes, read off the record where they said it, in place of a digest they type.
 *
 * The owner steers on the voice and does not type a digest, so asking for one on an invite already agreed on the voice
 * is the wrong ask.
 * The owner's approval arrives as an ANCHOR — a call stretch, a relay turn, a typed turn —
 * and the door binds it to the change by the digest the PREVIEW printed, stored on the intent at prepare. The commit
 * still re-reads the event and rebuilds the digest, and sends only when the two match exactly.
 *
 * What it proves, stated as the digest path states it: the record holds the owner's own whole words at that anchor, and the
 * change about to be sent is byte for byte the one previewed. It does NOT prove the words mean yes to THIS intent —
 * a call stretch names no intent — so that stays the committing session's judgement, journalled with the anchor so an
 * over-read is findable afterwards. A commit carrying neither an anchor nor a digest still holds.
 */
import { parseStrictIsoInstantMs } from "#lib/date.js";

import type { HisWordsError } from "../../../handover/hisWordsErrors.js";
import type { RawWords } from "../../../handover/hisWordsResolve.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { carriesWords } from "../../../outbound/slack/carriesWords.js";

/** The anchor's record could not be read as the owner's words at all. */
export interface CommitAnchorUnreadableError {
  readonly code: "ANCHOR_UNREADABLE";
  readonly message: string;
  readonly anchor: string;
}

/** The record holds only part of what the owner said, or cannot date it, so it cannot stand as the owner's yes. */
export interface CommitAnchorPartialError {
  readonly code: "ANCHOR_PARTIAL";
  readonly message: string;
  readonly anchor: string;
}

/** The intent was prepared before its previewed digest was stored, so nothing binds the owner's yes to what they were shown. */
export interface CommitPreviewDigestAbsentError {
  readonly code: "PREVIEW_DIGEST_ABSENT";
  readonly message: string;
  readonly intentId: string;
}

/** Every reason an anchored commit refuses before the door is asked. */
export type CommitAnchorError = CommitAnchorUnreadableError | CommitAnchorPartialError | CommitPreviewDigestAbsentError;

/** How to raise one — the factory the real code calls, so a test built the same way catches a drift. */
export const CommitAnchorErrors = {
  partial: ({ anchor, why }: { anchor: string; why: string }): CommitAnchorPartialError => ({
    anchor,
    code: "ANCHOR_PARTIAL",
    message: `--anchor ${anchor} cannot stand as the owner's yes: ${why}`,
  }),
  previewDigestAbsent: ({ intentId }: { intentId: string }): CommitPreviewDigestAbsentError => ({
    code: "PREVIEW_DIGEST_ABSENT",
    intentId,
    message:
      `intent ${intentId} was prepared before the door stored the digest its preview printed, so the owner's yes cannot be ` +
      "bound to what the owner was shown — re-run the verb for a fresh preview, tell the owner what it does, and commit that " +
      "intent only on a word the owner gives about it; never reuse the anchor this commit carried",
  }),
  unreadable: ({ anchor, cause }: { anchor: string; cause: HisWordsError }): CommitAnchorUnreadableError => ({
    anchor,
    code: "ANCHOR_UNREADABLE",
    message: `--anchor ${anchor} does not resolve to the owner's words: ${cause.message}`,
  }),
} as const;

/** The owner's yes as the door journals it: where it was said and when — never the words themselves. */
export interface AnchoredYes {
  readonly anchor: string;
  readonly atIso: string;
}

/**
 * The owner's whole, dated words at an anchor, or why the record cannot stand as their yes. The same four tests `slack draft
 * approve` applies: a record that cut the owner's head or tail may hold the "no, wait" after the yes, a relay that predates
 * recording whether its head was cut is never read as whole, and words with no instant cannot be journalled.
 *
 * @param anchor a `talk-call:`, `talk:` or `transcript:` anchor; a `call:` card landing is refused
 * @param read the record of the owner's words at that anchor, as the shared resolver read it
 * @returns the anchor and the instant to journal, or the refusal
 */
export function anchoredYes({
  anchor,
  read,
}: {
  anchor: string;
  read: Result<RawWords, HisWordsError>;
}): Result<AnchoredYes, CommitAnchorError> {
  if (read.isErr()) {
    return err(CommitAnchorErrors.unreadable({ anchor, cause: read.error }));
  }
  const words = read.value;
  // A card landing carries the words as they stood when the card left, never re-read off the call, and an
  // overtaken batch can land an utterance before its "no, wait" reached disk — so an
  // outward invite stands only on the call's own stretch, whose cut flags are read off the call file itself.
  if (words.context.kind === "card-landing") {
    const why = "a card landing holds the words as the card left, not the call — name talk-call:<call>#<segment>";
    return err(CommitAnchorErrors.partial({ anchor, why }));
  }
  // A relay made mid-sentence: the call holds what the owner went on to say, so its stretch is the anchor.
  if (words.tailLost && words.context.kind === "relay") {
    const why = "the relay was made while the owner was still speaking — name the call's own stretch instead";
    return err(CommitAnchorErrors.partial({ anchor, why }));
  }
  if (words.headLost || words.tailLost || !carriesWords({ text: words.text })) {
    const why = "the record holds only part of what the owner said there";
    return err(CommitAnchorErrors.partial({ anchor, why }));
  }
  if (!words.headKnown) {
    const why = "the relay predates recording whether its start was cut — name the call's own stretch instead";
    return err(CommitAnchorErrors.partial({ anchor, why }));
  }
  // A voice relay written before it recorded whether the stretch was still open may end mid-sentence.
  if (!words.tailKnown) {
    const why =
      "the relay predates recording whether the owner was still speaking — name the call's own stretch instead";
    return err(CommitAnchorErrors.partial({ anchor, why }));
  }
  // The ledger and the receipt both carry this instant, so one a reader cannot parse back is refused here.
  if (parseStrictIsoInstantMs({ text: words.atIso }) === undefined) {
    const why = `the record does not date the owner's words as an instant (${words.atIso})`;
    return err(CommitAnchorErrors.partial({ anchor, why }));
  }
  return ok({ anchor, atIso: words.atIso });
}

/**
 * The digest an anchored commit is bound to: the one the preview printed, stored on the intent at prepare.
 *
 * @param intentId the intent being committed, for the refusal
 * @param previewDigest what the intent stored, absent on one prepared before it was stored
 * @returns the digest the owner's yes was given over, or the refusal
 */
export function previewedDigest({
  intentId,
  previewDigest,
}: {
  intentId: string;
  previewDigest: string | undefined;
}): Result<string, CommitPreviewDigestAbsentError> {
  if (previewDigest === undefined) {
    return err(CommitAnchorErrors.previewDigestAbsent({ intentId }));
  }
  return ok(previewDigest);
}
