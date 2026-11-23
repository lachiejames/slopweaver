import { describe, expect, it } from "vitest";

import { isScannablePath, scanAtlasManifestClock } from "../../../devLint/atlasManifestClock.js";

describe("scanAtlasManifestClock", () => {
  it("catches the shape all four copies had — spread the manifest parameter, rewrite kinds", () => {
    // Reduced from `src/atlas/onepassword/sync.ts`'s `manifestUpdateFor` as it once stood.
    const content = [
      "function manifestUpdateFor({ manifest, outcome, at }: Args): Manifest {",
      "  return {",
      "    ...manifest,",
      "    kinds: { ...manifest.kinds, [outcome.kind]: { lastSuccessAt: at } },",
      "  };",
      "}",
    ].join("\n");
    const hits = scanAtlasManifestClock({ content, path: "src/atlas/onepassword/sync.ts" });
    expect(hits.length).toBe(1);
    expect(hits[0]?.line).toBe(2);
    expect(hits[0]?.message).toContain("spreads the parameter `manifest` and rewrites `kinds`");
  });

  it("catches it through a destructured options object, which is how every one of them was written", () => {
    const content = [
      "export function stampKindAttempt({ manifest, outcome, at }: Args): Manifest {",
      "  const status = manifest.kinds[outcome.kind];",
      "  return { ...manifest, kinds: { ...manifest.kinds, [outcome.kind]: status } };",
      "}",
    ].join("\n");
    expect(scanAtlasManifestClock({ content, path: "src/atlas/cloudflare/kindFold.ts" }).length).toBe(1);
  });

  it("passes a fresh manifest built from a CALL, which is a different job", () => {
    const content = [
      "function freshManifest({ at, kinds }: Args): Manifest {",
      "  return { ...initialCanvaManifest({ updatedAt: at }), kinds };",
      "}",
    ].join("\n");
    expect(scanAtlasManifestClock({ content, path: "src/atlas/canva/sync.ts" })).toEqual([]);
  });

  it("passes a fresh manifest bound to a LOCAL first, one line apart from the same call", () => {
    const content = [
      "function resetManifest({ at, kinds }: Args): Manifest {",
      "  const initial = initialCloudflareManifest({ updatedAt: at });",
      "  return { ...initial, kinds };",
      "}",
    ].join("\n");
    expect(scanAtlasManifestClock({ content, path: "src/atlas/cloudflare/reset.ts" })).toEqual([]);
  });

  it("passes the kit itself, which is where this function is SUPPOSED to live", () => {
    const content = [
      "export function withKindStatus({ manifest, kind, status }: Args): Manifest {",
      "  return { ...manifest, kinds: { ...manifest.kinds, [kind]: status } };",
      "}",
    ].join("\n");
    expect(scanAtlasManifestClock({ content, path: "src/atlas/kit/store.ts" })).toEqual([]);
  });

  it("passes a spread of a manifest that is not this function's own parameter", () => {
    const content = [
      "function build({ statuses }: Args): Manifest {",
      "  return { ...stored, kinds: { ...stored.kinds, ...statuses } };",
      "}",
    ].join("\n");
    expect(scanAtlasManifestClock({ content, path: "src/atlas/vanta/sync.ts" })).toEqual([]);
  });

  it("attributes a nested arrow's own parameters to the arrow, not to its enclosing function", () => {
    const content = [
      "function outer({ manifest }: Args): Manifest[] {",
      "  return [1].map((kinds) => ({ ...manifest, kinds }));",
      "}",
    ].join("\n");
    const hits = scanAtlasManifestClock({ content, path: "src/atlas/vanta/sync.ts" });
    expect(hits).toEqual([]);
  });

  it("says nothing about an object outside any function at all", () => {
    const content = "export const FIXED = { ...base, kinds: {} };";
    expect(scanAtlasManifestClock({ content, path: "src/atlas/vanta/model.ts" })).toEqual([]);
  });
});

describe("isScannablePath", () => {
  it("scans the atlas source tree", () => {
    expect(isScannablePath({ path: "src/atlas/vanta/sync.ts" })).toBe(true);
  });

  it("does not scan its own implementation, which contains the shape it looks for", () => {
    expect(isScannablePath({ path: "src/devLint/atlasManifestClock.ts" })).toBe(false);
  });

  it("does not scan a markdown file", () => {
    expect(isScannablePath({ path: "docs/architecture.md" })).toBe(false);
  });
});
