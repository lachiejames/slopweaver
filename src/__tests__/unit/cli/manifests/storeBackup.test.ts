/**
 * The `store` noun's backup-family metadata, checked on the two fields a gate reads.
 *
 * `admit/coverage.ts` fails any verb declaring `external-write` without `doorRouted`, so these two fields
 * decide whether the door governs a verb. They are plain data, which is exactly why nothing would notice
 * one flipping.
 */
import { describe, expect, it } from "vitest";

import { backupMeta, backupRegisterMeta, exclusionsMeta, restoreMeta } from "../../../../cli/manifests/storeBackup.js";

describe("the store backup family's metadata", () => {
  it("routes the one verb that writes off this machine through the door", () => {
    expect(backupMeta.effect).toBe("external-write");
    expect(backupMeta.doorRouted).toBe(true);
  });

  it("leaves the three local verbs off the door, because none of them leaves the machine", () => {
    expect([restoreMeta.effect, backupRegisterMeta.effect, exclusionsMeta.effect]).toEqual([
      "local-state",
      "local-state",
      "local-state",
    ]);
    expect([restoreMeta.doorRouted, backupRegisterMeta.doorRouted, exclusionsMeta.doorRouted]).toEqual([
      false,
      false,
      false,
    ]);
  });

  it("gives every row a usage line naming its own verb, so --help cannot describe a different one", () => {
    expect(backupMeta.usage.startsWith("usage: slopweaver store backup ")).toBe(true);
    expect(restoreMeta.usage.startsWith("usage: slopweaver store restore ")).toBe(true);
    expect(backupRegisterMeta.usage.startsWith("usage: slopweaver store backup-register ")).toBe(true);
    expect(exclusionsMeta.usage.startsWith("usage: slopweaver store exclusions ")).toBe(true);
  });
});
