/**
 * Five measured failures, as a regression fixture.
 *
 * The names here are SYNTHETIC and the domains are `example.*`. The real fixture was five colleagues and an
 * external guest at a named company, and none of that may be committed — so what is preserved is the
 * SHAPE of each failure, which is what the code reads:
 *
 * | fixture name | the shape it preserves                                                       | required outcome |
 * | ------------ | ---------------------------------------------------------------------------- | ---------------- |
 * | `wren`       | one colleague, addressed by first name only                                  | resolves         |
 * | `robin`      | three colleagues sharing a first name, one of them deactivated               | ambiguous, 2 named |
 * | `sage`       | one colleague's FIRST name is another's SURNAME                              | resolves to the first name |
 * | `juno`       | a junk single-source row whose whole display name is the colleague's first name | resolves to the colleague |
 * | `alex`       | an external guest carries the token as a handle; colleagues carry it as a first name | ambiguous among colleagues, never the guest |
 *
 * `alex` is the row that matters most. Before this module it did not fail — it ANSWERED, with a different
 * human at a different company, and only a domain check asked for by hand caught it.
 */
import { describe, expect, it } from "vitest";

import type { EmailTrust, MemberBronzeRow } from "../../../corpus/members/types.js";
import type { IdentitySource } from "../../../silver/identity.js";
import { mentionLookupRefusals } from "../../../silver/mentionRefusals.js";
import {
  latestMemberRows,
  lookupMention,
  type MentionLookup,
  type MentionMatch,
  mentionPeople,
  nameTokens,
  resolveMention,
} from "../../../silver/mentionResolver.js";

