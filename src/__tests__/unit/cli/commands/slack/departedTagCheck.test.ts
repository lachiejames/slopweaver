import { describe, expect, it } from "vitest";

import { resolvedTagRefusals } from "../../../../../cli/commands/slack/departedTagCheck.js";
import type { TaggedAccount } from "../../../../../outbound/slack/departedTags.js";
import type { MentionResolution, MentionTarget } from "../../../../../outbound/slack/mentionIndex.js";

/** A resolution carrying exactly these key → target pairs. */
function resolution({ targets }: { targets: readonly (readonly [string, MentionTarget])[] }): MentionResolution {
  return {
    groupAddresses: new Map(),
    heldRequested: [],
    memberLookups: new Map(),
    resolved: new Map(targets),
    roster: { addressableKeys: 0, collisions: [], derivedPeople: 0, freshness: { kind: "fresh" }, heldPeople: 0 },
  };
}

/** A roster read that records each id asked, answering from the map given and live otherwise. */
function roster({ accounts, asked }: { accounts: ReadonlyMap<string, TaggedAccount>; asked: string[] }) {
  return async ({ user }: { token: string; user: string }): Promise<TaggedAccount> => {
    asked.push(user);
    const known = accounts.get(user);
    if (known !== undefined) {
      return known;
    }
    return { deleted: false, kind: "read", name: undefined };
  };
}

describe("resolvedTagRefusals", () => {
  it("refuses the departed id among the tagged, reading each distinct id once in resolution order", async () => {
    const asked: string[] = [];
    const refusals = await resolvedTagRefusals({
      home: "/nonexistent/fixture-home",
      resolution: resolution({
        targets: [
          ["seth", { origin: "member", slackId: "U0SETH" }],
          ["noel", { origin: "member", slackId: "U0NOEL" }],
          ["@seth", { origin: "override", slackId: "U0SETH" }],
          ["bot", { origin: "self", slackId: "U0BOT" }],
        ],
      }),
      taggedAccount: roster({
        accounts: new Map([["U0NOEL", { deleted: true, kind: "read", name: "nicholas.hairs" }]]),
        asked,
      }),
      token: "xoxp",
    });
    expect(asked).toEqual(["U0SETH", "U0NOEL", "U0BOT"]);
    expect(refusals).toEqual([
      "nicholas.hairs (<@U0NOEL>) is deactivated in Slack: they have left, so a message tagging them reads as if " +
        "nobody noticed. Drop the tag, and tag whoever holds their work now.",
    ]);
  });

  it("reads nothing and refuses nothing when the message tags nobody", async () => {
    const asked: string[] = [];
    const refusals = await resolvedTagRefusals({
      home: "/nonexistent/fixture-home",
      resolution: resolution({ targets: [] }),
      taggedAccount: roster({ accounts: new Map(), asked }),
      token: "xoxp",
    });
    expect(asked).toEqual([]);
    expect(refusals).toEqual([]);
  });
});
