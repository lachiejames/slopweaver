/**
 * A permission boundary is a FIELD a reader branches on, so its schema is the contract: a whole block parses, and
 * a block that cannot name the grant that would unblock it is describing a broken read, not a boundary.
 */
import { describe, expect, it } from "vitest";

import { atlasPermissionBlockSchema } from "../../../../atlas/kit/permissionBlock.js";

const BLOCK = {
  at: "2026-09-07T03:00:00.000Z",
  detail: "403 insufficient_scope: admin:org",
  unblockedBy: "the admin:org scope on the token",
};

describe("atlasPermissionBlockSchema", () => {
  it("parses a whole block unchanged", () => {
    expect(atlasPermissionBlockSchema.parse(BLOCK)).toEqual(BLOCK);
  });

  it("refuses a block that names no grant to unblock it", () => {
    const parsed = atlasPermissionBlockSchema.safeParse({ ...BLOCK, unblockedBy: "" });

    expect(parsed.success).toBe(false);
    expect(parsed.error!.issues.map((issue) => issue.path.join("."))).toEqual(["unblockedBy"]);
  });

  it("refuses an empty detail", () => {
    const parsed = atlasPermissionBlockSchema.safeParse({ ...BLOCK, detail: "" });

    expect(parsed.error!.issues.map((issue) => issue.path.join("."))).toEqual(["detail"]);
  });

  it("refuses an observation instant that is not an ISO datetime", () => {
    const parsed = atlasPermissionBlockSchema.safeParse({ ...BLOCK, at: "7 Sep 2026" });

    expect(parsed.error!.issues.map((issue) => issue.path.join("."))).toEqual(["at"]);
  });

  it("refuses an unknown key, because the schema is strict", () => {
    const parsed = atlasPermissionBlockSchema.safeParse({ ...BLOCK, scope: "admin:org" });

    expect(parsed.error!.issues.map((issue) => issue.code)).toEqual(["unrecognized_keys"]);
  });
});
