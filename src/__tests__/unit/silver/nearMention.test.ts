/**
 * A measured failure, as a regression fixture.
 *
 * `slopweaver identity resolve 'Tobyn Barten'` answered "no colleague in the member index answers to Tobyn
 * Barten" and added "member bronze is every provider's own member list, so this is a real absence, not a
 * stale roster", while the member index held the colleague across three sources under a display name two
 * letters away. The names here are SYNTHETIC and the domains are `example.*`, preserving only the SHAPE the
 * code reads: a two-edit gap over a display name long enough to carry one.
 *
 * `barton` / `barten` is that shape — one substitution in the given name, one in the surname.
 */

import { describe, expect, it } from "vitest";
import { levenshteinDistance } from "#lib/editDistance.js";
import type { EmailTrust, MemberBronzeRow } from "../../../corpus/members/types.js";
import type { IdentitySource } from "../../../silver/identity.js";
import { mentionPeople } from "../../../silver/mentionResolver.js";
import { NEAR_MATCH_LIMIT, nearEditBudget, nearMentions } from "../../../silver/nearMention.js";

const ORG_DOMAINS = ["example.com"];

/** One member row, spelled the way hydration writes one. */
function row({
  source = "slack",
  nativeId,
  handle,
  name,
  email,
  emailTrust = "trusted",
  active = true,
  bot = false,
}: {
  source?: IdentitySource;
  nativeId: string;
  handle?: string;
  name?: string;
  email?: string;
  emailTrust?: EmailTrust;
  active?: boolean;
  bot?: boolean;
}): MemberBronzeRow {
  return {
    fetchedAtIso: "2026-09-07T00:00:00.000Z",
    identity: {
      emailTrust,
      nativeId,
      source,
      ...(handle !== undefined ? { handle } : {}),
      ...(name !== undefined ? { name } : {}),
      ...(email !== undefined ? { email, emailNormalised: email.toLowerCase() } : {}),
    },
    profile: { active, bot },
    provenance: ["test"],
    raw: {},
    source,
    sourceId: nativeId,
    version: 1,
    warnings: [],
  };
}

const ROWS: readonly MemberBronzeRow[] = [
  // The colleague the finding measured, across two sources joined on a trusted email.
  row({ email: "hollis@example.com", handle: "hollis", name: "Hollis Grantham", nativeId: "U-HOLLIS" }),
  row({
    email: "hollis@example.com",
    handle: "hollis",
    name: "Hollis Grantham",
    nativeId: "lin-hollis",
    source: "linear",
  }),
  // An unrelated colleague, spelled nothing like the token.
  row({ email: "wren.holloway@example.com", handle: "wren.holloway", name: "Wren Holloway", nativeId: "U-WREN" }),
  // A short-named colleague — the reason the budget is zero at four characters.
  row({ email: "ada@example.com", handle: "ada", name: "Ada", nativeId: "U-ADA" }),
  // A workspace bot carrying a near-spelling, which must never be suggested for a name.
  row({ bot: true, emailTrust: "missing", handle: "hollisbot", name: "Hollis Grantbot", nativeId: "B-HOLLIS" }),
];

const PEOPLE = mentionPeople({ orgDomains: ORG_DOMAINS, rows: ROWS });

describe("nearEditBudget", () => {
  it("gives a four-character token no budget at all", () => {
    expect(nearEditBudget({ length: 4 })).toBe(0);
    expect(nearEditBudget({ length: 1 })).toBe(0);
  });

  it("gives a five-to-eight character token one edit", () => {
    expect(nearEditBudget({ length: 5 })).toBe(1);
    expect(nearEditBudget({ length: 8 })).toBe(1);
  });

  it("gives a nine-or-longer token two edits — what the measured miss costs", () => {
    expect(nearEditBudget({ length: 9 })).toBe(2);
    expect(nearEditBudget({ length: 15 })).toBe(2);
  });
});

