/**
 * The manifest clock a kit publish writes is derived from the kind files rather than taken from the caller: a
 * stale or an advanced clock is replaced by the files' own, a kind file the publish leaves alone still counts,
 * and a kind whose file and just-recorded success disagree is refused while a carried-through status is not.
 */
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { PLACEHOLDER_CLOCK } from "../../../../../atlas/kit/manifestClock.js";
import { publishAtlas } from "../../../../../atlas/kit/publish.js";
import { readManifest } from "../../../../../atlas/kit/store.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import { ATTEMPT_STAMPING_SPEC, file, live, manifestAfterSync, paths, SPEC } from "./harness.js";

describe("the manifest clock is derived from the files, not asserted by the caller", () => {
  it("republishes the 1Password shape and stamps the FILE's clock, not the stale one handed in", () => {
    // The measured defect, reproduced at the seam: a caller hands in a manifest still carrying the clock the
    // previous generation had, while the kind file it is publishing is five days newer. Before this, the
    // stale clock went straight to disk and `atlas doctor` reported the generation five days stale.
    const STALE = "2026-08-29T05:44:23.607Z";
    const FRESH = "2026-09-03T17:17:14.637Z";
    const root = mkdtempSync(join(tmpdir(), "atlas-kit-"));
    const resolved = paths({ root });
    unwrap(
      publishAtlas({
        files: { thing: file({ ids: ["a"], updatedAt: FRESH }) },
        manifest: {
          kinds: { thing: { digest: null, entityCount: 0, lastAttempt: null, lastSuccessAt: FRESH } },
          schemaVersion: 1,
          updatedAt: STALE,
        },
        paths: resolved,
        derivedFrom: live({ paths: resolved }),
        spec: SPEC,
      }),
    );
    const published = unwrap(readManifest({ paths: resolved, spec: SPEC }));
    expect(published?.updatedAt).toBe(FRESH);
    rmSync(root, { force: true, recursive: true });
  });

  it("will not let a caller push the clock PAST the files it is publishing either", () => {
    const EARLY = "2026-08-29T05:44:23.607Z";
    const CLAIMED = "2026-09-03T17:17:14.637Z";
    const root = mkdtempSync(join(tmpdir(), "atlas-kit-"));
    const resolved = paths({ root });
    unwrap(
      publishAtlas({
        files: { thing: file({ ids: ["a"], updatedAt: EARLY }) },
        manifest: {
          kinds: { thing: { digest: null, entityCount: 0, lastAttempt: null, lastSuccessAt: EARLY } },
          schemaVersion: 1,
          updatedAt: CLAIMED,
        },
        paths: resolved,
        derivedFrom: live({ paths: resolved }),
        spec: SPEC,
      }),
    );
    const published = unwrap(readManifest({ paths: resolved, spec: SPEC }));
    expect(published?.updatedAt).toBe(EARLY);
    rmSync(root, { force: true, recursive: true });
  });

  it("counts a kind file this publish is LEAVING ALONE, read from its envelope on disk", () => {
    const FIRST = "2026-08-29T05:44:23.607Z";
    const SECOND = "2026-09-03T17:17:14.637Z";
    const root = mkdtempSync(join(tmpdir(), "atlas-kit-"));
    const resolved = paths({ root });
    unwrap(
      publishAtlas({
        files: { thing: file({ ids: ["a"], updatedAt: SECOND }) },
        manifest: manifestAfterSync(),
        paths: resolved,
        derivedFrom: live({ paths: resolved }),
        spec: SPEC,
      }),
    );
    // A second publish writing NO kind file at all still vouches for the one on disk, so the clock holds.
    // The manifest is the STORED one rather than a fresh `manifestAfterSync()`, because it has to carry the
    // digest the first publish stamped: a status claiming a success with no digest is what `incoherentKinds`
    // refuses, and a real caller passes `prior` through for exactly that reason.
    const stored = unwrap(readManifest({ paths: resolved, spec: SPEC }))!;
    unwrap(
      publishAtlas({
        files: {},
        manifest: { ...stored, updatedAt: FIRST },
        paths: resolved,
        derivedFrom: live({ paths: resolved }),
        spec: SPEC,
      }),
    );
    const published = unwrap(readManifest({ paths: resolved, spec: SPEC }));
    expect(published?.updatedAt).toBe(SECOND);
    rmSync(root, { force: true, recursive: true });
  });

  it("refuses a kind whose file and its own just-recorded success disagree", () => {
    const FILE_AT = "2026-09-03T17:17:14.637Z";
    const SUCCESS_AT = "2026-08-29T05:44:23.607Z";
    const root = mkdtempSync(join(tmpdir(), "atlas-kit-"));
    const resolved = paths({ root });
    const refused = publishAtlas({
      files: { thing: file({ ids: ["a"], updatedAt: FILE_AT }) },
      // ATTEMPT_STAMPING_SPEC, because `SPEC`'s own status schema types `lastAttempt` as `null` and this
      // check is precisely about a kind whose attempt SUCCEEDED. The attempt is stamped at the FILE's own
      // instant: this publish is the one that recorded it, and it still claims an older success.
      manifest: {
        kinds: {
          thing: {
            digest: null,
            entityCount: 0,
            lastAttempt: { at: FILE_AT, outcome: "ok", reasons: [] },
            lastSuccessAt: SUCCESS_AT,
          },
        },
        schemaVersion: 1,
        updatedAt: PLACEHOLDER_CLOCK,
      },
      paths: resolved,
      derivedFrom: live({ paths: resolved }),
      spec: ATTEMPT_STAMPING_SPEC,
    });
    expect(refused.isErr()).toBe(true);
    expect(unwrapErr(refused)[0]).toContain("carries two clocks");
    expect(existsSync(resolved.manifest)).toBe(false);
    rmSync(root, { force: true, recursive: true });
  });

  it("allows a publish that writes a kind's file while carrying an EARLIER run's status through", () => {
    const FILE_AT = "2026-09-03T17:17:14.637Z";
    const SYNCED_AT = "2026-08-29T05:44:23.607Z";
    const root = mkdtempSync(join(tmpdir(), "atlas-kit-"));
    const resolved = paths({ root });
    // `atlas vanta shot`'s shape: it merges a browser-discovered deep link onto only some of the controls, so the
    // file moves and the kind's own acquisition did NOT happen. Stamping a fresh success would make a
    // week-old sync read as current, which is what `lastSuccessAt` exists to prevent.
    const published = publishAtlas({
      files: { thing: file({ ids: ["a"], updatedAt: FILE_AT }) },
      manifest: {
        kinds: {
          thing: {
            digest: null,
            entityCount: 1,
            lastAttempt: { at: SYNCED_AT, outcome: "ok", reasons: [] },
            lastSuccessAt: SYNCED_AT,
          },
        },
        schemaVersion: 1,
        updatedAt: PLACEHOLDER_CLOCK,
      },
      paths: resolved,
      derivedFrom: live({ paths: resolved }),
      spec: ATTEMPT_STAMPING_SPEC,
    });
    expect(published.isOk()).toBe(true);
    expect(unwrap(readManifest({ paths: resolved, spec: ATTEMPT_STAMPING_SPEC }))?.kinds.thing.lastSuccessAt).toBe(
      SYNCED_AT,
    );
    rmSync(root, { force: true, recursive: true });
  });
});
