/**
 * `slopweaver listen` — the EMIT-ONLY handler and its deadline-mode stdout shapes.
 *
 * Split out of {@link ./run.js} (the file-size ratchet, step 2). There is deliberately no branch here that
 * could answer — see {@link ./run.js}'s own header, "The handler EMITS; it no longer answers, and cannot".
 */

import { type EmittedMention, emittedMention } from "../../../live/listen/handoff.js";
import type { MentionHandler } from "../../../live/listen/mention.js";

/**
 * A Slack address, as deadline mode's discriminated stdout emits it — {@link EmittedMention} plus the
 * discriminator. Only deadline mode ever produces this; without `--deadline-ms`, stdout stays the bare
 * unwrapped {@link EmittedMention} it always was, for byte-for-byte compatibility with every existing caller.
 *
 * @internal — documents the shape `emitOnly` prints; no caller names the type itself.
 */
export interface SlackAddressWake extends EmittedMention {
  readonly kind: "slack-address";
}

/** The clock winning a deadline race — deadline mode's other possible stdout object. Carries no turn content. */
export interface ClockWake {
  readonly kind: "clock-wake";
  readonly deadlineMs: number;
}

/**
 * Deadline mode's stdout contract: exactly one of these two, discriminated by `kind`.
 *
 * @internal — documents the contract; no caller names the union itself.
 */
export type DeadlineListenOutput = SlackAddressWake | ClockWake;

/**
 * EMIT-ONLY — capture one addressed mention, print it, answer nothing.
 *
 * ## This is the whole seam the supervisor loop needed
 *
 * The listener already does the hard parts correctly: Socket Mode, redelivery dedupe on `payload.event_id`,
 * single-consumer serialisation, and the addressed/not-addressed rules. The only thing wrong with it was
 * that it ANSWERED — via `turnHandler` over a `claudeCliClient`, which spawns a DETACHED `claude -p` child.
 * So every answer it ever gave came from a headless model running outside any session the owner could see,
 * interrupt or account for.
 *
 * Making it stop is the entire change. What comes out is one JSON object; what does the turn is the visible
 * agent session that ran this command. There is no model on this path, and no code here that could
 * acquire one — the composing verb (`turn answer`) has none either, and grounds a payload the session wrote.
 *
 * ## Capture acknowledgement is deliberately not an answer
 *
 * Before this handler runs, {@link ./capturingHandler} seeds the reaction and capture checklist. That post
 * contains no composed content and may therefore happen even in durable capture-only mode. The visible
 * session later advances the same checklist and replaces it with the grounded answer; this handler itself
 * still emits data only.
 *
 * @param json whether to print the mention as JSON (the machine handoff) or as readable lines
 * @param sink where the emitted mention goes; injected so a test can capture it without stdout
 * @param wrapped whether the JSON gets the `{"kind":"slack-address",...}` deadline-mode envelope. Only ever
 *   `true` when `--deadline-ms` was given — see {@link SlackAddressWake} — and irrelevant to the readable-lines
 *   branch, since deadline mode always requires `--json`.
 * @returns the handler the socket loop calls for the one mention it captures
 */
export function emitOnly({
  json,
  sink,
  wrapped = false,
}: {
  json: boolean;
  sink: (args: { line: string }) => void;
  wrapped?: boolean;
}): MentionHandler {
  return (mention) => {
    const emitted = emittedMention({ mention });
    if (json) {
      sink({ line: JSON.stringify(wrapped ? { kind: "slack-address" as const, ...emitted } : emitted) });
    } else {
      for (const line of [
        `from: ${emitted.userId} (${emitted.surface})`,
        `reply in: ${emitted.replyTarget.channel} thread ${emitted.replyTarget.threadTs}`,
        `asked: ${emitted.text}`,
      ]) {
        sink({ line });
      }
    }
    // Resolved, not awaited on anything: emitting IS the handler's whole job. A handler that did more here
    // would be this verb quietly growing back the ability to answer.
    return Promise.resolve();
  };
}
