/**
 * The witness path's place in the listener: a TAP on the connection's frames, beside the address loop rather
 * than inside it.
 *
 * `./socket.ts` decides what addresses this bot, and acknowledges every envelope before any work; this tap
 * sees the same frames AFTER the address loop has finished with each one (the generator resumes only when
 * the consumer asks for the next frame), so the ack-first ordering is untouched and the address loop's
 * responder whitelist, refusal reply, reply budget and `--once`/deadline accounting never see a witness line.
 * A witnessed message is therefore still logged by the address loop as an ignored `message` event — that
 * line is true of the ADDRESS path — and this tap logs its own `witnessed …` line beside it.
 *
 * The address path wins every overlap: a message that is also an address to this bot (a person tagging both
 * bots, or a reply under one of this bot's own posts) may start or refresh witnessing but is never handed
 * off as a witness line, because it is already being answered. A person tagging THIS bot is exactly such an
 * address, and it is also what starts the thread's own watch — so the tag is answered, and the messages after
 * it arrive as `ownThread` lines the loop may help on unprompted (`slopweaver witness help`).
 *
 * A thread somebody stood the bot down in (`slopweaver witness stand-down`) hands nothing off again, peer lines
 * included: the bot stops witnessing the rest of that thread. A tag
 * there is untouched — it is an address, and the address path still answers it.
 */
import type { Result } from "#lib/result.js";
import { admitEvent, createDedupeState, type DedupeState, dedupeKeyFor } from "./dedupe.js";
import { parseSocketFrame, type SocketEventFrame } from "./frames.js";
import { taggedIn } from "./mention.js";
import { type ListenScope, mentionInScope } from "./scope.js";
import type { ListenLog, SocketConnection } from "./socket.js";
import { parseWitnessEvent, type WitnessCandidate, type WitnessHandler, type WitnessLine } from "./witness.js";
import { WITNESS_DAILY_LINE_CAP } from "./witnessState.js";
import type { WitnessGate } from "./witnessStateStore.js";

/** Everything the tap judges a frame against, fixed once for the whole listen run. */
export interface WitnessTapPolicy {
  readonly gate: WitnessGate;
  readonly handler: WitnessHandler;
  /** Whether the address path takes this event — injected so the tap applies the address parse verbatim. */
  readonly isAddress: (args: { event: Readonly<Record<string, unknown>> }) => boolean;
  readonly log: ListenLog;
  readonly scope: ListenScope;
  /**
   * Whether somebody in the thread stood the bot down (`../witness/standDown.ts`), read fresh — asked only of a
   * line the gate already admitted, so an unwatched message never costs a journal read. A read error is the
   * text of why.
   */
  readonly stoodDown: (args: { channel: string; threadTs: string }) => Result<boolean, string>;
  readonly selfBotId: string | undefined;
  readonly selfUserId: string | undefined;
  readonly witnessUserIds: readonly string[];
}

/** One run's tap: its policy and its own message-keyed dedupe window, carried across reconnects. */
export interface WitnessTap {
  /** Judge one frame's text; never throws. */
  frame(args: { text: string }): Promise<void>;
}

/** Whether the address path owns this message — it tags this bot, or the address parse admits it. */
function addressedToUs({ frame, policy }: { frame: SocketEventFrame; policy: WitnessTapPolicy }): boolean {
  const text = typeof frame.event["text"] === "string" ? frame.event["text"] : "";
  const tagsUs = policy.selfUserId !== undefined && taggedIn({ text, userId: policy.selfUserId });
  return tagsUs || policy.isAddress({ event: frame.event });
}

/** Hand one admitted line off, absorbing a throw: a bad line must never end the listener. */
async function handOff({ line, policy }: { line: WitnessLine; policy: WitnessTapPolicy }): Promise<void> {
  try {
    await policy.handler(line);
  } catch (error) {
    policy.log({
      line: `the witness handler threw on ${line.channel}/${line.messageTs} — ${String(error)}; the listener continues`,
    });
  }
}

/**
 * Run one candidate through the durable thread state, and hand it off when admitted.
 *
 * @returns whether the message was durably judged — false only when the state could not be saved, so the
 *   caller leaves it out of the redelivery window and Slack's retry gets another chance
 */
