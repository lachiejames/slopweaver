/**
 * Correct a claim IN PLACE: strike it through where the message makes it, and put a bold Correction line under it.
 *
 * The owner's practice is to edit the original message, strike through the claims that turned out wrong, and put a
 * bold Correction underneath. That creates no separate message for everyone to look at, a correction buried in the
 * thread is never missed by people who linked the first message, and the original keeps the evidence that it was
 * previously a different claim. So this NEVER deletes and NEVER composes a reply: it rewrites the stored message,
 * keeping every word it already had.
 *
 * Pure. It takes what Slack STORED for one message (`./lifecycleGuards.ts`'s `StoredSlackContent` plus its blocks)
 * and returns the `chat.update` body, so the whole judgement — where the claim sits, whether it sits there exactly
 * once, what the strike and the line look like — is testable with no Slack at all.
 *
 * Four choices that are the design rather than a detail:
 *
 * - **The claim must occur EXACTLY ONCE** across the message's rich-text and `mrkdwn` section text. Zero is a claim
 *   this message does not make; two is a strike that could land on the wrong sentence. Both refuse, naming which.
 * - **The strike is STRUCTURAL in rich text** (`style.strike` on the covered runs, split at the claim's edges) and
 *   `~…~` only in `mrkdwn`, which is the one place Slack parses that markup. A run's other styles, a link's url and
 *   every non-text element (a mention, an emoji) are kept exactly.
 * - **The Correction line is its own `rich_text` block directly under the block that makes the claim** — not
 *   appended to the end of a long answer, where a reader who stopped at the struck line would never reach it.
 * - **Only fields `chat.update` accepts are sent back.** A read-back attachment carries response-only fields (`id`),
 *   so an attachment is rebuilt from `blocks`, `color` and `fallback` alone; `metadata` is carried as it was stored,
 *   which is what keeps the message recognisably ours to the next edit or delete.
 *
 * Four parts are split out under the file-size cap. The block surgery lives in `./claimStrike.ts` and the `mrkdwn`
 * span reading in `./claimMrkdwnSpans.ts`; the refusals and the checks on the two input words live in
 * `./claimCorrectionInput.ts`; what a stored message shows a reader — its fallbacks, attachment fields, a Correction
 * label, the claim's count — lives in `./claimShown.ts`. This module imports from each and none imports back. The
 * magnitude comparison, `magnitudeShift`, lives in `./claimMagnitude.ts` and is exported from there only: this module
 * neither imports nor re-exports it.
 */
import { isRecord } from "../../lib/parsers.js";
import { err, ok, type Result } from "../../lib/result.js";
import { type ClaimCorrectionError, ClaimCorrectionErrors, correctionInputRefusal } from "./claimCorrectionInput.js";
import { occurrences, opaqueSpanCount, opaqueSpanCrosses } from "./claimMrkdwnSpans.js";
import {
  attachmentsShowClaim,
  correctionSuffix,
  fallbackCorrected,
  fallbacksOf,
  labelShown,
  notExactlyOnce,
  outsideRebuild,
} from "./claimShown.js";
import {
  CORRECTION_LABEL,
  correctBlocks,
  correctionFollows,
  isCorrectionLine,
  unstrikeableCount,
} from "./claimStrike.js";

/** The raw stored message a correction rewrites. */
export interface StoredMessage {
  readonly text?: string | undefined;
  readonly blocks?: readonly unknown[] | undefined;
  readonly attachments?: readonly unknown[] | undefined;
  readonly metadata?: unknown;
}

/** An attachment as `chat.update` accepts it back. */
interface CorrectedAttachment {
  readonly blocks?: readonly unknown[];
  readonly color?: string;
  readonly fallback?: string;
}

/** The `chat.update` body a correction sends. */
export interface CorrectedMessage {
  readonly text: string;
  readonly blocks?: readonly unknown[];
  readonly attachments?: readonly CorrectedAttachment[];
  readonly metadata?: { readonly event_type: string; readonly event_payload: Readonly<Record<string, unknown>> };
  /** Where the claim was struck — rich text, a `mrkdwn` section, or the plain `text` of a block-less message. */
  readonly struckIn: "rich-text" | "mrkdwn" | "text";
}

