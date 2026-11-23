import { describe, expect, it } from "vitest";

import {
  isCorpusResyncId,
  isManagedResyncId,
  resyncRecipeId,
  resyncTargetLabel,
} from "../../../../live/resync/target.js";

describe("resyncRecipeId", () => {
  it("names an atlas row by its platform", () => {
    expect(resyncRecipeId({ target: { kind: "atlas", platform: "trelica" } })).toBe("resync-atlas-trelica");
  });

  it("names a corpus row by its source", () => {
    expect(resyncRecipeId({ target: { kind: "corpus", source: "notion" } })).toBe("resync-corpus-notion");
  });

  it("keeps the atlas and the corpus source of one name apart", () => {
    expect(resyncRecipeId({ target: { kind: "atlas", platform: "github" } })).not.toBe(
      resyncRecipeId({ target: { kind: "corpus", source: "github" } }),
    );
  });
});

describe("isManagedResyncId", () => {
  it("claims both managed prefixes", () => {
    expect(isManagedResyncId({ recipeId: "resync-atlas-trelica" })).toBe(true);
    expect(isManagedResyncId({ recipeId: "resync-corpus-notion" })).toBe(true);
  });

  it("disowns a row this registrar never writes", () => {
    expect(isManagedResyncId({ recipeId: "knock-alerts" })).toBe(false);
    expect(isManagedResyncId({ recipeId: "resync-something-else" })).toBe(false);
  });
});

describe("resyncTargetLabel", () => {
  it("reads as a person would say it", () => {
    expect(resyncTargetLabel({ target: { kind: "atlas", platform: "vanta" } })).toBe("atlas vanta");
    expect(resyncTargetLabel({ target: { kind: "corpus", source: "slack" } })).toBe("corpus slack");
  });
});

describe("isCorpusResyncId", () => {
  it("claims a corpus source's resync row and nothing else, a hand-written suffix included", () => {
    expect(
      ["resync-corpus-slack", "resync-atlas-github", "corpus-slack", "resync-corpus", "resync-corpus-PR 123"].map(
        (recipeId) => isCorpusResyncId({ recipeId }),
      ),
    ).toEqual([true, false, false, false, false]);
  });
});
