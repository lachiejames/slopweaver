/**
 * What a bot post to the owner's own DM is FOR — the closed allowlist, and the hold on everything else.
 *
 * The owner reads nothing of value in a DM like the "<slug> is blocked on you" cards that used to land there, and
 * scrolls past them to find the interesting posts: free-form investigation findings they might share into a
 * channel, and legitimate dogfood cases. A run blocked on the owner is looked at on the local console instead.
 *
 * So the owner's bot DM carries exactly three things, and they are {@link DM_PURPOSES}. A blocked-on-the-owner row
 * belongs on the console's Queue card, drawn while `src/handover/ownerWait.ts` calls it the owner's, never a
 * message. The sender that used to post those cards is deleted rather than guarded; this is what keeps the NEXT
 * one from arriving by a different verb.
 *
 * ## Everything this DM is for
 *
 * Read these before arguing an edge; together they are the whole rule.
 *
 * - The DM is where an UNASKED post lands, so the owner can share it into a public facing channel when they
 *   choose (`skills/automation/reference/the-owners-dm-not-a-channel.md`).
 * - What earns the DM is a free-form investigation finding the owner might share, or a legitimate dogfood case for
 *   the bot. Something blocked on the owner is read on the local console instead.
 * - A question put to the owner there is missed: it belongs in the queue, which is the page the owner reads.
 *
 * So: a finding the owner might share, a dogfood case, or a message the owner asked for — and never a question to
 * them or anything waiting on them, which goes on the Queue (`handover ask` / `handover register`).
 *
 * ## The purpose is DECLARED, never inferred — and the content is READ as well
 *
 * `slack post|reply --as bot` takes `--dm-purpose <one of the three>`, and a send aimed at the owner's DM without
 * one is HELD. A default would make an undeclared post indistinguishable from a deliberate one, which is the whole
 * failure: nothing about a card's shape says whether it is a finding or a nag. A declaration is not a content
 * check, so a caller that labels a question `investigation-finding` would be admitted by this hold alone.
 * `./ownerDmAsk.ts` is the content half: it refuses a post there whose own words ask the owner something, whatever
 * purpose it declared. The declaration is on the
 * command line rather than inside the form because the recipe lane hands `slack post` a form document another
 * verb emitted whole, and rewriting that document to add a field is a second author of it.
 *
 * ## What counts as "the owner's DM"
 *
 * Two spellings reach the one conversation, and both are configuration already on disk: `slackBot.ownerUserId`
 * (a `U…` id — `chat.postMessage` opens the direct message itself) and `slackBot.promptChannel` (the `D…`
 * conversation the scheduled lanes already treat as the owner's). The configured id on either, compared with
 * surrounding whitespace trimmed, is the owner's DM; nothing is resolved, and an id blank once trimmed names
 * nothing.
 * **The residue, stated**: a `D…` id for that same conversation which is NOT the configured `promptChannel` is
 * not recognised without a Slack read this pure check does not make — the bot has one direct conversation with
 * the owner, and `promptChannel` names it.
 * The check TRUSTS that configuration rather than verifying it: `promptChannelSchema` (`../../profile.ts`)
 * accepts any non-empty id, so a `promptChannel` set to a public channel makes that channel the owner's DM here.
 *
 * ## Where it is asked, and what it does not cover
 *
 * `../../cli/commands/slack/runAdmit.ts` asks it for an `--as bot` form send AFTER the two scheduled-post
 * holds, and the first refusal ends the admission: a send one of those already refused never reaches this one,
 * so it is refused, but by that hold's lines rather than these. A recipe card, an automation prompt and a
 * session's hand-composed finding that pass those holds all cross this one. A live
 * bot turn's own replies (`../../live/turn/poster*.ts`) do not: they answer an address the owner or someone else
 * made, which is "a message the owner asked for" by construction, and they go through the transport directly. Nor does
 * `slack edit`: it rewrites a message already sent, and a card this build posted there crossed the hold then.
 *
 * ## No hatch, and the refusal says so
 *
 * `.claude/rules/error-handling.md` § "A `hold` has no hatch, and says so": the allowlist IS the ruling, and an
 * override would be a documented fourth purpose.
 */
