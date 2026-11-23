/**
 * What one typed Datadog failure means for a coverage cell. Every case is built through the domain's own
 * factory rather than a hand-written literal, so a factory that stops matching its type reddens here.
 */
import { describe, expect, it } from "vitest";

import { stateFor } from "../../../../atlas/datadog/coverageState.js";
import { DatadogAtlasErrors } from "../../../../atlas/datadog/errors.js";

describe("stateFor", () => {
  it("grades a 403 unavailable and names the permission as the remedy, never a broken key", () => {
    const graded = stateFor({ error: DatadogAtlasErrors.forbidden({ surface: "api" }) });

    expect(graded.state).toBe("unavailable");
    expect(graded.unblockedBy).toContain("Datadog permission");
  });

  it("grades a 401 not-configured — the key is absent or wrong, which is not the org refusing", () => {
    const graded = stateFor({ error: DatadogAtlasErrors.unauthorised({ surface: "api" }) });

    expect(graded.state).toBe("not-configured");
    expect(graded.unblockedBy).toContain("slopweaver datadog verify");
  });

  it("grades a rate limit deferred, and says WHEN when Datadog sent a reset", () => {
    const withReset = stateFor({ error: DatadogAtlasErrors.rateLimited({ resetSeconds: 42, surface: "api" }) });

    expect(withReset.state).toBe("deferred");
    expect(withReset.unblockedBy).toContain("42s");
  });

  it("grades a rate limit with no reset header deferred, and says nothing here knows when", () => {
    const noReset = stateFor({ error: DatadogAtlasErrors.rateLimited({ resetSeconds: null, surface: "api" }) });

    expect(noReset.state).toBe("deferred");
    expect(noReset.unblockedBy).toContain("nothing here knows when that is");
  });

  it("grades an unexpected shape unreadable rather than unavailable — the call worked, the body did not", () => {
    const graded = stateFor({
      error: DatadogAtlasErrors.unexpectedShape({ detail: "an array where an object was declared", surface: "api" }),
    });

    expect(graded.state).toBe("unreadable");
    expect(graded.unblockedBy).toContain("widen the schema");
  });

  it("grades a drifted answer unreadable, and points at regenerating the boundary from a fresh census", () => {
    const drift = [{ detail: 'new field "data[0].owner"', kind: "new", path: "data[0].owner" }] as const;
    const graded = stateFor({ error: DatadogAtlasErrors.bodyShapeChanged({ drift, surface: "api" }) });

    expect(graded.state).toBe("unreadable");
    expect(graded.unblockedBy).toContain("regenerate its response boundary from a fresh census");
  });

  it("grades the console walk's own empty registry unreadable, and points at the declaration", () => {
    const graded = stateFor({ error: DatadogAtlasErrors.consoleRegistryEmpty() });

    expect(graded.state).toBe("unreadable");
    expect(graded.unblockedBy).toContain("consolePages.ts");
  });

  it("grades a --limit that keeps no route unreadable, and names the flag rather than the registry", () => {
    const graded = stateFor({ error: DatadogAtlasErrors.consoleLimitEmpty({ limit: 0 }) });

    expect(graded.state).toBe("unreadable");
    expect(graded.unblockedBy).toContain("--limit of at least 1");
  });
});
