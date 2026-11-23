/**
 * A message as the owner to the bot, in the owner's own bot DM, is SENT by the seat that needs it — never parked
 * on the owner's queue for a yes.
 *
 * A queue card parking a reply as the owner under their own message to the bot, which a seat needed as the human
 * half of a gold witness, is dogfooding that should not be escalated to or blocked on the owner. `AGENTS.md`
 * rule 1 already says so: the witness is the fleet's to take, and a human half is posted as the owner TO THE BOT,
 * never a card or hand step. So `slack draft record --as me` refuses to park one, and names the direct send that
 * takes its place.
 *
 * ## The recipient test is exact
 *
 * The destination is `slackBot.promptChannel`, the `D…` conversation the owner has with the bot, compared with
 * surrounding whitespace trimmed — and the message is the owner's: a top-level post there is theirs by
 * construction, and a reply is theirs only under a root they wrote themselves, as `auth.test` names them.
 * Everything else parks as before:
 *
 * - `slackBot.ownerUserId` is deliberately NOT a spelling here. Under the owner's token a `U…` destination is
 *   their SELF-DM, a different conversation from the bot DM that `./dmPurpose.ts` means by the same id under the
 *   bot's token.
 * - A DM with a person is any other `D…`, so it never matches.
 * - A reply under the BOT's own root in that DM, or under a root whose author the read did not say, or recorded
 *   while `auth.test` named nobody, is not proven the owner's own message to the bot.
 *
 * ## No hatch, and the refusal says so
 *
 * The direct send is always available and is the path, so an override would only ever put a dogfood message on
 * the owner's queue — the thing the rule removes.
 */

/**
 * Whether a destination is the owner's bot DM:`slackBot.promptChannel`, whitespace trimmed. A blank destination or
 * an unset or blank `promptChannel` names nothing.
 *
 * @param channel where the draft is aimed
 * @param promptChannel `slackBot.promptChannel`, absent when unset
 * @returns true only when the destination is that one conversation
 */
export function isBotDm({ channel, promptChannel }: { channel: string; promptChannel: string | undefined }): boolean {
  const target = channel.trim();
  return target.length > 0 && target === promptChannel?.trim();
}

/**
 * Refuse to park a message as the owner to the bot in their bot DM,naming the direct send instead.
 *
 * Returns an EMPTY list for every row that may park, so a caller asks unconditionally.
 *
 * @param channel where the draft is aimed
 * @param promptChannel `slackBot.promptChannel`, absent when unset
 * @param threadTs the root a reply goes under, absent for a top-level post
 * @param rootUserId who wrote that root, absent when there is none or the read did not say
 * @param selfUserId who `auth.test` says is sending, absent when it named nobody
 * @returns the hold's lines, or nothing when the row may park
 */
export function botDmWitnessRefusal({
  channel,
  promptChannel,
  rootUserId,
  selfUserId,
  threadTs,
}: {
  channel: string;
  promptChannel: string | undefined;
  rootUserId: string | undefined;
  selfUserId: string | undefined;
  threadTs: string | undefined;
}): readonly string[] {
  if (!isBotDm({ channel, promptChannel })) {
    return [];
  }
  const target = channel.trim();
  if (threadTs === undefined) {
    return holdLines({
      command: `slopweaver slack post --as me --channel ${target} --shape top-level --form -`,
      what: "a top-level post as the owner",
    });
  }
  const ownerRoot = selfUserId !== undefined && rootUserId === selfUserId;
  if (!ownerRoot) {
    return [];
  }
  return holdLines({
    command: `slopweaver slack reply --as me --channel ${target} --thread-ts ${threadTs} --form -`,
    what: "a reply as the owner under their own message to the bot",
  });
}

/**
 * The hold's three lines: what caught it, the send that takes its place, and the absent hatch. The recorder adds
 * the line saying nothing was parked, as every one of its refusals does.
 *
 * @param command the direct send to run instead
 * @param what the message being refused, in the words the first line uses
 * @returns the refusal lines
 */
function holdLines({ command, what }: { command: string; what: string }): readonly string[] {
  return [
    `slack draft record: REFUSING to park ${what} in the owner's bot DM — that is dogfooding, the seat ` +
      "that needs it sends it, and it is never escalated to or blocked on the owner (rule 1).",
    `Send it directly: ${command}`,
    "There is deliberately NO escape hatch: the direct send is the path, and a card is the thing the rule removes.",
  ];
}
