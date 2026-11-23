import { describe, expect, it } from "vitest";
import type { CorpusRecord } from "../../../corpus/types.js";
import type { IdentityRecord, Person, PersonIdentity } from "../../../silver/identity.js";
import type { RawPersonResolution } from "../../../silver/personLookup.js";
import { normaliseName, personIdentityKey, resolvePersonForRaw } from "../../../silver/personLookup.js";
import {
  canonicalPersonId,
  canonicalPersonIdForAuthor,
  chatNativeAuthorId,
  identityCandidatesForRecord,
  resolveFromRecords,
  resolvePeople,
} from "../../../silver/personResolver.js";

const rec = (over: Partial<CorpusRecord> = {}): CorpusRecord => ({
  container: "o/r",
  kind: "pr",
  refs: [],
  source: "github",
  sourceId: "#1",
  text: "t",
  tsIso: "2026-05-01T00:00:00Z",
  url: "u",
  ...over,
});

/**
 * The person a raw lookup resolved to, THROWING when it did not resolve to exactly one — the
 * `unwrap(result)` pattern, so a test reads the value without a conditional in its assertion.
 */
const resolvedPerson = ({ resolved }: { resolved: RawPersonResolution }): Person => {
  if (resolved.kind !== "resolved") {
    throw new Error(`expected exactly one person, got ${resolved.kind}`);
  }
  return resolved.person;
};

describe("identityCandidatesForRecord", () => {
  it("emits the author tagged with the record's source, when the author is itself id-shaped", () => {
    expect(identityCandidatesForRecord({ record: rec({ author: "U1A", source: "slack" }) })).toEqual([
      { name: "U1A", nativeId: "U1A", source: "slack" },
    ]);
  });

  it("refuses a Slack author that is a display name with no recoverable id", () => {
    expect(identityCandidatesForRecord({ record: rec({ author: "ada", source: "slack" }) })).toEqual([]);
  });

  it("emits nothing for an author-less or gold record", () => {
    expect(identityCandidatesForRecord({ record: rec() })).toEqual([]);
    expect(identityCandidatesForRecord({ record: rec({ author: "x", source: "gold" }) })).toEqual([]);
  });

  it("refuses a Linear author that is a display name — the connector never requested the user id", () => {
    expect(identityCandidatesForRecord({ record: rec({ author: "adela.yip", source: "linear" }) })).toEqual([]);
  });

  it("joins a Linear author once the connector carries the real UUID", () => {
    const uuid = "c4e7371f-37c3-48b8-99fc-41146b3188a1";
    expect(identityCandidatesForRecord({ record: rec({ author: uuid, source: "linear" }) })).toEqual([
      { name: uuid, nativeId: uuid, source: "linear" },
    ]);
  });
});

describe("resolvePeople — email join (high confidence)", () => {
  const candidates: readonly PersonIdentity[] = [
    { email: "ada@x.co", name: "Ada", nativeId: "ada", source: "github" },
    { email: "ADA@x.co", name: "Ada L", nativeId: "U1", source: "slack" },
  ];

  it("merges two sources sharing a normalised email into one person at 'email' confidence", () => {
    const resolution = resolvePeople({ candidates, overrides: [] });
    expect(resolution.people).toHaveLength(1);
    const person = resolution.people[0]!;
    expect(person.id).toBe("person:email:ada@x.co");
    expect(person.confidence).toBe("email");
    expect(person.identities.map((i) => i.source).toSorted()).toEqual(["github", "slack"]);
  });
});

describe("resolvePeople — name match (held, not applied)", () => {
  const candidates: readonly PersonIdentity[] = [
    { name: "Ada Lovelace", nativeId: "ada", source: "github" },
    { name: "ada  lovelace", nativeId: "U1", source: "slack" },
  ];

  it("keeps same-name cross-source identities as SEPARATE people", () => {
    const resolution = resolvePeople({ candidates, overrides: [] });
    expect(resolution.people.map((p) => p.id)).toEqual(["person:github:ada", "person:slack:u1"]);
    expect(resolution.people.every((p) => p.confidence === "single-source")).toBe(true);
  });

  it("flags the name collision as one held candidate over both people", () => {
    const resolution = resolvePeople({ candidates, overrides: [] });
    expect(resolution.candidates).toEqual([
      { confidence: "name", personIds: ["person:github:ada", "person:slack:u1"], reason: "name:ada lovelace" },
    ]);
  });

  it("does NOT index a held name link, so the directory leaves the ids raw", () => {
    const resolution = resolvePeople({ candidates, overrides: [] });
    expect(canonicalPersonId({ rawId: "ada", resolution, source: "github" })).toBe("ada");
  });
});

