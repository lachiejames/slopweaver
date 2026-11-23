/**
 * Mentioning a person through the Linear door: what the token matches, what resolves, and what a refusal
 * owes the caller.
 *
 * The four shapes exercised here are the four the owner's own backlog hit, reproduced with
 * synthetic people: a key two people answer to, a key nobody answers to, a person whose only account is
 * outside Linear, and one that simply resolves. Each has a different fix, so each has its own refusal.
 */
import { describe, expect, it } from "vitest";

import {
  linearMentionRefusals,
  mentionKeysOfText,
  mentionToken,
  parseVerifiedMentionIds,
  renderLinearMention,
  resolveLinearMentions,
  staleLinearMentionRefusals,
} from "../../../../outbound/linear/mentionIndex.js";
import { hasRawHtml } from "../../../../outbound/linear/structuralEscapes.js";
import type { DeriveFreshness } from "../../../../silver/derive/freshness.js";
import type { DerivedPerson, DerivedRoster } from "../../../../silver/derivedRoster.js";
import type { IdentityRecord } from "../../../../silver/identity.js";
import type { MentionLookup, MentionPerson } from "../../../../silver/mentionResolver.js";

const FRESH: DeriveFreshness = { kind: "fresh" };
const STALE: DeriveFreshness = {
  changed: [{ reasons: ["linear ingested more since"], source: "linear" }],
  derivedAtIso: "2026-08-01T00:00:00.000Z",
  kind: "stale",
};
const ID_ADA = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const ID_GRACE = "9c858901-8a57-4791-81fe-4c455b099bc9";

/** A derived person carrying a Slack identity and, when given, a Linear one. */
function person({
  id,
  handle,
  name,
  linearId,
  email,
}: {
  id: string;
  handle: string;
  name: string;
  linearId?: string;
  email?: string;
}): DerivedPerson {
  return {
    confidence: "email",
    id,
    identities: [
      { handle: `${handle}-slack`, name, nativeId: `U-${handle}`, source: "slack" },
      ...(linearId === undefined
        ? []
        : [
            {
              handle,
              name,
              nativeId: linearId,
              source: "linear" as const,
              ...(email === undefined ? {} : { email }),
            },
          ]),
    ],
    kind: "person",
  };
}

function roster({ people, held = [] }: { people: readonly DerivedPerson[]; held?: readonly string[] }): DerivedRoster {
  return { heldPersonIds: new Set(held), people };
}

const ADA = person({ email: "ada@example.test", handle: "ada", id: "p-ada", linearId: ID_ADA, name: "Ada" });
/** Two people whose display name is the same three letters — the ambiguous case, with no shared handle. */
const CHI_ONE = person({ handle: "chi-one", id: "p-chi-1", linearId: ID_ADA, name: "chi" });
const CHI_TWO = person({ handle: "chi-two", id: "p-chi-2", linearId: ID_GRACE, name: "chi" });
/** Someone the corpus knows only through Slack — no Linear account, so nothing here can mention them. */
const SLACK_ONLY = person({ handle: "linus", id: "p-linus", name: "Linus" });

describe("the mention token", () => {
  it("matches `@{key}` and yields the key, in first-appearance order, once each", () => {
    expect(mentionKeysOfText({ text: "@{ada} and @{grace}, then @{ada} again" })).toEqual(["ada", "grace"]);
  });

  it("trims the key, so `@{ ada }` addresses the same person as `@{ada}`", () => {
    expect(mentionKeysOfText({ text: "@{ ada }" })).toEqual(["ada"]);
  });

  it("does not match across a newline, so an unclosed token cannot swallow the paragraph", () => {
    expect(mentionKeysOfText({ text: "@{ada\ngrace} tail" })).toEqual([]);
  });

  it("does not match a bare `@handle` — a mention is a token, never a guess at prose", () => {
    expect(mentionKeysOfText({ text: "ping @ada about it" })).toEqual([]);
  });

  it("hands out a FRESH regex each call, so one walk cannot move the next one's lastIndex", () => {
    const first = mentionToken();
    first.exec("@{ada}");

    expect(mentionToken().lastIndex).toBe(0);
    expect(first.lastIndex).toBe(6);
  });
});

