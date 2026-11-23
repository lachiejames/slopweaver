/**
 * What a platform's `gradeNeverSucceeded` decides for a kind with no recorded success: a kind that honestly
 * recorded a failed attempt agrees, one with no attempt on record stays unpublished, and a kind with a recorded
 * success never consults it at all.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { PLACEHOLDER_CLOCK } from "../../../../../atlas/kit/manifestClock.js";
import { publishAtlas } from "../../../../../atlas/kit/publish.js";
import { readAtlas } from "../../../../../atlas/kit/store.js";
import { unwrap } from "../../../../../lib/result.js";
import { AT, ATTEMPT_STAMPING_SPEC, type AttemptedManifest, file, live, paths } from "./harness.js";

function attemptedManifest({ lastAttempt }: { lastAttempt: AttemptedManifest["kinds"]["thing"]["lastAttempt"] }) {
  return {
    kinds: { thing: { digest: null, entityCount: 0, lastAttempt, lastSuccessAt: null } },
    schemaVersion: 1,
    updatedAt: PLACEHOLDER_CLOCK,
  } satisfies AttemptedManifest;
}

describe("gradeNeverSucceeded", () => {
  it("grades a file whose kind honestly recorded a failed attempt as agreeing, not half-written", () => {
    const root = mkdtempSync(join(tmpdir(), "atlas-kit-"));
    const resolved = paths({ root });
    unwrap(
      publishAtlas({
        files: { thing: file({ ids: ["a"] }) },
        manifest: attemptedManifest({ lastAttempt: { at: AT, outcome: "failed", reasons: ["403"] } }),
        paths: resolved,
        derivedFrom: live({ paths: resolved }),
        spec: ATTEMPT_STAMPING_SPEC,
      }),
    );
    const snapshot = unwrap(readAtlas({ paths: resolved, spec: ATTEMPT_STAMPING_SPEC }));
    expect([...snapshot.unpublished]).toEqual([]);
    expect([...snapshot.missing]).toEqual([]);
    rmSync(root, { force: true, recursive: true });
  });

  it("still grades a file the manifest has no record of attempting as unpublished", () => {
    const root = mkdtempSync(join(tmpdir(), "atlas-kit-"));
    const resolved = paths({ root });
    unwrap(
      publishAtlas({
        files: { thing: file({ ids: ["a"] }) },
        manifest: attemptedManifest({ lastAttempt: null }),
        paths: resolved,
        derivedFrom: live({ paths: resolved }),
        spec: ATTEMPT_STAMPING_SPEC,
      }),
    );
    const snapshot = unwrap(readAtlas({ paths: resolved, spec: ATTEMPT_STAMPING_SPEC }));
    expect([...snapshot.unpublished]).toEqual(["thing"]);
    rmSync(root, { force: true, recursive: true });
  });

  it("is not consulted at all when the kind has a recorded success", () => {
    const root = mkdtempSync(join(tmpdir(), "atlas-kit-"));
    const resolved = paths({ root });
    unwrap(
      publishAtlas({
        files: { thing: file({ ids: ["a"] }) },
        manifest: {
          kinds: { thing: { digest: null, entityCount: 0, lastAttempt: null, lastSuccessAt: AT } },
          schemaVersion: 1,
          updatedAt: PLACEHOLDER_CLOCK,
        },
        paths: resolved,
        derivedFrom: live({ paths: resolved }),
        spec: ATTEMPT_STAMPING_SPEC,
      }),
    );
    const snapshot = unwrap(readAtlas({ paths: resolved, spec: ATTEMPT_STAMPING_SPEC }));
    expect([...snapshot.unpublished]).toEqual([]);
    expect([...snapshot.mismatched]).toEqual([]);
    rmSync(root, { force: true, recursive: true });
  });
});
