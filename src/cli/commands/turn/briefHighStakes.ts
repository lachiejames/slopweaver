/**
 * The high-stakes gate as the bot's turn lane asks it, once, at `turn brief`.
 *
 * Every turn post, whether the working card, the answer or a held answer released later, is a reply under the
 * brief's `threadTs`. In a high-stakes channel, a thread that names no message would carry the working card and
 * the answer to the top level, undefended. The write transport refuses that at every post
 * (`../../../corpus/slack/writeGuardHighStakes.ts`), a hand-edited brief included; this check asks it earlier,
 * so a bad thread is refused before any brief is written rather than at the first post. A brief built from a
 * real mention names the mention itself or its parent, and Slack confirms either. One built from a hand-typed
 * `--thread-ts` that names nothing is judged as the top-level post it would become: refused as undefended, by
 * the same gate every `slack` send lane asks (`../slack/highStakesGate.ts`).
 *
 * A home whose profile names no high-stakes channel gates nothing here. Unlike a `slack` send, a turn never posts
 * top-level by construction, so there is no channel for this lane to protect until the profile names one.
 */
import { highStakesChannelOf } from "../../../outbound/slack/highStakesChannel.js";
import { type HighStakesDeps, highStakesRefusals } from "../slack/highStakesGate.js";

/** The form kind a turn's own posts are judged as: the bot's answer, never a finding card. */
const TURN_FORM_KIND = "answer";

/**
 * Refuse a brief whose thread, in a high-stakes channel, is not confirmed as a real top-level message there.
 *
 * @param deps the profile read and the live thread-anchor read, plus the rest of the gate's reads
 * @param env the environment the gate's hatches are read from
 * @param home the state home, for the profile and the journalled hatch grants
 * @param channel the channel the ask arrived in
 * @param threadTs the thread every post of this turn will reply into
 * @param token the bot token the turn posts under, absent when none is stored
 * @returns the refusal lines, or empty when the brief may be written
 */
export async function turnBriefHighStakesRefusals({
  deps,
  env,
  home,
  channel,
  threadTs,
  token,
}: {
  deps: HighStakesDeps;
  env: Readonly<Record<string, string | undefined>>;
  home: string;
  channel: string;
  threadTs: string;
  token: string | undefined;
}): Promise<readonly string[]> {
  const config = deps.highStakes({ home });
  if (config.isOk()) {
    const target = highStakesChannelOf({ channel, channels: config.value.channels });
    if (target === undefined) {
      return [];
    }
    if (token === undefined) {
      return [
        `turn brief: ${target.name} is a high-stakes channel and no Slack bot token is stored, so thread ` +
          `${threadTs} cannot be confirmed as a real message there and nothing was written`,
      ];
    }
    return highStakesRefusals({ channel, claim: false, deps, env, formKind: TURN_FORM_KIND, home, threadTs, token });
  }
  return highStakesRefusals({ channel, claim: false, deps, env, formKind: TURN_FORM_KIND, home, threadTs, token: "" });
}
