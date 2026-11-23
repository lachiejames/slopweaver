/*
 * The voice stage's controls: which it draws, the word each is named by, which are pressed or inert, and where each
 * sits — the call's along the bottom bar, the way out in the corner — plus hang-up's red, measured.
 */
import { describe, expect, it } from "vitest";

import { contrastRatio, oklchToSrgbOnDisplayP3, parseOklch, srgbContrastRatio } from "../../lib/colorContrast";
import { HANG_UP_FILL, stageControlsOf, stageRailOf } from "../../lib/stageRail";

const CALL = {
  callActive: true,
  hasLive: true,
  muted: false,
  preview: false,
  screenSight: "share",
  sharing: undefined,
} as const;

const AUDIO = { id: "audio", inert: false, pressed: undefined, word: "microphone and speaker" } as const;
const CORNER = { id: "collapse", inert: false, pressed: undefined, word: "move to the corner" } as const;

describe("stageRailOf", () => {
  it("draws a live call's controls in order, mute and the screen unpressed", () => {
    expect(stageRailOf(CALL)).toEqual([
      { id: "mute", inert: false, pressed: false, word: "mute" },
      { id: "screen", inert: false, pressed: false, word: "look at my screen" },
      { id: "end", inert: false, pressed: undefined, word: "hang up" },
      CORNER,
    ]);
  });

  it("names mute by what a press does, and presses it while muted", () => {
    expect(stageRailOf({ ...CALL, muted: true }).at(0)).toEqual({
      id: "mute",
      inert: false,
      pressed: true,
      word: "unmute",
    });
  });

  it("presses the screen control while a share is open, even where the app looks natively", () => {
    expect(stageRailOf({ ...CALL, screenSight: "native", sharing: "Entire Screen" }).at(1)).toEqual({
      id: "screen",
      inert: false,
      pressed: true,
      word: "stop showing screen",
    });
  });

  it("draws no screen control in the desktop app with no share open", () => {
    expect(stageRailOf({ ...CALL, screenSight: "native" }).map((control) => control.id)).toEqual([
      "mute",
      "end",
      "collapse",
    ]);
  });
});

describe("stageControlsOf", () => {
  it("puts a live call's controls along the bottom, chevron first and hang-up last, and the way out in the corner", () => {
    expect(stageControlsOf(CALL)).toEqual({
      bar: [
        AUDIO,
        { id: "mute", inert: false, pressed: false, word: "mute" },
        { id: "screen", inert: false, pressed: false, word: "look at my screen" },
        { id: "end", inert: false, pressed: undefined, word: "hang up" },
      ],
      corner: CORNER,
    });
  });

  it("presses mute on the bar while muted, named by what a press does", () => {
    expect(stageControlsOf({ ...CALL, muted: true }).bar.at(1)).toEqual({
      id: "mute",
      inert: false,
      pressed: true,
      word: "unmute",
    });
  });

  it("draws mute straight beside hang-up in the desktop app with no share open", () => {
    expect(stageControlsOf({ ...CALL, screenSight: "native" }).bar.map((control) => control.id)).toEqual([
      "audio",
      "mute",
      "end",
    ]);
  });

  it("keeps the chevron, the screen and hang-up before the call has its live session, with no mute", () => {
    expect(stageControlsOf({ ...CALL, hasLive: false }).bar.map((control) => control.id)).toEqual([
      "audio",
      "screen",
      "end",
    ]);
  });

  it("draws an empty bar and only the corner with no call and no preview", () => {
    expect(stageControlsOf({ ...CALL, callActive: false, hasLive: false })).toEqual({ bar: [], corner: CORNER });
  });

  it("draws a call's controls inert in a preview, leaving the chevron's pickers and the corner live", () => {
    const controls = stageControlsOf({ ...CALL, callActive: false, hasLive: false, preview: true });
    expect(controls.bar.map((control) => [control.id, control.inert])).toEqual([
      ["audio", false],
      ["mute", true],
      ["screen", true],
      ["end", true],
    ]);
    expect(controls.corner).toEqual({ id: "collapse", inert: false, pressed: undefined, word: "close preview" });
  });
});

describe("HANG_UP_FILL", () => {
  const white = parseOklch({ value: "oklch(1 0 0)" });
  const red = parseOklch({ value: HANG_UP_FILL });

  it("carries a white glyph at 4.5:1 or better on an sRGB screen", () => {
    expect(contrastRatio({ background: red, foreground: white })).toBeGreaterThanOrEqual(4.5);
  });

  it("carries a white glyph at 4.5:1 or better on a Display P3 screen", () => {
    expect(
      srgbContrastRatio({
        background: oklchToSrgbOnDisplayP3({ color: red }),
        foreground: oklchToSrgbOnDisplayP3({ color: white }),
      }),
    ).toBeGreaterThanOrEqual(4.5);
  });
});
