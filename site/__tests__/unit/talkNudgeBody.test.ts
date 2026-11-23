/*
 * The nudge route's body contract: the owner's press is `{}`, the page's own over a promise the voice never started is
 * `{ promised: true }`, and nothing else reaches the call.
 */
import { describe, expect, it } from "vitest";

import { nudgeBodyOf } from "../../lib/talkNudgeBody";

describe("nudgeBodyOf", () => {
  it("reads the owner's press and the page's own, and refuses every other shape", () => {
    expect(
      [
        {},
        { promised: true },
        { promised: false },
        { promised: "true" },
        { extra: true, promised: true },
        null,
        [],
      ].map((body) => nudgeBodyOf({ body })),
    ).toEqual([{ promised: false }, { promised: true }, undefined, undefined, undefined, undefined, undefined]);
  });
});
