/*
 * What a presence is handed about the voice each frame — the owner's voice and the voice's own apart, by the orb's mood — and
 * the budgets and pixel ratio that bound how much it may draw.
 */
import { describe, expect, it } from "vitest";

import { ORB_MOODS } from "../../lib/orbMood";
import {
  MAX_PRESENCE_PIXEL_RATIO,
  PRESENCE_BAND_PROFILE,
  PRESENCE_BUDGETS,
  presencePixelRatio,
  presenceVoiceInputOf,
  withNewest,
} from "../../lib/presenceInput";

const NO_BANDS = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

describe("presenceVoiceInputOf", () => {
  it("reads the voice speaking as its own output, shaped across the bands", () => {
    expect(presenceVoiceInputOf({ level: 0.5, mood: "speaking" })).toEqual({
      bands: [0.5, 0.46, 0.42, 0.37, 0.32, 0.27, 0.22, 0.17, 0.13, 0.09],
      mic: 0,
      output: 0.5,
      turn: "bot",
    });
  });

  it("reads the owner heard, and the owner cutting in, as the owner's voice", () => {
    expect(presenceVoiceInputOf({ level: 1, mood: "hearing" })).toEqual({
      bands: [...PRESENCE_BAND_PROFILE],
      mic: 1,
      output: 0,
      turn: "owner",
    });
    expect(presenceVoiceInputOf({ level: 1, mood: "yielded" }).turn).toBe("owner");
  });

  it("reads work in flight as thinking, until the owner speaks over it", () => {
    expect(presenceVoiceInputOf({ level: 0, mood: "working" })).toEqual({
      bands: NO_BANDS,
      mic: 0,
      output: 0,
      turn: "thinking",
    });
    expect(presenceVoiceInputOf({ level: 0.4, mood: "looking" })).toEqual({
      bands: PRESENCE_BAND_PROFILE.map((share) => share * 0.4),
      mic: 0.4,
      output: 0,
      turn: "owner",
    });
  });

  it("reads every other mood as quiet, whatever level it is handed", () => {
    const quiet = ["off", "connecting", "reconnecting", "idle", "error"] as const;
    expect(quiet.map((mood) => presenceVoiceInputOf({ level: 0.8, mood }))).toEqual(
      quiet.map(() => ({ bands: NO_BANDS, mic: 0, output: 0, turn: "quiet" })),
    );
  });

  it("names a turn for every mood the orb has", () => {
    expect(ORB_MOODS.length).toBeGreaterThan(0);
    expect(
      ORB_MOODS.filter(
        (mood) => !["quiet", "owner", "bot", "thinking"].includes(presenceVoiceInputOf({ level: 0, mood }).turn),
      ),
    ).toEqual([]);
  });

  it("holds a level outside 0 to 1 to its ends", () => {
    expect(presenceVoiceInputOf({ level: 3, mood: "speaking" }).output).toBe(1);
    expect(presenceVoiceInputOf({ level: -1, mood: "hearing" })).toEqual({
      bands: NO_BANDS,
      mic: 0,
      output: 0,
      turn: "owner",
    });
  });
});

describe("the bands", () => {
  it("are ten, falling from low to high", () => {
    expect([...PRESENCE_BAND_PROFILE]).toEqual([1, 0.92, 0.84, 0.74, 0.64, 0.54, 0.44, 0.34, 0.26, 0.18]);
  });
});

describe("PRESENCE_BUDGETS", () => {
  it("lets the corner do about half the stage's work", () => {
    expect(PRESENCE_BUDGETS).toEqual({
      plain: { auroraColumns: 10, dotGrid: 9, emberSparks: 24, inkBlooms: 14 },
      refined: { auroraColumns: 20, dotGrid: 17, emberSparks: 48, inkBlooms: 28 },
    });
  });
});

describe("presencePixelRatio", () => {
  it("draws at the display's own ratio, held to a Retina display's", () => {
    expect(MAX_PRESENCE_PIXEL_RATIO).toBe(2);
    expect([1, 1.5, 2, 3].map((device) => presencePixelRatio({ device }))).toEqual([1, 1.5, 2, 2]);
  });
});

describe("withNewest", () => {
  it("adds the item at the end while there is room", () => {
    expect(withNewest({ cap: 3, item: "c", items: ["a", "b"] })).toEqual(["a", "b", "c"]);
    expect(withNewest({ cap: 3, item: "a", items: [] })).toEqual(["a"]);
  });

  it("drops the oldest first to stay within the cap", () => {
    expect(withNewest({ cap: 3, item: "d", items: ["a", "b", "c"] })).toEqual(["b", "c", "d"]);
    expect(withNewest({ cap: 2, item: "e", items: ["a", "b", "c", "d"] })).toEqual(["d", "e"]);
  });

  it("always keeps the newest, even under a cap below one", () => {
    expect(withNewest({ cap: 1, item: "z", items: ["a", "b"] })).toEqual(["z"]);
    expect(withNewest({ cap: 0, item: "z", items: ["a"] })).toEqual(["z"]);
  });
});
