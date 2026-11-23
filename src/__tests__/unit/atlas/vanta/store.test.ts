import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { emptyVantaKindFile, initialVantaManifest } from "../../../../atlas/vanta/model.js";
import {
  publishVantaAtlas,
  readVantaAtlas,
  readVantaKindFile,
  readVantaManifest,
  vantaAtlasJson,
  vantaAtlasPaths,
} from "../../../../atlas/vanta/store.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

const AT = "2026-01-01T00:00:00.000Z";

describe("vantaAtlasPaths", () => {
  it("resolves every path under $home/atlas/vanta", () => {
    const paths = vantaAtlasPaths({ home: "/tmp/sw-home" });
    expect(paths.directory).toBe("/tmp/sw-home/atlas/vanta");
    expect(paths.manifest).toBe("/tmp/sw-home/atlas/vanta/manifest.json");
    expect(paths.kinds.control).toBe("/tmp/sw-home/atlas/vanta/controls.jsonl");
    expect(paths.sensitive).toBe("/tmp/sw-home/atlas/vanta/_sensitive");
    expect(paths.superseded).toBe("/tmp/sw-home/atlas/_superseded/vanta");
  });
});

describe("read/publish round trip", () => {
  let home: string;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "vanta-store-"));
  });
  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  it("reads an absent manifest as null", () => {
    const paths = vantaAtlasPaths({ home });
    expect(unwrap(readVantaManifest({ paths }))).toBeNull();
  });

  it("reads an absent kind file as null", () => {
    const paths = vantaAtlasPaths({ home });
    expect(unwrap(readVantaKindFile({ kind: "control", paths }))).toBeNull();
  });

  it("publishes then reads back the same manifest and kind file", () => {
    const paths = vantaAtlasPaths({ home });
    const manifest = initialVantaManifest({ updatedAt: AT });
    const file = emptyVantaKindFile({ kind: "control", updatedAt: AT });
    const published = publishVantaAtlas({ derivedFrom: null, files: { control: file }, manifest, paths });
    expect(published.isOk()).toBe(true);

    const readManifest = unwrap(readVantaManifest({ paths }));
    expect(readManifest!.kinds.control.digest).not.toBeNull();
    const readFile = unwrap(readVantaKindFile({ kind: "control", paths }));
    expect(readFile).toEqual(file);
  });

  it("refuses a NEWER manifest and refuses to advise a reset, which would archive it", () => {
    const paths = vantaAtlasPaths({ home });
    const foreign = { ...initialVantaManifest({ updatedAt: AT }), schemaVersion: 999 };
    mkdirSync(paths.directory, { recursive: true });
    writeFileSync(paths.manifest, JSON.stringify(foreign), "utf8");
    const result = readVantaManifest({ paths });
    expect(result.isErr()).toBe(true);
    // 999 is NEWER than this build, so the remedy must NOT be this platform's own reset line — that is
    // the advice that archived a good generation. It names a newer build, and `restore`.
    expect(unwrapErr(result).some((line) => line.includes("vanta reset"))).toBe(false);
    expect(unwrapErr(result).some((line) => line.includes("this generation is NEWER than this build"))).toBe(true);
    expect(unwrapErr(result).some((line) => line.includes("slopweaver atlas vanta restore"))).toBe(true);
  });

  it("readVantaAtlas reports a kind as unpublished when its file exists but the manifest carries no success for it", () => {
    const paths = vantaAtlasPaths({ home });
    publishVantaAtlas({
      derivedFrom: null,
      files: { control: emptyVantaKindFile({ kind: "control", updatedAt: AT }) },
      manifest: initialVantaManifest({ updatedAt: AT }),
      paths,
    });
    const snapshot = unwrap(readVantaAtlas({ paths }));
    expect(snapshot.unpublished).toContain("control");
  });
});

describe("vantaAtlasJson", () => {
  it("matches the exact bytes the store writes", () => {
    expect(vantaAtlasJson({ value: { b: 2, a: 1 } })).toBe('{\n  "a": 1,\n  "b": 2\n}\n');
  });
});
