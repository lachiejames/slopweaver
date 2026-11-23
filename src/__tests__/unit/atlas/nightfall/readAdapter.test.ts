/**
 * What the read seam answers before anything has been published, and after a reset.
 *
 * "Nightfall has no violations" and "nobody ran the sync" are different sentences, and on a data-loss
 * platform the first one is the more dangerous thing to say by accident. So an unpublished store refuses
 * and names the command, rather than projecting an empty atlas.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { initialNightfallManifest } from "../../../../atlas/nightfall/model.js";
import { readNightfallSnapshot } from "../../../../atlas/nightfall/readAdapter.js";
import { resetNightfallAtlas } from "../../../../atlas/nightfall/reset.js";
import { nightfallAtlasPaths, publishNightfallAtlas } from "../../../../atlas/nightfall/store.js";
import { syncNightfallAtlas } from "../../../../atlas/nightfall/sync.js";
import { unwrap } from "../../../../lib/result.js";

const AT = "2026-09-05T00:00:00.000Z";
const homes: string[] = [];

/** A throwaway state home this file owns and removes. */
function scratchHome(): string {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-nightfall-read-"));
  homes.push(home);
  return home;
}

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

describe("readNightfallSnapshot", () => {
  it("refuses an unpublished store and names the command that fills it", () => {
    const result = readNightfallSnapshot({ home: scratchHome() });
    expect(result.isErr()).toBe(true);
    const error = result._unsafeUnwrapErr();
    expect(error.code).toBe("ATLAS_GENERATION_UNPUBLISHED");
    expect(error.message).toContain("slopweaver atlas nightfall sync");
  });

  it("carries the descriptor's own unfilled surfaces into the snapshot a reader gets", () => {
    const home = scratchHome();
    unwrap(syncNightfallAtlas({ at: AT, home }));
    const snapshot = unwrap(readNightfallSnapshot({ home }));
    expect(snapshot.descriptor.surfaces.filter((surface) => surface.status === "declared-unfilled").length).toBe(2);
    expect(snapshot.kinds.length).toBe(19);
  });

  it("reads a recorded permission block, and a status carrying none as unblocked", () => {
    const home = scratchHome();
    const manifest = initialNightfallManifest({ updatedAt: AT });
    const block = { at: AT, detail: "403 listing violations", unblockedBy: "a key with the violations scope" };
    unwrap(
      publishNightfallAtlas({
        derivedFrom: null,
        files: {},
        manifest: {
          ...manifest,
          kinds: {
            ...manifest.kinds,
            annotation: { ...manifest.kinds.annotation, permissionBlocked: block },
          },
        },
        paths: nightfallAtlasPaths({ home }),
      }),
    );
    const kinds = unwrap(readNightfallSnapshot({ home })).kinds;
    expect(kinds.find((kind) => kind.kind === "annotation")!.permissionBlocked).toStrictEqual(block);
    expect(kinds.find((kind) => kind.kind === "ai-device")!.permissionBlocked).toBeNull();
  });

  it("comes back empty-but-published after a reset, with the prior generation archived rather than deleted", () => {
    const home = scratchHome();
    unwrap(syncNightfallAtlas({ at: AT, home }));
    const outcome = unwrap(resetNightfallAtlas({ at: AT, paths: nightfallAtlasPaths({ home }) }));
    expect(outcome.archivedTo).toContain(join("atlas", "_superseded", "nightfall"));

    const snapshot = unwrap(readNightfallSnapshot({ home }));
    expect(snapshot.kinds.every((kind) => kind.entities.length === 0)).toBe(true);
    expect(snapshot.generation.missing).toStrictEqual([]);
  });
});
