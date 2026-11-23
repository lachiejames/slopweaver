/**
 * The write transport's own Slack identity, asked of `auth.test` the first time a caller needs it and reused
 * after that.
 *
 * Split from `./writeApi.ts`, which sits at the repository's 300-code-line ceiling, along the line between
 * WIRING the transport's methods and REMEMBERING one answer across them. It holds no client: the caller hands
 * in the call that asks. Pure apart from that call.
 */
import type { SlackSelfIdentity } from "../../outbound/slack/lifecycleGuards.js";

/**
 * The bot's identity, asked for once per transport. The sweep needs the bot id for every message it inspects,
 * and re-asking per message would spend a call per candidate to learn a value that cannot change mid-run.
 *
 * A call that fails remembers nothing, so the next caller asks again.
 *
 * @param ask the call that asks Slack who this transport's token is
 * @returns a function answering the identity — asking on its first call, and reusing that answer afterwards
 */
export function whoAmIOnce({ ask }: { ask: () => Promise<SlackSelfIdentity> }): () => Promise<SlackSelfIdentity> {
  let self: SlackSelfIdentity | undefined;
  return async () => {
    // Already asked in this run: the answer stands, and the call is not spent again.
    if (self !== undefined) {
      return self;
    }
    self = await ask();
    return self;
  };
}
