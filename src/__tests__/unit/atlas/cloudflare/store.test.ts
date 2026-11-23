import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { emptyCloudflareKindFile, initialCloudflareManifest } from "../../../../atlas/cloudflare/model.js";
import {
  cloudflareAtlasJson,
  cloudflareAtlasPaths,
  publishCloudflareAtlas,
  readCloudflareAtlas,
  readCloudflareKindFile,
  readCloudflareManifest,
} from "../../../../atlas/cloudflare/store.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

const AT = "2026-01-01T00:00:00.000Z";

describe("cloudflareAtlasPaths", () => {
  it("resolves every path under $home/atlas/cloudflare", () => {
    const paths = cloudflareAtlasPaths({ home: "/tmp/sw-home" });
    expect(paths.directory).toBe("/tmp/sw-home/atlas/cloudflare");
    expect(paths.manifest).toBe("/tmp/sw-home/atlas/cloudflare/manifest.json");
    expect(paths.kinds.zone).toBe("/tmp/sw-home/atlas/cloudflare/zone.jsonl");
    expect(paths.sensitive).toBe("/tmp/sw-home/atlas/cloudflare/_sensitive");
    expect(paths.superseded).toBe("/tmp/sw-home/atlas/_superseded/cloudflare");
  });
});

describe("read/publish round trip", () => {
  let home: string;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "cloudflare-store-"));
  });
  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  it("reads an absent manifest as null", () => {
    const paths = cloudflareAtlasPaths({ home });
    expect(unwrap(readCloudflareManifest({ paths }))).toBeNull();
  });

  it("reads an absent kind file as null", () => {
    const paths = cloudflareAtlasPaths({ home });
    expect(unwrap(readCloudflareKindFile({ kind: "zone", paths }))).toBeNull();
  });

  it("publishes then reads back the same manifest and kind file", () => {
    const paths = cloudflareAtlasPaths({ home });
    const manifest = initialCloudflareManifest({ updatedAt: AT });
    const file = emptyCloudflareKindFile({ kind: "zone", updatedAt: AT });
    const published = publishCloudflareAtlas({ derivedFrom: null, files: { zone: file }, manifest, paths });
    expect(published.isOk()).toBe(true);

    const readManifest = unwrap(readCloudflareManifest({ paths }));
    expect(readManifest!.kinds.zone.digest).not.toBeNull();
    const readFile = unwrap(readCloudflareKindFile({ kind: "zone", paths }));
    expect(readFile).toEqual(file);
  });

  it("round-trips a recorded selection through the manifest", () => {
    const paths = cloudflareAtlasPaths({ home });
    const manifest = {
      ...initialCloudflareManifest({ updatedAt: AT }),
      selection: { accountId: "0".repeat(32), deepZone: { id: "zone-id", name: "example.test" } },
    };
    publishCloudflareAtlas({ derivedFrom: null, files: {}, manifest, paths });
    const readManifest = unwrap(readCloudflareManifest({ paths }));
    expect(readManifest!.selection).toEqual(manifest.selection);
  });

  it("republishing the same selection succeeds — the ordinary repeated-sync case", () => {
    const paths = cloudflareAtlasPaths({ home });
    const manifest = {
      ...initialCloudflareManifest({ updatedAt: AT }),
      selection: { accountId: "0".repeat(32), deepZone: { id: "zone-id", name: "example.test" } },
    };
    expect(publishCloudflareAtlas({ derivedFrom: null, files: {}, manifest, paths }).isOk()).toBe(true);
    const held = unwrap(readCloudflareManifest({ paths }));
    expect(publishCloudflareAtlas({ derivedFrom: held, files: {}, manifest, paths }).isOk()).toBe(true);
  });

  it("allows the first selection over a published atlas that has recorded none yet", () => {
    const paths = cloudflareAtlasPaths({ home });
    publishCloudflareAtlas({
      derivedFrom: null,
      files: {},
      manifest: initialCloudflareManifest({ updatedAt: AT }),
      paths,
    });
    const selected = {
      ...initialCloudflareManifest({ updatedAt: AT }),
      selection: { accountId: "0".repeat(32), deepZone: { id: "zone-id", name: "example.test" } },
    };
    const held = unwrap(readCloudflareManifest({ paths }));
    expect(held!.selection).toBe(null);
    expect(publishCloudflareAtlas({ derivedFrom: held, files: {}, manifest: selected, paths }).isOk()).toBe(true);
  });

  it("refuses to publish a different account than the one the atlas is already selected for", () => {
    const paths = cloudflareAtlasPaths({ home });
    const first = {
      ...initialCloudflareManifest({ updatedAt: AT }),
      selection: { accountId: "0".repeat(32), deepZone: { id: "zone-id", name: "example.test" } },
    };
    expect(publishCloudflareAtlas({ derivedFrom: null, files: {}, manifest: first, paths }).isOk()).toBe(true);

    const second = {
      ...initialCloudflareManifest({ updatedAt: AT }),
      selection: { accountId: "1".repeat(32), deepZone: { id: "zone-id", name: "example.test" } },
    };
    const result = publishCloudflareAtlas({
      derivedFrom: unwrap(readCloudflareManifest({ paths })),
      files: {},
      manifest: second,
      paths,
    });
    expect(unwrapErr(result).some((line) => line.includes("cloudflare reset"))).toBe(true);
    expect(unwrap(readCloudflareManifest({ paths }))!.selection).toEqual(first.selection);
  });

  it("refuses to publish a different deep zone than the one the atlas is already selected for", () => {
    const paths = cloudflareAtlasPaths({ home });
    const first = {
      ...initialCloudflareManifest({ updatedAt: AT }),
      selection: { accountId: "0".repeat(32), deepZone: { id: "zone-a", name: "a.test" } },
    };
    publishCloudflareAtlas({ derivedFrom: null, files: {}, manifest: first, paths });

    const second = {
      ...initialCloudflareManifest({ updatedAt: AT }),
      selection: { accountId: "0".repeat(32), deepZone: { id: "zone-b", name: "b.test" } },
    };
    const result = publishCloudflareAtlas({
      derivedFrom: unwrap(readCloudflareManifest({ paths })),
      files: {},
      manifest: second,
      paths,
    });
    expect(unwrapErr(result).some((line) => line.includes("cloudflare reset"))).toBe(true);
  });

  it("refuses to publish a cleared selection over an atlas already selected", () => {
    const paths = cloudflareAtlasPaths({ home });
    const first = {
      ...initialCloudflareManifest({ updatedAt: AT }),
      selection: { accountId: "0".repeat(32), deepZone: { id: "zone-id", name: "example.test" } },
    };
    publishCloudflareAtlas({ derivedFrom: null, files: {}, manifest: first, paths });

    const cleared = initialCloudflareManifest({ updatedAt: AT });
    const result = publishCloudflareAtlas({
      derivedFrom: unwrap(readCloudflareManifest({ paths })),
      files: {},
      manifest: cleared,
      paths,
    });
    expect(unwrapErr(result).some((line) => line.includes("cloudflare reset"))).toBe(true);
  });

  it("refuses a NEWER manifest and refuses to advise a reset, which would archive it", () => {
    const paths = cloudflareAtlasPaths({ home });
    const foreign = { ...initialCloudflareManifest({ updatedAt: AT }), schemaVersion: 999 };
    mkdirSync(paths.directory, { recursive: true });
    writeFileSync(paths.manifest, JSON.stringify(foreign), "utf8");
    const result = readCloudflareManifest({ paths });
    expect(result.isErr()).toBe(true);
    // 999 is NEWER than this build, so the remedy must NOT be this platform's own reset line — that is
    // the advice that archived a good generation. It names a newer build, and `restore`.
    expect(unwrapErr(result).some((line) => line.includes("cloudflare reset"))).toBe(false);
    expect(unwrapErr(result).some((line) => line.includes("this generation is NEWER than this build"))).toBe(true);
    expect(unwrapErr(result).some((line) => line.includes("slopweaver atlas cloudflare restore"))).toBe(true);
  });

  it("readCloudflareAtlas reports a kind as unpublished when its file exists but the manifest has no record of ever attempting it", () => {
    const paths = cloudflareAtlasPaths({ home });
    publishCloudflareAtlas({
      derivedFrom: null,
      files: { zone: emptyCloudflareKindFile({ kind: "zone", updatedAt: AT }) },
      manifest: initialCloudflareManifest({ updatedAt: AT }),
      paths,
    });
    const snapshot = unwrap(readCloudflareAtlas({ paths }));
    expect(snapshot.unpublished).toContain("zone");
  });

  it("does not report a kind as unpublished when its most recent attempt is honestly recorded as failed", () => {
    const paths = cloudflareAtlasPaths({ home });
    const initial = initialCloudflareManifest({ updatedAt: AT });
    const manifest = {
      ...initial,
      kinds: {
        ...initial.kinds,
        zone: {
          digest: null,
          entityCount: 0,
          lastAttempt: { at: AT, outcome: "failed" as const, reasons: ["denied"] },
          lastSuccessAt: null,
        },
      },
    };
    publishCloudflareAtlas({
      derivedFrom: null,
      files: { zone: emptyCloudflareKindFile({ kind: "zone", updatedAt: AT }) },
      manifest,
      paths,
    });
    const snapshot = unwrap(readCloudflareAtlas({ paths }));
    expect(snapshot.unpublished).not.toContain("zone");
    expect(snapshot.missing).not.toContain("zone");
    expect(snapshot.mismatched).not.toContain("zone");
  });
});

describe("cloudflareAtlasJson", () => {
  it("matches the exact bytes the store writes", () => {
    expect(cloudflareAtlasJson({ value: { b: 2, a: 1 } })).toBe('{\n  "a": 1,\n  "b": 2\n}\n');
  });
});
