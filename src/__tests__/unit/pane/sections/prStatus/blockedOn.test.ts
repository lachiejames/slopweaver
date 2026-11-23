/*
 * What a pull request is blocked on: every state, a named person against a team, what Slack says about the ask,
 * and `none` kept apart from `unknown`.
 */
import { describe, expect, it } from "vitest";
import { measured } from "../../../../../measurement/status.js";
import { type BlockedOn, blockedOnFor, type PrRecord } from "../../../../../pane/sections/prStatus.js";
import type { SlackAsk } from "../../../../../pane/sections/slackAsk.js";
import { FRESH, pr } from "./harness.js";

/** Classify with no Slack asks, for the rungs that are about the GitHub half alone. */
function blockedFor({ pr: record, asks = [] }: { pr: PrRecord; asks?: readonly SlackAsk[] }): BlockedOn {
  return blockedOnFor({ asks, pr: record, window: FRESH });
}

describe("blockedOn — six states, and `none` is never `unknown`", () => {
  it("calls a ready pull request blocked on NOTHING", () => {
    const blocked = blockedFor({ pr: pr() });

    expect(blocked.kind).toBe("none");
    expect(blocked.why).toContain("nothing is blocking it");
  });

  it("calls a failing rollup CI, and names the check", () => {
    const blocked = blockedFor({
      pr: pr({ statusCheckRollup: [{ conclusion: "FAILURE", name: "build", status: "COMPLETED" }] }),
    });

    expect(blocked.kind).toBe("ci");
    expect(blocked.why).toContain("build");
  });

  it("calls a still-running rollup CI too — waiting is blocked, not ready", () => {
    expect(
      blockedFor({ pr: pr({ statusCheckRollup: [{ conclusion: "", name: "build", status: "IN_PROGRESS" }] }) }).kind,
    ).toBe("ci");
  });

  it("calls a conflicting branch a merge conflict", () => {
    expect(blockedFor({ pr: pr({ mergeable: "CONFLICTING" }) }).kind).toBe("conflict");
  });

  it("calls a required review with nobody asked REVIEW, not a person", () => {
    const blocked = blockedFor({ pr: pr({ reviewDecision: "REVIEW_REQUIRED", reviewRequests: [] }) });

    expect(blocked.kind).toBe("review");
    expect(blocked.why).toContain("review is required");
  });

  it("upgrades a required review to a PERSON once a NAMED USER has been asked, and names them", () => {
    const blocked = blockedFor({
      pr: pr({
        reviewDecision: "REVIEW_REQUIRED",
        reviewRequests: [
          { handle: "a-reviewer", kind: "user" },
          { handle: "a-team", kind: "team" },
        ],
      }),
    });

    expect(blocked.kind).toBe("person");
    expect(blocked.why).toContain("@a-reviewer");
  });

  it("calls a team-only request a TEAM, never a person, because a team is not someone to chase", () => {
    const blocked = blockedFor({
      pr: pr({ reviewDecision: "REVIEW_REQUIRED", reviewRequests: [{ handle: "a-team", kind: "team" }] }),
    });

    expect(blocked.kind).toBe("team");
    expect(blocked.why).toContain("only a team has been asked (@a-team)");
    expect(blocked.why).toContain("no one person to chase");
  });

  it("keeps a request gh did not type VISIBLE rather than dropping it into a false zero", () => {
    const blocked = blockedFor({
      pr: pr({ reviewDecision: "REVIEW_REQUIRED", reviewRequests: [{ handle: "", kind: "unknown" }] }),
    });

    expect(blocked.kind).toBe("review");
    expect(blocked.why).toContain("1 request(s) gh did not describe well enough to type");
  });

  it("names WHEN the owner last raised it in Slack, and with whom, on a person-blocked row", () => {
    const blocked = blockedFor({
      asks: [
        {
          atIso: "2026-08-01T00:00:00.000Z",
          author: "an-owner",
          named: ["a-reviewer"],
          permalink: "https://slack.example/p1",
          prUrl: "https://github.com/an-owner/a-repo/pull/1",
        },
      ],
      pr: pr({
        reviewDecision: "REVIEW_REQUIRED",
        reviewRequests: [{ handle: "a-reviewer", kind: "user" }],
        url: "https://github.com/an-owner/a-repo/pull/1",
      }),
    });

    expect(blocked.kind).toBe("person");
    expect(blocked.why).toContain("raised in Slack on 2026-08-01T00:00:00.000Z by @an-owner, naming @a-reviewer");
  });

  it("says plainly when a requested pull request was NEVER raised in Slack — the one that goes stale", () => {
    const blocked = blockedFor({
      pr: pr({ reviewDecision: "REVIEW_REQUIRED", reviewRequests: [{ handle: "a-reviewer", kind: "user" }] }),
    });

    expect(blocked.kind).toBe("person");
    expect(blocked.why).toContain(
      "NOT raised in any Slack conversation this corpus can read since 2000-01-01T00:00:00.000Z",
    );
  });

  it("REFUSES to claim the owner never raised it when the corpus is older than the pull request", () => {
    const blocked = blockedOnFor({
      asks: [],
      pr: pr({
        reviewDecision: "REVIEW_REQUIRED",
        reviewRequests: [{ handle: "a-reviewer", kind: "user" }],
        updatedAt: "2026-08-08T00:00:00.000Z",
      }),
      window: { newestIso: measured({ value: "2026-07-01T00:00:00.000Z" }), startIso: "2026-06-01T00:00:00.000Z" },
    });

    expect(blocked.why).toContain("NOT MEASURED");
    expect(blocked.why).toContain("refresh before trusting an absence");
  });

  it("keeps a named reviewer on a CHANGES_REQUESTED row instead of grading it back to the author", () => {
    const blocked = blockedFor({
      pr: pr({ reviewDecision: "CHANGES_REQUESTED", reviewRequests: [{ handle: "a-reviewer", kind: "user" }] }),
    });

    expect(blocked.kind).toBe("person");
    expect(blocked.why).toContain("@a-reviewer");
  });

  it("calls an approved draft blocked on its AUTHOR, by name", () => {
    const blocked = blockedFor({ pr: pr({ author: "an-author", isDraft: true }) });

    expect(blocked.kind).toBe("person");
    expect(blocked.why).toContain("@an-author");
  });

  it("calls an unreadable check rollup UNKNOWN, never `none`", () => {
    const blocked = blockedFor({ pr: pr({ statusCheckRollup: undefined }) });

    expect(blocked.kind).toBe("unknown");
    expect(blocked.why).toContain("could not be read");
  });

  it("calls an otherwise-ready pull request with an unmeasured mergeable state UNKNOWN, not `none`", () => {
    const blocked = blockedFor({ pr: pr({ mergeable: "UNKNOWN" }) });

    expect(blocked.kind).toBe("unknown");
    expect(blocked.why).toContain("asynchronously");
  });

  it("keeps `none` and `unknown` apart on the same green, approved pull request", () => {
    expect(blockedFor({ pr: pr({ mergeable: "MERGEABLE" }) }).kind).toBe("none");
    expect(blockedFor({ pr: pr({ mergeable: "" }) }).kind).toBe("unknown");
  });
});
