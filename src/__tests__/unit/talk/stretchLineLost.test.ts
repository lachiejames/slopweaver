/**
 * `stretchLineLost` — the one rule the card fold and the `talk-call:` stretch check both apply to each line of a
 * stretch, so a line either may hold words the winner lost, or it does not.
 */
import { describe, expect, it } from "vitest";

import { CALL_TEXT_CHARS, OWNER_SPEAKER } from "../../../talk/callRecord.js";
import { stretchLineLost } from "../../../talk/stretchLineLost.js";

const WINNER = { text: "yes, send it", who: OWNER_SPEAKER } as const;

describe("stretchLineLost", () => {
  it("keeps a snapshot the winner prints and the winner's own final", () => {
    expect([
      stretchLineLost({ line: { final: false, text: "yes, send", who: OWNER_SPEAKER }, winner: WINNER }),
      stretchLineLost({ line: { final: true, text: "yes, send it", who: OWNER_SPEAKER }, winner: WINNER }),
    ]).toEqual([false, false]);
  });

  it("reads as lost a take-back, a second final saying other words, another speaker's line and a capped line", () => {
    expect([
      stretchLineLost({ line: { final: false, text: "yes, send it, no wait", who: OWNER_SPEAKER }, winner: WINNER }),
      stretchLineLost({ line: { final: true, text: "yes, send", who: OWNER_SPEAKER }, winner: WINNER }),
      stretchLineLost({ line: { final: false, text: "yes, send", who: "voice" }, winner: WINNER }),
      stretchLineLost({
        line: { final: false, text: "y".repeat(CALL_TEXT_CHARS), who: OWNER_SPEAKER },
        winner: WINNER,
      }),
    ]).toEqual([true, true, true, true]);
  });
});
