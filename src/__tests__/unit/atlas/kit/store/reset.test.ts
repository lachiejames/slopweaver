/**
 * What `resetAtlas` does to a published generation: archives it whole and installs a fresh empty one, refuses
 * with nothing to reset or an archive already in place, and puts the archive back when the empty publish fails.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { readKindFileIfPresent } from "../../../../../atlas/atlasFile.js";
import { publishAtlas } from "../../../../../atlas/kit/publish.js";
import { resetAtlas } from "../../../../../atlas/kit/reset.js";
import { type AtlasStorePaths, readAtlas } from "../../../../../atlas/kit/store.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import { AT, EMPTY_MANIFEST, file, type Kind, live, manifestAfterSync, paths, SPEC } from "./harness.js";

describe("resetAtlas", () => {
  it("archives the whole generation and installs a fresh empty one, deleting nothing", () => {
    const root = mkdtempSync(join(tmpdir(), "atlas-kit-"));
    const resolved = paths({ root });
    unwrap(
      publishAtlas({
        files: { thing: file({ ids: ["a"] }) },
        manifest: manifestAfterSync(),
        paths: resolved,
        derivedFrom: live({ paths: resolved }),
        spec: SPEC,
      }),
    );
    const outcome = unwrap(
      resetAtlas({
        at: AT,
        emptyFiles: { thing: file({ ids: [] }) },
        emptyManifest: EMPTY_MANIFEST,
        paths: resolved,
        spec: SPEC,
      }),
    );
    expect(outcome.archivedTo).toBe(join(resolved.superseded, "2026-08-27T00-00-00.000Z"));

    const archived = unwrap(readKindFileIfPresent({ path: join(outcome.archivedTo, "thing.jsonl") }))!;
    expect(archived.entities.length).toBe(1);

    const current = unwrap(readAtlas({ paths: resolved, spec: SPEC }));
    expect(current.files.thing!.entities.length).toBe(0);
    rmSync(root, { force: true, recursive: true });
  });

  it("refuses when there is no current generation to reset", () => {
    const root = mkdtempSync(join(tmpdir(), "atlas-kit-"));
    const failure = unwrapErr(
      resetAtlas({
        at: AT,
        emptyFiles: { thing: file({ ids: [] }) },
        emptyManifest: EMPTY_MANIFEST,
        paths: paths({ root }),
        spec: SPEC,
      }),
    );
    expect(failure[0]).toContain("nothing to reset");
    rmSync(root, { force: true, recursive: true });
  });

  it("refuses to overwrite an archive that already exists", () => {
    const root = mkdtempSync(join(tmpdir(), "atlas-kit-"));
    const resolved = paths({ root });
    const install = (): void => {
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
    install();
    unwrap(
      resetAtlas({
        at: AT,
        emptyFiles: { thing: file({ ids: [] }) },
        emptyManifest: EMPTY_MANIFEST,
        paths: resolved,
        spec: SPEC,
      }),
    );
    install();
    const failure = unwrapErr(
      resetAtlas({
        at: AT,
        emptyFiles: { thing: file({ ids: [] }) },
        emptyManifest: EMPTY_MANIFEST,
        paths: resolved,
        spec: SPEC,
      }),
    );
    expect(failure[0]).toContain("refusing to overwrite it");
    rmSync(root, { force: true, recursive: true });
  });

  // `publishAtlas` creates the generation directory before it writes a kind file, so a publish that fails
  // part-way leaves a stump exactly where the archive has to go back. The restore used to read that stump
  // as "already restored", skip the rename and report success — the archive stayed in `_superseded`, the
  // live path held nothing, and the reported reason said the opposite. Asserted on the FILES rather than
  // on the message, because the message was the part that lied.
  it("puts the archive back when publishing the empty generation fails after the directory exists", () => {
    const root = mkdtempSync(join(tmpdir(), "atlas-kit-"));
    const resolved = paths({ root });
    unwrap(
      publishAtlas({
        files: { thing: file({ ids: ["a"] }) },
        manifest: manifestAfterSync(),
        paths: resolved,
        derivedFrom: live({ paths: resolved }),
        spec: SPEC,
      }),
    );
    const before = readFileSync(resolved.kinds.thing, "utf8");
    const manifestBefore = readFileSync(resolved.manifest, "utf8");

    // A regular file where the kind file's PARENT directory has to be, so the write fails with ENOTDIR
    // after `publishAtlas` has already created the generation directory. No mock: a real failing write.
    writeFileSync(join(root, "blocked"), "not a directory", "utf8");
    const sabotaged: AtlasStorePaths<Kind> = {
      directory: resolved.directory,
      home: resolved.home,
      kinds: { thing: join(root, "blocked", "thing.jsonl") },
      manifest: resolved.manifest,
      superseded: resolved.superseded,
    };

    const failure = unwrapErr(
      resetAtlas({
        at: AT,
        emptyFiles: { thing: file({ ids: [] }) },
        emptyManifest: EMPTY_MANIFEST,
        paths: sabotaged,
        spec: SPEC,
      }),
    );
    expect(failure[failure.length - 1]).toBe("the archived generation was restored; nothing was reset");

    expect(readFileSync(resolved.kinds.thing, "utf8")).toBe(before);
    expect(readFileSync(resolved.manifest, "utf8")).toBe(manifestBefore);
    expect(existsSync(join(resolved.superseded, "2026-08-27T00-00-00.000Z"))).toBe(false);
    rmSync(root, { force: true, recursive: true });
  });
});
