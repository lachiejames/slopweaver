/**
 * Which Slack token a write sends with — split out of `./coreArgs.js`, which parses the flags that pick the
 * identity; this module refuses a token whose prefix says it is the other identity.
 */
import { err, ok } from "../../../lib/result.js";
import { type SlackDelivery, SlackDeliveryErrors } from "../../../outbound/slack/deliveryErrors.js";
import type { SlackActor } from "../../../outbound/slack/types.js";

/** The prefix each lane's token carries, so the check below is data rather than two near-identical branches. */
const ACTOR_TOKEN_PREFIX = { bot: "xoxb-", me: "xoxp-" } as const satisfies Record<SlackActor, string>;

/**
 * Choose the token for the requested identity, and REFUSE one whose prefix says it is the other kind.
 *
 * A user token used for as-bot, or a bot token used for as-me, would post under an identity the caller did
 * not ask for. That is the single worst thing this program can do, so a mismatch is a hard error rather
 * than a silent substitution — and it is caught here, before any network call.
 *
 * @param actor the requested posting identity
 * @param botToken the resolved Slack bot token, if any
 * @param userToken the resolved Slack user token, if any
 * @returns the token to send with, or a usage error naming exactly what to set
 */
export function resolveSlackWriteToken({
  actor,
  botToken,
  userToken,
}: {
  actor: SlackActor;
  botToken: string | undefined;
  userToken: string | undefined;
}): SlackDelivery<string> {
  const token = actor === "bot" ? botToken : userToken;
  if (token === undefined) {
    return err(SlackDeliveryErrors.tokenAbsent({ actor }));
  }
  if (!token.startsWith(ACTOR_TOKEN_PREFIX[actor])) {
    return err(SlackDeliveryErrors.tokenWrongKind({ actor }));
  }
  return ok(token);
}
