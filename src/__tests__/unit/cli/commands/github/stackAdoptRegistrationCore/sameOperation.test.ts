/**
 * `github stack adopt --register-only`'s pure decisions — the mode that registers a native stack membership
 * without replaying a commit, and so ends the deadlock where a drifted chained pull request could be neither
 * pushed nor adopted.
 */
import { describe, expect, it } from "vitest";

import { sameRegistrationOperation } from "../../../../../../cli/commands/github/stackAdoptRegistrationCore.js";

describe("sameRegistrationOperation", () => {
  it("treats an add that changed target stack as a different write, though the kind is identical", () => {
    expect(
      sameRegistrationOperation({
        current: { kind: "add", pullRequests: [100], stackNumber: 6 },
        planned: { kind: "add", pullRequests: [100], stackNumber: 5 },
      }),
    ).toBe(false);
  });

  it("accepts the identical add", () => {
    expect(
      sameRegistrationOperation({
        current: { kind: "add", pullRequests: [100], stackNumber: 5 },
        planned: { kind: "add", pullRequests: [100], stackNumber: 5 },
      }),
    ).toBe(true);
  });

  it("treats a create whose pair changed as a different write", () => {
    expect(
      sameRegistrationOperation({
        current: { kind: "create", pullRequests: [11, 100] },
        planned: { kind: "create", pullRequests: [10, 100] },
      }),
    ).toBe(false);
  });

  it("treats a create that became an add as a different write", () => {
    expect(
      sameRegistrationOperation({
        current: { kind: "add", pullRequests: [100], stackNumber: 5 },
        planned: { kind: "create", pullRequests: [10, 100] },
      }),
    ).toBe(false);
  });

  it("accepts the identical already-joined, and refuses one pointing at another stack", () => {
    expect(
      sameRegistrationOperation({
        current: { kind: "already-joined", stackNumber: 5 },
        planned: { kind: "already-joined", stackNumber: 5 },
      }),
    ).toBe(true);
    expect(
      sameRegistrationOperation({
        current: { kind: "already-joined", stackNumber: 6 },
        planned: { kind: "already-joined", stackNumber: 5 },
      }),
    ).toBe(false);
  });
});