describe("resolveLinearMentions", () => {
  it("resolves a Linear handle to that person's Linear user id, labelled with the handle", () => {
    const resolution = resolveLinearMentions({
      derived: roster({ people: [ADA] }),
      freshness: FRESH,
      keys: ["ada"],
      overrides: [],
    });

    expect(resolution.resolved.get("ada")).toEqual({ label: "ada", linearId: ID_ADA, origin: "derived" });
  });

  it("resolves the canonical person id and the email on the Linear identity too", () => {
    const resolution = resolveLinearMentions({
      derived: roster({ people: [ADA] }),
      freshness: FRESH,
      keys: ["p-ada", "ada@example.test", "@ada", ID_ADA],
      overrides: [],
    });

    expect([...resolution.resolved.keys()]).toEqual(["p-ada", "ada@example.test", "@ada", ID_ADA]);
  });

  it("resolves NOBODY from a roster Linear id that is not a UUID, which would render raw into the link", () => {
    const forged = person({ handle: "mallory", id: "p-mallory", linearId: "x)\n<!--", name: "Mallory" });
    const resolution = resolveLinearMentions({
      derived: roster({ people: [forged, ADA] }),
      freshness: FRESH,
      keys: ["mallory", "ada"],
      overrides: [],
    });

    expect([...resolution.resolved.keys()]).toEqual(["ada"]);
  });

  it("resolves NOBODY for a person with no Linear identity, and offers them as a candidate", () => {
    const resolution = resolveLinearMentions({
      derived: roster({ people: [SLACK_ONLY] }),
      freshness: FRESH,
      keys: ["linus"],
      overrides: [],
    });

    expect(resolution.resolved.size).toBe(0);
    expect(resolution.candidates.get("linus")).toEqual([
      { email: undefined, handle: undefined, linearId: undefined, name: "Linus", personId: "p-linus" },
    ]);
  });

  it("resolves nothing for a key nobody answers to, and offers no candidate either", () => {
    const resolution = resolveLinearMentions({
      derived: roster({ people: [ADA] }),
      freshness: FRESH,
      keys: ["nobody"],
      overrides: [],
    });

    expect(resolution.resolved.size).toBe(0);
    expect(resolution.candidates.get("nobody")).toEqual([]);
  });

  it("offers BOTH people when a display name is shared, so the caller can pick by id", () => {
    const resolution = resolveLinearMentions({
      derived: roster({ people: [CHI_ONE, CHI_TWO] }),
      freshness: FRESH,
      keys: ["chi"],
      overrides: [],
    });

    expect(resolution.resolved.size).toBe(0);
    expect(resolution.candidates.get("chi")).toEqual([
      { email: undefined, handle: "chi-one", linearId: ID_ADA, name: "chi", personId: "p-chi-1" },
      { email: undefined, handle: "chi-two", linearId: ID_GRACE, name: "chi", personId: "p-chi-2" },
    ]);
  });

  it("lets a verified `--mention-id` resolve a key the roster cannot, labelled by the key", () => {
    const resolution = resolveLinearMentions({
      derived: roster({ people: [] }),
      freshness: FRESH,
      keys: ["chi"],
      overrides: [],
      verified: new Map([["chi", ID_GRACE]]),
    });

    expect(resolution.resolved.get("chi")).toEqual({ label: "chi", linearId: ID_GRACE, origin: "verified" });
  });

  it("labels a verified id with the roster's own handle when the roster knows that id", () => {
    const resolution = resolveLinearMentions({
      derived: roster({ people: [ADA] }),
      freshness: FRESH,
      keys: ["some-alias"],
      overrides: [],
      verified: new Map([["some-alias", ID_ADA]]),
    });

    expect(resolution.resolved.get("some-alias")).toEqual({
      label: "ada",
      linearId: ID_ADA,
      origin: "verified",
    });
  });

  it("lets the human roster win over the derived layer", () => {
    const override: IdentityRecord = {
      handle: "ada",
      id: "p-ada",
      identities: [{ handle: "ada", nativeId: ID_GRACE, source: "linear" }],
      name: "Ada",
    };
    const resolution = resolveLinearMentions({
      derived: roster({ people: [ADA] }),
      freshness: FRESH,
      keys: ["ada"],
      overrides: [override],
    });

    expect(resolution.resolved.get("ada")).toEqual({ label: "ada", linearId: ID_GRACE, origin: "override" });
  });
});