import { z } from "zod";

import { err, ok, type Result } from "#lib/result.js";

/**
 * The only things a bot post to the owner's DM may be.
 *
 * - `investigation-finding` — a free-form finding the owner might share into a channel, including the unasked
 *   scheduled cards rule 10 sends there so they can share them.
 * - `dogfood-case` — a deliberate the bot dogfood case in the private DM.
 * - `asked-for` — a message the owner asked for: a reply to their own ask, or the prompt a recipe they set up posts.
 */
export const DM_PURPOSES = ["investigation-finding", "dogfood-case", "asked-for"] as const;

/** The closed allowlist as a schema, so a fourth value is refused where it is typed. */
const dmPurposeSchema = z.enum(DM_PURPOSES);

/** One declared purpose. */
export type DmPurpose = z.infer<typeof dmPurposeSchema>;

/**
 * Read a `--dm-purpose` value, refusing anything outside the allowlist by naming the whole list.
 *
 * @param value the flag's raw value
 * @returns the purpose, or the one line saying what is allowed
 */
export function parseDmPurpose({ value }: { value: string }): Result<DmPurpose, string> {
  const parsed = dmPurposeSchema.safeParse(value.trim());
  if (parsed.success) {
    return ok(parsed.data);
  }
  return err(
    `--dm-purpose must be one of ${DM_PURPOSES.join(", ")} — the only three things the owner's private DM carries; ` +
      `got "${value}"`,
  );
}

/**
 * Whether a destination is the owner's own DM: the same id as either configured spelling, whitespace trimmed.
 * A destination blank once trimmed is never the owner's DM, whatever is configured.
 *
 * @param channel where the send is aimed
 * @param ownerUserId `slackBot.ownerUserId`, absent when unset
 * @param promptChannel `slackBot.promptChannel`, absent when unset
 * @returns true when the destination equals either configured id — what this module takes to be the owner's DM
 */
export function isOwnerDm({
  channel,
  ownerUserId,
  promptChannel,
}: {
  channel: string;
  ownerUserId: string | null | undefined;
  promptChannel: string | undefined;
}): boolean {
  const target = channel.trim();
  return target.length > 0 && (target === ownerUserId?.trim() || target === promptChannel?.trim());
}

/**
 * Hold a bot post aimed at the owner's DM that does not declare what it is for.
 *
 * Returns an EMPTY list for every send that may proceed — any destination that is not the owner's DM, and any post to
 * it that declares an allowed purpose — so a caller asks unconditionally rather than behind an `if` that gets
 * forgotten.
 *
 * @param channel where the send is aimed
 * @param dmPurpose the declared purpose, absent when the caller named none
 * @param ownerUserId `slackBot.ownerUserId`, absent when unset
 * @param promptChannel `slackBot.promptChannel`, absent when unset
 * @returns the hold's lines, or nothing when the send may proceed
 */
export function ownerDmPurposeRefusal({
  channel,
  dmPurpose,
  ownerUserId,
  promptChannel,
}: {
  channel: string;
  dmPurpose: DmPurpose | undefined;
  ownerUserId: string | null | undefined;
  promptChannel: string | undefined;
}): readonly string[] {
  if (dmPurpose !== undefined || !isOwnerDm({ channel, ownerUserId, promptChannel })) {
    return [];
  }
  return [
    `this post is aimed at ${channel}, the owner's own bot DM, and declares no --dm-purpose. That DM ` +
      `carries ${DM_PURPOSES.join(", ")} and nothing else: a run blocked on the owner is ` +
      "shown on the console's Queue page, never posted to them.",
    "Pass --dm-purpose with the one that is TRUE of this post, or send it nowhere and leave it on the queue.",
    "There is deliberately NO escape hatch here, and that is not an omission: an override would be a " +
      "documented fourth purpose, which is the thing this allowlist exists to prevent.",
  ];
}