describe("resolvePeople — roster override always wins", () => {
  const overrides: readonly IdentityRecord[] = [
    {
      handle: "ada",
      id: "person:ada",
      identities: [
        { nativeId: "ada", source: "github" },
        { nativeId: "U1", source: "slack" },
      ],
      name: "Ada Lovelace",
    },
  ];
  // These same ids would otherwise email-merge under a DIFFERENT id — the override must win.
  const candidates: readonly PersonIdentity[] = [
    { email: "ada@x.co", nativeId: "ada", source: "github" },
    { email: "ada@x.co", nativeId: "U1", source: "slack" },
  ];

  it("pins the seeded ids to the roster person at 'override' confidence", () => {
    const resolution = resolvePeople({ candidates, overrides });
    expect(resolution.people).toHaveLength(1);
    const person = resolution.people[0]!;
    expect(person.id).toBe("person:ada");
    expect(person.confidence).toBe("override");
    expect(person.identities.map((i) => i.nativeId).toSorted()).toEqual(["U1", "ada"]);
    expect(person.provenance).toEqual(["override:person:ada"]);
  });

  it("indexes the applied override link for the directory to merge on", () => {
    const resolution = resolvePeople({ candidates, overrides });
    expect(canonicalPersonId({ rawId: "ada", resolution, source: "github" })).toBe("person:ada");
    expect(canonicalPersonId({ rawId: "U1", resolution, source: "slack" })).toBe("person:ada");
  });

  it("absorbs a free candidate that shares the roster person's email — override wins over an inferred email group", () => {
    const withEmail: readonly IdentityRecord[] = [
      {
        email: "ada@x.co",
        handle: "ada",
        id: "person:ada",
        identities: [{ nativeId: "ada", source: "github" }],
        name: "Ada",
      },
    ];
    // a Slack candidate carries the same email but is NOT listed in the roster's identities
    const resolution = resolvePeople({
      candidates: [{ email: "ADA@x.co", nativeId: "U1", source: "slack" }],
      overrides: withEmail,
    });
    expect(resolution.people).toHaveLength(1);
    const person = resolution.people[0]!;
    expect(person.id).toBe("person:ada");
    expect(person.confidence).toBe("override");
    expect(person.identities.map((i) => i.source).toSorted()).toEqual(["github", "slack"]);
    expect(person.provenance).toContain("email:ada@x.co");
  });

  it("MERGES a corpus candidate into its roster identity without losing the roster's handle", () => {
    const withHandle: readonly IdentityRecord[] = [
      {
        handle: "ada",
        id: "person:ada",
        identities: [{ handle: "ada-gh", nativeId: "ada", source: "github" }],
        name: "Ada",
      },
    ];
    // the corpus candidate for the same id carries a NAME but no handle — the roster handle must survive
    const resolution = resolvePeople({
      candidates: [{ name: "Ada L", nativeId: "ada", source: "github" }],
      overrides: withHandle,
    });
    expect(resolution.people[0]!.identities).toEqual([
      { handle: "ada-gh", name: "Ada L", nativeId: "ada", source: "github" },
    ]);
  });
});

