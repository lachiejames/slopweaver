/*
 * The voice's two views: the owner's gestures between them, the stage preview's address, the corner's backing and the call's
 * switches.
 */
import { describe, expect, it } from "vitest";

import { ORB_MOODS, orbPreviewOf } from "../../lib/orbMood";
import { PRESENCE_IDS } from "../../lib/orbPresence";
import {
  backingIsPressable,
  CORNER_CALM,
  DEFAULT_ORB_BACKING,
  DEFAULT_ORB_BACKING_OPACITY,
  isOrbBacking,
  isOrbBackingOpacity,
  isStageSwitch,
  ORB_BACKING_OPACITIES,
  ORB_BACKING_OPACITY_STORAGE_KEY,
  ORB_BACKING_STORAGE_KEY,
  ORB_BACKINGS,
  orbTuning,
  presenceWorn,
  STAGE_LEVEL_GAIN,
  STAGE_PACE,
  STAGE_TOGGLE_ORDER,
  STAGE_TOGGLES,
  simulatedVoiceLevel,
  stageKeyOf,
  stageOrbLevel,
  stagePreviewOf,
  voiceSimOf,
} from "../../lib/voiceStage";

describe("voiceSimOf", () => {
  it("plays a made-up voice only beside a stage preview, and only for the exact word sim", () => {
    expect(voiceSimOf({ search: "?stage=star-cluster&orb=speaking&voice=sim" })).toBe(true);
    expect(voiceSimOf({ search: "?orb=speaking&voice=sim" })).toBe(false);
    expect(voiceSimOf({ search: "?stage=star-cluster&voice=on" })).toBe(false);
    expect(voiceSimOf({ search: "?stage=star-cluster&voice=sim&voice=sim" })).toBe(false);
    expect(voiceSimOf({ search: "?stage=star-cluster" })).toBe(false);
  });
});

describe("simulatedVoiceLevel", () => {
  const instants = Array.from({ length: 600 }, (_, index) => index / 30);

  it("is silent for every mood but hearing the owner and the voice speaking", () => {
    expect(ORB_MOODS.length).toBeGreaterThan(0);
    const loud = ORB_MOODS.filter((mood) => mood !== "hearing" && mood !== "speaking").filter((mood) =>
      instants.some((timeS) => simulatedVoiceLevel({ mood, timeS }) !== 0),
    );
    expect(loud).toEqual([]);
  });

  it("speaks in phrases with pauses, peaking near full and staying within 0 to 1", () => {
    const levels = instants.map((timeS) => simulatedVoiceLevel({ mood: "speaking", timeS }));
    expect(Math.max(...levels)).toBeGreaterThan(0.9);
    expect(Math.min(...levels)).toBe(0);
    expect(levels.filter((level) => level < 0 || level > 1)).toEqual([]);
  });

  it("makes the owner a little softer than the voice", () => {
    const peak = ({ mood }: { mood: "hearing" | "speaking" }): number =>
      Math.max(...instants.map((timeS) => simulatedVoiceLevel({ mood, timeS })));
    expect(peak({ mood: "hearing" })).toBeLessThanOrEqual(0.85);
    expect(peak({ mood: "hearing" })).toBeGreaterThan(0.75);
  });
});

describe("stagePreviewOf", () => {
  it("reads every presence by its exact name", () => {
    expect(PRESENCE_IDS.length).toBeGreaterThan(0);
    expect(PRESENCE_IDS.map((id) => stagePreviewOf({ search: `?stage=${id}` }))).toEqual([...PRESENCE_IDS]);
  });

  it("draws nothing for an absent, empty, unknown or repeated presence", () => {
    expect(stagePreviewOf({ search: "" })).toBeUndefined();
    expect(stagePreviewOf({ search: "?stage=" })).toBeUndefined();
    expect(stagePreviewOf({ search: "?stage=blob" })).toBeUndefined();
    expect(stagePreviewOf({ search: "?stage=mist&stage=embers" })).toBeUndefined();
  });

  it("opens no preview for a name that is no presence, rather than a different presence under it", () => {
    expect(
      ["laser-beams", "steel-wool", "murmuration", "sun", "smoke"].map((name) =>
        stagePreviewOf({ search: `?stage=${name}` }),
      ),
    ).toEqual([undefined, undefined, undefined, undefined, undefined]);
  });

  it("sits beside the orb's own preview without either reading the other", () => {
    const search = "?stage=aurora&orb=speaking,slack";
    expect(stagePreviewOf({ search })).toBe("aurora");
    expect(orbPreviewOf({ search })).toEqual({ badge: "slack", mood: "speaking" });
  });
});

