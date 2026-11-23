/**
 * How a kit read grades a kind file against the manifest: unpublished when the manifest does not vouch for it,
 * missing when a vouched-for file is gone, and superseded when the file sits on disk under the `.json` name the
 * format change left behind, even with no entities vouched for.
 */
import { mkdtempSync, renameSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { publishAtlas } from "../../../../../atlas/kit/publish.js";
import { readAtlas } from "../../../../../atlas/kit/store.js";
import { unwrap } from "../../../../../lib/result.js";
import { EMPTY_MANIFEST, file, live, manifestAfterSync, paths, SPEC } from "./harness.js";

describe("the kit generation protocol", () => {
  it("grades a kind file the manifest does not vouch for as unpublished", () => {
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
    const snapshot = unwrap(readAtlas({ paths: resolved, spec: SPEC }));
    expect([...snapshot.unpublished]).toEqual(["thing"]);
    expect([...snapshot.missing]).toEqual([]);
    rmSync(root, { force: true, recursive: true });
  });

  it("grades a file the manifest vouches for but that is gone as missing, not empty", () => {
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
    rmSync(resolved.kinds.thing);
    const snapshot = unwrap(readAtlas({ paths: resolved, spec: SPEC }));
    expect([...snapshot.missing]).toEqual(["thing"]);
    rmSync(root, { force: true, recursive: true });
  });

  it("grades a kind left behind by the .json to .jsonl format change as superseded, not missing", () => {
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
    renameSync(resolved.kinds.thing, join(root, "example", "thing.json"));
    const snapshot = unwrap(readAtlas({ paths: resolved, spec: SPEC }));
    expect([...snapshot.superseded]).toEqual(["thing"]);
    expect([...snapshot.missing]).toEqual([]);
    rmSync(root, { force: true, recursive: true });
  });

  // The state `kit/answerable.ts` cannot recover on its own: the manifest vouches for NO entities, so a
  // reader comparing published counts to projected ones has nothing to compare. Only the store can see that
  // a file is on disk under a name it no longer reads.
  it("grades a kind superseded even when the manifest vouches for none of its entities", () => {
    const root = mkdtempSync(join(tmpdir(), "atlas-kit-"));
    const resolved = paths({ root });
    unwrap(
      publishAtlas({
        files: { thing: file({ ids: [] }) },
        manifest: manifestAfterSync(),
        paths: resolved,
        derivedFrom: live({ paths: resolved }),
        spec: SPEC,
      }),
    );
    renameSync(resolved.kinds.thing, join(root, "example", "thing.json"));
    const snapshot = unwrap(readAtlas({ paths: resolved, spec: SPEC }));
    expect([...snapshot.superseded]).toEqual(["thing"]);
    expect([...snapshot.missing]).toEqual([]);
    rmSync(root, { force: true, recursive: true });
  });

  it("keeps grading a kind with no sibling in any format as missing", () => {
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
    rmSync(resolved.kinds.thing);
    const snapshot = unwrap(readAtlas({ paths: resolved, spec: SPEC }));
    expect([...snapshot.superseded]).toEqual([]);
    expect([...snapshot.missing]).toEqual(["thing"]);
    rmSync(root, { force: true, recursive: true });
  });
});
