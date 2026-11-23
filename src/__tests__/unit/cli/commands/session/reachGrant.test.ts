import { describe, expect, it } from "vitest";

import { runSessionReachGrant } from "../../../../../cli/commands/session/reachGrant.js";

/** A full argv for `slopweaver session reach-grant`, since the runner slices past the noun and verb. */
function argv({ rest }: { rest: readonly string[] }): readonly string[] {
  return ["node", "slopweaver", "session", "reach-grant", ...rest];
}

describe("session reach-grant argument guards", () => {
  it("prints usage and succeeds on --help", async () => {
    expect(await runSessionReachGrant(argv({ rest: ["--help"] }))).toBe(0);
  });

  it("refuses with no --tool", async () => {
    expect(await runSessionReachGrant(argv({ rest: ["--reason", "why"] }))).toBe(2);
  });

  it("refuses a tool that is not in the production-facing class", async () => {
    // `gcloud` IS blocked by the classifier, but through the ordinary env-var escape — pointing it at this
    // verb would tell a reader the wrong hatch, so the verb refuses rather than recording a useless grant.
    expect(await runSessionReachGrant(argv({ rest: ["--tool", "gcloud", "--reason", "why"] }))).toBe(2);
    expect(await runSessionReachGrant(argv({ rest: ["--tool", "curl", "--reason", "why"] }))).toBe(2);
  });

  it("refuses a blank reason on a valid tool", async () => {
    // Checked AFTER the tool, and asserted separately, so a passing tool check cannot mask a missing reason.
    expect(await runSessionReachGrant(argv({ rest: ["--tool", "twilio", "--reason", "   "] }))).toBe(2);
    expect(await runSessionReachGrant(argv({ rest: ["--tool", "twilio"] }))).toBe(2);
  });
});