describe("linearMentionRefusals", () => {
  it("says nothing when every mention resolved", () => {
    const resolution = resolveLinearMentions({
      derived: roster({ people: [ADA] }),
      freshness: FRESH,
      keys: ["ada"],
      overrides: [],
    });

    expect(linearMentionRefusals({ keys: ["ada"], resolution })).toEqual([]);
  });

  it("NAMES both candidates and how to pick one, when a name is shared", () => {
    const resolution = resolveLinearMentions({
      derived: roster({ people: [CHI_ONE, CHI_TWO] }),
      freshness: FRESH,
      keys: ["chi"],
      overrides: [],
    });
    const lines = linearMentionRefusals({ keys: ["chi"], resolution });

    expect(lines[1]).toBe('  2 person(s) answer to "chi":');
    expect(lines[2]).toBe(`    chi — linear:${ID_ADA}  [p-chi-1]`);
    expect(lines[3]).toBe(`    chi — linear:${ID_GRACE}  [p-chi-2]`);
    expect(lines[4]).toBe(
      "  pick one with `--mention-id chi=<linear-user-id>`, once you have opened their Linear profile and confirmed it is them.",
    );
  });

  it("says a candidate with no Linear account cannot be mentioned at all", () => {
    const resolution = resolveLinearMentions({
      derived: roster({ people: [SLACK_ONLY] }),
      freshness: FRESH,
      keys: ["linus"],
      overrides: [],
    });
    const lines = linearMentionRefusals({ keys: ["linus"], resolution });

    expect(lines[2]).toBe("    Linus — no Linear account — cannot be mentioned  [p-linus]");
    expect(lines[3]).toBe(
      "  none of them has a Linear account, so nothing here can be mentioned — check the person is in Linear at all.",
    );
  });

  it("names a HELD link as held, rather than as a plain miss", () => {
    const resolution = resolveLinearMentions({
      derived: roster({ held: ["p-held"], people: [] }),
      freshness: FRESH,
      keys: ["p-held"],
      overrides: [],
    });

    expect(linearMentionRefusals({ keys: ["p-held"], resolution })[0]).toContain("that identity link is HELD");
  });

  it("appends the roster's staleness, once, after the per-key refusals", () => {
    const resolution = resolveLinearMentions({
      derived: roster({ people: [] }),
      freshness: STALE,
      keys: ["ada", "grace"],
      overrides: [],
    });
    const lines = linearMentionRefusals({ keys: ["ada", "grace"], resolution });

    expect(lines.filter((line) => line.includes("slopweaver derive")).length).toBe(1);
  });
});

describe("staleLinearMentionRefusals", () => {
  it("refuses a body whose mentions came from a STALE roster", () => {
    const resolution = resolveLinearMentions({
      derived: roster({ people: [ADA] }),
      freshness: STALE,
      keys: ["ada"],
      overrides: [],
    });

    expect(staleLinearMentionRefusals({ keys: ["ada"], resolution }).length).toBe(1);
  });

  it("lets a body through whose every mention came from a VERIFIED id, stale roster or not", () => {
    const resolution = resolveLinearMentions({
      derived: roster({ people: [] }),
      freshness: STALE,
      keys: ["chi"],
      overrides: [],
      verified: new Map([["chi", ID_GRACE]]),
    });

    expect(staleLinearMentionRefusals({ keys: ["chi"], resolution })).toEqual([]);
  });

  it("lets a body that mentions nobody through a stale roster", () => {
    const resolution = resolveLinearMentions({
      derived: roster({ people: [] }),
      freshness: STALE,
      keys: [],
      overrides: [],
    });

    expect(staleLinearMentionRefusals({ keys: [], resolution })).toEqual([]);
  });
});

describe("parseVerifiedMentionIds", () => {
  it("parses comma-separated `key=id` pairs, lower-casing the id", () => {
    const parsed = parseVerifiedMentionIds({ raw: `ada=${ID_ADA.toUpperCase()}, grace=${ID_GRACE}` });

    expect([...parsed.verified]).toEqual([
      ["ada", ID_ADA],
      ["grace", ID_GRACE],
    ]);
    expect(parsed.errors).toEqual([]);
  });

  it("parses nothing at all from an absent flag", () => {
    const parsed = parseVerifiedMentionIds({ raw: undefined });

    expect(parsed.verified.size).toBe(0);
    expect(parsed.errors).toEqual([]);
  });

  it("REFUSES a value that is not a Linear user id, rather than writing it into a mention", () => {
    const parsed = parseVerifiedMentionIds({ raw: "ada=not-a-uuid" });

    expect(parsed.verified.size).toBe(0);
    expect(parsed.errors[0]).toContain("is not a Linear user id");
  });

  it("refuses a pair with no `=` at all", () => {
    const parsed = parseVerifiedMentionIds({ raw: ID_ADA });

    expect(parsed.errors[0]).toContain("takes `key=<linear-user-id>` pairs");
  });
});

