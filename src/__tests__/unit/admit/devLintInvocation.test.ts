/**
 * `devLintInvocation.ts`: which `dev lint` tails are the whole lap, a whole-Program gate, or local work.
 */
import { describe, expect, it } from "vitest";

import { devLintScope } from "../../../admit/devLintInvocation.js";

describe("devLintScope", () => {
  it("names the whole lap when nothing narrows it", () => {
    expect(devLintScope({ args: [], label: "yarn lint" })).toBe("yarn lint (the whole lint lap, tsgolint included)");
  });

  it("names only the whole-Program gates an --only selection carries", () => {
    expect(
      devLintScope({ args: ["--only", "jsdoc-tags, oxlint,named-object-params"], label: "slopweaver dev lint" }),
    ).toBe("slopweaver dev lint --only oxlint,named-object-params (a whole-tree type-checker gate)");
  });

  it("names prettier and knip as whole-tree CI gates, alone or beside a whole-Program gate", () => {
    expect(devLintScope({ args: ["--only", "knip,constraints"], label: "yarn lint" })).toBe(
      "yarn lint --only knip (a whole-tree CI gate)",
    );
    expect(devLintScope({ args: ["--only", "prettier,oxlint,knip,hygiene"], label: "yarn lint" })).toBe(
      "yarn lint --only oxlint,prettier,knip (a whole-tree type-checker gate; a whole-tree CI gate)",
    );
  });

  it("leaves the local lane, the seat lane, help, cheap gates and an empty --only to run", () => {
    expect(devLintScope({ args: ["--lane", "local"], label: "yarn lint" })).toBe(undefined);
    expect(devLintScope({ args: ["--lane", "seat"], label: "slopweaver dev lint" })).toBe(undefined);
    expect(devLintScope({ args: ["--help"], label: "yarn lint" })).toBe(undefined);
    expect(devLintScope({ args: ["--only", "constraints,hygiene,jsdoc-tags"], label: "yarn lint" })).toBe(undefined);
    expect(devLintScope({ args: ["--only"], label: "yarn lint" })).toBe(undefined);
  });
});
