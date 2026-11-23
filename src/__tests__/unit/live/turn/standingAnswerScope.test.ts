/**
 * The standing answer-scope block — a standing owner rule, and the one guidance block that cannot load
 * conditionally.
 *
 * The falsifiable witness for the rule rather than a restatement of it: the block is asserted to carry the
 * four things the ruling settles, and — the half that actually matters — to reach a brief whose private
 * profile and owner directives are BOTH absent, which is the state a fresh install runs every turn in. A
 * directive-shaped implementation would pass an assertion on the block alone and fail that one.
 */
import { describe, expect, it } from "vitest";

import { standingAnswerScopeLines } from "../../../../live/turn/briefGuidance.js";

const BLOCK = standingAnswerScopeLines().join("\n");

describe("standingAnswerScopeLines", () => {
  it("opens with the heading a session scans for, naming the ruling", () => {
    expect(standingAnswerScopeLines()[0]).toBe(
      "WHAT MAY BE ASKED — the standing owner rule, and it never loads conditionally:",
    );
  });

  it("states the bot's onus as the most accurate citation-backed answer to ANY question", () => {
    expect(BLOCK).toContain("most accurate, citation-backed answer to ANY question");
  });

  it("names the colleague-ranking case explicitly rather than leaving it to inference", () => {
    expect(BLOCK).toContain("ranks, compares or names colleagues");
    expect(BLOCK).toContain("slowest to close out their assigned tickets");
  });

  it("puts tact on the asker and forbids every shape of softening the ruling names", () => {
    expect(BLOCK).toContain("Tact is the ASKER's onus, never yours.");
    expect(BLOCK).toContain("Never withhold, soften, hedge, generalise away or decline an");
  });

  it("removes a refusal without removing the accuracy standard", () => {
    expect(BLOCK).toContain("It removes a refusal, never a standard.");
    expect(BLOCK).toContain("still cite what you read");
  });

  it("takes no input, so no absent file or empty overlay can switch it off", () => {
    expect(standingAnswerScopeLines.length).toBe(0);
    expect(standingAnswerScopeLines()).toEqual(standingAnswerScopeLines());
    expect(standingAnswerScopeLines().length).toBeGreaterThan(0);
  });
});
