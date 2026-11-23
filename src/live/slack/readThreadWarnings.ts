/**
 * The `slack read-thread` document's stage warnings: each turns one stage's verdict (the file-lane scope,
 * the attachments it could not retrieve, the thread count) into the sentence the document carries, or into
 * nothing when that stage has nothing to say.
 */
import { describeThreadCompleteness, type ThreadCompleteness } from "./completeness.js";
import type { FileOutcome } from "./fileDownloads.js";
import { describeScopePreflight, type FileScopePreflight } from "./filePlan.js";

/**
 * The scope verdict as a warning, when it has something to say.
 *
 * @param preflight the file-lane scope verdict
 * @returns the warning as a one-element list, or empty when the scope was proven present
 */
export function scopeWarnings({ preflight }: { preflight: FileScopePreflight }): readonly string[] {
  const sentence = describeScopePreflight({ preflight });
  return sentence === undefined ? [] : [sentence];
}

/**
 * A headline warning when attachments were lost, over and above the per-file `limitations`.
 *
 * Two places rather than one on purpose: `limitations` names each file, and a reader scanning only the
 * warnings would otherwise have to notice an absence. This states the count where a bot-token caveat and a
 * count discrepancy already appear, so "this read lost content" is in the one place all such notices live.
 *
 * @param files the attachment stage's outcome
 * @returns the warning as a one-element list, or empty when nothing was lost
 */
export function unretrievableWarnings({ files }: { files: FileOutcome }): readonly string[] {
  if (files.unretrievable.length === 0) {
    return [];
  }
  const n = String(files.unretrievable.length);
  const plural = files.unretrievable.length === 1 ? "attachment" : "attachments";
  return [
    `${n} ${plural} could NOT be retrieved and their content is absent from this read; ` +
      "each is named in the limitations below and beside the message that carried it",
  ];
}

/**
 * The count discrepancy as a warning, when there is one.
 *
 * A warning rather than an error, and the reasoning is in `completeness.ts`: `reply_count` drifts in both
 * directions, so a mismatch is a discrepancy between two Slack figures and not proof this read stopped early.
 * Refusing on it would destroy a good thread to report a number we cannot trust.
 *
 * @param completeness the derived evidence
 * @returns the caveat as a one-element list, or an empty list when every lane agrees
 */
export function completenessWarnings({ completeness }: { completeness: ThreadCompleteness }): readonly string[] {
  const caveat = describeThreadCompleteness({ completeness });
  return caveat === undefined ? [] : [caveat];
}
