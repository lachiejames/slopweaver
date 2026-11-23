import { describe, expect, it } from "vitest";

import { resolveRepoEdge } from "../../../../../cli/commands/github/repoEdge.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

describe("resolveRepoEdge", () => {
  it("parses an explicit slug as given, without touching any checkout", () => {
    const resolved = resolveRepoEdge({ explicit: "octo-self/slopweaver", home: undefined });

    expect(resolved.isOk()).toBe(true);
    expect(unwrap(resolved)).toEqual({ owner: "octo-self", repo: "slopweaver" });
  });

  it("reports a malformed explicit slug rather than falling back to the checkout", () => {
    const resolved = resolveRepoEdge({ explicit: "not-a-slug", home: undefined });

    expect(resolved.isErr()).toBe(true);
    expect(unwrapErr(resolved)).toEqual(["expected owner/repo, got: not-a-slug"]);
  });

  it("prefers the explicit slug over the checkout even when a home is also given", () => {
    const resolved = resolveRepoEdge({ explicit: "acme/widget", home: "/nonexistent-home" });

    expect(unwrap(resolved)).toEqual({ owner: "acme", repo: "widget" });
  });
});
