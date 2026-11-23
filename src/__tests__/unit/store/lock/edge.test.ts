/**
 * The lock edge's run lock: one never-stale lock for every stack, refusing a second run until the first releases.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "#lib/result.js";

import { holdStackLock } from "../../../../store/lock/edge.js";

describe("holdStackLock", () => {
  it("refuses a second run on any stack until the first releases, since stacks share a home's files", () => {
    const first = unwrap(holdStackLock({ projectId: "acme-held" }));
    const second = unwrapErr(holdStackLock({ projectId: "acme-held" }));
    expect(second.message).toContain("another `store lock` run is in progress");
    const other = unwrapErr(holdStackLock({ projectId: "acme-other" }));
    expect(other.message).toContain("another `store lock` run is in progress");
    first.release();
    const again = unwrap(holdStackLock({ projectId: "acme-held" }));
    again.release();
    expect(second.code).toBe("STEP_FAILED");
  });
});
