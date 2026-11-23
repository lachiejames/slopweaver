/**
 * What a bot message says when an upload never became attachable — the words that replace a dropped answer.
 *
 * The old behaviour was to throw before anything was posted, which cost a whole answer twice in two days
 * (the asks are in the operator's own loop-breakage ledger, not in this public
 * repository; the first was never recovered, the second only survived a worker retry 27 minutes later).
 * Losing an answer is not "failing loudly" — nobody sees it. Saying which image is missing, in the message
 * itself, is.
 *
 * The note is a `context` block appended to the END of the wrapper, below the fold, so it can never push the
 * form's above-the-fold content out of view. It never manufactures proof: it states the absence.
 *
 * **The BOT lanes only.** The as-me drip lane keeps the hard failure, because this note is chrome the owner
 * did not type and the human lane carries none.
 */
import type { KnownBlock } from "@slack/types";
import { escapeMrkdwn } from "./render.js";
import type { SlackCardWrapper } from "./types.js";

/** How many missing files the note names before it stops listing them. Rule 7: concise, never a wall. */
const NOTE_MAX_LISTED = 3;

/** One file the send could not attach, and why — the note's whole input. */
export interface MissingUpload {
  /** The name Slack would have shown, so a reader knows WHICH image is absent. */
  readonly filename: string;
  /** Slack's own file id, so the failure can be chased in `files.info` rather than guessed at. */
  readonly fileId: string;
  /** Why it could not be attached, already phrased for a reader. */
  readonly reason: string;
}

/**
 * The one-line statement for a set of files that could not be attached.
 *
 * Separate from the block it goes into so a test can assert the words without reaching through Block Kit,
 * and so the same sentence can be reported to a caller that is not rendering Slack at all.
 *
 * @param missing the files that never attached, in the caller's order
 * @returns the statement, or the empty string when nothing is missing
 */
export function missingMediaSentence({ missing }: { missing: readonly MissingUpload[] }): string {
  if (missing.length === 0) {
    return "";
  }
  const listed = missing.slice(0, NOTE_MAX_LISTED);
  const named = listed.map((item) => `${item.filename} (${item.fileId}) — ${item.reason}`).join("; ");
  const unlisted = missing.length - listed.length;
  const tail = unlisted > 0 ? `; and ${String(unlisted)} more` : "";
  const count = missing.length === 1 ? "1 image" : `${String(missing.length)} images`;
  return `${count} could not be attached to this message: ${named}${tail}`;
}

/**
 * The `context` block that carries {@link missingMediaSentence} into a card.
 *
 * `context` rather than `section` because this is chrome about the message, not part of the answer, and
 * mrkdwn is escaped here for the same reason the author row escapes it — a filename may contain `<` or `&`.
 *
 * @param missing the files that never attached
 * @returns one context block stating the absence
 */
export function missingMediaBlock({ missing }: { missing: readonly MissingUpload[] }): KnownBlock {
  return {
    elements: [{ text: `:warning: ${escapeMrkdwn({ text: missingMediaSentence({ missing }) })}`, type: "mrkdwn" }],
    type: "context",
  };
}

/**
 * Append the missing-media note to a rendered wrapper, leaving every other block untouched.
 *
 * One function serves the card, the assistant answer and the recipe response because all three payloads are
 * a single {@link SlackCardWrapper} — the note is appended to the wrapper, and each lane spreads the result
 * back into its own payload type. Returns the wrapper UNCHANGED when nothing is missing, so a caller can
 * apply it unconditionally without a branch of its own.
 *
 * @param wrapper the already-rendered wrapper
 * @param missing the files that never attached
 * @returns the wrapper, with the note as its last block when there is one to add
 */
export function wrapperWithMissingMediaNote({
  wrapper,
  missing,
}: {
  wrapper: SlackCardWrapper;
  missing: readonly MissingUpload[];
}): SlackCardWrapper {
  if (missing.length === 0) {
    return wrapper;
  }
  return { ...wrapper, blocks: [...wrapper.blocks, missingMediaBlock({ missing })] };
}
