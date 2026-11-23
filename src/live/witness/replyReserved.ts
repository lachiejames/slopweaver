/**
 * Whether a witness reply was ever reserved for one witnessed message — the read `witness dispatch` makes before
 * it boots a second attempt on a `failed` witness.
 *
 * The door's duplicate check refuses a repeat reply for 24 hours only (`DUPLICATE_WINDOW_HOURS`), and a
 * re-dispatch can come later than that. Its reservation files are never pruned, so reading the same file with
 * no window answers "did any attempt ever send, or start sending, this reply" at any age. The key is the one
 * the reply itself reserves under: the bot actor, the thread, and `witnessIdempotencyKey`, which replaces the
 * reply's content in the digest (`outbound/slack/fingerprint.ts`).
 */
import { keyedDuplicateKey } from "../../outbound/slack/fingerprint.js";
import { peekSend } from "../../outbound/slack/sendReservation.js";
import { witnessIdempotencyKey } from "./instructions.js";
import type { WitnessKey } from "./types.js";

/**
 * Read the send ledger for a witness reply to this message, at any age.
 *
 * @param home the state home whose send ledger the reply reserved in
 * @param key the witnessed message's coordinates
 * @param nowIso the reference instant
 * @returns true when a reply was reserved, whether or not it was confirmed landed
 */
export function witnessReplyReserved({
  home,
  key,
  nowIso,
}: {
  home: string;
  key: WitnessKey;
  nowIso: string;
}): boolean {
  const { channel, messageTs, threadTs } = key;
  const reservation = peekSend({
    duplicateKey: keyedDuplicateKey({
      actor: "bot",
      channel,
      idempotencyKey: witnessIdempotencyKey({ channel, messageTs }),
      threadTs,
    }),
    home,
    nowIso,
    windowHours: Number.POSITIVE_INFINITY,
  });
  return reservation.kind === "duplicate";
}
