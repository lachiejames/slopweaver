import { describe, expect, it } from "vitest";

import { mentionRefusals, resolveMentionKeys } from "../../../../../outbound/slack/mentionIndex.js";
import { NO_OVERRIDES, person, roster, SELF_USER_IDS } from "./harness.js";

describe("resolveMentionKeys — held candidates are never addressable", () => {
  it("refuses a person whose only link is HELD, and says the link is held", () => {
    const resolution = resolveMentionKeys({
      derived: roster({ held: ["p-github-only"], people: [person({ handle: "ada-l", id: "p-github-only" })] }),
      freshness: { kind: "fresh" },
      overrides: NO_OVERRIDES,
      people: ["p-github-only"],
    });

    expect(resolution.resolved.size).toBe(0);
    expect(resolution.heldRequested).toEqual(["p-github-only"]);
    expect(resolution.roster.heldPeople).toBe(1);
  });

  it("does NOT let a held candidate borrow the OTHER person's Slack id", () => {
    // The tempting "fix": derive proposed that p-github-only and p-ada are the same human, so resolve the
    // former to the latter's Slack account. That is a fuzzy guess pinging a real colleague — never allowed.
    const resolution = resolveMentionKeys({
      derived: roster({
        held: ["p-github-only", "p-ada"],
        people: [
          person({ handle: "ada-l", id: "p-ada", slackId: "U_fake_ada" }),
          person({ handle: "ada", id: "p-github-only" }),
        ],
      }),
      freshness: { kind: "fresh" },
      overrides: NO_OVERRIDES,
      people: ["p-github-only", "p-ada"],
    });

    expect(resolution.resolved.get("p-github-only")).toBe(undefined);
    expect(resolution.resolved.get("p-ada")).toEqual({ origin: "derived", slackId: "U_fake_ada" });
  });

  it("resolves a held person once a HUMAN confirms them — that is what confirmation means", () => {
    const resolution = resolveMentionKeys({
      derived: roster({ held: ["p-ada"], people: [person({ handle: "ada-l", id: "p-ada" })] }),
      freshness: { kind: "fresh" },
      overrides: [
        { handle: "ada-l", id: "p-ada", identities: [{ nativeId: "U_fake_ada", source: "slack" }], name: "ada" },
      ],
      people: ["p-ada"],
    });

    expect(resolution.resolved.get("p-ada")).toEqual({ origin: "override", slackId: "U_fake_ada" });
    expect(resolution.heldRequested).toEqual([]);
  });
});

describe("resolveMentionKeys — the as-me door can tag the bot itself", () => {
  it("resolves a mention of the bot's own declared id", () => {
    const resolution = resolveMentionKeys({
      derived: roster({ people: [] }),
      freshness: { kind: "fresh" },
      overrides: NO_OVERRIDES,
      people: ["U_fake_bot"],
      selfUserIds: SELF_USER_IDS,
    });

    expect(resolution.resolved.get("U_fake_bot")).toEqual({ origin: "self", slackId: "U_fake_bot" });
  });

  it("still refuses an id nobody declared, even with a self identity present", () => {
    const resolution = resolveMentionKeys({
      derived: roster({ people: [] }),
      freshness: { kind: "fresh" },
      overrides: NO_OVERRIDES,
      people: ["U_unknown"],
      selfUserIds: SELF_USER_IDS,
    });

    expect(resolution.resolved.has("U_unknown")).toBe(false);
    expect(mentionRefusals({ missing: ["U_unknown"], resolution })[0]).toContain(
      'cannot resolve a mention for "U_unknown"',
    );
  });
});
