/**
 * `github landing --drafts-only`: the tick's second reading, which boards the owner's drafts without ever riding the
 * press read. It must read drafts alone, keep its own cadence, and refuse every flag that would make it press or
 * record a partial picture as the whole one.
 */
import { describe, expect, it } from "vitest";

import { fleetReadArgs, parseGithubLandingArgs } from "../../../../../cli/commands/github/landingCore.js";
import { draftsOnlyProblems } from "../../../../../cli/commands/github/landingDraftsOnly.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

describe("parseGithubLandingArgs --drafts-only", () => {
  it("reads drafts alone and includes them, beside --if-due and --register as the tick passes it", () => {
    const args = unwrap(
      parseGithubLandingArgs({ rest: ["--author", "@me", "--if-due", "--drafts-only", "--register", "--json"] }),
    );
    expect([args.draftsOnly, args.includeDrafts, args.ifDue, args.register]).toEqual([true, true, true, true]);
  });

  it("leaves draftsOnly false on the press read, which stays exactly as it was", () => {
    const args = unwrap(parseGithubLandingArgs({ rest: ["--author", "@me", "--if-due", "--press", "--register"] }));
    expect([args.draftsOnly, args.includeDrafts]).toEqual([false, false]);
  });

  it("refuses --press, because a draft has no button to press", () => {
    expect(unwrapErr(parseGithubLandingArgs({ rest: ["--drafts-only", "--press"] }))).toContain(
      "--drafts-only cannot be combined with --press: a draft has no button to press",
    );
  });

  it("refuses --record-reading, because the ledger holds the whole picture, never a drafts slice", () => {
    expect(
      unwrapErr(parseGithubLandingArgs({ rest: ["--author", "@me", "--drafts-only", "--record-reading", "tick"] })),
    ).toContain(
      "--drafts-only cannot be combined with --record-reading: the readings ledger holds the whole picture of the owner's pull requests, never a drafts slice",
    );
  });

  it("refuses --pr, which reads one pull request whole", () => {
    const problems = unwrapErr(parseGithubLandingArgs({ rest: ["--pr", "7", "--repo", "o/r", "--drafts-only"] }));
    expect(problems.some((line) => line.includes("--drafts-only"))).toBe(true);
  });

  it("passes draftsOnly through to the fleet read, which turns it into the server's draft:true", () => {
    const args = unwrap(parseGithubLandingArgs({ rest: ["--drafts-only"] }));
    expect(fleetReadArgs({ args, repos: ["o/r"] }).draftsOnly).toBe(true);
  });
});

describe("draftsOnlyProblems", () => {
  it("names nothing when the flag is absent, whatever else is set", () => {
    expect(draftsOnlyProblems({ values: { press: true, "record-reading": "tick" } })).toEqual([]);
  });

  it("names nothing for an unset or false companion flag", () => {
    expect(draftsOnlyProblems({ values: { "drafts-only": true, press: false } })).toEqual([]);
  });
});
