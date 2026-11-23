import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { emptyCloudflareKindFile, initialCloudflareManifest } from "../../../../atlas/cloudflare/model.js";
import { resetCloudflareAtlas } from "../../../../atlas/cloudflare/reset.js";
import {
  cloudflareAtlasPaths,
  publishCloudflareAtlas,
  readCloudflareAtlas,
} from "../../../../atlas/cloudflare/store.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

const AT = "2026-01-01T00:00:00.000Z";

describe("resetCloudflareAtlas", () => {
  let home: string;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "cloudflare-reset-"));
  });
  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  it("refuses when there is no current atlas to reset", () => {
    const paths = cloudflareAtlasPaths({ home });
    const result = resetCloudflareAtlas({ at: AT, paths });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result)[0]).toContain("nothing to reset");
  });

  it("archives the current generation and installs a fresh, empty one with no selection", () => {
    const paths = cloudflareAtlasPaths({ home });
    publishCloudflareAtlas({
      derivedFrom: null,
      files: {
        zone: emptyCloudflareKindFile({ kind: "zone", updatedAt: AT }),
      },
      manifest: {
        ...initialCloudflareManifest({ updatedAt: AT }),
        selection: { accountId: "0".repeat(32), deepZone: { id: "z", name: "example.test" } },
      },
      paths,
    });

    const outcome = unwrap(resetCloudflareAtlas({ at: AT, paths }));
    expect(existsSync(outcome.archivedTo)).toBe(true);

    const snapshot = unwrap(readCloudflareAtlas({ paths }));
    expect(snapshot.files.zone!.entities).toEqual([]);
    expect(snapshot.manifest!.selection).toBeNull();
  });

  it("a freshly reset atlas reads with no kind reported unpublished, missing or mismatched", () => {
    const paths = cloudflareAtlasPaths({ home });
    publishCloudflareAtlas({
      derivedFrom: null,
      files: { zone: emptyCloudflareKindFile({ kind: "zone", updatedAt: AT }) },
      manifest: initialCloudflareManifest({ updatedAt: AT }),
      paths,
    });

    unwrap(resetCloudflareAtlas({ at: AT, paths }));

    const snapshot = unwrap(readCloudflareAtlas({ paths }));
    expect(snapshot.unpublished).toEqual([]);
    expect(snapshot.missing).toEqual([]);
    expect(snapshot.mismatched).toEqual([]);
  });

  it("refuses rather than overwrites an archive that already exists at the same instant", () => {
    const paths = cloudflareAtlasPaths({ home });
    publishCloudflareAtlas({
      derivedFrom: null,
      files: {},
      manifest: initialCloudflareManifest({ updatedAt: AT }),
      paths,
    });
    resetCloudflareAtlas({ at: AT, paths });
    const result = resetCloudflareAtlas({ at: AT, paths });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result)[0]).toContain("already exists");
  });
});
