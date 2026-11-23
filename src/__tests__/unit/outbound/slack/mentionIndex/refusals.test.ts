import { describe, expect, it } from "vitest";

import {
  mentionRefusals,
  resolveMentionKeys,
  staleRosterRefusals,
} from "../../../../../outbound/slack/mentionIndex.js";
import { NO_OVERRIDES, person, roster } from "./harness.js";

describe("mentionRefusals — a refusal names the cause and its fix", () => {
  it("names the addressable-key count for a plain miss", () => {
    const resolution = resolveMentionKeys({
      derived: roster({ people: [person({ handle: "ada-l", id: "p-ada", slackId: "U_fake_ada" })] }),
      freshness: { kind: "fresh" },
      overrides: NO_OVERRIDES,
      people: ["nobody"],
    });

    const refusals = mentionRefusals({ missing: ["nobody"], resolution });

    expect(refusals.length).toBe(1);
    expect(refusals[0]).toContain('cannot resolve a mention for "nobody"');
    expect(refusals[0]).toContain("no exact match among the 4 addressable keys");
  });

  it("says the link is HELD, and how to confirm it", () => {
    const resolution = resolveMentionKeys({
      derived: roster({ held: ["p-ada"], people: [person({ handle: "ada-l", id: "p-ada" })] }),
      freshness: { kind: "fresh" },
      overrides: NO_OVERRIDES,
      people: ["p-ada"],
    });

    const refusals = mentionRefusals({ missing: ["p-ada"], resolution });

    expect(refusals[0]).toContain("that identity link is HELD");
    expect(refusals[0]).toContain("the identity roster (slopweaver identity roster replace)");
  });

  it("says the key was DROPPED as ambiguous rather than resolved first-wins", () => {
    const resolution = resolveMentionKeys({
      derived: roster({
        people: [
          person({ handle: "seth", id: "p-one", slackId: "U_fake_one" }),
          person({ handle: "seth", id: "p-two", slackId: "U_fake_two" }),
        ],
      }),
      freshness: { kind: "fresh" },
      overrides: NO_OVERRIDES,
      people: ["seth"],
    });

    const refusals = mentionRefusals({ missing: ["seth"], resolution });

    expect(refusals[0]).toContain("two different people claim that key");
  });

  it("appends the STALE-roster advisory, because that is the likeliest real cause", () => {
    const resolution = resolveMentionKeys({
      derived: roster({ people: [] }),
      freshness: {
        changed: [{ reasons: ["resume cursor a → b"], source: "slack" }],
        derivedAtIso: "2026-07-20T00:00:00.000Z",
        kind: "stale",
      },
      overrides: NO_OVERRIDES,
      people: ["nobody"],
    });

    const refusals = mentionRefusals({ missing: ["nobody"], resolution });

    expect(refusals.length).toBe(2);
    expect(refusals[1]).toContain("run `slopweaver derive`");
  });

  it("appends the ABSENT-roster advisory when derive has never run", () => {
    const resolution = resolveMentionKeys({
      derived: roster({ people: [] }),
      freshness: { kind: "absent", why: "it has never been derived" },
      overrides: NO_OVERRIDES,
      people: ["nobody"],
    });

    expect(mentionRefusals({ missing: ["nobody"], resolution })[1]).toContain("it has never been derived");
  });
});

describe("staleRosterRefusals — the send refuses rather than warning", () => {
  it("refuses a send whose mentions rest on a roster that is still not fresh", () => {
    const resolution = resolveMentionKeys({
      derived: roster({ people: [] }),
      freshness: { kind: "absent", why: "it has never been derived" },
      overrides: NO_OVERRIDES,
      people: ["ada"],
    });

    const refusals = staleRosterRefusals({ people: ["ada"], resolution });

    expect(refusals.length).toBe(1);
    expect(refusals[0]).toBe(
      "the derived identity roster (corpus/silver/index/identities.json) cannot be trusted: it has never " +
        "been derived — refusing rather than sending against stale state. `slopweaver derive` has already " +
        "run and did not make it fresh. Run `slopweaver derive`, then retry.",
    );
  });

  it("lets a send that mentions NOBODY through, because the roster cannot change its output", () => {
    const resolution = resolveMentionKeys({
      derived: roster({ people: [] }),
      freshness: { kind: "absent", why: "it has never been derived" },
      overrides: NO_OVERRIDES,
      people: [],
    });

    expect(staleRosterRefusals({ people: [], resolution })).toEqual([]);
  });

  it("lets a send through on a fresh roster", () => {
    const resolution = resolveMentionKeys({
      derived: roster({ people: [] }),
      freshness: { kind: "fresh" },
      overrides: NO_OVERRIDES,
      people: ["ada"],
    });

    expect(staleRosterRefusals({ people: ["ada"], resolution })).toEqual([]);
  });
});
