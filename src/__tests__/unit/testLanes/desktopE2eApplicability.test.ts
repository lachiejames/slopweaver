import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../lib/result.js";
import { desktopE2eApplicable, desktopE2eBase } from "../../../testLanes/desktopE2eApplicability.js";

describe("desktopE2eApplicable", () => {
  it("is not applicable when every path is prose under docs/", () => {
    expect(desktopE2eApplicable({ paths: ["docs/store.md", "docs/security/hygiene-gate.MD"] })).toBe(false);
  });

  it("is applicable for an area rule, whose paths: catalog trees draws", () => {
    expect(desktopE2eApplicable({ paths: ["docs/store.md", ".claude/rules/area-live.md"] })).toBe(true);
  });

  it("is applicable for markdown at the repository root, which shipped code reads", () => {
    expect(desktopE2eApplicable({ paths: ["docs/store.md", "README.md"] })).toBe(true);
  });

  it("is applicable for the main-checkouts page, which shipped code names", () => {
    expect(desktopE2eApplicable({ paths: ["docs/main-checkouts.md"] })).toBe(true);
  });

  it("is applicable for markdown under site/, which the console serves", () => {
    expect(desktopE2eApplicable({ paths: ["docs/store.md", "site/content/index.mdx"] })).toBe(true);
  });

  it("is applicable for a skill, whose description /docs/build/modules draws", () => {
    expect(desktopE2eApplicable({ paths: ["docs/store.md", "skills/github/SKILL.md"] })).toBe(true);
  });

  it("is applicable for the recurring-failure register, which reflect reads", () => {
    expect(desktopE2eApplicable({ paths: ["docs/recurring-failure-register/2026-11.md"] })).toBe(true);
  });

  it("is applicable once any path is not markdown", () => {
    expect(desktopE2eApplicable({ paths: ["docs/store.md", "src/cli/main.ts"] })).toBe(true);
  });

  it("is applicable for an empty path list, so an unread diff never passes as not applicable", () => {
    expect(desktopE2eApplicable({ paths: [] })).toBe(true);
  });

  it("is applicable for a file merely named like markdown in a directory", () => {
    expect(desktopE2eApplicable({ paths: ["docs/notes.md/index.ts"] })).toBe(true);
  });
});

describe("desktopE2eBase", () => {
  it("reads a pull request's base commit", () => {
    const base = desktopE2eBase({ event: { pull_request: { base: { sha: "abc123" } } }, eventName: "pull_request" });
    expect(unwrap(base)).toBe("abc123");
  });

  it("reads a merge group's base commit", () => {
    const base = desktopE2eBase({ event: { merge_group: { base_sha: "def456" } }, eventName: "merge_group" });
    expect(unwrap(base)).toBe("def456");
  });

  it("has no base on a push, so the lane runs whole", () => {
    expect(unwrap(desktopE2eBase({ event: { after: "abc" }, eventName: "push" }))).toBeUndefined();
  });

  it("has no base off CI", () => {
    expect(unwrap(desktopE2eBase({ event: undefined, eventName: undefined }))).toBeUndefined();
  });

  it("refuses a pull request event with no base", () => {
    const base = desktopE2eBase({ event: { pull_request: {} }, eventName: "pull_request" });
    expect(unwrapErr(base)).toEqual(["a pull_request event carried no pull_request.base.sha"]);
  });

  it("refuses a merge group event with an empty base", () => {
    const base = desktopE2eBase({ event: { merge_group: { base_sha: "" } }, eventName: "merge_group" });
    expect(unwrapErr(base)).toEqual(["a merge_group event carried no merge_group.base_sha"]);
  });
});
