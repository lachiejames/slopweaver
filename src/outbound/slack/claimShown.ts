/**
 * What a stored Slack message SHOWS a reader of one claim and one Correction line: its notification fallbacks, the
 * attachment fields the edit never rewrites, a Correction label in any markup, and how many times the claim is made.
 * Both halves of `./claimCorrection.ts` read a message this way — `correctClaim` before the edit, `claimCorrectedAs`
 * on the read-back — so the readers live here, split out under the file-size cap. Pure; imports nothing from
 * `./claimCorrection.ts`.
 */
import { isRecord } from "../../lib/parsers.js";
import { type ClaimCorrectionError, ClaimCorrectionErrors } from "./claimCorrectionInput.js";
import { occurrences, opaqueSpanCount, opaqueSpanCrosses } from "./claimMrkdwnSpans.js";
import { CORRECTION_LABEL, countInBlock, OPAQUE, stringValues } from "./claimStrike.js";

/** Escape the three characters Slack's `mrkdwn` treats as control. */
function escapeMrkdwn({ text }: { text: string }): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

/**
 * The Correction line as `correctClaim` appends it to a notification text.
 *
 * @param line the trimmed correction line
 * @returns a newline, the bold label and the escaped line
 */
export function correctionSuffix({ line }: { line: string }): string {
  return `\n*${CORRECTION_LABEL}* ${escapeMrkdwn({ text: line })}`;
}

/**
 * Each attachment less the blocks and fallback the edit rebuilds it from: its `text`, `pretext`, `fields` and the
 * rest, which the edit never strikes.
 *
 * @returns the attachments with `blocks` and `fallback` cleared
 */
export function outsideRebuild({ attachments }: { attachments: readonly unknown[] }): readonly unknown[] {
  return attachments.map((attachment) =>
    isRecord(attachment) ? { ...attachment, blocks: undefined, fallback: undefined } : attachment,
  );
}

/**
 * Whether any string an attachment carries, under any key but a structural one, makes the claim.
 *
 * @returns whether some attachment shows `wrong`
 */
export function attachmentsShowClaim({
  attachments,
  wrong,
}: {
  attachments: readonly unknown[];
  wrong: string;
}): boolean {
  return attachments.some((attachment) => stringValues({ value: attachment }).some((value) => value.includes(wrong)));
}

/**
 * Whether any of these blocks or attachments carries the Correction label, in whatever markup.
 *
 * @returns whether the label shows anywhere among them
 */
export function labelShown({
  attachments,
  blocks,
}: {
  attachments: readonly unknown[];
  blocks: readonly unknown[];
}): boolean {
  return (
    attachmentsShowClaim({ attachments, wrong: CORRECTION_LABEL }) ||
    blocks.some((block) => stringValues({ value: block }).some((value) => value.includes(CORRECTION_LABEL)))
  );
}

/**
 * The notification fallbacks `correctClaim` rewrites too: the message text, always, and each attachment's
 * `fallback` where it has one.
 *
 * @returns the message text first, then each attachment fallback
 */
export function fallbacksOf({
  attachments,
  text,
}: {
  attachments: readonly unknown[];
  text: string;
}): readonly string[] {
  const attached = attachments.flatMap((attachment) =>
    isRecord(attachment) && typeof attachment["fallback"] === "string" ? [attachment["fallback"]] : [],
  );
  return [text, ...attached];
}

/**
 * Whether a plain-text fallback reads as `correctClaim` writes one: the bare Correction line where the text was empty,
 * else ending on this Correction line with the claim nowhere unstruck above it. A copy inside a code span or a `<…>`
 * token shows, struck or not: no tilde there is a strike.
 *
 * @param line the trimmed correction line
 * @returns whether the fallback shows this exact correction
 */
export function fallbackCorrected({
  fallback,
  line,
  wrong,
}: {
  fallback: string;
  line: string;
  wrong: string;
}): boolean {
  if (fallback === `${CORRECTION_LABEL} ${line}`) {
    return true;
  }
  const suffix = correctionSuffix({ line });
  if (!fallback.endsWith(suffix)) {
    return false;
  }
  const body = fallback.slice(0, fallback.length - suffix.length);
  // An unclosed fence or token in the body swallows the Correction line appended after it.
  if (opaqueSpanCrosses({ at: body.length, text: fallback })) {
    return false;
  }
  // A Correction line already above this one would show the reader two.
  if (body.includes(`*${CORRECTION_LABEL}*`)) {
    return false;
  }
  // A doubled `~~claim~~` or any other tilde on the claim's line is counted here.
  if (opaqueSpanCount({ text: body, wrong }) > 0) {
    return false;
  }
  return !body.split(`~${wrong}~`).join(OPAQUE).includes(wrong);
}

/**
 * The refusal when the message does not make the claim exactly once — in its blocks, or its text when it has none.
 *
 * @returns `CLAIM_NOT_FOUND` or `CLAIM_AMBIGUOUS`, or undefined when the claim is made once
 */
export function notExactlyOnce({
  allBlocks,
  text,
  wrong,
}: {
  allBlocks: readonly unknown[];
  text: string;
  wrong: string;
}): ClaimCorrectionError | undefined {
  const count =
    allBlocks.length > 0
      ? allBlocks.reduce<number>((sum, block) => sum + countInBlock({ block, wrong }), 0)
      : occurrences({ haystack: text, needle: wrong }).length;
  if (count === 0) {
    return ClaimCorrectionErrors.notFound({ wrong });
  }
  if (count > 1) {
    return ClaimCorrectionErrors.ambiguous({ count, wrong });
  }
  return undefined;
}
