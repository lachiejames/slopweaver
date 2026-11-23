/**
 * What a drip's dry run says about the media it carries: the summary line above the preview, and the extra
 * wire steps under the one message that holds the files. Split out of `./dripCore.ts`, which keeps the plan
 * and the report; these two only describe media, and take the media paths rather than the plan.
 */
import { basename } from "node:path";

/**
 * What the media does, said above the preview rather than left to be inferred from the step list.
 *
 * Silent when there is none: a drip without attachments should read exactly as it always did.
 *
 * @param count how many messages the drip sends, the last of which carries the media
 * @param media every media path the drip carries, in the caller's order
 * @returns the summary line, or no lines when the drip carries no media
 */
export function dripMediaLines({ count, media }: { count: number; media: readonly string[] }): readonly string[] {
  if (media.length === 0) {
    return [];
  }
  return [
    `media: ${String(media.length)} file(s) — ${media.map((path) => basename(path)).join(", ")} — ` +
      `attached UNDER message ${String(count)}/${String(count)}, the last one`,
  ];
}

/**
 * The extra wire steps a message carrying media performs, named individually.
 *
 * The whole composite is listed rather than summarised as "and attach the media", because the read-back is
 * the step that decides whether the message survives: an operator reading this should be able to see that a
 * failure to verify DELETES the message it was attached to rather than leaving it up without its evidence.
 *
 * @param media the media paths this one message carries
 * @returns the step lines, or no lines for a message carrying no media
 */
export function mediaStepsFor({ media }: { media: readonly string[] }): readonly string[] {
  if (media.length === 0) {
    return [];
  }
  const files = String(media.length);
  return [
    `     ↳ files.uploadV2 ×${files} (private, before the post — an unreadable path fails before anything is said)`,
    `     ↳ chat.update file_ids=${files} — the files land under this message's own text`,
    `     ↳ read-back — a count that disagrees DELETES this message rather than leaving it evidence-free`,
  ];
}
