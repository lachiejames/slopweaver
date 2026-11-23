/**
 * What `supervisor tick close` prints LAST when the chair's cadence says hand off: the hand-off itself, in place of
 * the sweep prompt the chair would otherwise re-arm.
 *
 * MEASURED: a chair on plan-one recorded a tick with its own captured gauge reading
 * plan-one at 97% of its Fable week while
 * plan-two, plan-three and plan-four sat at 0 to 2%. The cadence that would have said HAND OFF ran only in
 * `tick-record`, which no sweep calls any more, and `tick close` printed the re-arm prompt as it did every tick.
 * Within the hour the plan was at 100%, the chat stopped sending, and the owner logged the seat in by hand. A block printed
 * beside a prompt that still re-arms is a block the chair can arm past; this prompt REPLACES the re-arm, so the
 * default next act is the hand-off, and a chair that arms it anyway wakes into the hand-off again.
 *
 * Advisory still: the tick is recorded and the close exits 0 (the owner took the hard block away).
 * Where no host can take the successor (`./chairSuccessor.ts`) the sweep prompt stands, under one line naming
 * why, because a hand-off with nowhere to land stops the sweep and moves nothing.
 *
 * Pure: the verdict, the successor's target and the seat's handoff in, the prompt out.
 */
import type { ChairCadenceVerdict } from "./chairCadence.js";
import { reasonLine } from "./chairCadenceLines.js";
import { type ChairSuccessorTarget, type SeatableSuccessor, successorSpawnLine } from "./chairSuccessor.js";

/**
 * The successor's handover slug: the seat's `handoff-<n>`, one on.
 *
 * @param handoff the seat's handoff, `handoff-<digits>`
 * @returns `fresh-supervisor-handoff-<n+1>`, or the placeholder when the name carries no number
 */
export function successorSlugOf({ handoff }: { handoff: string }): string {
  const match = /^handoff-(\d+)$/u.exec(handoff);
  if (match === null) {
    return "fresh-supervisor-handoff-<next>";
  }
  return `fresh-supervisor-handoff-${String(Number(match[1]) + 1)}`;
}

/** What the cadence decided this close: nothing to hand off, or a hand-off with the host its successor boots on. */
export type ClosePromptCadence =
  | { readonly kind: "stay" }
  | {
      readonly kind: "hand-off";
      readonly verdict: Extract<ChairCadenceVerdict, { kind: "hand-off" }>;
      readonly target: ChairSuccessorTarget;
    };

/**
 * The prompt a close prints LAST: the hand-off when the cadence says go and a host can take the successor, the
 * sweep prompt otherwise. An event-woken chair re-arms no sweep, so it passes none: a stay then prints nothing, and
 * a hand-off no host can take prints its warning alone.
 *
 * @param cadence what the cadence decided, with the successor's target on a hand-off
 * @param handoff the seat's handoff, which names the successor's slug
 * @param sweepPrompt the prompt a staying chair re-arms, undefined when an event-woken chair arms none
 * @returns the prompt to print last, undefined when there is none, and whether it is the hand-off
 */
export function closePromptOf({
  cadence,
  handoff,
  sweepPrompt,
}: {
  cadence: ClosePromptCadence;
  handoff: string;
  sweepPrompt: string | undefined;
}): { prompt: string | undefined; handOff: boolean } {
  if (cadence.kind === "stay") {
    return { handOff: false, prompt: sweepPrompt };
  }
  const { target, verdict } = cadence;
  if (target.kind === "none") {
    const warning = `HAND-OFF TARGET UNAVAILABLE — ${target.why}`;
    if (sweepPrompt === undefined) {
      return { handOff: false, prompt: warning };
    }
    return { handOff: false, prompt: `${warning}\n${sweepPrompt}` };
  }
  const slug = successorSlugOf({ handoff });
  return {
    handOff: true,
    prompt: [
      "HAND OFF NOW — do NOT re-arm the sweep from this chair. Its own measurements say seat a successor now:",
      ...verdict.reasons.map((reason) => `  - ${reasonLine({ reason })}`),
      `1. Write the successor's handover doc \`${slug}\` (the next free number, if a failed attempt already took it) exactly as skills/supervisor/reference/briefing-contract.md § Successor handoff says: front matter \`role: supervisor\`, opening with the /slopweaver:supervisor Skill invocation, the § 7 sweep arming and \`slopweaver cmux takeover\`.`,
      `2. \`${successorSpawnLine({ slug, target })}\` — ${spawnWitness({ target })}`,
      "3. Leave the pin and the sweep to the successor. If the spawn refuses, arm THIS prompt rather than the sweep, so the next wake tries the hand-off again.",
    ].join("\n"),
  };
}

/**
 * What the spawn line's own output proves, per host.
 *
 * @param target the host the successor boots on
 * @returns the sentence after the command
 */
function spawnWitness({ target }: { target: SeatableSuccessor }): string {
  if (target.kind === "codex") {
    return "routing ranks every registered Codex plan and never seats one at its usage limit; its `codex seat on <alias>` line names which.";
  }
  return "routing lands it on the plan furthest below its Fable level line and never on a spent one, the chair's own plan included when it is the only one; its `claude routing:` line names which, and `slopweaver claude gauge`'s `chair:` line is the successor's witness.";
}
