/**
 * THE REACTION ASSERTION — check that an ask's tagged message is wearing what its state earns, and converge
 * it when it is not.
 *
 * The effectful shell over `../../../live/turn/reactionState.ts`'s pure decision, and the answer to the half
 * of the phantom-reaction finding a dispatch-time fix cannot reach on its own: a converge that was written and lost, a
 * re-dispatch by an older binary, an operator's own `reactions.remove`. The dispatch path is what makes the
 * reaction right; this is what keeps it right.
 *
 * ## Why it asks Slack, when the rest of this machinery deliberately does not
 *
 * `../../../live/turn/posterIndicators.ts`'s `settleTagReaction` refuses a `reactions.get` round trip and
 * says why: on the TERMINAL path its answer "could be stale by the time it is acted on", and a stale read
 * there would skip the one convergence that ever runs for that ask. A per-tick assertion inverts that
 * arithmetic exactly — a stale read costs a wasted convergence, or a correction deferred by one tick, and
 * neither is a lost transition. The two are not in tension; they are the same tradeoff read from opposite
 * ends, so read both before changing either.
 *
 * The read is also what makes the check cheap enough to run every tick: one `reactions.get` per still-working
 * ask in the steady state, and the five writes of a full convergence only on the tick that actually corrects
 * something. Converging unconditionally would pay those five on every tick of every ask forever.
 *
 * ## The event log cannot do this job, and it is worth saying why
 *
 * Deriving the standing reaction from `asks.jsonl` instead looks cheaper and is a check that can never fire.
 * Every settlement is triggered by a lifecycle event, so a "what did we last settle it to" derivation would
 * read the same `dispatched` row `lifecycleReactionForAsk` reads and return the same answer — the comparison
 * would be a value against itself. Only Slack knows what is actually on the message.
 */

import { slackBotToken } from "../../../config.js";
import { makeSlackWriteTransport } from "../../../corpus/slack/writeApi.js";
import type { SlackWriteTransport } from "../../../corpus/slack/writeTransport.js";
import { err } from "../../../lib/result.js";
import type { AskIdentity } from "../../../live/ask/identity.js";
import type { AskLifecycle } from "../../../live/ask/lifecycle.js";
import type { IndicatorOutcome } from "../../../live/turn/indicators.js";
import {
  type LifecycleReaction,
  lifecycleReactionEmoji,
  lifecycleReactionEmojis,
} from "../../../live/turn/lifecycleReactions.js";
import { settleLifecycleReaction } from "../../../live/turn/poster.js";
import { lifecycleReactionForAsk, reactionConvergenceNeeded } from "../../../live/turn/reactionState.js";

/**
 * How the assertion ended, for the one line a sweep prints about it.
 *
 * `unreadable` is its own kind rather than a failure, and the distinction is the repo's rule about a gate
 * that never SAW its input: a home with no bot token, or a message Slack no longer has, is a FACT about what
 * could be checked, not a finding about the reaction.
 */
export type ReactionAssertion =
  | { readonly kind: "matches"; readonly expected: LifecycleReaction; readonly emoji: string }
  | { readonly kind: "converged"; readonly expected: LifecycleReaction; readonly emoji: string }
  | {
      readonly kind: "unconverged";
      readonly expected: LifecycleReaction;
      readonly emoji: string;
      readonly reason: string;
    }
  | {
      readonly kind: "unreadable";
      readonly expected: LifecycleReaction;
      readonly emoji: string;
      readonly reason: string;
    };

/** The Slack calls the assertion makes, injected so the sweep's own unit tests need no network and no mock. */
export interface ReactionAssertDeps {
  /** The tagged message's current reaction names, or `undefined` when the message cannot be read at all. */
  readonly readReactionNames: (input: { askIdentity: AskIdentity }) => Promise<readonly string[] | undefined>;
  /** Converge the tagged message to exactly this reaction. Reports a refusal rather than rejecting. */
  readonly converge: (input: { askIdentity: AskIdentity; reaction: LifecycleReaction }) => Promise<IndicatorOutcome>;
}

/**
 * The real `ReactionAssertDeps` for one home, or `undefined` when this home has no Slack bot token — in which
 * case no reaction can be read OR written and the caller must say so rather than reporting a match.
 *
 * @param home the resolved state home
 * @returns the live deps, or `undefined` when no bot token is configured
 */
