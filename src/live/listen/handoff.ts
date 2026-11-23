/**
 * The handoff shape a captured mention becomes for the visible turn flow — shared by the socket listener
 * and scheduled recovery, so a survivor from either path reaches `/slopweaver:loop` in exactly one shape.
 */
import type { AskIdentity } from "../ask/identity.js";
import type { Mention } from "./mention.js";

/**
 * The mention, as the emit handoff prints it.
 *
 * Exported and named rather than assembled inline, because it is a CONTRACT between two processes: this
 * verb writes it and `/slopweaver:loop` parses it. `replyTarget` is the field that makes the handoff whole —
 * every downstream verb takes a channel and a thread, and pre-resolving them here means the session never
 * has to work out where a reply goes, and so cannot get it right in one place and wrong in another.
 */
export interface EmittedMention extends AskIdentity {
  readonly userId: string;
  readonly surface: "channel" | "dm";
  /** The message with every Slack tag normalised to `@(id)` — what the person asked, ids never dropped. */
  readonly text: string;
  /** Channel + thread, pre-joined: what every reply verb needs, resolved once. */
  readonly replyTarget: { readonly channel: string; readonly threadTs: string };
  /**
   * The capture-time checklist `withCapturedChecklist` (see `capture.ts`) already posted, when it did.
   *
   * Pass BOTH fields straight through to `slopweaver turn brief --turn-id --working-ts` so the answer step
   * advances this message instead of posting a second one. Absent when the post failed or was never
   * attempted — `turn brief` then falls back to posting its own working message, unchanged.
   */
  readonly started?: { readonly turnId: string; readonly workingTs: string };
}

/**
 * Shape one mention for the handoff. Pure.
 *
 * @param mention the mention the transport parsed
 * @returns the value printed to stdout for the calling session to consume
 */
export function emittedMention({ mention }: { mention: Mention }): EmittedMention {
  return {
    channel: mention.channel,
    messageTs: mention.messageTs,
    replyTarget: { channel: mention.channel, threadTs: mention.threadTs },
    surface: mention.surface,
    text: mention.text,
    threadTs: mention.threadTs,
    userId: mention.userId,
    ...(mention.started === undefined ? {} : { started: mention.started }),
  };
}
