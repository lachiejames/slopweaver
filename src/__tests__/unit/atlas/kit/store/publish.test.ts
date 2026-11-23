/**
 * What a kit publish writes: kind files before the manifest with a digest and count stamped from the bytes,
 * identical bytes for the same generation published twice, and the platform's own publish guard either refusing
 * with nothing written or letting the publish through.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { publishAtlas } from "../../../../../atlas/kit/publish.js";
import { type AtlasStoreSpec, readManifest } from "../../../../../atlas/kit/store.js";
import { err, ok, unwrap, unwrapErr } from "../../../../../lib/result.js";
import {
  EMPTY_MANIFEST,
  type File,
  file,
  type Kind,
  live,
  type Manifest,
  manifestAfterSync,
  paths,
  SPEC,
} from "./harness.js";

describe("the kit generation protocol", () => {
  it("writes kind files before the manifest, and stamps a digest and count from the bytes written", () => {
    const root = mkdtempSync(join(tmpdir(), "atlas-kit-"));
    const resolved = paths({ root });
    const written = unwrap(
      publishAtlas({
        files: { thing: file({ ids: ["b", "a"] }) },
        manifest: manifestAfterSync(),
        paths: resolved,
        derivedFrom: live({ paths: resolved }),
        spec: SPEC,
      }),
    );
    expect(written).toEqual([resolved.kinds.thing, resolved.manifest]);

    const manifest = unwrap(readManifest({ paths: resolved, spec: SPEC }))!;
    expect(manifest.kinds.thing.entityCount).toBe(2);
    expect(manifest.kinds.thing.digest!.length).toBe(64);
    rmSync(root, { force: true, recursive: true });
  });

  it("publishes identical bytes when the same generation is published twice", () => {
    const root = mkdtempSync(join(tmpdir(), "atlas-kit-"));
    const resolved = paths({ root });
    const publish = (): void => {
      unwrap(
        publishAtlas({
          files: { thing: file({ ids: ["a"] }) },
          manifest: manifestAfterSync(),
          paths: resolved,
          derivedFrom: live({ paths: resolved }),
          spec: SPEC,
        }),
      );
    };
    publish();
    const first = readFileSync(resolved.manifest, "utf8");
    publish();
    expect(readFileSync(resolved.manifest, "utf8")).toBe(first);
    rmSync(root, { force: true, recursive: true });
  });

  it("writes nothing at all when the platform's own publish guard refuses", () => {
    const root = mkdtempSync(join(tmpdir(), "atlas-kit-"));
    const resolved = paths({ root });
    const guarded: AtlasStoreSpec<Kind, File, Manifest> = {
      ...SPEC,
      guardPublish: () => err(["this generation belongs to a different account"]),
    };
    const failure = unwrapErr(
      publishAtlas({
        files: { thing: file({ ids: ["a"] }) },
        manifest: EMPTY_MANIFEST,
        paths: resolved,
        derivedFrom: live({ paths: resolved }),
        spec: guarded,
      }),
    );
    expect(failure[0]).toBe("this generation belongs to a different account");
    expect(failure[1]).toContain("nothing was written");
    expect(unwrap(readManifest({ paths: resolved, spec: SPEC }))).toBe(null);
    rmSync(root, { force: true, recursive: true });
  });

  it("lets a publish through when the platform's guard is satisfied", () => {
    const root = mkdtempSync(join(tmpdir(), "atlas-kit-"));
    const resolved = paths({ root });
    const guarded: AtlasStoreSpec<Kind, File, Manifest> = { ...SPEC, guardPublish: () => ok(null) };
    const written = unwrap(
      publishAtlas({
        files: { thing: file({ ids: ["a"] }) },
        manifest: EMPTY_MANIFEST,
        paths: resolved,
        derivedFrom: live({ paths: resolved }),
        spec: guarded,
      }),
    );
    expect(written.length).toBe(2);
    rmSync(root, { force: true, recursive: true });
  });
});
