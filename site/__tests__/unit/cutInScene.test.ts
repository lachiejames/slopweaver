/**
 * The recordable cut-in runs the real detector: speaking, then "your turn" as the voice stops for the owner, then hearing
 * the owner, then listening — at fixed instants of the scene.
 */
import { describe, expect, it } from "vitest";

import { CUT_IN_SCENE_S, cutInLevelsAt, cutInSceneAt } from "../../lib/cutInScene";

describe("cutInSceneAt", () => {
  it("speaks, stops for the owner, hears the owner, then listens", () => {
    expect(cutInSceneAt({ timeS: 1 }).status.phase).toBe("speaking");
    expect(cutInSceneAt({ timeS: 2.6 }).status.phase).toBe("speaking");
    expect(cutInSceneAt({ timeS: 3.6 }).status.headline).toBe("your turn");
    expect(cutInSceneAt({ timeS: 5.5 }).status.phase).toBe("hearing");
    expect(cutInSceneAt({ timeS: 8 }).status.phase).toBe("listening");
  });

  it("loops", () => {
    expect(cutInSceneAt({ timeS: CUT_IN_SCENE_S + 3.6 }).status.phase).toBe("yielded");
  });

  it("has both sides loud only while they overlap", () => {
    expect(cutInLevelsAt({ timeS: 2.5 }).micLevel).toBeGreaterThan(0.04);
    expect(cutInLevelsAt({ timeS: 2.5 }).outputLevel).toBeGreaterThan(0.04);
    expect(cutInLevelsAt({ timeS: 4 })).toMatchObject({ outputLevel: 0 });
    expect(cutInLevelsAt({ timeS: 7 })).toEqual({ micLevel: 0, micRms: 0, outputLevel: 0 });
  });
});
