import { describe, expect, it } from "vitest";

import { runVoiceStart, voiceStartOffered } from "../../lib/voiceStart";

describe("runVoiceStart", () => {
  it("opens nothing in a browser tab, which has no route", () => {
    const opened: string[] = [];
    runVoiceStart({
      route: undefined,
      startHere: async () => {
        opened.push("here");
      },
    });
    expect(opened).toEqual([]);
  });

  it("opens the call here in the desktop overlay", () => {
    const opened: string[] = [];
    runVoiceStart({
      route: { kind: "local" },
      startHere: async () => {
        opened.push("here");
      },
    });
    expect(opened).toEqual(["here"]);
  });

  it("hands the start to the overlay from the desktop console window, never opening one here", () => {
    const opened: string[] = [];
    runVoiceStart({
      route: {
        kind: "elsewhere",
        run: () => {
          opened.push("overlay");
        },
      },
      startHere: async () => {
        opened.push("here");
      },
    });
    expect(opened).toEqual(["overlay"]);
  });
});

describe("voiceStartOffered", () => {
  it("offers no start in a browser tab, which has no route", () => {
    expect(voiceStartOffered({ callActiveAnywhere: false, canStart: false })).toBe(false);
  });

  it("offers a start where one can go and no call is up", () => {
    expect(voiceStartOffered({ callActiveAnywhere: false, canStart: true })).toBe(true);
  });

  it("offers no start while a call is up here or in the overlay", () => {
    expect(voiceStartOffered({ callActiveAnywhere: true, canStart: true })).toBe(false);
  });
});