export function liveReactionAssertDeps({ home }: { home: string }): ReactionAssertDeps | undefined {
  const botToken = slackBotToken({ home });
  if (botToken === undefined) {
    return undefined;
  }
  const transport: SlackWriteTransport = makeSlackWriteTransport({ home, token: botToken });
  return {
    converge: async ({ askIdentity, reaction }) => settleLifecycleReaction({ askIdentity, home, reaction, transport }),
    readReactionNames: async ({ askIdentity }) => {
      const live = await transport.readReactions({
        posted: { channel: askIdentity.channel, ts: askIdentity.messageTs },
      });
      if (live === undefined) {
        return undefined;
      }
      return live.map((reaction) => reaction.name);
    },
  };
}

/**
 * Assert one ask's tagged reaction against its own folded state, and converge it when they disagree.
 *
 * Never throws. Like every other indicator write in this tree, a reaction is a courtesy the caller's real
 * work must survive: a sweep that aborted over one unreachable message would stop reporting every ask behind
 * it, which is a far worse failure than a stale emoji.
 *
 * @param deps the Slack calls to run it through, absent when this home has no bot token
 * @param entry the ask's folded lifecycle — the whole input to the decision
 * @param home the resolved state home, for the configured emoji names
 * @returns what the assertion found, and what it did about it
 */
export async function assertAskReaction({
  deps,
  entry,
  home,
}: {
  deps: ReactionAssertDeps | undefined;
  entry: AskLifecycle;
  home: string;
}): Promise<ReactionAssertion> {
  const expected = lifecycleReactionForAsk({ entry });
  const emoji = lifecycleReactionEmoji({ home, reaction: expected });
  if (deps === undefined) {
    return { emoji, expected, kind: "unreadable", reason: "no Slack bot token is configured" };
  }
  const present = await readNamesSafely({ askIdentity: entry, deps });
  if (present.kind === "unreadable") {
    return { emoji, expected, kind: "unreadable", reason: present.reason };
  }
  if (
    !reactionConvergenceNeeded({ emojis: lifecycleReactionEmojis({ home }), present: present.names, standing: emoji })
  ) {
    return { emoji, expected, kind: "matches" };
  }
  const converged = await convergeSafely({ askIdentity: entry, deps, reaction: expected });
  if (converged.isErr()) {
    return { emoji, expected, kind: "unconverged", reason: converged.error };
  }
  return { emoji, expected, kind: "converged" };
}

/** The live reaction names, turning a thrown transport into an `unreadable` reason rather than a rejection. */
async function readNamesSafely({
  askIdentity,
  deps,
}: {
  askIdentity: AskIdentity;
  deps: ReactionAssertDeps;
}): Promise<
  | { readonly kind: "read"; readonly names: readonly string[] }
  | { readonly kind: "unreadable"; readonly reason: string }
> {
  try {
    const names = await deps.readReactionNames({ askIdentity });
    if (names === undefined) {
      return { kind: "unreadable", reason: "slack returned no reactions for that message — it may be gone" };
    }
    return { kind: "read", names };
  } catch (error) {
    return { kind: "unreadable", reason: error instanceof Error ? error.message : String(error) };
  }
}

/** The convergence, turning a thrown transport into a reason rather than a rejection. */
async function convergeSafely({
  askIdentity,
  deps,
  reaction,
}: {
  askIdentity: AskIdentity;
  deps: ReactionAssertDeps;
  reaction: LifecycleReaction;
}): Promise<IndicatorOutcome> {
  try {
    return await deps.converge({ askIdentity, reaction });
  } catch (error) {
    return err(error instanceof Error ? error.message : String(error));
  }
}

/**
 * The sweep's own line for one assertion, or `undefined` for the quiet case.
 *
 * A message already wearing the right emoji writes NOTHING: a sweep that printed a line per healthy ask
 * would bury the findings that need a reader, which is the same ordering rule the unrouted pass already
 * carries. Every other outcome names the EXPECTATION it derived, so the line is evidence about the decision
 * rather than about the Slack call — which is what makes it a witness a replay can assert on in a home that
 * has no bot token at all.
 *
 * @param askIdentity the ask this assertion is about
 * @param assertion what the assertion found
 * @returns the line to write, or `undefined` when there is nothing worth saying
 */
export function reactionAssertionLine({
  askIdentity,
  assertion,
}: {
  askIdentity: AskIdentity;
  assertion: ReactionAssertion;
}): string | undefined {
  const subject = `reaction: ${askIdentity.channel}/${askIdentity.messageTs} — expected :${assertion.emoji}: (${assertion.expected})`;
  if (assertion.kind === "matches") {
    return undefined;
  }
  if (assertion.kind === "converged") {
    return `${subject}; it was wearing something else and has been converged`;
  }
  if (assertion.kind === "unconverged") {
    return `${subject}; it disagreed and could NOT be converged — ${assertion.reason}`;
  }
  return `${subject}; could not check what it is wearing — ${assertion.reason}`;
}
