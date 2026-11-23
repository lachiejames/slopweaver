/**
 * The exit code `atlas aether walk` ends on once a walk has published.
 *
 * The runner itself attaches to the owner's Chrome, writes screenshots and samples the clock, so it is not
 * driven here; `aetherWalkExitCode` is the runner's final judgement, extracted whole.
 */
import { describe, expect, it } from "vitest";

import { aetherWalkExitCode } from "../../../../../../cli/commands/atlas/aether/walkRun.js";

describe("aetherWalkExitCode", () => {
  it("ends on 3 when the walk hit the sign-in wall, even with findings recorded", () => {
    expect(aetherWalkExitCode({ outcome: { findingCount: 2, loggedOut: true } })).toBe(3);
  });

  it("ends on 3 when a signed-in walk recorded zero findings, and on 0 at one finding", () => {
    expect(aetherWalkExitCode({ outcome: { findingCount: 0, loggedOut: false } })).toBe(3);
    expect(aetherWalkExitCode({ outcome: { findingCount: 1, loggedOut: false } })).toBe(0);
  });
});
