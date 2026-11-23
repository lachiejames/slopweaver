/*
 * The voice's sticky window state: the middle by default, a fold and a lifted region shown without being stored, and the
 * orb's press.
 */
import { describe, expect, it } from "vitest";

import {
  DEFAULT_VOICE_WINDOW_STATE,
  isVoiceWindowState,
  VOICE_WINDOW_STORAGE_KEY,
  type VoiceWindowState,
  voiceViewOf,
  voiceWindowDrawing,
  voiceWindowOnOrb,
  voiceWindowShown,
} from "../../lib/voiceWindow";

const STATES: readonly VoiceWindowState[] = ["minimised", "middle", "fullscreen"];

describe("the window state's preference", () => {
  it("opens in the middle, under its own key", () => {
    expect(DEFAULT_VOICE_WINDOW_STATE).toBe("middle");
    expect(VOICE_WINDOW_STORAGE_KEY).toBe("slopweaver.talk.windowState");
  });

  it("accepts the three states and nothing else, the old stage-start values included", () => {
    expect(STATES.map((state) => isVoiceWindowState(state))).toEqual([true, true, true]);
    expect([isVoiceWindowState("stage"), isVoiceWindowState("corner"), isVoiceWindowState(undefined)]).toEqual([
      false,
      false,
      false,
    ]);
  });
});

describe("voiceWindowShown", () => {
  it("draws the stored state when nothing holds it folded", () => {
    expect(STATES.map((stored) => voiceWindowShown({ focusLit: false, folded: false, stored }))).toEqual([...STATES]);
  });

  it("draws the orb alone while a fold or a lifted region holds it, whatever is stored", () => {
    expect(STATES.map((stored) => voiceWindowShown({ focusLit: false, folded: true, stored }))).toEqual([
      "minimised",
      "minimised",
      "minimised",
    ]);
    expect(STATES.map((stored) => voiceWindowShown({ focusLit: true, folded: false, stored }))).toEqual([
      "minimised",
      "minimised",
      "minimised",
    ]);
  });
});

describe("voiceWindowOnOrb", () => {
  it("opens the orb alone onto the middle, and closes the card or the stage to the orb alone", () => {
    expect(voiceWindowOnOrb({ shown: "minimised", stored: "minimised" })).toBe("middle");
    expect(voiceWindowOnOrb({ shown: "middle", stored: "middle" })).toBe("minimised");
    expect(voiceWindowOnOrb({ shown: "fullscreen", stored: "fullscreen" })).toBe("minimised");
  });

  it("brings back what a fold hid, full screen included", () => {
    expect(voiceWindowOnOrb({ shown: "minimised", stored: "middle" })).toBe("middle");
    expect(voiceWindowOnOrb({ shown: "minimised", stored: "fullscreen" })).toBe("fullscreen");
  });

  it("opens and closes on press after press", () => {
    const seen: VoiceWindowState[] = [];
    let stored: VoiceWindowState = "minimised";
    for (let press = 0; press < 4; press += 1) {
      stored = voiceWindowOnOrb({ shown: stored, stored });
      seen.push(stored);
    }
    expect(seen).toEqual(["middle", "minimised", "middle", "minimised"]);
  });
});

describe("voiceViewOf", () => {
  it("draws full screen on the stage and the rest in the corner", () => {
    expect(STATES.map((shown) => voiceViewOf({ shown }))).toEqual(["corner", "corner", "stage"]);
  });
});

describe("voiceWindowDrawing", () => {
  it("draws the card in a corner the shell has not grown whole, and nothing display-spanning", () => {
    expect(voiceWindowDrawing({ covers: false, shown: "middle", staged: false })).toStrictEqual({
      cardDrawn: true,
      stageDrawn: false,
      wholeReady: false,
    });
  });

  it("draws the card under a shell that keeps the window whole", () => {
    expect(voiceWindowDrawing({ covers: true, shown: "middle", staged: false })).toStrictEqual({
      cardDrawn: true,
      stageDrawn: false,
      wholeReady: true,
    });
  });

  it("holds the stage until the shell answers that the window is whole", () => {
    expect(voiceWindowDrawing({ covers: false, shown: "fullscreen", staged: true })).toStrictEqual({
      cardDrawn: false,
      stageDrawn: false,
      wholeReady: false,
    });
  });

  it("draws the stage, and no card, once the window is whole", () => {
    expect(voiceWindowDrawing({ covers: true, shown: "fullscreen", staged: true })).toStrictEqual({
      cardDrawn: false,
      stageDrawn: true,
      wholeReady: true,
    });
  });

  it("draws neither card nor stage, minimised", () => {
    expect(voiceWindowDrawing({ covers: false, shown: "minimised", staged: false })).toStrictEqual({
      cardDrawn: false,
      stageDrawn: false,
      wholeReady: false,
    });
  });
});