describe("renderLinearMention", () => {
  it("emits Linear's own `@[label](id)` markup", () => {
    expect(renderLinearMention({ target: { label: "ada", linearId: ID_ADA, origin: "derived" } })).toBe(
      `@[ada](${ID_ADA})`,
    );
  });

  it("folds every line ending in a label to one space, so a label cannot put a `+++` on its own line", () => {
    const label = `x\n\n+++\r\n${String.fromCodePoint(0x0b)}Injected${String.fromCodePoint(0x2028)}tail`;
    expect(renderLinearMention({ target: { label, linearId: ID_ADA, origin: "derived" } })).toBe(
      `@[x +++ Injected tail](${ID_ADA})`,
    );
  });

  it("folds a backtick, so a label cannot close the authored code span quoting a `<!--`", () => {
    const mention = renderLinearMention({ target: { label: "a`b", linearId: ID_ADA, origin: "derived" } });

    expect(mention).toBe(`@[a b](${ID_ADA})`);
    expect(hasRawHtml({ text: `\`${mention}<!--\`` })).toBe(false);
  });

  it("escapes a bracket and backslash and folds an angle bracket, so a label can neither end early nor open HTML", () => {
    const label = "Al]ice <script> \\ [x]";
    expect(renderLinearMention({ target: { label, linearId: ID_ADA, origin: "derived" } })).toBe(
      `@[Al\\]ice  script  \\\\ \\[x\\]](${ID_ADA})`,
    );
  });

  it("folds a quote and `>`, so a label cannot finish a tag the author left open", () => {
    const mentions = ['" a=x>', "' a=x>"].map((label) =>
      renderLinearMention({ target: { label, linearId: ID_ADA, origin: "derived" } }),
    );

    expect(mentions).toEqual([`@[  a=x ](${ID_ADA})`, `@[  a=x ](${ID_ADA})`]);
    expect(mentions.map((mention) => hasRawHtml({ text: `Problem <textarea title="${mention}` }))).toEqual([
      false,
      false,
    ]);
    expect(hasRawHtml({ text: `Problem <textarea title='${mentions[1]!}` })).toBe(false);
  });
});

/**
 * The MEMBER layer — the one that removes this door's dependency on a `derive` that can refuse.
 *
 * A lookup is built by hand rather than through `resolveMention`: what is under test is what this door DOES
 * with a verdict, not how the verdict was reached (that is `../../silver/mentionResolver.test.ts`).
 */
function memberPerson({ name, linearId }: { name: string; linearId: string }): MentionPerson {
  return {
    active: true,
    bot: false,
    displayName: name,
    email: `${name.toLowerCase()}@example.test`,
    identities: [{ active: true, bot: false, name, nativeId: linearId, source: "linear" }],
    key: `${name.toLowerCase()}@example.test`,
    orgStatus: "org",
  };
}

/** One `resolved` member verdict for a key. */
function memberResolved({
  key,
  name,
  linearId,
}: {
  key: string;
  name: string;
  linearId: string;
}): ReadonlyMap<string, MentionLookup> {
  const matched = memberPerson({ linearId, name });
  return new Map([[key, { kind: "resolved", match: { person: matched, tier: "given-name" }, nativeId: linearId }]]);
}