describe("presenceWorn", () => {
  it("wears a valid stage pin over the stored presence", () => {
    expect(presenceWorn({ search: "?stage=mist", stored: "embers" })).toBe("mist");
  });

  it("wears the stored presence when the address holds no valid pin, so a pick applies live", () => {
    expect(
      ["", "?stage=", "?stage=blob", "?stage=mist&stage=embers", "?orb=speaking"].map((search) =>
        presenceWorn({ search, stored: "embers" }),
      ),
    ).toEqual(["embers", "embers", "embers", "embers", "embers"]);
  });
});

describe("the guards", () => {
  it("accept a switch's two states and nothing else", () => {
    expect([isStageSwitch("on"), isStageSwitch("off"), isStageSwitch("true"), isStageSwitch(undefined)]).toEqual([
      true,
      true,
      false,
      false,
    ]);
  });
});

// The disc must not read as flat plastic.
describe("the corner's backing", () => {
  it("stays the disc until a theme is worn, under its own key", () => {
    expect(DEFAULT_ORB_BACKING).toBe("disc");
    expect(ORB_BACKING_STORAGE_KEY).toBe("slopweaver.talk.orbBacking");
  });

  it("accepts the four backings and nothing else", () => {
    expect(ORB_BACKINGS.filter((backing) => !isOrbBacking(backing))).toEqual([]);
    expect([isOrbBacking("glass"), isOrbBacking(""), isOrbBacking(undefined)]).toEqual([false, false, false]);
  });

  it("takes the pointer only where something is drawn, so nothing invisible sits in the owner's app's way", () => {
    expect(ORB_BACKINGS.map((backing) => backingIsPressable({ backing }))).toEqual([true, true, true, false]);
    expect(ORB_BACKINGS.map((backing) => backingIsPressable({ backing, opacity: "100" }))).toEqual([
      true,
      true,
      true,
      false,
    ]);
    expect(ORB_BACKINGS.map((backing) => backingIsPressable({ backing, opacity: "10" }))).toEqual([
      true,
      true,
      true,
      false,
    ]);
    expect(ORB_BACKINGS.map((backing) => backingIsPressable({ backing, opacity: "0" }))).toEqual([
      false,
      false,
      false,
      false,
    ]);
  });
});

// The minimised orb has a background opacity slider.
describe("the backing's strength", () => {
  it("draws the backing as it was until a theme is worn, under its own key", () => {
    expect(DEFAULT_ORB_BACKING_OPACITY).toBe("100");
    expect(ORB_BACKING_OPACITY_STORAGE_KEY).toBe("slopweaver.talk.orbBackingOpacity");
  });

  it("steps by tens from none to full, and accepts nothing else", () => {
    expect(ORB_BACKING_OPACITIES).toEqual(["0", "10", "20", "30", "40", "50", "60", "70", "80", "90", "100"]);
    expect(ORB_BACKING_OPACITIES.filter((opacity) => !isOrbBackingOpacity(opacity))).toEqual([]);
    expect([isOrbBackingOpacity("55"), isOrbBackingOpacity(50), isOrbBackingOpacity(undefined)]).toEqual([
      false,
      false,
      false,
    ]);
  });
});