describe("resolvePeople — single-source fallback + conflicts", () => {
  it("gives a lone identity a deterministic person:<source>:<id> key", () => {
    const resolution = resolvePeople({ candidates: [{ nativeId: "Ada", source: "github" }], overrides: [] });
    expect(resolution.people[0]!.id).toBe("person:github:ada");
    expect(resolution.people[0]!.confidence).toBe("single-source");
  });

  it("records a conflict when two roster people declare the same email (email ownership is authoritative)", () => {
    const overrides: readonly IdentityRecord[] = [
      {
        email: "shared@x.co",
        handle: "a",
        id: "person:a",
        identities: [{ nativeId: "a", source: "github" }],
        name: "A",
      },
      {
        email: "SHARED@x.co",
        handle: "b",
        id: "person:b",
        identities: [{ nativeId: "b", source: "slack" }],
        name: "B",
      },
    ];
    const resolution = resolvePeople({ candidates: [], overrides });
    expect(resolution.conflicts).toEqual(["email shared@x.co claimed by both person:a and person:b"]);
  });

  it("records a conflict when two roster people claim the same source/native id (no silent later-wins)", () => {
    const overrides: readonly IdentityRecord[] = [
      { handle: "a", id: "person:a", identities: [{ nativeId: "ada", source: "github" }], name: "A" },
      { handle: "b", id: "person:b", identities: [{ nativeId: "ada", source: "github" }], name: "B" },
    ];
    const resolution = resolvePeople({ candidates: [], overrides });
    expect(resolution.conflicts).toEqual(["identity github:ada claimed by both person:a and person:b"]);
    // person:a keeps the identity; person:b's empty shell is dropped.
    expect(resolution.people.map((p) => p.id)).toEqual(["person:a"]);
  });
});

describe("resolvePeople — how a person is first seated", () => {
  it("seeds nobody from a roster entry that pins no source id, absent or empty", () => {
    const resolution = resolvePeople({
      candidates: [],
      overrides: [
        { handle: "a", id: "person:a", name: "A" },
        { handle: "b", id: "person:b", identities: [], name: "B" },
      ],
    });
    expect(resolution.people).toEqual([]);
    expect(resolution.index.size).toBe(0);
  });

  it("extends the first roster entry under an id with a later one, keeping the first entry's name", () => {
    const resolution = resolvePeople({
      candidates: [],
      overrides: [
        { handle: "a", id: "person:a", identities: [{ nativeId: "a", source: "github" }], name: "First" },
        { handle: "a2", id: "person:a", identities: [{ nativeId: "U9", source: "slack" }], name: "Second" },
      ],
    });
    expect(resolution.people.map((p) => p.displayName)).toEqual(["First"]);
    expect(resolution.people[0]!.identities.map((i) => personIdentityKey(i))).toEqual(["github:a", "slack:U9"]);
  });

  it("names an inferred group after the first candidate to reach it", () => {
    const resolution = resolvePeople({
      candidates: [
        { email: "ada@x.co", handle: "ada-h", nativeId: "ada", source: "github" },
        { email: "ada@x.co", name: "Ada L", nativeId: "U1", source: "slack" },
      ],
      overrides: [],
    });
    expect(resolution.people.map((p) => p.displayName)).toEqual(["ada-h"]);
  });

  it("holds one name candidate listing every person who carries that name, sorted", () => {
    const resolution = resolvePeople({
      candidates: [
        { name: "Seth", nativeId: "seth", source: "github" },
        { name: "seth", nativeId: "U2", source: "slack" },
        { name: "SETH", nativeId: "lin-seth", source: "linear" },
        { name: "Other", nativeId: "other", source: "github" },
      ],
      overrides: [],
    });
    expect(resolution.candidates).toEqual([
      {
        confidence: "name",
        personIds: ["person:github:seth", "person:linear:lin-seth", "person:slack:u2"],
        reason: "name:seth",
      },
    ]);
  });
});

describe("resolvePersonForRaw", () => {
  const resolution = resolvePeople({
    candidates: [],
    overrides: [
      {
        handle: "ada",
        id: "person:ada",
        identities: [
          { nativeId: "ada", source: "github" },
          { handle: "ada", nativeId: "U1", source: "slack" },
        ],
        name: "Ada Lovelace",
      },
    ],
  });

  it("resolves a raw native id (any source) to its canonical person", () => {
    expect(resolvedPerson({ resolved: resolvePersonForRaw({ raw: "U1", resolution }) }).id).toBe("person:ada");
    expect(resolvedPerson({ resolved: resolvePersonForRaw({ raw: "@ada", resolution }) }).id).toBe("person:ada");
  });

  it("reports an unknown token as unknown rather than guessing", () => {
    expect(resolvePersonForRaw({ raw: "nobody", resolution }).kind).toBe("unknown");
  });
});

