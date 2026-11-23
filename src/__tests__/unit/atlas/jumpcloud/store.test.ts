import { describe, expect, it } from "vitest";

import { initialJumpcloudManifest, type JumpcloudKindStatus } from "../../../../atlas/jumpcloud/entities.js";
import { JUMPCLOUD_KINDS } from "../../../../atlas/jumpcloud/model.js";
import {
  guardJumpcloudPublish,
  jumpcloudAtlasPaths,
  stampJumpcloudManifest,
} from "../../../../atlas/jumpcloud/store.js";
import { PLACEHOLDER_CLOCK } from "../../../../atlas/kit/manifestClock.js";
import { unwrapErr } from "../../../../lib/result.js";

const AT = "2026-09-04T10:00:00.000Z";

describe("jumpcloudAtlasPaths", () => {
  it("resolves one file per declared kind, and no others", () => {
    const paths = jumpcloudAtlasPaths({ home: "/tmp/state-root" });
    expect(Object.keys(paths.kinds).toSorted()).toEqual([...JUMPCLOUD_KINDS].toSorted());
  });

  it("writes the manifest last, beside the kind files it names", () => {
    const paths = jumpcloudAtlasPaths({ home: "/tmp/state-root" });
    expect(paths.manifest).toBe("/tmp/state-root/atlas/jumpcloud/manifest.json");
    expect(paths.kinds.systems).toBe("/tmp/state-root/atlas/jumpcloud/systems.jsonl");
  });
});

describe("stampJumpcloudManifest", () => {
  it("stamps this run's statuses and leaves the clock for publication to derive", () => {
    const status: JumpcloudKindStatus = {
      digest: "d",
      entityCount: 3,
      lastAttempt: { at: AT, outcome: "ok", reasons: [] },
      lastSuccessAt: AT,
    };
    const manifest = stampJumpcloudManifest({ prior: null, statuses: { systems: status } });
    expect(manifest.kinds.systems?.lastSuccessAt).toBe(AT);
    // Not AT: nothing but `publishAtlas` sets this, and it sets it from the kind files it writes.
    expect(manifest.updatedAt).toBe(PLACEHOLDER_CLOCK);
  });

  it("carries a kind this run did not touch forward exactly as it was, clock included", () => {
    const prior = initialJumpcloudManifest({ updatedAt: AT });
    const manifest = stampJumpcloudManifest({ prior, statuses: {} });
    expect(manifest.kinds.policies).toEqual(prior.kinds.policies);
    expect(manifest.updatedAt).toBe(AT);
  });
});

describe("guardJumpcloudPublish", () => {
  // The clock check this guard used to carry is GONE, not moved here: `publishAtlas` derives the clock as
  // the maximum over the kind files a generation vouches for, so a manifest behind a success it grades is
  // unrepresentable. `unit/atlas/kit/manifestClock.test.ts` asserts that invariant directly, which is what a
  // check that can no longer fail must be replaced by rather than kept as reassurance.

  it("refuses a count that describes a file this generation never wrote", () => {
    const base = initialJumpcloudManifest({ updatedAt: AT });
    const guarded = guardJumpcloudPublish({
      next: {
        ...base,
        kinds: { ...base.kinds, systems: { digest: null, entityCount: 240, lastAttempt: null, lastSuccessAt: null } },
      },
    });
    expect(unwrapErr(guarded)[0]).toContain("carries no file digest");
  });

  it("prints the incoherence and then the not-published line, whole", () => {
    const base = initialJumpcloudManifest({ updatedAt: AT });
    const guarded = guardJumpcloudPublish({
      next: {
        ...base,
        kinds: { ...base.kinds, systems: { digest: null, entityCount: 240, lastAttempt: null, lastSuccessAt: null } },
      },
    });
    expect(unwrapErr(guarded)).toEqual([
      "systems is graded with 240 entities but carries no file digest — the count describes a file this generation never wrote",
      "nothing was written — this generation is not published",
    ]);
  });

  it("refuses a success with no success time, which could never be graded for freshness", () => {
    const base = initialJumpcloudManifest({ updatedAt: AT });
    const guarded = guardJumpcloudPublish({
      next: {
        ...base,
        kinds: {
          ...base.kinds,
          systems: {
            digest: "d",
            entityCount: 0,
            lastAttempt: { at: AT, outcome: "ok" as const, reasons: [] },
            lastSuccessAt: null,
          },
        },
      },
    });
    expect(unwrapErr(guarded)[0]).toContain("no success time");
  });

  it("admits a coherent, freshly stamped manifest", () => {
    expect(guardJumpcloudPublish({ next: initialJumpcloudManifest({ updatedAt: AT }) }).isOk()).toBe(true);
  });
});
