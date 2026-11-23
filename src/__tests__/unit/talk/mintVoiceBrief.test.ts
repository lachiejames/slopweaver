/**
 * What a call's delegated model is minted with of the owner's voice rules, in each of the three states. The rules here are
 * synthetic; the real ones live in an install's profile and never in this repository.
 */
import { describe, expect, it } from "vitest";

import { err, ok } from "../../../lib/result.js";
import { VOICE_RULES_ESCAPE } from "../../../outbound/voice/exactRules.js";
import { MINT_VOICE_BRIEF_MAX_BYTES, mintVoiceBriefOf } from "../../../talk/mintVoiceBrief.js";
import { TALK_BACKEND_INSTRUCTIONS, TALK_VOICE_INSTRUCTIONS } from "../../../talk/sessionConfig.js";

const SHAPE = "Quote the line, then answer it, one at a time.";
const WORD_RULE = { kind: "word", value: "fixtureword" } as const;

describe("mintVoiceBriefOf", () => {
  it("carries the whole brief under a heading that binds the first draft", () => {
    const brief = mintVoiceBriefOf({ brief: ok({ paragraphSpacing: true, rules: [WORD_RULE], shape: SHAPE }) });
    expect(brief.kind).toBe("configured");
    expect(
      brief.block.startsWith("THE OWNER'S VOICE: binding on every word you draft to stand as the owner's own"),
    ).toBe(true);
    expect(brief.block).toContain("ADVISORY below says\nonly that the Slack send refuses none of it");
    expect(brief.block).toContain(SHAPE);
    expect(brief.block).toContain("fixtureword");
    expect(brief.block).toContain("PARAGRAPH SPACING (ENFORCED)");
    expect(brief.block).toContain("PARKED DRAFT SHAPE");
    expect(brief.block).toContain(VOICE_RULES_ESCAPE);
    expect(brief.bytes).toBe(Buffer.byteLength(brief.block, "utf8"));
  });

  it.each([
    ["a shape alone", { paragraphSpacing: false, rules: [], shape: SHAPE }],
    ["a rule alone", { paragraphSpacing: false, rules: [WORD_RULE], shape: null }],
    ["spacing alone", { paragraphSpacing: true, rules: [], shape: null }],
  ])("is configured by %s", (_name, value) => {
    expect(mintVoiceBriefOf({ brief: ok(value) }).kind).toBe("configured");
  });

  it("says none is configured when none is, and that a draft is unbriefed", () => {
    const block =
      "THE OWNER'S VOICE: none configured on this install. Any draft as the owner is unbriefed; say so to the owner in one short line.";
    expect(mintVoiceBriefOf({ brief: ok({ paragraphSpacing: false, rules: [], shape: null }) })).toEqual({
      block,
      bytes: Buffer.byteLength(block, "utf8"),
      kind: "unconfigured",
    });
  });

  // The header's one worse answer: a profile that cannot be read becoming "the owner has no rules".
  it("says a failed read is a failed read, never that none is configured, and carries the reason", () => {
    const brief = mintVoiceBriefOf({ brief: err(["profile.json: bad", "shape: gone"]) });
    const block =
      "THE OWNER'S VOICE: the owner's voice rules could not be read for this call, so none of them are here. That does not mean the owner " +
      "has none. Any draft as the owner is unbriefed; say so to the owner in one short line.";
    expect(brief).toEqual({
      block,
      bytes: Buffer.byteLength(block, "utf8"),
      kind: "broken",
      why: "profile.json: bad; shape: gone",
    });
  });

  it("carries none of a brief past its budget, rather than a part of it that would read as the whole", () => {
    const shape = `${SHAPE}\n${"x".repeat(MINT_VOICE_BRIEF_MAX_BYTES)}`;
    const brief = mintVoiceBriefOf({ brief: ok({ paragraphSpacing: false, rules: [], shape }) });
    expect(brief.kind).toBe("broken");
    expect(brief.block).not.toContain(SHAPE);
    expect(brief.block).toContain("That does not mean the owner has none");
  });

  it("carries a brief exactly at the budget, and refuses one byte past it", () => {
    const fitted = ({ extra }: { extra: number }) => {
      const base = mintVoiceBriefOf({ brief: ok({ paragraphSpacing: false, rules: [], shape: "" }) }).bytes;
      const shape = "x".repeat(MINT_VOICE_BRIEF_MAX_BYTES - base + extra);
      return mintVoiceBriefOf({ brief: ok({ paragraphSpacing: false, rules: [], shape }) });
    };
    expect([fitted({ extra: 0 }).kind, fitted({ extra: 1 }).kind]).toEqual(["configured", "broken"]);
    expect(fitted({ extra: 0 }).bytes).toBe(MINT_VOICE_BRIEF_MAX_BYTES);
  });
});

// A measured call: the first draft as the owner was written with no rule read.
describe("the prompts' half of the brief", () => {
  it("tells the thinking model the voice block binds the first draft, and leaves the voice's prompt alone", () => {
    expect(TALK_BACKEND_INSTRUCTIONS).toContain("Its FIRST draft obeys the voice-rules block in your context.");
    expect(TALK_VOICE_INSTRUCTIONS).not.toMatch(/\b(?:his|her|their) voice:/iu);
  });
});