describe("resolveFromRecords", () => {
  it("resolves straight from corpus records + roster (merging by the seed)", () => {
    const records: readonly CorpusRecord[] = [
      rec({ author: "ada", source: "github", sourceId: "#1" }),
      rec({ author: "Ada Lovelace", container: "slack/c", source: "slack", sourceId: "s1" }),
    ];
    const roster: readonly IdentityRecord[] = [
      {
        handle: "ada",
        id: "person:ada",
        identities: [
          { nativeId: "ada", source: "github" },
          { nativeId: "Ada Lovelace", source: "slack" },
        ],
        name: "Ada Lovelace",
      },
    ];
    const resolution = resolveFromRecords({ records, roster });
    expect(resolution.people.map((p) => p.id)).toEqual(["person:ada"]);
    expect(resolution.people[0]!.identities).toHaveLength(2);
  });
});

describe("chatNativeAuthorId — the chat file/pin repair", () => {
  it("lifts the native id a chat record keeps in raw.user when its author is a display name", () => {
    const record = rec({ author: "Ada Lovelace", kind: "file", raw: { user: "U1" }, source: "slack" });
    expect(chatNativeAuthorId({ record })).toBe("U1");
  });

  it("returns undefined when the author IS the native id already (a message/comment record)", () => {
    expect(chatNativeAuthorId({ record: rec({ author: "U1", raw: { user: "U1" }, source: "slack" }) })).toBeUndefined();
  });

  it("returns undefined for a non-chat source, even carrying the same raw field", () => {
    expect(
      chatNativeAuthorId({ record: rec({ author: "Ada", raw: { user: "U1" }, source: "github" }) }),
    ).toBeUndefined();
  });

  it("returns undefined for a chat record with no raw, no user, or a blank/non-string user", () => {
    expect(chatNativeAuthorId({ record: rec({ author: "Ada", source: "slack" }) })).toBeUndefined();
    expect(chatNativeAuthorId({ record: rec({ author: "Ada", raw: {}, source: "slack" }) })).toBeUndefined();
    expect(chatNativeAuthorId({ record: rec({ author: "Ada", raw: { user: "" }, source: "slack" }) })).toBeUndefined();
    expect(chatNativeAuthorId({ record: rec({ author: "Ada", raw: { user: 7 }, source: "slack" }) })).toBeUndefined();
  });
});

describe("canonicalPersonIdForAuthor — a chat author reaches its person by the key the resolver knows", () => {
  const resolution = resolveFromRecords({
    extraCandidates: [
      { email: "ada@x.co", name: "Ada Lovelace", nativeId: "U1", source: "slack" },
      { email: "ada@x.co", name: "ada", nativeId: "ada", source: "github" },
    ],
    records: [],
    roster: [],
  });

  it("resolves a chat upload whose author is a display name, via its raw native id", () => {
    const record = rec({ author: "Ada Lovelace", kind: "file", raw: { user: "U1" }, source: "slack" });
    expect(canonicalPersonIdForAuthor({ record, resolution })).toBe("person:email:ada@x.co");
  });

  it("resolves an ordinary chat message the same way, straight off its author", () => {
    const record = rec({ author: "U1", kind: "message", raw: { user: "U1" }, source: "slack" });
    expect(canonicalPersonIdForAuthor({ record, resolution })).toBe("person:email:ada@x.co");
  });

  it("prefers the record's own author over the raw payload, so a me-to-me rewrite is never undone", () => {
    // PR4.5 rewrites the owner's own bot post to the owner's user id, while raw.user stays the BOT's id.
    const record = rec({ author: "U1", kind: "message", raw: { user: "UBOT" }, source: "slack" });
    expect(canonicalPersonIdForAuthor({ record, resolution })).toBe("person:email:ada@x.co");
  });

  it("leaves an unresolvable chat author exactly as it was — never a guess at who the name meant", () => {
    const record = rec({ author: "Someone Else", kind: "file", raw: { user: "U404" }, source: "slack" });
    expect(canonicalPersonIdForAuthor({ record, resolution })).toBe("Someone Else");
  });

  it("returns undefined for an author-less or blank-author record, and the raw id for a gold one", () => {
    expect(canonicalPersonIdForAuthor({ record: rec(), resolution })).toBeUndefined();
    expect(canonicalPersonIdForAuthor({ record: rec({ author: "" }), resolution })).toBeUndefined();
    expect(canonicalPersonIdForAuthor({ record: rec({ author: "x", source: "gold" }), resolution })).toBe("x");
  });
});

