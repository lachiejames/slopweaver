import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  type CloudflareEntity,
  emptyCloudflareKindFile,
  initialCloudflareManifest,
} from "../../../../atlas/cloudflare/model.js";
import { readCloudflareSnapshot } from "../../../../atlas/cloudflare/readAdapter.js";
import { cloudflareAtlasPaths, publishCloudflareAtlas } from "../../../../atlas/cloudflare/store.js";
import { unwrap } from "../../../../lib/result.js";

const AT = "2026-01-01T00:00:00.000Z";

describe("readCloudflareSnapshot", () => {
  let home: string;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "cloudflare-read-adapter-"));
  });
  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  it("reads an atlas with no manifest yet as nothing published: no timestamp, no success, a count of zero", () => {
    const snapshot = unwrap(readCloudflareSnapshot({ home }));
    const zone = snapshot.kinds.find((kind) => kind.kind === "zone")!;
    expect(snapshot.generation.updatedAt).toBe(null);
    expect([zone.lastSuccessAt, zone.permissionBlocked, zone.publishedCount, zone.latestAttemptFailed]).toEqual([
      null,
      null,
      0,
      false,
    ]);
  });

  it("carries a published kind's own status through, and an omitted permission block as null", () => {
    const initial = initialCloudflareManifest({ updatedAt: AT });
    const manifest = {
      ...initial,
      kinds: {
        ...initial.kinds,
        zone: {
          digest: null,
          entityCount: 1,
          lastAttempt: { at: AT, outcome: "ok" as const, reasons: [] },
          lastSuccessAt: AT,
        },
      },
    };
    const entity: CloudflareEntity = {
      detail: { name: "example.test" },
      firstSeenAt: AT,
      id: "zone:zone-1",
      kind: "zone",
      lastSeenAt: AT,
      providerId: "zone-1",
      scope: { accountId: "a".repeat(32), parentId: null, zoneId: null },
      source: { channel: "rest-api", observedAt: AT, operation: "zones-list" },
      state: "observed",
    };
    const paths = cloudflareAtlasPaths({ home });
    unwrap(
      publishCloudflareAtlas({
        derivedFrom: null,
        files: { zone: { ...emptyCloudflareKindFile({ kind: "zone", updatedAt: AT }), entities: [entity] } },
        manifest,
        paths,
      }),
    );
    const snapshot = unwrap(readCloudflareSnapshot({ home }));
    const zone = snapshot.kinds.find((kind) => kind.kind === "zone")!;
    expect(snapshot.generation.updatedAt).toBe(AT);
    expect([zone.lastSuccessAt, zone.permissionBlocked, zone.publishedCount]).toEqual([AT, null, 1]);
  });
});
