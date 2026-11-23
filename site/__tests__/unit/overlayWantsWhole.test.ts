/**
 * When the desktop overlay covers the whole display: only for what is drawn across it. The orb, the open messenger
 * and a call keep to the corner, since a whole-display window is what ⌘⇧5's window picker selected wherever the owner
 * pointed.
 */
import { describe, expect, it } from "vitest";

import { overlayWantsWhole } from "../../lib/desktopShellOverlay";
import { edgeGlowOf } from "../../lib/edgeGlow";
import type { VoicePhase } from "../../lib/voiceActivity";

describe("overlayWantsWhole", () => {
  const nothing = { edgeInOverlay: false, focusShown: false, landing: false, staged: false };

  it("lets the corner be the window for the orb, the open messenger and a call, whose glow the shell's strips draw", () => {
    expect(overlayWantsWhole(nothing)).toBe(false);
  });

  it("holds the whole display through every turn while the page draws the glow itself, under an older shell", () => {
    const turns: readonly VoicePhase[] = ["listening", "speaking", "working", "speaking", "listening"];
    const glows = turns.map((phase) => edgeGlowOf({ callActive: true, phase, sharing: false }));
    expect(glows).toEqual(["off", "speaking", "off", "speaking", "off"]);
    expect(glows.map(() => overlayWantsWhole({ ...nothing, edgeInOverlay: true }))).toEqual([
      true,
      true,
      true,
      true,
      true,
    ]);
  });

  it("holds it for the stage, the screen-focus frame and the orb landing from the stage", () => {
    expect([
      overlayWantsWhole({ ...nothing, staged: true }),
      overlayWantsWhole({ ...nothing, focusShown: true }),
      overlayWantsWhole({ ...nothing, landing: true }),
    ]).toEqual([true, true, true]);
  });
});
