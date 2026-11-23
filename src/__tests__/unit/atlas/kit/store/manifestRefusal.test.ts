/**
 * Which manifests a kit read refuses, and the remedy each refusal names: a NEWER generation never advises a
 * reset, an OLDER one names the platform's own reset, and a corrupt file is refused rather than read as empty.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { publishAtlas } from "../../../../../atlas/kit/publish.js";
import { readManifest } from "../../../../../atlas/kit/store.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import { EMPTY_MANIFEST, file, live, paths, SPEC } from "./harness.js";

describe("the kit generation protocol", () => {
  it("refuses a NEWER generation without ever advising a reset, because that would archive it", () => {
    const root = mkdtempSync(join(tmpdir(), "atlas-kit-"));
    const resolved = paths({ root });
    unwrap(
      publishAtlas({
        files: { thing: file({ ids: ["a"] }) },
        manifest: EMPTY_MANIFEST,
        paths: resolved,
        derivedFrom: live({ paths: resolved }),
        spec: SPEC,
      }),
    );
    writeFileSync(resolved.manifest, JSON.stringify({ kinds: {}, schemaVersion: 99 }), "utf8");
    const failure = unwrapErr(readManifest({ paths: resolved, spec: SPEC }));
    expect(failure[0]).toContain("declares schema version 99");
    expect(failure[1]).toBe(
      "this generation is NEWER than this build, not corrupt — use a build that writes version 99. " +
        "Do NOT reset: that archives a generation this build cannot read but a newer one can. " +
        "A checkout already current on its upstream means the writer is on an unmerged branch — a worktree " +
        "session ran that branch's own sync into this home — so retry after it lands. " +
        "If a reset already happened, run: slopweaver atlas example restore",
    );
    rmSync(root, { force: true, recursive: true });
  });

  it("still names the platform's own reset remedy for an OLDER generation, where installing a fresh one is sane", () => {
    const root = mkdtempSync(join(tmpdir(), "atlas-kit-"));
    const resolved = paths({ root });
    unwrap(
      publishAtlas({
        files: { thing: file({ ids: ["a"] }) },
        manifest: EMPTY_MANIFEST,
        paths: resolved,
        derivedFrom: live({ paths: resolved }),
        spec: SPEC,
      }),
    );
    // The other direction, so the branch is proven to fire both ways rather than always taking one arm.
    writeFileSync(resolved.manifest, JSON.stringify({ kinds: {}, schemaVersion: 0 }), "utf8");
    const failure = unwrapErr(readManifest({ paths: resolved, spec: SPEC }));
    expect(failure[0]).toContain("declares schema version 0");
    expect(failure[1]).toBe("run: slopweaver atlas example reset");
    rmSync(root, { force: true, recursive: true });
  });

  it("refuses a corrupt file rather than reading it as an empty atlas", () => {
    const root = mkdtempSync(join(tmpdir(), "atlas-kit-"));
    const resolved = paths({ root });
    unwrap(
      publishAtlas({
        files: { thing: file({ ids: ["a"] }) },
        manifest: EMPTY_MANIFEST,
        paths: resolved,
        derivedFrom: live({ paths: resolved }),
        spec: SPEC,
      }),
    );
    writeFileSync(resolved.manifest, "{not json", "utf8");
    const failure = unwrapErr(readManifest({ paths: resolved, spec: SPEC }));
    expect(failure[1]).toContain("refusing rather than treating a corrupt atlas as an empty one");
    rmSync(root, { force: true, recursive: true });
  });
});
