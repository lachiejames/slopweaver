/**
 * The code-noise `@`-token set the graph and the opportunity classifier share: JSDoc tags and npm scopes are
 * members, people and each reader's own extra exclusions are not, and the lookup is exact because both callers
 * lower-case the handle before asking.
 */
import { describe, expect, it } from "vitest";

import { isCodeNoiseAtToken } from "../../../silver/codeNoiseAtToken.js";
import { isGraphEntityToken } from "../../../silver/graph.js";
import { classifyOpportunityToken } from "../../../silver/opportunityToken.js";

describe("isCodeNoiseAtToken", () => {
  it("names JSDoc tags as code noise", () => {
    expect(["param", "returns", "deprecated", "example", "link"].map((bare) => isCodeNoiseAtToken({ bare }))).toEqual([
      true,
      true,
      true,
      true,
      true,
    ]);
  });

  it("names npm scopes as code noise", () => {
    expect(["octokit", "packagemanager", "notionhq", "xenova"].map((bare) => isCodeNoiseAtToken({ bare }))).toEqual([
      true,
      true,
      true,
      true,
    ]);
  });

  it("leaves a person's handle and the opportunity-only exclusions out of the shared set", () => {
    expect(["ada", "gmail", "dependabot", "github", "here"].map((bare) => isCodeNoiseAtToken({ bare }))).toEqual([
      false,
      false,
      false,
      false,
      false,
    ]);
  });

  it("matches exactly, so a handle that was not lower-cased is not a member", () => {
    expect(isCodeNoiseAtToken({ bare: "Param" })).toBe(false);
  });

  it("is lower-cased by both callers, so a mixed-case tag is still rejected by each", () => {
    expect([isGraphEntityToken({ token: "@Param" }), classifyOpportunityToken({ token: "@Param" })]).toEqual([
      false,
      "generic",
    ]);
  });
});