describe("normalisers + key", () => {
  it("collapses whitespace + case in a name and builds a stable key", () => {
    expect(normaliseName({ name: "  Ada   Lovelace " })).toBe("ada lovelace");
    expect(personIdentityKey({ nativeId: "U1", source: "slack" })).toBe("slack:U1");
  });
});

describe("member candidates feed the email tier (PR4.1)", () => {
  const member = (over: Partial<PersonIdentity>): PersonIdentity => ({ nativeId: "x", source: "slack", ...over });

  it("auto-links a person across sources by a shared trusted email, at email confidence, with provenance", () => {
    const resolution = resolveFromRecords({
      extraCandidates: [
        member({ email: "ada@example.com", name: "Ada", nativeId: "U1", source: "slack" }),
        member({ email: "ada@example.com", name: "ada", nativeId: "ada", source: "github" }),
        member({ email: "ada@example.com", name: "Ada L", nativeId: "n1", source: "notion" }),
      ],
      records: [],
      roster: [],
    });
    const person = resolvedPerson({ resolved: resolvePersonForRaw({ raw: "U1", resolution, source: "slack" }) });
    expect(person.confidence).toBe("email");
    expect(person.identities.map((i) => i.source).toSorted()).toEqual(["github", "notion", "slack"]);
    expect(person.provenance).toContain("email:ada@example.com");
  });

  it("HOLDS a no-email member with a colliding name (a name candidate, never an applied merge)", () => {
    const resolution = resolveFromRecords({
      extraCandidates: [
        member({ name: "Ada Lovelace", nativeId: "U1", source: "slack" }),
        member({ name: "Ada Lovelace", nativeId: "n1", source: "notion" }),
      ],
      records: [],
      roster: [],
    });
    const slack = resolvedPerson({ resolved: resolvePersonForRaw({ raw: "U1", resolution, source: "slack" }) });
    const notion = resolvedPerson({ resolved: resolvePersonForRaw({ raw: "n1", resolution, source: "notion" }) });
    expect(slack.id).not.toBe(notion.id);
    expect(resolution.candidates.map((c) => c.reason)).toEqual(["name:ada lovelace"]);
  });

  it("keeps the roster override winning over an inferred member email link", () => {
    const roster: readonly IdentityRecord[] = [
      {
        handle: "ada",
        id: "person:ada",
        identities: [{ email: "ada@example.com", nativeId: "U1", source: "slack" }],
        name: "Ada",
      },
    ];
    const resolution = resolveFromRecords({
      extraCandidates: [member({ email: "ada@example.com", nativeId: "ada", source: "github" })],
      records: [],
      roster,
    });
    const person = resolvedPerson({ resolved: resolvePersonForRaw({ raw: "ada", resolution, source: "github" }) });
    expect(person.id).toBe("person:ada");
    expect(person.confidence).toBe("override");
  });

  it("cannot merge members whose held email was stripped at projection (no email reaches the resolver)", () => {
    const resolution = resolveFromRecords({
      // A weak/shared email is dropped by `memberCandidate`, so the resolver only ever sees email-less
      // candidates for those members — which therefore stay separate rather than wrong-merging.
      extraCandidates: [
        member({ name: "Ada", nativeId: "U1", source: "slack" }),
        member({ name: "Grace", nativeId: "g1", source: "github" }),
      ],
      records: [],
      roster: [],
    });
    const slack = resolvedPerson({ resolved: resolvePersonForRaw({ raw: "U1", resolution, source: "slack" }) });
    const github = resolvedPerson({ resolved: resolvePersonForRaw({ raw: "g1", resolution, source: "github" }) });
    expect(slack.id).not.toBe(github.id);
  });
});
