/**
 * Every registered atlas's own question loads, so no atlas refresh card goes unnamed for want of its descriptor.
 */
import { describe, expect, it } from "vitest";

import { atlasPlatforms } from "../../../atlas/registry.js";
import { loadAtlasQuestions } from "../../../automations/atlasQuestions.js";

describe("loadAtlasQuestions", () => {
  it("loads a non-empty question for every registered atlas, with no descriptor failing", async () => {
    const platforms = atlasPlatforms();
    expect(platforms.length).toBeGreaterThan(0);

    const loaded = await loadAtlasQuestions();

    expect(loaded.issues).toEqual([]);
    expect([...loaded.questions.keys()].toSorted()).toEqual([...platforms].toSorted());
    expect(platforms.filter((platform) => loaded.questions.get(platform)!.length === 0)).toEqual([]);
  });
});