describe("nearMentions", () => {
  it("names the colleague a two-letter misspelling missed (a past regression)", () => {
    const near = nearMentions({ people: PEOPLE, token: "Hollis Grantam" });
    expect(near.map((match) => match.person.key)).toEqual(["hollis@example.com"]);
    expect(near[0]!.field).toBe("full-name");
    expect(near[0]!.distance).toBe(1);
    expect(near[0]!.value).toBe("hollis grantham");
  });

  it("carries the measured two-edit gap the finding named", () => {
    const near = nearMentions({ people: PEOPLE, token: "Holis Granthem" });
    expect(near.map((match) => match.person.key)).toEqual(["hollis@example.com"]);
    expect(near[0]!.distance).toBe(2);
  });

  it("returns nothing for a token spelled near nobody — the one honest absence", () => {
    expect(nearMentions({ people: PEOPLE, token: "zzqqxxwwvv" })).toEqual([]);
  });

  it("returns nothing for an EXACT match, since the exact ladder already answered", () => {
    expect(nearMentions({ people: PEOPLE, token: "Hollis Grantham" })).toEqual([]);
  });

  it("suggests nothing for a four-character token, where one edit reaches a different person", () => {
    // Falsifiable: "adam" really is one edit from the colleague named "ada", so only the zero budget at
    // this length keeps it out. Raise that rung and this test reddens.
    expect(levenshteinDistance({ left: "adam", right: "ada" })).toBe(1);
    expect(nearEditBudget({ length: 4 })).toBe(0);
    expect(nearMentions({ people: PEOPLE, token: "adam" })).toEqual([]);
  });

  it("never suggests a bot, which can only ever arrive here as noise", () => {
    // Falsifiable the same way: the bot's own display name is INSIDE the budget for this token, and the
    // live colleague's is not, so anything returned here could only be the bot.
    expect(levenshteinDistance({ left: "hollis grantbet", right: "hollis grantbot" })).toBe(1);
    expect(levenshteinDistance({ left: "hollis grantbet", right: "hollis grantham" })).toBe(3);
    expect(nearEditBudget({ length: 15 })).toBe(2);
    expect(nearMentions({ people: PEOPLE, token: "Hollis Grantbet" })).toEqual([]);
  });

  it("matches a misspelled HANDLE as well as a display name", () => {
    const near = nearMentions({ people: PEOPLE, token: "@hollos" });
    expect(near.map((match) => match.person.key)).toEqual(["hollis@example.com"]);
    expect(near[0]!.field).toBe("handle");
  });

  it("matches a misspelled EMAIL, which the finding named alongside display names", () => {
    const near = nearMentions({ people: PEOPLE, token: "hollis@exampel.com" });
    expect(near.map((match) => match.person.key)).toEqual(["hollis@example.com"]);
    expect(near[0]!.field).toBe("email");
  });

  it("returns nothing for an empty or whitespace-only token", () => {
    expect(nearMentions({ people: PEOPLE, token: "" })).toEqual([]);
    expect(nearMentions({ people: PEOPLE, token: "   " })).toEqual([]);
  });

  it("puts colleagues before outsiders, then the closest first", () => {
    const people = mentionPeople({
      orgDomains: ORG_DOMAINS,
      rows: [
        row({ email: "quillon.marsh@othercompany.test", name: "Quillon Marsh", nativeId: "U-OUT" }),
        row({ email: "quillan.marsh@example.com", name: "Quillan Marsh", nativeId: "U-IN" }),
      ],
    });
    const near = nearMentions({ people, token: "Quillen Marsh" });
    expect(near.map((match) => match.person.orgStatus)).toEqual(["org", "external"]);
  });

  it("caps what it hands back, so a loose token cannot print a roster", () => {
    const people = mentionPeople({
      orgDomains: ORG_DOMAINS,
      rows: Array.from({ length: NEAR_MATCH_LIMIT + 3 }, (_unused, index) =>
        row({
          email: `brannock${String(index)}@example.com`,
          name: `Brannock ${String(index)}`,
          nativeId: `U-${String(index)}`,
        }),
      ),
    });
    expect(nearMentions({ people, token: "Brannick 1" }).length).toBe(NEAR_MATCH_LIMIT);
  });

  it("honours a caller's own tighter limit", () => {
    const people = mentionPeople({
      orgDomains: ORG_DOMAINS,
      rows: [
        row({ email: "quillan.marsh@example.com", name: "Quillan Marsh", nativeId: "U-IN" }),
        row({ email: "quillon.marsh@example.com", name: "Quillon Marsh", nativeId: "U-IN2" }),
      ],
    });
    expect(nearMentions({ limit: 1, people, token: "Quillen Marsh" }).length).toBe(1);
  });
});
