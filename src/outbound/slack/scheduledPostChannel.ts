/**
 * The DOOR's half of "a scheduled post goes to the owner's DM and the owner shares it".
 *
 * `../../live/automation/postTarget.ts` is the planner's half; this is what a card that never went through a
 * planner still meets. The discriminant is already on the wire and costs nothing to read: a scheduled
 * firing's post carries its slot's own delivery key, and `live/automation/slotLedger.ts#slotDeliveryKey` spells
 * that `recipe-slot:<digest>`. So "this send came from a clock rather than from a person" is a FACT about
 * the request, not a label a caller opted into — which is the property `../artifact/botFormKinds.ts`'s
 * header argues every check of this sort needs.
 *
 * ## It asks a WEAKER question than the planner, on purpose
 *
 * The planner knows which row it is running, so it asks "was THIS row approved for THIS channel". The door
 * knows only the key, and the key is a digest: `slotDeliveryKey`'s own header says the digest half "is what
 * keeps a raw recipe id off the wire". Putting the id back so the door could look the row up would undo a
 * decision that module states in prose, for a gate that is the second of two. So this one asks whether ANY
 * row on the install carries the owner's approval for the channel, and the planner asks the exact question.
 *
 * Neither gate subsumes the other, and both have a hole the other covers:
 *
 * - this one is reached by a card composed anywhere, planner or not — but only when the caller passes a
 *   slot key, which a `verb-run` row's arbitrary verb has no reason to do;
 * - the planner's covers a `verb-run` row's argv — but only the channels spelled as argv words.
 *
 * Complements, exactly as `.claude/rules/testing.md` records for `home-safety`'s two halves. Keep both.
 *
 * ## No hatch, and the refusal says so
 *
 * Same standing as `./automationPromptChannel.ts` and for the same reason
 * (`.claude/rules/error-handling.md` § "A `hold` has no hatch, and says so"): an override would be a
 * documented way to post unasked into a team channel, which is the act the owner has deleted before. The fix the text
 * names is a recorded approval, never a waiver.
 *
 * ## Absent config REFUSES
 *
 * An install that has configured no private conversation has nowhere for a scheduled card to land, so it
 * may not send one. The same fail-closed arm `./renderProof.ts` and `./automationPromptChannel.ts` both
 * take, and for the same reason: the alternative is inventing a destination nobody chose.
 */

/**
 * The prefix `live/automation/slotLedger.ts#slotDeliveryKey` puts on every scheduled firing's delivery id.
 *
 * @internal — {@link isScheduledDelivery} is what a caller asks; this is here to be READ beside it, because
 * a literal buried in a `startsWith` is the thing a reader cannot find from the other module.
 */
const RECIPE_SLOT_KEY_PREFIX = "recipe-slot:";

/**
 * Whether this send is one cadence firing's delivery, and so subject to the check below.
 *
 * Its own function because the discriminant is a string the door compares rather than a type it narrows —
 * the same reason `./automationPromptChannel.ts#isAutomationPrompt` is one.
 *
 * @param idempotencyKey the delivery id the caller passed, absent on an ordinary hand-typed send
 * @returns true when the key is a recipe slot's own
 */
export function isScheduledDelivery({ idempotencyKey }: { idempotencyKey: string | undefined }): boolean {
  if (idempotencyKey === undefined) {
    return false;
  }
  return idempotencyKey.startsWith(RECIPE_SLOT_KEY_PREFIX);
}

/**
 * Refuse a scheduled firing's card aimed anywhere but the owner's private conversation or a channel the owner has approved.
 *
 * Returns an EMPTY list for every send that is not a scheduled delivery, so a caller may ask
 * unconditionally — the alternative is a caller-side `if`, which is the branch that gets forgotten.
 *
 * @param idempotencyKey the delivery id the caller passed, absent on an ordinary hand-typed send
 * @param channel where this send is aimed
 * @param promptChannel the one private conversation `slackBot.promptChannel` names, absent on an install
 *   that has configured none
 * @param approvedChannels every channel some recipe row carries the owner's recorded approval for
 * @returns the refusal lines, or nothing when the send may proceed
 */
export function scheduledPostChannelRefusal({
  idempotencyKey,
  channel,
  promptChannel,
  approvedChannels,
}: {
  idempotencyKey: string | undefined;
  channel: string;
  promptChannel: string | undefined;
  approvedChannels: readonly string[];
}): readonly string[] {
  if (!isScheduledDelivery({ idempotencyKey })) {
    return [];
  }
  if (promptChannel === undefined) {
    return [
      "this is a SCHEDULED post — a recipe firing's own card — and no `slackBot.promptChannel` is set in " +
        "profile.json, so there is no private conversation for it to land in. Set it to the conversation " +
        "only you and the bot read (the bot's own DM is the intended one). There is deliberately NO " +
        "override: a scheduled card posted where a team can read it is spam.",
    ];
  }
  if (channel === promptChannel || approvedChannels.includes(channel)) {
    return [];
  }
  return [
    `this is a SCHEDULED post — a recipe firing's own card — aimed at ${channel}, which is neither the ` +
      `private conversation ${promptChannel} nor a channel any recipe row carries the owner's approval for. ` +
      "A scheduled post goes to the owner's bot DM and the owner shares it into a channel when " +
      "wanted. A person's direct ask of the bot is the exception, and a direct ask carries no slot key.",
    `Point the row at ${promptChannel}, or ask the owner on the Queue (\`handover register\`, never in the owner's DM) and, ` +
      "once the owner has said this channel, record it on the row's `channelApprovals` — { channel, runSlug, atIso } " +
      "for the owner's Queue answer, or { channel, dmChannel, ts, atIso } for a message the owner sent — which a reader can " +
      "go and read.",
    "There is deliberately NO escape hatch here, and that is not an omission: an override would be a " +
      "documented way to do the thing this refusal exists to prevent.",
  ];
}
