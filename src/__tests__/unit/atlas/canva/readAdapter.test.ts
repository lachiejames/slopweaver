/**
 * What the Canva read view says about a kind's permission block, and what it refuses before anything has been
 * published.
 *
 * `permissionBlocked` is absent on every manifest written before the field existed, so a status that does not
 * carry one reads as unblocked rather than failing the read.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { initialCanvaManifest } from "../../../../atlas/canva/model.js";
import { readCanvaSnapshot } from "../../../../atlas/canva/readAdapter.js";
import { canvaAtlasPaths, publishCanvaAtlas } from "../../../../atlas/canva/store.js";
import { unwrap } from "../../../../lib/result.js";

const AT = "2026-10-12T05:00:00.000Z";
const BLOCK = { at: AT, detail: "403 listing brand templates", unblockedBy: "a Canva Enterprise seat" };

const homes: string[] = [];

/** A throwaway state home this file owns and removes. */
function scratchHome(): string {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-canva-read-"));
  homes.push(home);
  return home;
}

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

describe("readCanvaSnapshot", () => {
  it("refuses an unpublished store and names the command that fills it", () => {
    const result = readCanvaSnapshot({ home: scratchHome() });
    expect(result.isErr()).toBe(true);
    const error = result._unsafeUnwrapErr();
    expect(error.code).toBe("ATLAS_GENERATION_UNPUBLISHED");
    expect(error.message).toContain("slopweaver atlas canva sync");
  });

  it("reads a recorded permission block, and a status carrying none as unblocked", () => {
    const home = scratchHome();
    const manifest = initialCanvaManifest({ updatedAt: AT });
    unwrap(
      publishCanvaAtlas({
        derivedFrom: null,
        files: {},
        manifest: {
          ...manifest,
          kinds: {
            ...manifest.kinds,
            asset: {
              digest: null,
              entityCount: 0,
              lastAttempt: { at: AT, outcome: "failed", reasons: ["403"] },
              lastSuccessAt: null,
              permissionBlocked: BLOCK,
            },
          },
        },
        paths: canvaAtlasPaths({ home }),
      }),
    );
    const snapshot = unwrap(readCanvaSnapshot({ home }));
    const asset = snapshot.kinds.find((kind) => kind.kind === "asset")!;
    const app = snapshot.kinds.find((kind) => kind.kind === "app")!;
    expect(asset.permissionBlocked).toStrictEqual(BLOCK);
    expect(asset.latestAttemptFailed).toBe(true);
    expect(app.permissionBlocked).toBeNull();
    expect(snapshot.generation.updatedAt).toBe(AT);
  });
});
