import { describe, expect, it } from "vitest";

import { buildMentionIndex } from "../../../../../outbound/slack/mentionIndex.js";
import type { DerivedPerson } from "../../../../../silver/derivedRoster.js";
import { NO_OVERRIDES, person, roster, SELF_USER_IDS } from "./harness.js";

describe("buildMentionIndex — which keys may address a mention", () => {
  it("indexes the canonical id, the Slack id, the Slack handle, @handle and the Slack email", () => {
    const { index } = buildMentionIndex({
      derived: roster({
        people: [person({ email: "a@example.test", handle: "ada-l", id: "p-ada", slackId: "U_fake_ada" })],
      }),
      overrides: NO_OVERRIDES,
    });

    expect([...index.keys()].toSorted()).toEqual(["@ada-l", "U_fake_ada", "a@example.test", "ada-l", "p-ada"]);
    expect(index.get("ada-l")).toEqual({ origin: "derived", slackId: "U_fake_ada" });
  });

  it("NEVER indexes a GitHub handle — a cross-source join is the likeliest place a link is wrong", () => {
    const { index } = buildMentionIndex({
      derived: roster({ people: [person({ handle: "ada-l", id: "p-ada", slackId: "U_fake_ada" })] }),
      overrides: NO_OVERRIDES,
    });

    expect(index.has("ada-l-gh")).toBe(false);
  });

  it("NEVER indexes a display name, even though the roster carries one", () => {
    const { index } = buildMentionIndex({
      derived: roster({ people: [person({ handle: "ada-l", id: "p-ada", slackId: "U_fake_ada" })] }),
      overrides: NO_OVERRIDES,
    });

    expect(index.has("Display Name ada-l")).toBe(false);
  });

  it("omits a person with NO Slack identity — they cannot be pinged, so no key is invented for them", () => {
    const { index } = buildMentionIndex({
      derived: roster({ people: [person({ handle: "ada-l", id: "p-ada" })] }),
      overrides: NO_OVERRIDES,
    });

    expect(index.size).toBe(0);
  });

  it("DROPS a key two different people claim, and reports it, rather than resolving first-wins", () => {
    const { index, collisions } = buildMentionIndex({
      derived: roster({
        people: [
          person({ handle: "seth", id: "p-one", slackId: "U_fake_one" }),
          person({ handle: "seth", id: "p-two", slackId: "U_fake_two" }),
        ],
      }),
      overrides: NO_OVERRIDES,
    });

    expect(collisions).toEqual(["@seth", "seth"]);
    expect(index.has("seth")).toBe(false);
    expect(index.get("p-one")).toEqual({ origin: "derived", slackId: "U_fake_one" });
  });

  it("drops the canonical id of a person carrying TWO Slack accounts — which one is not ours to pick", () => {
    const twoAccounts: DerivedPerson = {
      confidence: "email",
      id: "p-two-accounts",
      identities: [
        { handle: "work", nativeId: "U_fake_work", source: "slack" },
        { handle: "personal", nativeId: "U_fake_personal", source: "slack" },
      ],
      kind: "person",
    };
    const { index, collisions } = buildMentionIndex({
      derived: roster({ people: [twoAccounts] }),
      overrides: NO_OVERRIDES,
    });

    expect(collisions).toEqual(["p-two-accounts"]);
    expect(index.get("work")).toEqual({ origin: "derived", slackId: "U_fake_work" });
    expect(index.get("personal")).toEqual({ origin: "derived", slackId: "U_fake_personal" });
  });

  it("lets the HUMAN roster win over a derived resolution for the same key", () => {
    const { index } = buildMentionIndex({
      derived: roster({ people: [person({ handle: "ada-l", id: "p-ada", slackId: "U_fake_derived" })] }),
      overrides: [
        { handle: "ada-l", id: "p-ada", identities: [{ nativeId: "U_fake_confirmed", source: "slack" }], name: "ada" },
      ],
    });

    expect(index.get("p-ada")).toEqual({ origin: "override", slackId: "U_fake_confirmed" });
    expect(index.get("ada-l")).toEqual({ origin: "override", slackId: "U_fake_confirmed" });
  });

  it("lets the HUMAN roster rescue a key the derived layer had to drop as ambiguous", () => {
    const { index, collisions } = buildMentionIndex({
      derived: roster({
        people: [
          person({ handle: "seth", id: "p-one", slackId: "U_fake_one" }),
          person({ handle: "seth", id: "p-two", slackId: "U_fake_two" }),
        ],
      }),
      overrides: [
        { handle: "seth", id: "p-one", identities: [{ nativeId: "U_fake_one", source: "slack" }], name: "seth" },
      ],
    });

    // The override supplies `seth` AND `@seth`, so both are confirmed and NEITHER is still reported as a
    // live ambiguity — a resolved collision is not a warning.
    expect(index.get("seth")).toEqual({ origin: "override", slackId: "U_fake_one" });
    expect(index.get("@seth")).toEqual({ origin: "override", slackId: "U_fake_one" });
    expect(collisions).toEqual([]);
  });

  it("ignores a human roster entry with no Slack identity — the commonest real shape", () => {
    const { index } = buildMentionIndex({
      derived: roster({ people: [] }),
      overrides: [{ handle: "ada-l", id: "p-ada", name: "ada" }],
    });

    expect(index.size).toBe(0);
  });
});

describe("buildMentionIndex — the bot's own declared identity (the as-me door)", () => {
  it("indexes the bot's own declared id to itself, so an as-me send can tag the bot", () => {
    const { index } = buildMentionIndex({
      derived: roster({ people: [] }),
      overrides: NO_OVERRIDES,
      selfUserIds: SELF_USER_IDS,
    });

    expect(index.get("U_fake_bot")).toEqual({ origin: "self", slackId: "U_fake_bot" });
  });

  it("adds no self keys when nothing is declared — the everyday case for every other sender", () => {
    const { index } = buildMentionIndex({ derived: roster({ people: [] }), overrides: NO_OVERRIDES });

    expect(index.size).toBe(0);
  });

  it("still refuses an id the bot never declared, even with a self identity present", () => {
    const { index } = buildMentionIndex({
      derived: roster({ people: [] }),
      overrides: NO_OVERRIDES,
      selfUserIds: SELF_USER_IDS,
    });

    expect(index.has("U_someone_else")).toBe(false);
  });

  it("lets the human roster win over the bot's own declared identity for the same key", () => {
    const { index } = buildMentionIndex({
      derived: roster({ people: [] }),
      overrides: [
        {
          handle: "the-bot",
          id: "U_fake_bot",
          identities: [{ nativeId: "U_fake_confirmed", source: "slack" }],
          name: "bot",
        },
      ],
      selfUserIds: SELF_USER_IDS,
    });

    expect(index.get("U_fake_bot")).toEqual({ origin: "override", slackId: "U_fake_confirmed" });
  });
});
