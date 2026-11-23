/**
 * Unit: the two Google atlases' path resolvers — one kind file per declared kind, under the platform's own directory.
 */
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { GOOGLE_ADMIN_ATLAS_KINDS } from "../../atlas/googleAdmin/model.js";
import { GOOGLE_SECOPS_ATLAS_KINDS } from "../../atlas/googleSecops/model.js";
import { googleAdminAtlasHomePaths, googleSecopsAtlasHomePaths } from "../../atlasHomeGoogle.js";

const ATLAS_ROOT = join("/h", "atlas");

describe("googleSecopsAtlasHomePaths", () => {
  it("files every SecOps kind under atlas/google-secops", () => {
    const paths = googleSecopsAtlasHomePaths({ atlasRoot: ATLAS_ROOT });
    expect(paths.root).toBe(join(ATLAS_ROOT, "google-secops"));
    expect(Object.keys(paths.kinds).toSorted()).toStrictEqual([...GOOGLE_SECOPS_ATLAS_KINDS].toSorted());
    expect(paths.kinds["rule"]).toBe(join(ATLAS_ROOT, "google-secops", "rules.jsonl"));
  });
});

describe("googleAdminAtlasHomePaths", () => {
  it("has kinds to compute from, so the guard below is not vacuously green", () => {
    expect(GOOGLE_ADMIN_ATLAS_KINDS.length).toBeGreaterThan(0);
  });

  it("computes one file per Admin kind, named for the kind", () => {
    const paths = googleAdminAtlasHomePaths({ atlasRoot: ATLAS_ROOT });
    expect(Object.keys(paths.kinds).toSorted()).toStrictEqual([...GOOGLE_ADMIN_ATLAS_KINDS].toSorted());
    expect(paths.kinds["directory-users"]).toBe(join(ATLAS_ROOT, "google-admin", "directory-users.jsonl"));
  });
});