/** The notification text, the claim struck where it appears and the Correction line under it. */
function correctedFallback({ text, wrong, correction }: { text: string; wrong: string; correction: string }): string {
  // A copy already struck stays as it is: striking it again would write `~~claim~~`.
  const needsStrike = text.includes(wrong) && !text.includes(`~${wrong}~`);
  const struck = needsStrike ? text.replace(wrong, `~${wrong}~`) : text;
  return `${struck}${correctionSuffix({ line: correction })}`;
}

/** Whether an unclosed fence or token in a non-empty fallback would swallow the Correction line appended to it. */
function swallowsCorrection({ fallback, line, wrong }: { fallback: string; line: string; wrong: string }): boolean {
  if (fallback.length === 0) {
    return false;
  }
  const corrected = correctedFallback({ correction: line, text: fallback, wrong });
  return opaqueSpanCrosses({ at: corrected.length - correctionSuffix({ line }).length, text: corrected });
}

/** An attachment rebuilt from the three fields `chat.update` takes back. */
function sendableAttachment({
  attachment,
  blocks,
}: {
  attachment: unknown;
  blocks?: readonly unknown[];
}): CorrectedAttachment {
  const raw = isRecord(attachment) ? attachment : {};
  return {
    ...(blocks === undefined ? {} : { blocks }),
    ...(typeof raw["color"] === "string" ? { color: raw["color"] } : {}),
    ...(typeof raw["fallback"] === "string" ? { fallback: raw["fallback"] } : {}),
  };
}

/** The stored metadata in the shape `chat.update` takes, when it has one. */
function sendableMetadata({ metadata }: { metadata: unknown }): CorrectedMessage["metadata"] {
  if (!isRecord(metadata) || typeof metadata["event_type"] !== "string") {
    return undefined;
  }
  const payload = isRecord(metadata["event_payload"]) ? metadata["event_payload"] : {};
  return { event_payload: payload, event_type: metadata["event_type"] };
}

/**
 * The `chat.update` body that strikes `wrong` where the message makes it and adds the Correction line under it.
 *
 * @param stored what Slack stored for the message — its blocks, attachments, text and metadata
 * @param wrong the exact words of the claim that turned out wrong, as the message shows them
 * @param correction what is true now, one line
 * @returns the body to send, or which check refused it
 */
export function correctClaim({
  stored,
  wrong,
  correction,
}: {
  stored: StoredMessage;
  wrong: string;
  correction: string;
}): Result<CorrectedMessage, ClaimCorrectionError> {
  const refusal = correctionInputRefusal({ correction, wrong });
  if (refusal !== undefined) {
    return err(ClaimCorrectionErrors.invalid({ reason: refusal }));
  }
  const line = correction.trim();
  // Absent by design: a block-less message has no `blocks`, a message posted without a wrapper no `attachments`.
  const { attachments = [], blocks: topBlocks = [], text = "" } = stored;
  const attachmentBlocks = attachments.map((attachment) =>
    isRecord(attachment) && Array.isArray(attachment["blocks"]) ? attachment["blocks"] : [],
  );
  const allBlocks = [...topBlocks, ...attachmentBlocks.flat()];
  const notOnce = notExactlyOnce({ allBlocks, text, wrong });
  if (notOnce !== undefined) {
    return err(notOnce);
  }
  if (fallbackOrFieldUnstrikeable({ attachments, line, text, wrong })) {
    return err(ClaimCorrectionErrors.unstrikeable({ wrong }));
  }
  // Checked after the already-struck checks the branches run, so a re-run still reads as one.
  const correctionShown = fallbacksOf({ attachments, text }).some((fallback) =>
    fallback.includes(`*${CORRECTION_LABEL}*`),
  );
  const metadata = sendableMetadata({ metadata: stored.metadata });
  const withMetadata = metadata === undefined ? {} : { metadata };
  if (allBlocks.length === 0) {
    return blocklessCorrection({ attachments, correctionShown, line, text, withMetadata, wrong });
  }
  return blockCorrection({
    allBlocks,
    attachmentBlocks,
    attachments,
    correctionShown,
    line,
    stored,
    text,
    topBlocks,
    withMetadata,
    wrong,
  });
}

