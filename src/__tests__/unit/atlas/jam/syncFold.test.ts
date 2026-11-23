/*
 * The compiled channel's per-kind fold and the manifest stamped over it, read directly rather than through a
 * whole generation: which kind the compiled channel fills, which it defers, and whose success the deferred
 * one keeps.
 */
import { describe, expect, it } from "vitest";

import { initialJamManifest, JAM_ATLAS_KINDS, type JamAtlasManifest } from "../../../../atlas/jam/model.js";
import { foldedKindFiles, type JamHeldGeneration, syncManifest } from "../../../../atlas/jam/syncFold.js";
import { unwrap } from "../../../../lib/result.js";

const AT = "2026-09-07T00:00:00.000Z";

/** The instant an earlier walk landed, kept distinct from {@link AT} so a carried value cannot look fresh. */
const WALKED_AT = "2026-09-05T00:00:00.000Z";

/** A held manifest whose `page` kind carries a real success from an earlier walk. */
function walkedManifest(): JamAtlasManifest {
  const initial = initialJamManifest({ updatedAt: WALKED_AT });
  return {
    ...initial,
    kinds: {
      ...initial.kinds,
      page: {
        digest: null,
        entityCount: 0,
        lastAttempt: { at: WALKED_AT, outcome: "ok", reasons: [] },
        lastSuccessAt: WALKED_AT,
      },
    },
  };
}

describe("foldedKindFiles", () => {
  it("has at least one entry in JAM_ATLAS_KINDS, so the per-kind checks below are not vacuously green", () => {
    expect(JAM_ATLAS_KINDS.length).toBeGreaterThan(0);
  });

  it("folds a file for every declared kind onto an empty store", () => {
    const files = unwrap(foldedKindFiles({ at: AT, held: { files: {}, manifest: null } }));
    expect(Object.keys(files).toSorted()).toEqual([...JAM_ATLAS_KINDS].toSorted());
  });

  it("marks the compiled cell synced on a kind it fills and deferred on `page`", () => {
    const files = unwrap(foldedKindFiles({ at: AT, held: { files: {}, manifest: null } }));
    const operationCell = files.operation.coverage.find((cell) => cell.channel === "compiled")!;
    const pageCell = files.page.coverage.find((cell) => cell.channel === "compiled")!;
    expect(operationCell.state).toBe("synced");
    expect(pageCell.state).toBe("deferred");
  });

  it("grades the route kind's compiled cell as discovery and every other filled kind as authoritative", () => {
    const files = unwrap(foldedKindFiles({ at: AT, held: { files: {}, manifest: null } }));
    const routeCell = files.route.coverage.find((cell) => cell.channel === "compiled")!;
    const scopeCell = files.scope.coverage.find((cell) => cell.channel === "compiled")!;
    expect(routeCell.role).toBe("discovery");
    expect(scopeCell.role).toBe("authoritative");
  });
});

describe("syncManifest", () => {
  it("stamps this run's success on a filled kind, counting the folded file's entities", () => {
    const held: JamHeldGeneration = { files: {}, manifest: null };
    const files = unwrap(foldedKindFiles({ at: AT, held }));
    const manifest = syncManifest({ at: AT, files, held });
    expect(manifest.kinds.operation.lastSuccessAt).toBe(AT);
    expect(manifest.kinds.operation.entityCount).toBe(14);
    expect(manifest.updatedAt).toBe(AT);
  });

  it("records an attempt on `page` with no success when nothing has walked it", () => {
    const held: JamHeldGeneration = { files: {}, manifest: null };
    const files = unwrap(foldedKindFiles({ at: AT, held }));
    const manifest = syncManifest({ at: AT, files, held });
    expect(manifest.kinds.page.lastAttempt!.at).toBe(AT);
    expect(manifest.kinds.page.lastSuccessAt).toBe(null);
  });

  it("carries the walk's own `page` success forward rather than claiming one of its own", () => {
    const held: JamHeldGeneration = { files: {}, manifest: walkedManifest() };
    const files = unwrap(foldedKindFiles({ at: AT, held }));
    const manifest = syncManifest({ at: AT, files, held });
    expect(manifest.kinds.page.lastSuccessAt).toBe(WALKED_AT);
    expect(manifest.kinds.page.lastAttempt!.at).toBe(AT);
  });
});