describe("the member layer", () => {
  it("resolves a first name the derived roster has never heard of, and labels it with the real name", () => {
    const resolution = resolveLinearMentions({
      derived: roster({ people: [] }),
      freshness: FRESH,
      keys: ["ada"],
      memberLookups: memberResolved({ key: "ada", linearId: ID_ADA, name: "Ada Lovelace" }),
      overrides: [],
    });

    expect(resolution.resolved.get("ada")).toEqual({ label: "Ada Lovelace", linearId: ID_ADA, origin: "member" });
  });

  it("blocks the derived roster from answering a key the member layer REFUSED", () => {
    const ambiguous: ReadonlyMap<string, MentionLookup> = new Map([
      [
        "ada",
        {
          kind: "ambiguous",
          matches: [
            { person: memberPerson({ linearId: ID_ADA, name: "Ada One" }), tier: "given-name" },
            { person: memberPerson({ linearId: ID_GRACE, name: "Ada Two" }), tier: "given-name" },
          ],
          tier: "given-name",
        },
      ],
    ]);
    const resolution = resolveLinearMentions({
      derived: roster({ people: [person({ handle: "ada", id: "p-ada", linearId: ID_ADA, name: "Ada" })] }),
      freshness: FRESH,
      keys: ["ada"],
      memberLookups: ambiguous,
      overrides: [],
    });

    expect(resolution.resolved.has("ada")).toBe(false);
    expect(linearMentionRefusals({ keys: ["ada"], resolution })[0]).toContain("2 colleagues answer to it");
  });

  it("does not append a roster-candidate block under a member refusal, which already names who it saw", () => {
    const external: ReadonlyMap<string, MentionLookup> = new Map([
      [
        "ada",
        {
          kind: "external",
          matches: [{ person: memberPerson({ linearId: ID_ADA, name: "Ada Stranger" }), tier: "handle" }],
        },
      ],
    ]);
    const resolution = resolveLinearMentions({
      derived: roster({ people: [person({ handle: "ada", id: "p-ada", linearId: ID_GRACE, name: "Ada" })] }),
      freshness: FRESH,
      keys: ["ada"],
      memberLookups: external,
      overrides: [],
    });

    expect(resolution.candidates.has("ada")).toBe(false);
    expect(linearMentionRefusals({ keys: ["ada"], resolution })[0]).toContain(
      "OUTSIDE your organisation's email domains",
    );
  });

  it("does not hold a write on a stale roster when the member index settled every mention", () => {
    const resolution = resolveLinearMentions({
      derived: roster({ people: [] }),
      freshness: STALE,
      keys: ["ada"],
      memberLookups: memberResolved({ key: "ada", linearId: ID_ADA, name: "Ada Lovelace" }),
      overrides: [],
    });

    expect(staleLinearMentionRefusals({ keys: ["ada"], resolution })).toEqual([]);
    expect(linearMentionRefusals({ keys: ["ada"], resolution })).toEqual([]);
  });

  it("still holds a write whose mention fell through to the derived roster", () => {
    const resolution = resolveLinearMentions({
      derived: roster({ people: [] }),
      freshness: STALE,
      keys: ["ada"],
      memberLookups: new Map(),
      overrides: [],
    });

    expect(staleLinearMentionRefusals({ keys: ["ada"], resolution }).length).toBe(1);
  });
});

describe("a heard-as pin whose target the member index cannot resolve", () => {
  const pinnedMiss: ReadonlyMap<string, MentionLookup & { heardAsTarget: string }> = new Map([
    ["smitty", { heardAsTarget: "john@example.test", kind: "unknown" }],
  ]);
  const resolution = resolveLinearMentions({
    derived: roster({ people: [person({ handle: "orrin", id: "smitty", linearId: ID_GRACE, name: "Orrin" })] }),
    freshness: STALE,
    keys: ["smitty"],
    memberLookups: pinnedMiss,
    overrides: [],
  });

  it("refuses rather than letting the derived roster mention whoever else answers to the raw token", () => {
    expect(resolution.resolved.has("smitty")).toBe(false);
    expect(linearMentionRefusals({ keys: ["smitty"], resolution })[0]).toBe(
      '"smitty" is pinned heard-as john@example.test in the identity roster (slopweaver identity roster replace), but the member index does not resolve that target on linear.',
    );
  });

  it("does not blame a stale derived roster, which could not have changed the outcome", () => {
    expect(staleLinearMentionRefusals({ keys: ["smitty"], resolution })).toEqual([]);
  });
});

describe("a heard-as claim reaching the resolver on a lookup nobody routed", () => {
  it("still refuses, because the resolver reads the roster's claims itself", () => {
    const john: IdentityRecord = {
      email: "john@example.test",
      handle: "john",
      heardAs: ["smitty"],
      id: "p-john",
      name: "John",
    };
    const resolution = resolveLinearMentions({
      derived: roster({ people: [person({ handle: "orrin", id: "smitty", linearId: ID_GRACE, name: "Orrin" })] }),
      freshness: FRESH,
      keys: ["smitty"],
      overrides: [john],
    });

    expect(resolution.resolved.has("smitty")).toBe(false);
  });
});