/**
 * Whether a notification fallback or an attachment field shows the claim where the edit cannot strike it: a fallback
 * copy inside a code span or a `<…>` token (no strike reaches it, blocks or none), a second copy in one fallback
 * (`correctedFallback` strikes the first only), an unclosed fence or token that would swallow the appended Correction
 * line, or an attachment's `text`, `pretext` or a field, which the edit never strikes.
 */
function fallbackOrFieldUnstrikeable({
  attachments,
  line,
  text,
  wrong,
}: {
  attachments: readonly unknown[];
  line: string;
  text: string;
  wrong: string;
}): boolean {
  const unstrikeable = (fallback: string): boolean =>
    opaqueSpanCount({ text: fallback, wrong }) > 0 ||
    occurrences({ haystack: fallback, needle: wrong }).length > 1 ||
    swallowsCorrection({ fallback, line, wrong });
  return (
    fallbacksOf({ attachments, text }).some(unstrikeable) ||
    attachmentsShowClaim({ attachments: outsideRebuild({ attachments }), wrong })
  );
}

/** A block-less message's correction: its `text` struck and the Correction line appended, sent alone. */
function blocklessCorrection({
  attachments,
  correctionShown,
  line,
  text,
  withMetadata,
  wrong,
}: {
  attachments: readonly unknown[];
  correctionShown: boolean;
  line: string;
  text: string;
  withMetadata: Pick<CorrectedMessage, "metadata">;
  wrong: string;
}): Result<CorrectedMessage, ClaimCorrectionError> {
  if (text.includes(`~${wrong}~`)) {
    return err(ClaimCorrectionErrors.alreadyStruck({ wrong }));
  }
  // A block-less edit sends `text` alone, so an attachment making the claim (its fallback, text, pretext, a field)
  // would keep showing it; a Correction line already there would show twice.
  if (attachmentsShowClaim({ attachments, wrong }) || correctionShown || labelShown({ attachments, blocks: [] })) {
    return err(ClaimCorrectionErrors.unstrikeable({ wrong }));
  }
  return ok({ ...withMetadata, struckIn: "text", text: correctedFallback({ correction: line, text, wrong }) });
}

/** A message with blocks: the claim struck where a block makes it, the Correction block under it, fallbacks too. */
function blockCorrection({
  allBlocks,
  attachmentBlocks,
  attachments,
  correctionShown,
  line,
  stored,
  text,
  topBlocks,
  withMetadata,
  wrong,
}: {
  allBlocks: readonly unknown[];
  attachmentBlocks: readonly (readonly unknown[])[];
  attachments: readonly unknown[];
  correctionShown: boolean;
  line: string;
  stored: StoredMessage;
  text: string;
  topBlocks: readonly unknown[];
  withMetadata: Pick<CorrectedMessage, "metadata">;
  wrong: string;
}): Result<CorrectedMessage, ClaimCorrectionError> {
  const top = correctBlocks({ blocks: topBlocks, correction: line, wrong });
  const wrapped = attachmentBlocks.map((blocks) => correctBlocks({ blocks, correction: line, wrong }));
  const struck = [top, ...wrapped].find((entry) => entry.struck !== undefined)?.struck;
  if (struck === undefined) {
    // A count of one with no block rewritten would be the two walks disagreeing — a programming error, not input.
    throw new Error("unreachable: the claim was counted once and struck nowhere");
  }
  if (struck.alreadyStruck) {
    return err(ClaimCorrectionErrors.alreadyStruck({ wrong }));
  }
  // Refused before the edit rather than found by the read-back after it: the strike would land and the claim still show,
  // or a Correction line already there, in a fallback or any other markup, would show twice.
  const labelled = correctionShown || labelShown({ attachments: outsideRebuild({ attachments }), blocks: allBlocks });
  if (allBlocks.some((block) => unstrikeableCount({ block, wrong }) > 0) || labelled) {
    return err(ClaimCorrectionErrors.unstrikeable({ wrong }));
  }
  const rebuilt = rebuiltAttachments({ attachments, line, wrapped, wrong });
  return ok({
    ...withMetadata,
    ...(stored.blocks === undefined ? {} : { blocks: top.blocks }),
    ...(stored.attachments === undefined ? {} : { attachments: rebuilt }),
    struckIn: struck.kind,
    text: text.length > 0 ? correctedFallback({ correction: line, text, wrong }) : `${CORRECTION_LABEL} ${line}`,
  });
}

