/**
 * Reset, and the schema-version refusal beside it.
 *
 * `reset` is the only verb in this noun that makes the atlas forget, and the whole design is that it never
 * deletes: the prior generation is archived and a fresh, complete, empty one is installed in its place. A
 * reset that left a kind's file missing would produce a partial generation the reader cannot distinguish
 * from a half-written one.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { XERO_ATLAS_KINDS } from "../../../../atlas/xero/model.js";
import { resetXeroAtlas } from "../../../../atlas/xero/reset.js";
import { readXeroKindFile, readXeroManifest, xeroAtlasPaths } from "../../../../atlas/xero/store.js";
import { syncXeroApiSurface } from "../../../../atlas/xero/sync.js";
import { unwrap } from "../../../../lib/result.js";

const AT = "2026-09-05T00:00:00.000Z";

const homes: string[] = [];

/** A throwaway state home, removed after the test that made it. */
function scratchHome(): string {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-xero-reset-"));
  homes.push(home);
  return home;
}

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

describe("resetXeroAtlas", () => {
  it("installs a file for EVERY kind, so the fresh generation is complete rather than partial", () => {
    const paths = xeroAtlasPaths({ home: scratchHome() });
    unwrap(syncXeroApiSurface({ at: AT, paths }));
    unwrap(resetXeroAtlas({ at: "2026-09-05T01:00:00.000Z", paths }));
    const missing = XERO_ATLAS_KINDS.filter((kind) => unwrap(readXeroKindFile({ kind, paths })) === null);
    expect(missing).toEqual([]);
  });

  it("empties every kind it reinstalls", () => {
    const paths = xeroAtlasPaths({ home: scratchHome() });
    unwrap(syncXeroApiSurface({ at: AT, paths }));
    unwrap(resetXeroAtlas({ at: "2026-09-05T01:00:00.000Z", paths }));
    const held = XERO_ATLAS_KINDS.flatMap((kind) => unwrap(readXeroKindFile({ kind, paths }))!.entities);
    expect(held).toEqual([]);
  });

  it("says where the prior generation was archived, because nothing is ever deleted", () => {
    const paths = xeroAtlasPaths({ home: scratchHome() });
    unwrap(syncXeroApiSurface({ at: AT, paths }));
    const outcome = unwrap(resetXeroAtlas({ at: "2026-09-05T01:00:00.000Z", paths }));
    expect(outcome.archivedTo).toContain("_superseded");
  });

  it("leaves a readable manifest behind, so the reader is not left with an unpublished atlas", () => {
    const paths = xeroAtlasPaths({ home: scratchHome() });
    unwrap(syncXeroApiSurface({ at: AT, paths }));
    unwrap(resetXeroAtlas({ at: "2026-09-05T01:00:00.000Z", paths }));
    expect(unwrap(readXeroManifest({ paths }))!.schemaVersion).toBe(1);
  });
});
