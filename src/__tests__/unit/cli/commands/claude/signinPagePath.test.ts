import { describe, expect, it } from "vitest";

import { signinPagePath } from "../../../../../cli/commands/claude/signinPagePath.js";

describe("signinPagePath", () => {
  it("writes the page into the Slopweaver home when no --out is given", () => {
    expect(signinPagePath({ args: {}, home: "/home/sw" })).toBe("/home/sw/claude-signin.html");
  });

  it("uses a given --out exactly as typed", () => {
    expect(signinPagePath({ args: { out: "/tmp/page.html" }, home: "/home/sw" })).toBe("/tmp/page.html");
  });

  it("keeps an empty --out rather than substituting the default", () => {
    expect(signinPagePath({ args: { out: "" }, home: "/home/sw" })).toBe("");
  });
});
