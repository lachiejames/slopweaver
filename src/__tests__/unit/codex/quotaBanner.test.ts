/**
 * {@link detectExhaustionBanner} — the two real exhaustion shapes captured live, plus the false
 * positive this module exists to avoid: the weekly-limit bar renders as ordinary chrome at every percentage.
 */
import { describe, expect, it } from "vitest";
import { detectExhaustionBanner } from "../../../codex/quotaBanner.js";

describe("detectExhaustionBanner", () => {
  it("detects the real credits-out banner reproduced live via codex exec", () => {
    const screen =
      "OpenAI Codex v0.145.0\n--------\nsession id: 019ffe97\n--------\nERROR: Your workspace is out of credits. " +
      "Ask your workspace owner to refill in order to continue.";

    expect(detectExhaustionBanner({ text: screen })).toBe("credits-out");
  });

  it("detects the real weekly-limit banner at 0% left, quoted verbatim in the handover doc", () => {
    const screen = "Weekly limit: [░░░░░░░░░░░░░░░░░░░░] 0% left (resets 10:25 on 18 Aug 2026)";

    expect(detectExhaustionBanner({ text: screen })).toBe("window-limit");
  });

  it("does NOT flag a healthy weekly-limit bar showing spare capacity", () => {
    const screen = "Weekly limit: [██████████░░░░░░░░░░] 45% left";

    expect(detectExhaustionBanner({ text: screen })).toBeUndefined();
  });

  it("does not flag a plain boot banner with neither exhaustion shape present", () => {
    const screen = "OpenAI Codex v0.145.0\n--------\nworkdir: /tmp\nmodel: gpt-5.6-sol\n--------";

    expect(detectExhaustionBanner({ text: screen })).toBeUndefined();
  });

  it("does not flag an empty screen", () => {
    expect(detectExhaustionBanner({ text: "" })).toBeUndefined();
  });

  it("prefers credits-out when both banners somehow appear on the same screen", () => {
    const screen = "Weekly limit: [░░░░░░░░░░░░░░░░░░░░] 0% left\nYour workspace is out of credits.";

    expect(detectExhaustionBanner({ text: screen })).toBe("credits-out");
  });
});

describe("the two exhaustion sentences are told apart, not merged", () => {
  // One `codex_error_info` covers both, and only the wording separates them. Codex's own reached types split
  // the same 93 events 85/8 the same way, which is what makes this a reading rather than a choice.
  it("reads the workspace spend cap as a usage limit", () => {
    const text =
      "You hit your spend cap set by the owner of your workspace. Ask an owner to increase your spend cap to continue.";

    expect(detectExhaustionBanner({ text })).toBe("usage-limit");
  });

  it("still reads the out-of-credits sentence as credits-out", () => {
    const text = "Your workspace is out of credits. Ask your workspace owner to refill in order to continue.";

    expect(detectExhaustionBanner({ text })).toBe("credits-out");
  });
});
