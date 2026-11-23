import { describe, expect, it } from "vitest";

import { renovateTitleParts } from "../../../review/renovateTitle.js";

describe("renovateTitleParts", () => {
  it.each([
    ["chore(deps): update dependency @ai-sdk/openai to v3.0.124", "@ai-sdk/openai", "v3.0.124"],
    ["fix(deps): update dependency @knocklabs/react to ^0.13.0", "@knocklabs/react", "^0.13.0"],
    ["chore(deps): update dependency nx to v23.2.1 [security]", "nx", "v23.2.1"],
    ["chore(deps): update dependency eslint to v9 (major)", "eslint", "v9"],
    ["chore(deps):  update   dependency  eslint  to  v9 ", "eslint", "v9"],
    ["fix(deps): update dependency axios to v1.12.0 (patch) [security] [skip ci]", "axios", "v1.12.0"],
    ["chore(deps): update dependency to-fast-properties to v4", "to-fast-properties", "v4"],
  ])("reads %s as %s to %s", (title, subject, target) => {
    expect(renovateTitleParts({ title })).toEqual({ subject, target });
  });

  it("carries no target for a group update that names none", () => {
    expect(renovateTitleParts({ title: "chore(deps): update github actions" })).toEqual({
      subject: "github actions",
      target: undefined,
    });
  });

  it.each([
    "[ABC-1] fix(security): re-resolve joi to 17.13.8",
    "chore(deps): lock file maintenance",
    "bump lodash by hand",
    "",
    "chore(deps): update ",
  ])("reads %j as no update Renovate wrote", (title) => {
    expect(renovateTitleParts({ title })).toBe(undefined);
  });
});