describe("stageOrbLevel", () => {
  const levels = { mic: 0.2, output: 0.1 };

  it("swells with the owner's voice while it listens or hears the owner,lifted by the gain", () => {
    expect(stageOrbLevel({ levels, phase: "listening" })).toBeCloseTo(0.2 * STAGE_LEVEL_GAIN);
    expect(stageOrbLevel({ levels, phase: "hearing" })).toBeCloseTo(0.2 * STAGE_LEVEL_GAIN);
  });

  it("swells with its own voice while it speaks", () => {
    expect(stageOrbLevel({ levels, phase: "speaking" })).toBeCloseTo(0.1 * STAGE_LEVEL_GAIN);
  });

  it("still shows it heard the owner over a turn in flight, and keeps still when no call is up", () => {
    expect(stageOrbLevel({ levels, phase: "working" })).toBeCloseTo(0.2 * STAGE_LEVEL_GAIN);
    expect(stageOrbLevel({ levels, phase: "off" })).toBe(0);
    expect(stageOrbLevel({ levels, phase: "reconnecting" })).toBe(0);
  });

  it("clamps a loud level to 1 and silence to 0", () => {
    expect(stageOrbLevel({ levels: { mic: 0.9, output: 0 }, phase: "hearing" })).toBe(1);
    expect(stageOrbLevel({ levels: { mic: 0, output: 0 }, phase: "speaking" })).toBe(0);
  });
});

// Collapsed, the same orb moves in similar ways with animations a little less pronounced.
describe("orbTuning", () => {
  it("places the stage's orb at its mood's own pace, moving with the whole level", () => {
    expect(orbTuning({ calm: 1, level: 0.5, mood: "speaking" })).toEqual({
      "--lvl": "0.500",
      "--move-lvl": "0.500",
      "--pace": String(STAGE_PACE.speaking),
    });
  });

  it("slows the corner's and damps how far the level moves it, while the level still lights it whole", () => {
    expect(orbTuning({ calm: CORNER_CALM, level: 0.5, mood: "speaking" })).toEqual({
      "--lvl": "0.500",
      "--move-lvl": "0.300",
      "--pace": String(STAGE_PACE.speaking / 0.6),
    });
    expect(CORNER_CALM).toBe(0.6);
  });

  it("gives a reconnect its own pace", () => {
    expect(orbTuning({ calm: 1, level: 0, mood: "reconnecting" })["--pace"]).toBe("0.75");
  });
});

describe("the stage's switches", () => {
  it("are the three the owner can flip, with no switch for the screen edge's glow", () => {
    expect([...STAGE_TOGGLE_ORDER]).toEqual(["activity", "previews", "openCards"]);
  });

  it("lists every switch once, each under its own key", () => {
    expect(STAGE_TOGGLE_ORDER.length).toBeGreaterThan(0);
    expect([...STAGE_TOGGLE_ORDER].toSorted()).toEqual(Object.keys(STAGE_TOGGLES).toSorted());
    expect(new Set(STAGE_TOGGLE_ORDER.map((toggle) => STAGE_TOGGLES[toggle].key)).size).toBe(STAGE_TOGGLE_ORDER.length);
  });
});

describe("stageKeyOf", () => {
  const press = { altKey: false, code: "KeyA", modified: false, stageOpen: true, typing: false };

  it("toggles on Alt+V and collapses on Escape", () => {
    expect(stageKeyOf({ ...press, altKey: true, code: "KeyV" })).toBe("toggle");
    expect(stageKeyOf({ ...press, code: "Escape" })).toBe("collapse");
  });

  it("leaves Escape alone while the stage is not showing", () => {
    expect(stageKeyOf({ ...press, code: "Escape", stageOpen: false })).toBe("none");
  });

  it("never fires while the owner is typing or holding another modifier", () => {
    expect(stageKeyOf({ ...press, altKey: true, code: "KeyV", typing: true })).toBe("none");
    expect(stageKeyOf({ ...press, code: "Escape", typing: true })).toBe("none");
    expect(stageKeyOf({ ...press, altKey: true, code: "KeyV", modified: true })).toBe("none");
    expect(stageKeyOf({ ...press, code: "KeyV" })).toBe("none");
  });
});