/**
 * Whether the message ALREADY shows this exact correction of this claim — the claim struck and this very line under
 * it. `CLAIM_ALREADY_STRUCK` says only that the strike is there; a caller treating a re-run as landed (a journal
 * that must record what readers see) asks this as well, so a different line is never recorded as this one.
 *
 * @param stored what Slack stored for the message
 * @param wrong the claim's exact words
 * @param correction the correction line, as passed to {@link correctClaim}
 * @returns whether the strike and this line are both already shown
 */
export function claimCorrectedAs({
  stored,
  wrong,
  correction,
}: {
  stored: StoredMessage;
  wrong: string;
  correction: string;
}): boolean {
  const line = correction.trim();
  const { attachments = [], blocks: topBlocks = [], text = "" } = stored;
  const lists = [
    topBlocks,
    ...attachments.map((attachment) =>
      isRecord(attachment) && Array.isArray(attachment["blocks"]) ? attachment["blocks"] : [],
    ),
  ];
  if (lists.every((blocks) => blocks.length === 0)) {
    // `correctedFallback` strikes the claim where it sits and appends the line as the text's last line.
    const suffix = correctionSuffix({ line });
    const body = text.slice(0, text.length - suffix.length);
    return (
      fallbackCorrected({ fallback: text, line, wrong }) &&
      text.endsWith(suffix) &&
      body.includes(`~${wrong}~`) &&
      notExactlyOnce({ allBlocks: [], text: body, wrong }) === undefined &&
      // The block-less edit leaves attachments as they were, so one of them making the claim shows it uncorrected, and
      // one carrying a Correction label shows a second line.
      !attachmentsShowClaim({ attachments, wrong }) &&
      !labelShown({ attachments, blocks: [] })
    );
  }
  // A second copy of the claim — one left unstruck beside a struck one — is not this correction, so the claim must
  // occur once outside the Correction line, which may itself quote it.
  // A copy in a header or context line is still read unstruck, whatever the strike did.
  const claimBlocks = lists.flat().filter((block) => !isCorrectionLine({ block, correction: line }));
  // One Correction line, the one under the strike: a second elsewhere is a copy the strike never reached.
  if (lists.flat().length - claimBlocks.length !== 1) {
    return false;
  }
  if (notExactlyOnce({ allBlocks: claimBlocks, text, wrong }) !== undefined) {
    return false;
  }
  // A Correction label in any other markup — a mrkdwn section, an attachment field — is a second line to the reader.
  if (labelShown({ attachments: outsideRebuild({ attachments }), blocks: claimBlocks })) {
    return false;
  }
  // Over every block, the Correction line's included: it may quote the claim in plain words, never in code.
  if (lists.flat().some((block) => unstrikeableCount({ block, wrong }) > 0)) {
    return false;
  }
  if (!fallbacksOf({ attachments, text }).every((fallback) => fallbackCorrected({ fallback, line, wrong }))) {
    return false;
  }
  if (attachmentsShowClaim({ attachments: outsideRebuild({ attachments }), wrong })) {
    return false;
  }
  return lists.some((blocks) => correctionFollows({ blocks, correction: line, wrong }));
}

/** Every attachment rebuilt around its corrected blocks, its notification fallback struck and corrected too. */
function rebuiltAttachments({
  attachments,
  wrapped,
  line,
  wrong,
}: {
  attachments: readonly unknown[];
  wrapped: readonly { readonly blocks: readonly unknown[] }[];
  line: string;
  wrong: string;
}): readonly CorrectedAttachment[] {
  return attachments.map((attachment, index) => {
    const fallback =
      isRecord(attachment) && typeof attachment["fallback"] === "string" ? attachment["fallback"] : undefined;
    const base = sendableAttachment({ attachment, blocks: wrapped[index]!.blocks });
    return fallback === undefined
      ? base
      : { ...base, fallback: correctedFallback({ correction: line, text: fallback, wrong }) };
  });
}
