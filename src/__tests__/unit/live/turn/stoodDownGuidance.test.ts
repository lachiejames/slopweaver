/**
 * The stood-down guidance block: nothing for a thread that never stood the bot down, and the owner's three
 * rulings for one that did, ending on a blank line so the brief's next section starts clean.
 */
import { describe, expect, it } from "vitest";

import { stoodDownLines } from "../../../../live/turn/stoodDownGuidance.js";

describe("stoodDownLines", () => {
  it("prints nothing for a thread that never stood the bot down", () => {
    expect(stoodDownLines({ stoodDown: false })).toEqual([]);
  });

  it("answers a question, gives a steer no-response, and never narrates the stand-down", () => {
    const lines = stoodDownLines({ stoodDown: true });

    expect(lines[0]).toBe(
      "STOOD DOWN — earlier in this thread somebody told the bot it was in the way, and it stood down: it reacted,",
    );
    expect(lines).toContain("  - A genuine question to the bot: answer it, exactly as any tag.");
    expect(lines).toContain(
      "  - A steer, a correction offered as context, or extra context with no question in it: `no-response`, which",
    );
    expect(lines).toContain(
      "  - Never apologise, never mention having stood down, never offer to stay out of the way.",
    );
    expect(lines.at(-1)).toBe("");
  });
});