const ORG_DOMAINS = ["example.com", "example.net"];

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
  fetchedAtIso = "2026-08-30T00:00:00.000Z",
}: {
  source?: IdentitySource;
  nativeId: string;
  handle?: string;
  name?: string;
  email?: string;
  emailTrust?: EmailTrust;
  active?: boolean;
  bot?: boolean;
  fetchedAtIso?: string;
}): MemberBronzeRow {
  return {
    fetchedAtIso,
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

/** The fixture population: five failure shapes plus the noise a real member index carries. */
const ROWS: readonly MemberBronzeRow[] = [
  // `wren` — one colleague, three sources joined on a trusted email.
  row({ email: "wren.holloway@example.com", handle: "wren.holloway", name: "Wren Holloway", nativeId: "U-WREN" }),
  row({
    email: "wren.holloway@example.com",
    handle: "wren.holloway",
    name: "Wren Holloway",
    nativeId: "lin-wren",
    source: "linear",
  }),
  // `robin` — three colleagues, one deactivated.
  row({ email: "robin.ash@example.com", handle: "robin.ash", name: "Robin Ash", nativeId: "U-ROBIN-1" }),
  row({ email: "robin.vale@example.com", handle: "robin.vale", name: "Robin Vale", nativeId: "U-ROBIN-2" }),
  row({
    active: false,
    email: "robin.pike@example.com",
    handle: "robin.pike",
    name: "Robin Pike",
    nativeId: "U-ROBIN-3",
  }),
  // `sage` — a first name for one colleague, a surname for another.
  row({ email: "sage.turner@example.com", handle: "sage.turner", name: "Sage Turner", nativeId: "U-SAGE" }),
  row({ email: "otto.sage@example.com", handle: "otto.sage", name: "Otto Sage", nativeId: "U-OTTO" }),
  // `juno` — the colleague, plus a junk single-source row named only by her first name.
  row({ email: "juno.reyes@example.net", handle: "juno.reyes", name: "Juno Reyes", nativeId: "U-JUNO" }),
  row({ emailTrust: "missing", handle: "juno", name: "juno", nativeId: "lin-juno-junk", source: "linear" }),
  // `alex` — two colleagues by first name, and an EXTERNAL guest whose handle IS the token.
  row({ email: "alex.moreau@example.com", handle: "alex.moreau", name: "Alex Moreau", nativeId: "U-ALEX-1" }),
  row({ email: "alex.byrd@example.com", handle: "alex.byrd", name: "Alex Byrd", nativeId: "U-ALEX-2" }),
  row({
    email: "alex@othercompany.test",
    handle: "alex",
    name: "Alex Stranger",
    nativeId: "lin-alex-guest",
    source: "linear",
  }),
  // Noise a real index carries: a bot whose name contains a fixture token.
  row({ bot: true, emailTrust: "missing", handle: "sagebot", name: "Sage Bot", nativeId: "U-BOT" }),
];

/**
 * The matches of an AMBIGUOUS lookup, throwing when it was anything else — the same shape as `unwrap` for a
 * `Result`, so the assertion below stays free of the conditional that would let it pass vacuously.
 */
function ambiguous({ result }: { result: MentionLookup }): readonly MentionMatch[] {
  if (result.kind !== "ambiguous") {
    throw new Error(`expected an ambiguous lookup, got ${result.kind}`);
  }
  return result.matches;
}

/**
 * The match of a RESOLVED lookup, throwing when it was anything else — the same throwing-narrowing shape as
 * {@link ambiguous}, so a tier assertion below cannot pass vacuously on a refusal.
 */
function resolved({ result }: { result: MentionLookup }): MentionMatch {
  if (result.kind !== "resolved") {
    throw new Error(`expected a resolved lookup, got ${result.kind}`);
  }
  return result.match;
}

/** Resolve one token over the fixture. */
function lookup({ token, source = "slack" }: { token: string; source?: IdentitySource }): MentionLookup {
  return resolveMention({ orgDomains: ORG_DOMAINS, rows: ROWS, source, token });
}

describe("the five-failure fixture", () => {
  it("resolves a colleague addressed by first name alone", () => {
    const result = lookup({ token: "wren" });

    expect(result.kind).toBe("resolved");
    expect(result).toMatchObject({ kind: "resolved", nativeId: "U-WREN" });
  });

  it("refuses three colleagues who share a first name, naming only the live ones", () => {
    const result = lookup({ token: "robin" });

    const matches = ambiguous({ result });
    expect(matches.map((match) => match.person.displayName)).toEqual(["Robin Ash", "Robin Vale"]);
    expect(matches.every((match) => match.tier === "given-name")).toBe(true);
  });

  it("prefers the given name over the surname when one token is both", () => {
    const result = lookup({ token: "sage" });

    expect(result).toMatchObject({ kind: "resolved", match: { tier: "given-name" }, nativeId: "U-SAGE" });
  });

  it("prefers the org colleague over a junk row named by her first name", () => {
    const result = lookup({ token: "juno" });

    expect(result).toMatchObject({ kind: "resolved", nativeId: "U-JUNO" });
  });

  it("never resolves to an external guest, even when the guest matches at a stronger tier", () => {
    const result = lookup({ token: "alex" });

    const matches = ambiguous({ result });
    expect(matches.map((match) => match.person.email)).toEqual(["alex.byrd@example.com", "alex.moreau@example.com"]);
  });

  it("refuses loudly when the ONLY match is external", () => {
    const result = lookup({ token: "alex stranger" });

    expect(result.kind).toBe("external");
    const lines = mentionLookupRefusals({ key: "alex stranger", lookup: result, source: "slack" });
    expect(lines[0]).toContain("OUTSIDE your organisation's email domains");
    expect(lines[1]).toContain("alex@othercompany.test");
  });
});

describe("resolveMention tiers", () => {
  it("resolves a native id exactly", () => {
    expect(lookup({ token: "U-ROBIN-3" })).toMatchObject({
      kind: "resolved",
      match: { tier: "native-id" },
      nativeId: "U-ROBIN-3",
    });
  });

  it("resolves an email local part", () => {
    expect(lookup({ token: "wren.holloway" })).toMatchObject({ kind: "resolved", match: { tier: "email" } });
  });

  it("resolves a full display name", () => {
    expect(lookup({ token: "otto sage" })).toMatchObject({
      kind: "resolved",
      match: { tier: "full-name" },
      nativeId: "U-OTTO",
    });
  });

  it("resolves a surname at the name-part tier when no given name claims it", () => {
    expect(lookup({ token: "holloway" })).toMatchObject({ kind: "resolved", match: { tier: "name-part" } });
  });

  it("strips a leading @ before matching", () => {
    expect(lookup({ token: "@wren.holloway" })).toMatchObject({ kind: "resolved", nativeId: "U-WREN" });
  });

  it("knows nobody by a token no member carries", () => {
    expect(lookup({ token: "nobodyatall" })).toEqual({ kind: "unknown" });
  });

  it("treats an empty token as unknown rather than matching everything", () => {
    expect(lookup({ token: "   " })).toEqual({ kind: "unknown" });
  });
});

describe("what resolveMention refuses", () => {
  it("refuses a match that carries no trusted email", () => {
    const result = lookup({ token: "lin-juno-junk" });

    expect(result.kind).toBe("unverified");
    expect(mentionLookupRefusals({ key: "lin-juno-junk", lookup: result, source: "slack" })[0]).toContain(
      "no trusted email",
    );
  });

  it("refuses a colleague who has no account on the surface being addressed", () => {
    const result = lookup({ source: "github", token: "wren" });

    expect(result).toMatchObject({ kind: "no-account", source: "github" });
    expect(mentionLookupRefusals({ key: "wren", lookup: result, source: "github" })[0]).toContain(
      "has no github account",
    );
  });

  it("never matches a bot by name", () => {
    expect(lookup({ token: "sage bot" })).toEqual({ kind: "unknown" });
  });

  it("resolves this workspace's own bot by its native id, though it carries no email", () => {
    expect(lookup({ token: "U-BOT" })).toMatchObject({ kind: "resolved", nativeId: "U-BOT" });
    expect(resolved({ result: lookup({ token: "U-BOT" }) }).tier).toBe("native-id");
  });

  it("resolves that same bot by the handle a human would actually type", () => {
    expect(lookup({ token: "sagebot" })).toMatchObject({ kind: "resolved", nativeId: "U-BOT" });
    expect(lookup({ token: "@sagebot" })).toMatchObject({ kind: "resolved", nativeId: "U-BOT" });
    expect(resolved({ result: lookup({ token: "sagebot" }) }).tier).toBe("handle");
  });

  it("refuses that bot on a surface it has no account on, rather than handing back its slack id", () => {
    expect(lookup({ source: "linear", token: "sagebot" })).toMatchObject({ kind: "no-account", source: "linear" });
  });

  it("says nothing about a token it resolved", () => {
    expect(mentionLookupRefusals({ key: "wren", lookup: lookup({ token: "wren" }), source: "slack" })).toEqual([]);
  });

  it("says nothing about a token it does not know, so another layer may still answer", () => {
    expect(mentionLookupRefusals({ key: "x", lookup: { kind: "unknown" }, source: "slack" })).toEqual([]);
  });
});

describe("with no org domains settled", () => {
  it("refuses every name rather than resolving one, since nothing places a colleague", () => {
    const result = lookupMention({
      people: mentionPeople({ orgDomains: [], rows: ROWS }),
      source: "slack",
      token: "wren",
    });

    expect(result.kind).toBe("external");
  });
});

describe("mentionPeople folding", () => {
  it("starts a person's identities at the first row under a key and extends them with every later one", () => {
    const people = mentionPeople({ orgDomains: ORG_DOMAINS, rows: ROWS.slice(0, 2) });

    expect(people.map((person) => person.key)).toEqual(["wren.holloway@example.com"]);
    expect(people[0]!.identities.map((identity) => `${identity.source}:${identity.nativeId}`)).toEqual([
      "slack:U-WREN",
      "linear:lin-wren",
    ]);
  });

  it("gives a row with no trusted email a person of its own, holding only that row's identity", () => {
    const people = mentionPeople({ orgDomains: ORG_DOMAINS, rows: [ROWS[8]!] });

    expect(people.map((person) => person.key)).toEqual(["linear:lin-juno-junk"]);
    expect(people[0]!.identities.map((identity) => identity.nativeId)).toEqual(["lin-juno-junk"]);
  });
});

describe("latestMemberRows", () => {
  it("keeps only the newest row per member, so an append-only re-hydrate is not four people", () => {
    const rows = [
      row({ fetchedAtIso: "2026-08-01T00:00:00.000Z", name: "Old Name", nativeId: "U-1" }),
      row({ fetchedAtIso: "2026-08-30T00:00:00.000Z", name: "New Name", nativeId: "U-1" }),
    ];

    const latest = latestMemberRows({ rows });

    expect(latest.length).toBe(1);
    expect(latest[0]!.identity.name).toBe("New Name");
  });
});

describe("nameTokens", () => {
  it("splits a spaced display name", () => {
    expect(nameTokens({ name: "Wren  Holloway" })).toEqual({ parts: ["wren", "holloway"], whole: "wren holloway" });
  });

  it("splits a handle-shaped display name on its separators", () => {
    expect(nameTokens({ name: "wren.holloway" })).toEqual({ parts: ["wren", "holloway"], whole: "wren.holloway" });
  });
});

/**
 * The WORKSPACE BOT exception: a bot of this organisation's own Slack has no email by
 * construction, so the email check that places a human places no bot at all. Before this, every one of the
 * hundreds of bots in a real index refused as `unverified`, and `@acmebot` — the token a human types to tag
 * the bot in its own DM — was the measured failure.
 *
 * Its own fixture rather than rows added to the five-failure one, because the property under test is the BOUNDARY:
 * which bots the exception admits, which it still refuses, and that a live colleague still wins a collision.
 */
describe("a bot of this workspace's own slack", () => {
  const HUMAN = row({ email: "wren.ito@example.com", handle: "wren.ito", name: "Wren Ito", nativeId: "U-HUMAN" });
  const BOT = row({ bot: true, emailTrust: "missing", handle: "helperbot", name: "Helper Bot", nativeId: "U-HELPER" });

  function over({
    rows,
    token,
    source = "slack",
    orgDomains = ORG_DOMAINS,
  }: {
    rows: readonly MemberBronzeRow[];
    token: string;
    source?: IdentitySource;
    orgDomains?: readonly string[];
  }): MentionLookup {
    return resolveMention({ orgDomains, rows, source, token });
  }

  it("resolves by handle even with no org domains settled, since no email places a bot either way", () => {
    expect(over({ orgDomains: [], rows: [BOT], token: "helperbot" })).toMatchObject({
      kind: "resolved",
      nativeId: "U-HELPER",
    });
  });

  it("stays unverified in the folded people, because the exception is addressability and not classification", () => {
    expect(mentionPeople({ orgDomains: ORG_DOMAINS, rows: [BOT] })[0]!.orgStatus).toBe("unverified");
  });

  it("still refuses every name tier, so a first name never answers with an integration", () => {
    expect(over({ rows: [BOT], token: "Helper Bot" })).toEqual({ kind: "unknown" });
    expect(over({ rows: [BOT], token: "Helper" })).toEqual({ kind: "unknown" });
    expect(over({ rows: [BOT], token: "Bot" })).toEqual({ kind: "unknown" });
  });

  it("does not admit a bot of some OTHER provider, whose membership this says nothing about", () => {
    const linearBot = row({
      bot: true,
      emailTrust: "missing",
      handle: "helperbot",
      name: "Helper Bot",
      nativeId: "lin-helper",
      source: "linear",
    });

    expect(over({ rows: [linearBot], source: "linear", token: "helperbot" })).toMatchObject({ kind: "unverified" });
  });

  it("does not admit a bot carrying an email at someone else's domain", () => {
    const guestBot = row({
      bot: true,
      email: "helperbot@othercompany.test",
      handle: "helperbot",
      name: "Helper Bot",
      nativeId: "U-GUEST-BOT",
    });

    expect(over({ rows: [guestBot], token: "helperbot" })).toMatchObject({ kind: "external" });
  });

  it("still refuses a HUMAN who carries no trusted email, which is the refusal this never loosened", () => {
    const unplaceable = row({ emailTrust: "missing", handle: "ghost", name: "Ghost Row", nativeId: "U-GHOST" });

    expect(over({ rows: [unplaceable], token: "ghost" })).toMatchObject({ kind: "unverified" });
  });

  it("never answers with a bot when a colleague matched at all, even a weaker tier", () => {
    const collidingBot = row({
      bot: true,
      emailTrust: "missing",
      handle: "wren",
      name: "Wren Bot",
      nativeId: "U-WREN-BOT",
    });

    expect(over({ rows: [HUMAN, collidingBot], token: "wren" })).toMatchObject({
      kind: "resolved",
      nativeId: "U-HUMAN",
    });
    expect(over({ rows: [collidingBot, HUMAN], token: "wren" })).toMatchObject({
      kind: "resolved",
      nativeId: "U-HUMAN",
    });
  });

  // The two counterexamples Codex's review pass found against the first version of this change. Both are
  // tokens that ALREADY WORKED before the bot exception existed, and both regressed when the bot was allowed
  // to compete with a colleague rather than only to answer when no colleague matched.
  it("still resolves the colleague, not an ambiguity, when a live bot shares their handle", () => {
    // The colleague's handle is deliberately NOT their email's local part: were it `wren.ito`, they would
    // match at `email` tier and outrank the bot's handle anyway, so there would be no collision to test.
    const handleHuman = row({ email: "wren.ito@example.com", handle: "wito", name: "Wren Ito", nativeId: "U-HUMAN" });
    const sameTierBot = row({ bot: true, emailTrust: "missing", handle: "wito", name: "Wren Bot", nativeId: "U-WBOT" });

    expect(over({ rows: [handleHuman, sameTierBot], token: "wito" })).toMatchObject({
      kind: "resolved",
      nativeId: "U-HUMAN",
    });
    expect(over({ rows: [sameTierBot, handleHuman], token: "wito" })).toMatchObject({
      kind: "resolved",
      nativeId: "U-HUMAN",
    });
  });

  it("still resolves a DEACTIVATED colleague over a live bot, since preferActive kept them as the answer", () => {
    const goneHuman = row({
      active: false,
      email: "wren.ito@example.com",
      handle: "wito",
      name: "Wren Ito",
      nativeId: "U-HUMAN",
    });
    const liveBot = row({ bot: true, emailTrust: "missing", handle: "wito", name: "Wren Bot", nativeId: "U-WBOT" });

    expect(over({ rows: [goneHuman, liveBot], token: "wito" })).toMatchObject({
      kind: "resolved",
      nativeId: "U-HUMAN",
    });
  });

  it("still resolves a deactivated colleague matched at a WEAKER tier than the bot's handle", () => {
    const goneHuman = row({
      active: false,
      email: "wren.ito@example.com",
      handle: "wito",
      name: "Wren Ito",
      nativeId: "U-HUMAN",
    });
    const strongerBot = row({ bot: true, emailTrust: "missing", handle: "wren", name: "Helper", nativeId: "U-WBOT" });

    expect(over({ rows: [goneHuman, strongerBot], token: "wren" })).toMatchObject({
      kind: "resolved",
      nativeId: "U-HUMAN",
    });
  });

  it("keeps an ambiguity among deactivated colleagues rather than answering with a bot", () => {
    const goneOne = row({ active: false, email: "a.wren@example.com", name: "Wren Ito", nativeId: "U-G1" });
    const goneTwo = row({ active: false, email: "b.wren@example.com", name: "Wren Osei", nativeId: "U-G2" });
    const bot = row({ bot: true, emailTrust: "missing", handle: "wren", name: "Helper", nativeId: "U-WBOT" });
    const matches = ambiguous({ result: over({ rows: [goneOne, goneTwo, bot], token: "wren" }) });

    expect(matches.map((match) => match.person.key).toSorted()).toEqual(["a.wren@example.com", "b.wren@example.com"]);
  });
});

describe("a member of the conversation the message posts into", () => {
  // An outsider with no email at all — the shape of a real failure — and one at a partner's domain.
  const outsider = row({ emailTrust: "missing", handle: "rook", name: "Rook Fenwick", nativeId: "U-ROOK" });
  const partner = row({ email: "dana@partner.test", handle: "dana", name: "Dana Quill", nativeId: "U-DANA" });
  const colleague = row({ email: "rook.hale@example.com", handle: "rook.hale", name: "Rook Hale", nativeId: "U-HALE" });
  const people = mentionPeople({ orgDomains: ORG_DOMAINS, rows: [outsider, partner, colleague] });
  const inDm = new Set(["U-OWNER", "U-ROOK", "U-DANA"]);

  it("resolves an outsider with no email by their own id when they are in the conversation", () => {
    const result = lookupMention({ conversationMembers: inDm, people, source: "slack", token: "U-ROOK" });

    expect(result).toMatchObject({ kind: "resolved", nativeId: "U-ROOK" });
    expect(resolved({ result }).tier).toBe("native-id");
  });

  it("resolves an outsider at another company's domain by full name when they are in the conversation", () => {
    expect(lookupMention({ conversationMembers: inDm, people, source: "slack", token: "dana quill" })).toMatchObject({
      kind: "resolved",
      nativeId: "U-DANA",
    });
  });

  it("still refuses that same outsider when the conversation's members were not read", () => {
    expect(lookupMention({ people, source: "slack", token: "U-ROOK" }).kind).toBe("unverified");
  });

  it("still refuses an outsider who is not in the conversation", () => {
    const elsewhere = new Set(["U-OWNER"]);

    expect(lookupMention({ conversationMembers: elsewhere, people, source: "slack", token: "U-DANA" }).kind).toBe(
      "external",
    );
  });

  it("answers with the colleague, not the in-conversation outsider, when both answer to a first name", () => {
    const result = lookupMention({ conversationMembers: inDm, people, source: "slack", token: "rook" });

    expect(result).toMatchObject({ kind: "resolved", nativeId: "U-HALE" });
  });

  it("tells a refused outsider the way through, rather than to use the id that was just refused", () => {
    const result = lookupMention({ people, source: "slack", token: "U-ROOK" });

    expect(mentionLookupRefusals({ key: "U-ROOK", lookup: result, source: "slack" }).at(-1)).toBe(
      "  re-run `slopweaver refresh` so members hydrate with emails, or a slack account outside your organisation " +
        "is addressable only in a conversation it is a member of: post where they are, or confirm them in " +
        "the identity roster (slopweaver identity roster replace).",
    );
  });
});
