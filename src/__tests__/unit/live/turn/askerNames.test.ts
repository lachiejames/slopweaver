/**
 * What a card is allowed to CALL the person whose id it quotes.
 *
 * Driven through the real `lookupMentions` over a synthetic member population rather than over hand-built
 * `MentionLookup` literals, so the reading rule is tested against the arms the resolver actually produces —
 * a literal would keep passing after the resolver stopped returning that shape.
 */
import { describe, expect, it } from "vitest";

import type { MemberBronzeRow } from "../../../../corpus/members/types.js";
import { namesFromLookups } from "../../../../live/turn/askerNames.js";
import { lookupMentions } from "../../../../silver/mentionResolver.js";

const ORG_DOMAINS = ["example.com"];

/** One Slack member row, spelled the way hydration writes one. */
function row({ nativeId, name, email }: { nativeId: string; name: string; email: string }): MemberBronzeRow {
  return {
    fetchedAtIso: "2026-09-22T00:00:00.000Z",
    identity: {
      email,
      emailNormalised: email,
      emailTrust: "trusted",
      handle: name.toLowerCase(),
      name,
      nativeId,
      source: "slack",
    },
    profile: { active: true, bot: false },
    provenance: ["test"],
    raw: {},
    source: "slack",
    sourceId: nativeId,
    version: 1,
    warnings: [],
  };
}

/** Two colleagues, and one pair sharing a first name so an ambiguous arm is reachable. */
const ROWS: readonly MemberBronzeRow[] = [
  row({ email: "rosa.bahl@example.com", name: "Rosa Bahl", nativeId: "U0SYN000002" }),
  row({ email: "ada.bot@example.com", name: "acme-bot", nativeId: "U0SYN000005" }),
  row({ email: "robin.ash@example.com", name: "Robin Ash", nativeId: "U-ROBIN-1" }),
  row({ email: "robin.vale@example.com", name: "Robin Vale", nativeId: "U-ROBIN-2" }),
];

/** The lookups the door would hand back for these keys. */
function lookups({ keys }: { keys: readonly string[] }): ReturnType<typeof lookupMentions> {
  return lookupMentions({ keys, orgDomains: ORG_DOMAINS, rows: ROWS, source: "slack" });
}

describe("namesFromLookups", () => {
  it("names both ids a question tagged, keyed by the id the card has to replace", () => {
    const slackIds = ["U0SYN000002", "U0SYN000005"];
    expect(namesFromLookups({ lookups: lookups({ keys: slackIds }), slackIds })).toEqual({
      U0SYN000002: "Rosa Bahl",
      U0SYN000005: "acme-bot",
    });
  });

  it("leaves an id the member index has never seen ABSENT, so the id itself is rendered", () => {
    const slackIds = ["U0NOBODY"];
    expect(namesFromLookups({ lookups: lookups({ keys: slackIds }), slackIds })).toEqual({});
  });

  it("writes no name for a token the door called AMBIGUOUS, rather than picking a candidate", () => {
    const slackIds = ["robin"];
    expect(lookups({ keys: slackIds }).get("robin")!.kind).toBe("ambiguous");
    expect(namesFromLookups({ lookups: lookups({ keys: slackIds }), slackIds })).toEqual({});
  });

  it("keeps the resolved half of a mixed list, dropping only the id it could not place", () => {
    const slackIds = ["U0SYN000002", "U0NOBODY"];
    expect(namesFromLookups({ lookups: lookups({ keys: slackIds }), slackIds })).toEqual({ U0SYN000002: "Rosa Bahl" });
  });

  it("answers an empty question with an empty map", () => {
    expect(namesFromLookups({ lookups: lookups({ keys: [] }), slackIds: [] })).toEqual({});
  });
});
