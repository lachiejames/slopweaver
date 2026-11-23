import { describe, expect, it } from "vitest";

import { DATADOG_SURFACES } from "../../../../atlas/datadog/generated/surfaces.js";
import {
  DATADOG_ATLAS_PLATFORM,
  DATADOG_CONSOLE_KINDS,
  DATADOG_KINDS,
  DATADOG_REGISTRY_KINDS,
  DATADOG_VISIBILITY_SCOPE,
} from "../../../../atlas/datadog/model.js";

describe("the Datadog atlas model", () => {
  it("names ONE platform, because the API, the compiled catalogue and the console are surfaces of it", () => {
    expect(DATADOG_ATLAS_PLATFORM).toBe("datadog");
  });

  // A kind that nothing declares is a kind no generation can publish a coverage state for, so it reads as
  // a kind that does not exist — and, worse, a row of that kind has no file to be published into and is
  // silently dropped. This was an entity-disposition-only check when the atlas landed, which left 50 rows
  // across 28 kinds unpublishable; `model.ts` carries the measurement and `tools/datadogKindCensus.ts`
  // reproduces it.
  it("declares EXACTLY every kind the generated registry carries, whatever the disposition", () => {
    const fromRegistry = [...new Set(DATADOG_SURFACES.map((row) => row.kind))].toSorted();

    expect([...DATADOG_REGISTRY_KINDS]).toStrictEqual(fromRegistry);
  });

  // The console walk publishes into kinds no registry row can reach, and a compile must never be judged over
  // them — `surfaceFill.ts` reads the registry list for the compiled and api surfaces for exactly that reason.
  it("keeps the two console kinds apart from the registry kinds, and the whole list is both", () => {
    expect([...DATADOG_CONSOLE_KINDS]).toStrictEqual(["console-page", "console-request"]);
    expect([...DATADOG_KINDS]).toStrictEqual([...DATADOG_REGISTRY_KINDS, ...DATADOG_CONSOLE_KINDS]);
    expect(DATADOG_SURFACES.some((row) => row.kind === "console-page")).toBe(false);
  });

  // The three groups the widening recovered, each named so a later narrowing has to argue with them.
  it("declares the kinds whose only rows are shape-index, excluded or probe-only", () => {
    const declared = new Set<string>(DATADOG_KINDS);
    for (const kind of ["audit", "spans", "events", "validate", "validate_keys", "anonymize_users"]) {
      expect(declared.has(kind)).toBe(true);
    }
  });

  it("declares each kind once", () => {
    expect(new Set(DATADOG_KINDS).size).toBe(DATADOG_KINDS.length);
  });

  it("keeps a v1 and a v2 route to one thing as ONE kind", () => {
    const monitorRows = DATADOG_SURFACES.filter((row) => row.kind === "monitor");
    const specs = [...new Set(monitorRows.map((row) => row.spec))].toSorted();

    expect(specs).toStrictEqual(["v1", "v2"]);
  });

  // Kept because they are the reason an atlas exists: the SDK reaches surfaces Datadog documents nowhere.
  it("keeps the undocumented families the SDK reveals, rather than tidying them away", () => {
    for (const kind of ["hamr", "spa", "bits-ai", "graph", "pruned_trace"]) {
      expect(DATADOG_SURFACES.some((row) => row.kind === kind)).toBe(true);
    }
  });

  it("states the claim boundary in the credentials' own terms, not as a reassurance", () => {
    expect(DATADOG_VISIBILITY_SCOPE).toContain("never by the credentials' own scope");
  });
});
