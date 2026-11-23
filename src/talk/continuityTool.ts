/**
 * Continuity as the voice's `recent_steers` tool and `talk recent --json` hand it over: every passage clipped, then
 * cut to a byte cap with a count of what was left out of each half. Pure; what the read carries is `./continuity.ts`.
 */
import { continuityForStorage, type TalkContinuity } from "./continuity.js";

/** The most `talk recent --json` prints, in UTF-8 bytes; the console's tool cap is 24 KiB. */
export const CONTINUITY_MAX_BYTES = 20 * 1024;

/** The read as the voice's tool is handed it: bounded, with how many entries of each half were cut. */
export interface ContinuityForTool extends TalkContinuity {
  /** Entries left out to fit the cap, oldest first — never zero-filled when nothing was cut. */
  readonly notShown: {
    readonly calls: number;
    readonly steers: number;
    readonly rulings: number;
    readonly knowledge: number;
    readonly typed: number;
  };
}

/**
 * The read cut to fit the tool cap: every passage clipped, then the oldest entry of the longest half dropped
 * until it fits, each drop counted so the voice says "and N more" rather than reading a cut list as whole. A call
 * loses its oldest lines, counted in its own `linesCut`, before it is dropped whole.
 *
 * @param continuity the read
 * @param maxBytes the cap
 * @returns the bounded read
 */
export function continuityForTool({
  continuity,
  maxBytes,
}: {
  continuity: TalkContinuity;
  maxBytes: number;
}): ContinuityForTool {
  const clipped = continuityForStorage({ continuity });
  const halves = {
    calls: [...clipped.calls],
    knowledge: [...clipped.knowledge],
    rulings: [...clipped.rulings],
    steers: [...clipped.steers],
    typed: [...clipped.typed],
  };
  const notShown = { calls: 0, knowledge: 0, rulings: 0, steers: 0, typed: 0 };
  const sizeOf = (): number => Buffer.byteLength(JSON.stringify({ ...clipped, ...halves, notShown }), "utf8");
  while (sizeOf() > maxBytes) {
    const longest = (["steers", "typed", "calls", "rulings", "knowledge"] as const).toSorted(
      (a, b) => halves[b].length - halves[a].length,
    )[0]!;
    if (halves[longest].length === 0) {
      break;
    }
    // The oldest call left is cut a line at a time, oldest line first, before the whole call goes: its last
    // words are the ones a dropped call would otherwise lose.
    const oldestCall = halves.calls.at(-1);
    if (longest === "calls" && oldestCall !== undefined && oldestCall.lines.length > 1) {
      halves.calls[halves.calls.length - 1] = {
        ...oldestCall,
        lines: oldestCall.lines.slice(1),
        linesCut: oldestCall.linesCut + 1,
      };
      continue;
    }
    halves[longest].pop();
    notShown[longest] += 1;
  }
  return { ...clipped, ...halves, notShown };
}
