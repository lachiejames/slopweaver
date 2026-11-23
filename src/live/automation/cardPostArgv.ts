/**
 * The one `slack post --as bot` argv a scheduled firing's card is sent through.
 *
 * It exists because owner turn 291-8x made the two kinds that post a card IDENTICAL in the only word that
 * used to differ. `alertSummary.ts` read `plan.postTo` and `datadogAlertDigest.ts` read `plan.channel`;
 * once both take an already-admitted destination from `./postTarget.ts`, the two builders became the same
 * fifteen lines, and `duplicate-windows` said so on the commit that made them so.
 *
 * Keeping it one function is the point rather than a tidy-up: a card leg that drifts between two kinds is a
 * card one kind sends through a flag the other does not, which is exactly the class `slotLedger.ts`'s
 * delivery key and `scheduledPostChannel.ts`'s door check both assume away.
 */
import type { DmPurpose } from "../../outbound/slack/dmPurpose.js";

/**
 * Build the post leg for a scheduled card.
 *
 * @param postTo the conversation `resolveScheduledPostTarget` admitted — the owner's DM, or a channel the row records
 * @param form the form document the read leg emitted, passed whole as one argv word
 * @param home the state home this tick is running over
 * @param dryRun whether to render the card and withhold the network call
 * @param idempotencyKey the firing's own delivery id, which is also what the door reads to know this is scheduled
 * @param media the capture paths to attach, empty when the row takes no pictures
 * @param dmPurpose why the card may land in the owner's DM: a finding they share (the alert kinds), or a report they asked for
 * @returns the argv to hand the dispatcher
 */
export function scheduledCardPostArgv({
  postTo,
  form,
  home,
  dryRun,
  idempotencyKey,
  media,
  dmPurpose,
}: {
  postTo: string;
  form: string;
  home: string;
  dryRun: boolean;
  idempotencyKey: string;
  media: readonly string[];
  dmPurpose: DmPurpose;
}): readonly string[] {
  return [
    "node",
    "slopweaver",
    "slack",
    "post",
    "--as",
    "bot",
    "--channel",
    postTo,
    "--form",
    form,
    "--home",
    home,
    "--idempotency-key",
    idempotencyKey,
    // The owner's DM is where a scheduled card lands unless they approved a channel; there the purpose is the
    // kind's own, and anywhere else it is carried and unread.
    "--dm-purpose",
    dmPurpose,
    ...(media.length === 0 ? [] : ["--media", media.join(",")]),
    ...(dryRun ? ["--dry-run"] : []),
  ];
}
