/**
 * The gate that stands between a stale form and someone else's work. Pure, so no seam is needed.
 *
 * deleted-with-code: destinationConflicts
 */
import { describe, expect, it } from "vitest";

import { updateSafety } from "../../cli/commands/linear/core.js";

const SEEN = "aaaa1111bbbb2222cccc3333dddd4444";
const MOVED = "9999ffff8888eeee7777dddd6666cccc";

describe("updateSafety", () => {
  it("allows a body replacement when nothing changed since our last write", () => {
    expect(
      updateSafety({ lastSeenDescriptionHash: SEEN, remoteDescriptionHash: SEEN, scope: "replace-body" }).safe,
    ).toBe(true);
  });

  it("REFUSES a body replacement when the DESCRIPTION changed since our last write", () => {
    // Compares prose, not the clock: Linear moves `updatedAt` by itself after a create, so a timestamp
    // check refused every first update as a phantom conflict. Measured on a live issue.
    const result = updateSafety({
      lastSeenDescriptionHash: SEEN,
      remoteDescriptionHash: MOVED,
      scope: "replace-body",
    });

    expect(result.safe).toBe(false);
    expect(result.safe === false && result.reason).toContain("would discard whatever changed");
  });

  it("REFUSES when we have no record of our last write, rather than assuming nothing changed", () => {
    const result = updateSafety({
      lastSeenDescriptionHash: undefined,
      remoteDescriptionHash: SEEN,
      scope: "replace-body",
    });

    expect(result.safe).toBe(false);
    expect(result.safe === false && result.reason).toContain("cannot tell whether anyone has edited");
  });

  it("allows a fields-only update even on a changed issue, because it sends no description", () => {
    // The honest answer to "edit one field": do not send prose at all, so prose cannot be clobbered.
    expect(
      updateSafety({ lastSeenDescriptionHash: undefined, remoteDescriptionHash: MOVED, scope: "fields-only" }).safe,
    ).toBe(true);
  });
});
