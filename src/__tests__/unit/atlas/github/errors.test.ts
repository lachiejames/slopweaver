import { describe, expect, it } from "vitest";

import { GithubRefusalErrors, githubRefusalErrorLines } from "../../../../atlas/github/errors.js";

describe("GithubRefusalErrors", () => {
  it("refuses a description whose shape moved, in one line", () => {
    const error = GithubRefusalErrors.shapeChanged();
    expect(error.code).toBe("DESCRIPTION_SHAPE_CHANGED");
    expect(githubRefusalErrorLines({ error })).toEqual([
      "the GitHub OpenAPI description declares no `paths` or no `operations` interface — its shape has changed, and enumerating zero routes would report a complete API surface over nothing",
    ]);
  });

  it("refuses a description that declared no route, in one line", () => {
    const error = GithubRefusalErrors.noRoutes();
    expect(error.code).toBe("NO_ROUTES");
    expect(githubRefusalErrorLines({ error })).toEqual([
      "the GitHub OpenAPI description declared no route at all, so its `paths` shape has changed",
    ]);
  });

  it("prints an unpublishable generation's problems one per line, then the trailer", () => {
    const error = GithubRefusalErrors.unpublishable({ problems: ["first problem", "second problem"] });
    expect(error.code).toBe("GENERATION_UNPUBLISHABLE");
    expect(githubRefusalErrorLines({ error })).toEqual([
      "first problem",
      "second problem",
      "nothing was written — this generation is not published",
    ]);
    expect(error.message).toBe("first problem; second problem; nothing was written — this generation is not published");
  });

  // Unreachable through `syncGithubAtlas`, because the kit never proves an unexhausted read complete, so this
  // factory test is the sentence's only witness.
  it("names the kind whose failed read still produced a completeness proof", () => {
    const error = GithubRefusalErrors.completenessContradicted({ kind: "ruleset" });
    expect(error).toEqual({
      code: "COMPLETENESS_CONTRADICTED",
      kind: "ruleset",
      message:
        "ruleset had a failed read this run and still produced a completeness proof — refusing to publish rather than risk staling live configuration",
    });
    expect(githubRefusalErrorLines({ error })).toEqual([
      "ruleset had a failed read this run and still produced a completeness proof — refusing to publish rather than risk staling live configuration",
    ]);
  });

  it("refuses a walk with no seeds, in one line", () => {
    const error = GithubRefusalErrors.noSeeds();
    expect(error.code).toBe("NO_SEEDS");
    expect(githubRefusalErrorLines({ error })).toEqual([
      "no settings seeds were supplied, so a walk would report full coverage over nothing",
    ]);
  });
});
