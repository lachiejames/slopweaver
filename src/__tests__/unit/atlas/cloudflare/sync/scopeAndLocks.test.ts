import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { acquireOperationLock } from "../../../../../admit/operationLock.js";
import { createCloudflareClient } from "../../../../../atlas/cloudflare/client.js";
import type { CloudflareEntity, CloudflareKind, CloudflareKindFile } from "../../../../../atlas/cloudflare/model.js";
import {
  cloudflareAtlasPaths,
  publishCloudflareAtlas,
  readCloudflareKindFile,
  readCloudflareManifest,
} from "../../../../../atlas/cloudflare/store.js";
import { syncCloudflareAtlas } from "../../../../../atlas/cloudflare/sync.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import { AT, LATER, noopProgress, SELECTION } from "./fixtures.js";
import { allKindsFetch, freshHome, removeFixtureHomes } from "./harness.js";

describe("syncCloudflareAtlas", () => {
  let home: string;
  beforeEach(() => {
    home = freshHome();
  });
  afterEach(removeFixtureHomes);

  /**
   * Republish one kind's file with a second zone's entity spliced in, through the real store, so a later
   * run meets a generation holding more than the one zone this atlas reads deeply.
   */
  function seedSecondZone({
    kind,
    zoneId,
    home: stateHome,
  }: {
    kind: CloudflareKind;
    zoneId: string;
    home: string;
  }): CloudflareEntity {
    const paths = cloudflareAtlasPaths({ home: stateHome });
    const manifest = unwrap(readCloudflareManifest({ paths }))!;
    const file = unwrap(readCloudflareKindFile({ kind, paths }))!;
    const first = file.entities[0]!;
    const other: CloudflareEntity = {
      ...first,
      id: `${zoneId}-${first.id}`,
      scope: { ...first.scope, zoneId },
    };
    const next: CloudflareKindFile = { ...file, entities: [...file.entities, other] };
    unwrap(publishCloudflareAtlas({ derivedFrom: manifest, files: { [kind]: next }, manifest, paths }));
    return other;
  }

  it("leaves a second zone's stored entities observed when a run reads only the deep zone (flat kind)", async () => {
    const client = createCloudflareClient({
      apiToken: "t",
      fetchImpl: allKindsFetch({
        zoneSettings: [{ id: "ssl", value: "full" }],
        zones: [{ id: "z1", name: "one.test" }],
      }),
      maxRetries: 0,
    });
    await syncCloudflareAtlas({ at: AT, client, home, progress: noopProgress, selection: SELECTION });
    const other = seedSecondZone({ home, kind: "zone-setting", zoneId: "zone-2" });

    await syncCloudflareAtlas({ at: LATER, client, home, progress: noopProgress, selection: SELECTION });

    const paths = cloudflareAtlasPaths({ home });
    const after = unwrap(readCloudflareKindFile({ kind: "zone-setting", paths }))!;
    expect(after.entities).toHaveLength(2);
    expect(after.entities.find((entity) => entity.id === other.id)!.state).toBe("observed");
    expect(after.entities.find((entity) => entity.scope.zoneId === "zone-1")!.lastSeenAt).toBe(LATER);
  });

  it("leaves a second zone's stored entities in place when a fan-out kind republishes (non-flat kind)", async () => {
    const client = createCloudflareClient({
      apiToken: "t",
      fetchImpl: allKindsFetch({
        certificatePacks: [{ id: "pack-1" }],
        zones: [{ id: "z1", name: "one.test" }],
      }),
      maxRetries: 0,
    });
    await syncCloudflareAtlas({ at: AT, client, home, progress: noopProgress, selection: SELECTION });
    const other = seedSecondZone({ home, kind: "zone-certificate", zoneId: "zone-2" });

    await syncCloudflareAtlas({ at: LATER, client, home, progress: noopProgress, selection: SELECTION });

    const paths = cloudflareAtlasPaths({ home });
    const after = unwrap(readCloudflareKindFile({ kind: "zone-certificate", paths }))!;
    expect(after.entities.filter((entity) => entity.scope.zoneId === "zone-2").map((entity) => entity.id)).toEqual([
      other.id,
    ]);
  });

  it("refuses to publish a different selection than the one the atlas is already scoped to", async () => {
    const client = createCloudflareClient({
      apiToken: "t",
      fetchImpl: allKindsFetch({ zones: [{ id: "z1", name: "one.test" }] }),
      maxRetries: 0,
    });
    await syncCloudflareAtlas({ at: AT, client, home, progress: noopProgress, selection: SELECTION });

    const otherSelection = { accountId: "b".repeat(32), deepZone: { id: "zone-2", name: "other.test" } };
    const result = await syncCloudflareAtlas({
      at: LATER,
      client,
      home,
      progress: noopProgress,
      selection: otherSelection,
    });
    expect(unwrapErr(result).some((line) => line.includes("cloudflare reset"))).toBe(true);
  });

  it("refuses to run while the sync lock is already held", async () => {
    const lock = acquireOperationLock({ home, key: "cloudflare-atlas-sync", nowIso: AT });
    expect(lock.isOk()).toBe(true);
    const client = createCloudflareClient({ apiToken: "t", fetchImpl: allKindsFetch({}), maxRetries: 0 });
    const result = await syncCloudflareAtlas({ at: AT, client, home, progress: noopProgress, selection: SELECTION });
    expect(unwrapErr(result).some((line) => line.includes("lock"))).toBe(true);
  });
});
