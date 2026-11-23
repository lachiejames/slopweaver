import { describe, expect, it } from "vitest";

import { buildReviewRoster } from "../../../review/reviewRoster.js";

describe("buildReviewRoster", () => {
  it("addresses a login by one Slack id but joins it to every id either roster layer holds", () => {
    const roster = buildReviewRoster({
      overrides: [
        {
          handle: "alice",
          id: "alice",
          identities: [
            { nativeId: "Alice-GH", source: "github" },
            { nativeId: "U0ALICE", source: "slack" },
          ],
          name: "Alice",
        },
      ],
      roster: {
        heldPersonIds: new Set(),
        people: [
          {
            confidence: "handle",
            id: "alice",
            identities: [
              { nativeId: "alice-gh", source: "github" },
              { nativeId: "W0ALICE", source: "slack" },
            ],
          },
        ],
      },
    });
    expect([roster.slackIdForLogin.get("alice-gh"), roster.slackIdsForLogin.get("alice-gh")]).toEqual([
      "U0ALICE",
      ["U0ALICE", "W0ALICE"],
    ]);
    expect([roster.samePersonForSlackId.get("W0ALICE"), roster.samePersonForSlackId.get("U0ALICE")]).toEqual([
      ["U0ALICE", "W0ALICE"],
      ["U0ALICE", "W0ALICE"],
    ]);
  });

  it("ties a person's Slack ids together when they have no GitHub login at all", () => {
    const roster = buildReviewRoster({
      roster: {
        heldPersonIds: new Set(),
        people: [
          {
            confidence: "email",
            id: "bob",
            identities: [
              { nativeId: "U0BOB", source: "slack" },
              { nativeId: "W0BOB", source: "slack" },
            ],
          },
        ],
      },
    });
    expect([roster.samePersonForSlackId.get("W0BOB"), roster.slackIdsForLogin.size]).toEqual([["U0BOB", "W0BOB"], 0]);
  });

  it("joins no login that has no Slack id", () => {
    const roster = buildReviewRoster({
      roster: {
        heldPersonIds: new Set(),
        people: [{ confidence: "single-source", id: "bo", identities: [{ nativeId: "bo", source: "github" }] }],
      },
    });
    expect([roster.slackIdForLogin.size, roster.slackIdsForLogin.size, roster.samePersonForSlackId.size]).toEqual([
      0, 0, 0,
    ]);
  });
});