async function judge({
  candidate,
  handOffWanted,
  policy,
}: {
  candidate: WitnessCandidate;
  handOffWanted: boolean;
  policy: WitnessTapPolicy;
}): Promise<boolean> {
  const observed = policy.gate.observe({ handOff: handOffWanted, observation: candidate });
  if (observed.isErr()) {
    policy.log({
      line: `witness: not handed off ${candidate.channel}/${candidate.messageTs} — ${observed.error.message}; a redelivery is judged afresh`,
    });
    return false;
  }
  const verdict = observed.value;
  if (verdict.kind === "over-budget") {
    policy.log({
      line: `witness: thread ${candidate.channel}/${candidate.threadTs} spent its ${String(WITNESS_DAILY_LINE_CAP)} lines for ${candidate.messageTs}'s UTC day — remembered, not handed off`,
    });
    return true;
  }
  if (verdict.kind !== "admitted") {
    return true;
  }
  const where = `${candidate.channel} (thread ${candidate.threadTs})`;
  // A stood-down thread is witnessed no further, and a journal that cannot say is read as one: the quiet
  // failure is a missed line, the loud one a bot back in a thread that told it to go.
  const stoodDown = policy.stoodDown({ channel: candidate.channel, threadTs: candidate.threadTs });
  if (stoodDown.isErr() || stoodDown.value) {
    const why = stoodDown.isErr()
      ? `the witness journal could not be read (${stoodDown.error})`
      : "the bot stood down there";
    policy.log({ line: `witness: not handed off ${candidate.channel}/${candidate.messageTs} — ${why}` });
    return true;
  }
  policy.log({ line: `witnessed a message from ${candidate.userId} in ${where}` });
  const { ownTaggedTs, witnessUserId } = verdict.thread;
  await handOff({
    line: {
      activation: candidate.activatesFor !== undefined,
      channel: candidate.channel,
      kind: "witness",
      messageTs: candidate.messageTs,
      ownThread: ownTaggedTs !== undefined,
      text: candidate.text,
      threadTs: candidate.threadTs,
      userId: candidate.userId,
      ...(witnessUserId === undefined ? {} : { witnessUserId }),
    },
    policy,
  });
  return true;
}

/**
 * Build the tap for one listen run.
 *
 * @param policy what every frame is judged against
 * @returns the tap, holding its own dedupe window — keyed on the message, so a redelivery and a second event
 *   naming the same message are both judged once — for the run's whole life
 */
export function createWitnessTap({ policy }: { policy: WitnessTapPolicy }): WitnessTap {
  let seen: DedupeState = createDedupeState();
  return {
    frame: async ({ text }) => {
      const frame = parseSocketFrame({ text });
      if (frame.kind !== "event") {
        return;
      }
      const parsed = parseWitnessEvent({
        event: frame.event,
        eventType: frame.eventType,
        selfBotId: policy.selfBotId,
        selfUserId: policy.selfUserId,
        witnessUserIds: policy.witnessUserIds,
      });
      if (parsed.kind === "skip") {
        return;
      }
      const { candidate } = parsed;
      if (!mentionInScope({ mention: { channel: candidate.channel, surface: "channel" }, scope: policy.scope })) {
        return;
      }
      const admitted = admitEvent({ key: dedupeKeyFor({ mention: candidate }), state: seen });
      if (admitted.duplicate) {
        return;
      }
      // Remembered only once judged durably: a failed save must leave a later delivery of this message able
      // to retry it.
      if (await judge({ candidate, handOffWanted: !addressedToUs({ frame, policy }), policy })) {
        seen = admitted.state;
      }
    },
  };
}

/**
 * Wrap a connection so every frame ALSO reaches the tap, after the address loop has finished with it.
 *
 * @param connection the live connection
 * @param tap the run's tap
 * @returns the same connection, its frames tapped
 */
export function witnessingConnection({
  connection,
  tap,
}: {
  connection: SocketConnection;
  tap: WitnessTap;
}): SocketConnection {
  return {
    acknowledge: (args) => {
      connection.acknowledge(args);
    },
    cancel: async (args) => connection.cancel(args),
    close: async (args) => connection.close(args),
    discarded: () => connection.discarded(),
    endedBecause: () => connection.endedBecause(),
    frames: async function* tapped() {
      for await (const text of connection.frames()) {
        // `finally`, so the frame is still witnessed when the consumer stops pulling right after it.
        try {
          yield text;
        } finally {
          await tap.frame({ text });
        }
      }
    },
  };
}
