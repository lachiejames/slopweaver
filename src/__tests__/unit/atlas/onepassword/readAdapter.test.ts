/**
 * What the read seam says about each kind's history, before and after a generation is published.
 *
 * No manifest is the never-synced reading — nothing succeeded, failed, was blocked or was published — and it
 * must stay distinguishable from a published manifest that records a failed attempt.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  emptyOnepasswordKindFile,
  initialOnepasswordManifest,
  type OnepasswordManifest,
} from "../../../../atlas/onepassword/model.js";
import { readOnepasswordSnapshot } from "../../../../atlas/onepassword/readAdapter.js";
import { onepasswordAtlasPaths, publishOnepasswordAtlas } from "../../../../atlas/onepassword/store.js";
import { unwrap } from "../../../../lib/result.js";
import { stateHomePaths } from "../../../../stateHome.js";

const AT = "2026-10-01T00:00:00.000Z";
const homes: string[] = [];

/** A throwaway state home this file owns and removes. */
function scratchHome(): string {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-onepassword-read-"));
  homes.push(home);
  return home;
}

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

describe("readOnepasswordSnapshot", () => {
  it("reads a never-published store as never synced on every kind, with no generation instant", () => {
    const snapshot = unwrap(readOnepasswordSnapshot({ home: scratchHome() }));

    expect(snapshot.generation.updatedAt).toBeNull();
    expect(snapshot.kinds.length).toBe(7);
    expect(
      snapshot.kinds.filter(
        (kind) =>
          kind.lastSuccessAt !== null ||
          kind.latestAttemptFailed ||
          kind.permissionBlocked !== null ||
          kind.publishedCount !== 0,
      ),
    ).toEqual([]);
  });

  it("reads each kind's history off a published manifest, a failed latest attempt included", () => {
    const home = scratchHome();
    const initial = initialOnepasswordManifest({ updatedAt: AT });
    const manifest: OnepasswordManifest = {
      ...initial,
      kinds: {
        ...initial.kinds,
        vault: {
          digest: null,
          entityCount: 0,
          lastAttempt: { at: AT, outcome: "failed", reasons: ["op signed out"] },
          lastSuccessAt: "2026-09-01T00:00:00.000Z",
        },
      },
    };
    unwrap(
      publishOnepasswordAtlas({
        denylist: [],
        derivedFrom: null,
        // Only the acquired kind is written: publishing a file for a never-acquired surface is refused.
        files: { vault: emptyOnepasswordKindFile({ kind: "vault", updatedAt: AT }) },
        manifest,
        paths: onepasswordAtlasPaths({ home: stateHomePaths({ home }).root }),
      }),
    );

    const snapshot = unwrap(readOnepasswordSnapshot({ home }));
    const vault = snapshot.kinds.find((kind) => kind.kind === "vault")!;
    const user = snapshot.kinds.find((kind) => kind.kind === "user")!;

    expect(snapshot.generation.updatedAt).toBe(AT);
    expect([vault.lastSuccessAt, vault.latestAttemptFailed, vault.permissionBlocked, vault.publishedCount]).toEqual([
      "2026-09-01T00:00:00.000Z",
      true,
      null,
      0,
    ]);
    expect([user.lastSuccessAt, user.latestAttemptFailed, user.permissionBlocked]).toEqual([null, false, null]);
  });
});
