import { describe, expect, it } from "vitest";
import { runIdentityNarrowWithDeps } from "../../../../../cli/commands/identity/identityNarrow.js";
import { runIdentityOrgDomainsWithDeps } from "../../../../../cli/commands/identity/identityOrgDomains.js";
import { runIdentityResolveWithDeps } from "../../../../../cli/commands/identity/identityResolve.js";
import type { IdentityDeps } from "../../../../../cli/commands/identity/identityShared.js";
import { runIdentityShowWithDeps } from "../../../../../cli/commands/identity/identityShow.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import type { MemberBronzeRow } from "../../../../../corpus/members/types.js";
import type { CorpusRecord } from "../../../../../corpus/types.js";
import { err as failure, ok } from "../../../../../lib/result.js";
import type { MentionGroup } from "../../../../../silver/groupMention.js";
import type { IdentityRecord } from "../../../../../silver/identity.js";
import { IdentityRosterErrors } from "../../../../../silver/identityRosterErrors.js";
import { identityCandidatesForRecord } from "../../../../../silver/personResolver.js";
import { parseOwnJson } from "../../../../parseOwnJson.js";

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

const RECORDS: readonly CorpusRecord[] = [
  rec({ author: "ada", source: "github", sourceId: "gh1" }),
  rec({ author: "U1", container: "slack/c", source: "slack", sourceId: "s1" }),
];

const ROSTER: readonly IdentityRecord[] = [
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

/** A capturing fake — plain functions, not mocks (per testing.md). */
function fakeDeps({
  records = RECORDS,
  roster = ROSTER,
  members = [],
  groups = [],
  orgDomains = [],
  rosterOutage,
  corpusRefused,
}: {
  records?: readonly CorpusRecord[];
  roster?: readonly IdentityRecord[];
  /** When set, the roster seam answers a store-unavailable refusal carrying this reason. */
  rosterOutage?: string;
  /** When set, the candidate seam answers the owner's protect list refusing the corpus, with this message. */
  corpusRefused?: string;
  members?: readonly MemberBronzeRow[];
  orgDomains?: readonly string[];
  groups?: readonly MentionGroup[];
} = {}): { deps: IdentityDeps; out: string[]; err: string[]; loads: () => number } {
  const out: string[] = [];
  const err: string[] = [];
  let loads = 0;
  const deps: IdentityDeps = {
    home: () => "/home",
    loadDirectory: () => ({ basis: "test", orgDomains, rows: members, warnings: [] }),
    loadGroups: () => groups,
    loadMembers: () => ({ rows: members, warnings: [] }),
    loadCandidates: () => {
      loads += 1;
      if (corpusRefused !== undefined) {
        return { candidates: [], refused: corpusRefused, warnings: [] };
      }
      // Through the REAL extractor, so the fake seam supplies only the I/O the production stream does — a
      // fake that hand-wrote candidates would stop testing what a record actually contributes.
      return { candidates: records.flatMap((record) => identityCandidatesForRecord({ record })), warnings: [] };
    },
    loadRoster: async () => {
      if (rosterOutage !== undefined) {
        return failure(IdentityRosterErrors.storeUnavailable({ doing: "be opened", reason: rosterOutage }));
      }
      return ok(roster);
    },
    logger: {
      error: ({ msg }) => err.push(msg),
      out: ({ line }) => out.push(line),
      warn: () => {},
    },
  };
  return { deps, err, loads: () => loads, out };
}

const argv = ({ tail }: { tail: readonly string[] }): readonly string[] => ["node", "cli", "identity", ...tail];

describe("identity show", () => {
  it("lists the merged canonical person", async () => {
    const { deps, out } = fakeDeps();
    const code = await runIdentityShowWithDeps({ argv: argv({ tail: ["show"] }), deps });
    expect(code).toBe(EXIT_OK);
    expect(out[0]).toBe("person:ada  [override]  Ada Lovelace");
  });

  it("emits deterministic --json for the whole resolution", async () => {
    const { deps, out } = fakeDeps();
    await runIdentityShowWithDeps({ argv: argv({ tail: ["show", "--json"] }), deps });
    const parsed = parseOwnJson<{ people: { id: string }[] }>({ text: out.join("\n") });
    expect(parsed.people.map((p) => p.id)).toEqual(["person:ada"]);
  });

  it("filters to one person when given a positional (the `show <me>` proof shape)", async () => {
    const { deps, out } = fakeDeps();
    const code = await runIdentityShowWithDeps({ argv: argv({ tail: ["show", "U1"] }), deps });
    expect(code).toBe(EXIT_OK);
    expect(out[0]).toBe("person:ada  [override]  Ada Lovelace");
  });

  it("signals not-found (EXIT_EXPECTED_EMPTY) for an unknown positional", async () => {
    const { deps, out } = fakeDeps();
    const code = await runIdentityShowWithDeps({ argv: argv({ tail: ["show", "nobody"] }), deps });
    expect(code).toBe(EXIT_EXPECTED_EMPTY);
    expect(out[0]).toBe('no canonical person for "nobody"');
  });

  it("refuses with EXIT_ERROR, never an empty roster, when the store cannot answer", async () => {
    const { deps, out, err: errors } = fakeDeps({ rosterOutage: "refusing to reach the store" });
    const code = await runIdentityShowWithDeps({ argv: argv({ tail: ["show"] }), deps });
    expect(code).toBe(EXIT_ERROR);
    expect(out).toEqual([]);
    expect(errors).toEqual([
      IdentityRosterErrors.storeUnavailable({ doing: "be opened", reason: "refusing to reach the store" }).message,
    ]);
  });

  it("refuses with EXIT_ERROR, never a resolution without the corpus, when the protect list refuses it", async () => {
    const { deps, out, err: errors } = fakeDeps({ corpusRefused: "refusing to read the corpus: fixture" });
    const code = await runIdentityShowWithDeps({ argv: argv({ tail: ["show"] }), deps });
    expect(code).toBe(EXIT_ERROR);
    expect(out).toEqual([]);
    expect(errors).toEqual(["refusing to read the corpus: fixture"]);
  });

  it("rejects an unknown flag WITHOUT loading the corpus (parse reject is I/O-free)", async () => {
    const { deps, loads } = fakeDeps();
    const code = await runIdentityShowWithDeps({ argv: argv({ tail: ["show", "--bogus"] }), deps });
    expect(code).toBe(EXIT_USAGE);
    expect(loads()).toBe(0);
  });

  it("prints usage on --help without loading the corpus", async () => {
    const { deps, out, loads } = fakeDeps();
    const code = await runIdentityShowWithDeps({ argv: argv({ tail: ["show", "--help"] }), deps });
    expect(code).toBe(EXIT_OK);
    expect(out[0]).toContain("usage: slopweaver identity show");
    expect(loads()).toBe(0);
  });
});

describe("identity resolve", () => {
  it("resolves from the MEMBER index without touching the corpus at all", async () => {
    const { deps, out, loads } = fakeDeps({
      members: [memberRow({ email: "ada@example.com", nativeId: "ada", source: "slack" })],
      orgDomains: ["example.com"],
    });
    const code = await runIdentityResolveWithDeps({ argv: argv({ tail: ["resolve", "ada"] }), deps });
    expect(code).toBe(EXIT_OK);
    expect(out[0]).toBe("ada@example.com  [native-id]  ada");
    // The whole point of the member leg: a lookup that used to stream every bronze file now reads none.
    expect(loads()).toBe(0);
  });

  it("signals not-found for a token no colleague answers to, and names the corpus escape", async () => {
    const { deps, out, loads } = fakeDeps();
    const code = await runIdentityResolveWithDeps({ argv: argv({ tail: ["resolve", "ghost"] }), deps });
    expect(code).toBe(EXIT_EXPECTED_EMPTY);
    expect(out[0]).toBe(
      'no colleague in the member index answers to "ghost", and nothing in the member index is spelled near it.',
    );
    expect(out.join("\n")).toContain("--corpus-scan");
    expect(loads()).toBe(0);
  });

  it("never calls a miss a real absence — the sentence an earlier finding measured is gone", async () => {
    const { deps, out } = fakeDeps();
    await runIdentityResolveWithDeps({ argv: argv({ tail: ["resolve", "ghost"] }), deps });
    expect(out.join("\n")).not.toContain("real absence");
    // Falsifiable: the TRUE half of that sentence is still printed, so this is not asserting on silence.
    expect(out.join("\n")).toContain("member bronze is every provider's own member list");
    expect(out.join("\n")).toContain("Nothing here establishes that the person is not in the corpus.");
  });

  it("names the colleague a two-letter misspelling missed, and refuses to pick one", async () => {
    const { deps, out, loads } = fakeDeps({
      members: [memberRow({ email: "hollis@example.com", nativeId: "Hollis Grantham", source: "slack" })],
      orgDomains: ["example.com"],
    });
    const code = await runIdentityResolveWithDeps({ argv: argv({ tail: ["resolve", "Hollis Grantam"] }), deps });
    expect(code).toBe(EXIT_EXPECTED_EMPTY);
    expect(out[0]).toBe('no colleague in the member index answers EXACTLY to "Hollis Grantam".');
    expect(out[1]).toBe("  the member index was spelling-matched too, and 1 person in it is near it:");
    expect(out[2]).toBe("    Hollis Grantham <hollis@example.com>  [org-status: org · full-name · 1 edit]");
    expect(out[3]).toBe(
      "  this verb will not pick one for you — re-run it with the spelling, handle, email or id you meant.",
    );
    // The near pass is member-index only: it must not have paid for a corpus walk to say this.
    expect(loads()).toBe(0);
  });

  it("emits the miss as JSON when asked, rather than prose a --json caller cannot parse", async () => {
    const { deps, out } = fakeDeps({
      members: [memberRow({ email: "hollis@example.com", nativeId: "Hollis Grantham", source: "slack" })],
      orgDomains: ["example.com"],
    });
    const code = await runIdentityResolveWithDeps({
      argv: argv({ tail: ["resolve", "Hollis Grantam", "--json"] }),
      deps,
    });
    expect(code).toBe(EXIT_EXPECTED_EMPTY);
    const parsed = parseOwnJson<{
      corpusScanned: boolean;
      near: readonly { distance: number; field: string; key: string }[];
      raw: string;
      reason: string;
    }>({ text: out.join("\n") });
    expect(parsed.reason).toBe("no-exact-match");
    expect(parsed.raw).toBe("Hollis Grantam");
    expect(parsed.corpusScanned).toBe(false);
    expect(parsed.near.map((match) => match.key)).toEqual(["hollis@example.com"]);
    expect(parsed.near[0]!.distance).toBe(1);
    expect(parsed.near[0]!.field).toBe("full-name");
  });

  it("follows a heard-as pin the roster declares, and says it did (Smitty is John Smith)", async () => {
    const { deps, out } = fakeDeps({
      members: [
        memberRow({ email: "john.smith@acme.com", nativeId: "U0SYN000011", source: "slack" }),
        memberRow({ email: "orrin.wexley@acme.com", nativeId: "U0SYN000016", source: "slack" }),
      ],
      orgDomains: ["acme.com"],
      roster: [{ email: "john.smith@acme.com", handle: "john", heardAs: ["smitty"], id: "p:john", name: "John" }],
    });
    const code = await runIdentityResolveWithDeps({ argv: argv({ tail: ["resolve", "Smitty"] }), deps });
    expect(code).toBe(EXIT_OK);
    expect(out[0]).toBe("john.smith@acme.com  [email]  U0SYN000011");
    expect(out.at(-1)).toBe(
      '  heard-as: "Smitty" is pinned to john.smith@acme.com in the identity roster (slopweaver identity roster replace)',
    );
  });

  it("carries the pin in --json, so a caller can tell a declared route from a typed name", async () => {
    const { deps, out } = fakeDeps({
      members: [memberRow({ email: "john.smith@acme.com", nativeId: "U0SYN000011", source: "slack" })],
      orgDomains: ["acme.com"],
      roster: [{ email: "john.smith@acme.com", handle: "john", heardAs: ["smythe"], id: "p:john", name: "John" }],
    });
    const code = await runIdentityResolveWithDeps({ argv: argv({ tail: ["resolve", "Smythe", "--json"] }), deps });
    expect(code).toBe(EXIT_OK);
    const parsed = parseOwnJson<{ heardAs: string; key: string }>({ text: out.join("\n") });
    expect(parsed.heardAs).toBe("john.smith@acme.com");
    expect(parsed.key).toBe("john.smith@acme.com");
  });

  it("answers a corpus-scan miss in the same shape, not a bare `no canonical person`", async () => {
    const { deps, out, loads } = fakeDeps({ records: [], roster: [] });
    const code = await runIdentityResolveWithDeps({
      argv: argv({ tail: ["resolve", "ghost", "--corpus-scan"] }),
      deps,
    });
    expect(code).toBe(EXIT_EXPECTED_EMPTY);
    expect(out[0]).toBe(
      'no colleague in the member index or the corpus answers to "ghost", and nothing in the member index is spelled near it.',
    );
    expect(out.join("\n")).not.toContain("no canonical person");
    // Offering the flag the caller just used would be advice that cannot be followed.
    expect(out.join("\n")).not.toContain("--corpus-scan");
    expect(loads()).toBe(1);
  });

  it("refuses with EXIT_ERROR, never an answer from an empty roster, when the store cannot answer on a miss", async () => {
    const { deps, out, err: errors } = fakeDeps({ rosterOutage: "refusing to reach the store" });
    const code = await runIdentityResolveWithDeps({ argv: argv({ tail: ["resolve", "ghost"] }), deps });
    expect(code).toBe(EXIT_ERROR);
    expect(out).toEqual([]);
    expect(errors).toEqual([
      IdentityRosterErrors.storeUnavailable({ doing: "be opened", reason: "refusing to reach the store" }).message,
    ]);
  });

  it("refuses a corpus scan the protect list refuses with EXIT_ERROR, never reporting nobody found", async () => {
    const { deps, out, err: errors } = fakeDeps({ corpusRefused: "refusing to read the corpus: fixture", roster: [] });
    const code = await runIdentityResolveWithDeps({
      argv: argv({ tail: ["resolve", "ghost", "--corpus-scan"] }),
      deps,
    });
    expect(code).toBe(EXIT_ERROR);
    expect(out).toEqual([]);
    expect(errors).toEqual(["refusing to read the corpus: fixture"]);
  });

  it("rejects a missing positional as a usage error, I/O-free", async () => {
    const { deps, loads } = fakeDeps();
    const code = await runIdentityResolveWithDeps({ argv: argv({ tail: ["resolve"] }), deps });
    expect(code).toBe(EXIT_USAGE);
    expect(loads()).toBe(0);
  });

  it("falls through to the whole-corpus resolution only when asked", async () => {
    const { deps, out, loads } = fakeDeps();
    const code = await runIdentityResolveWithDeps({ argv: argv({ tail: ["resolve", "@ada", "--corpus-scan"] }), deps });
    expect(code).toBe(EXIT_OK);
    expect(out[0]).toBe("person:ada  [override]  Ada Lovelace");
    expect(loads()).toBe(1);
  });

  it("still resolves within a source when the roster is empty (single-source)", async () => {
    const { deps, out } = fakeDeps({ roster: [] });
    const code = await runIdentityResolveWithDeps({ argv: argv({ tail: ["resolve", "ada", "--corpus-scan"] }), deps });
    expect(code).toBe(EXIT_OK);
    expect(out[0]).toBe("person:github:ada  [single-source]  ada");
  });

  it("refuses a match outside the org's domains rather than answering with a stranger", async () => {
    const { deps, err } = fakeDeps({
      members: [memberRow({ email: "ada@othercompany.test", nativeId: "lin-guest", source: "linear" })],
      orgDomains: ["example.com"],
    });
    const code = await runIdentityResolveWithDeps({ argv: argv({ tail: ["resolve", "ada"] }), deps });
    expect(code).toBe(EXIT_ERROR);
    expect(err[0]).toContain("OUTSIDE your organisation's email domains");
  });
});

describe("identity org-domains", () => {
  it("prints the settled domains and how they were settled", () => {
    const { deps, out } = fakeDeps({ orgDomains: ["example.com"] });
    const code = runIdentityOrgDomainsWithDeps({ argv: argv({ tail: ["org-domains"] }), deps });
    expect(code).toBe(EXIT_OK);
    expect(out[0]).toBe("org domains (test):");
    expect(out[1]).toBe("  example.com");
  });

  it("signals empty when nothing could be settled, so a caller can tell a refusal from a set", () => {
    const { deps } = fakeDeps();
    expect(runIdentityOrgDomainsWithDeps({ argv: argv({ tail: ["org-domains"] }), deps })).toBe(EXIT_EXPECTED_EMPTY);
  });
});

/** A member row carrying a HANDLE and no email — the shape whose only re-resolution token can collide. */
function handleOnlyRow({
  handle,
  name,
  nativeId,
}: {
  handle: string;
  name: string;
  nativeId: string;
}): MemberBronzeRow {
  return {
    fetchedAtIso: "2026-09-15T00:00:00.000Z",
    identity: { emailTrust: "missing", handle, name, nativeId, source: "slack" },
    profile: { active: true, bot: false },
    provenance: ["slack.users"],
    raw: {},
    source: "slack",
    sourceId: nativeId,
    version: 1,
    warnings: [],
  };
}

/** A trusted member row (a real personal email) for a source/id. */
function memberRow({
  source,
  nativeId,
  email,
}: {
  source: MemberBronzeRow["source"];
  nativeId: string;
  email: string;
}): MemberBronzeRow {
  return {
    fetchedAtIso: "2026-07-20T00:00:00.000Z",
    identity: { email, emailNormalised: email.toLowerCase(), emailTrust: "trusted", name: nativeId, nativeId, source },
    profile: { active: true, bot: false },
    provenance: [`${source}.users`],
    raw: {},
    source,
    sourceId: nativeId,
    version: 1,
    warnings: [],
  };
}

describe("identity show unifies teammates from hydrated members (PR4.1, no prior derive)", () => {
  it("merges two sources by a shared member email, with NO roster entry", async () => {
    const members = [
      memberRow({ email: "grace@example.com", nativeId: "U9", source: "slack" }),
      memberRow({ email: "grace@example.com", nativeId: "grace", source: "github" }),
    ];
    const { deps, out } = fakeDeps({ members, records: [], roster: [] });
    const code = await runIdentityShowWithDeps({ argv: argv({ tail: ["show", "U9", "--json"] }), deps });
    expect(code).toBe(EXIT_OK);
    const person = parseOwnJson<{ confidence: string; identities: readonly { source: string }[] }>({
      text: out.join("\n"),
    });
    expect(person.confidence).toBe("email");
    expect(person.identities.map((i) => i.source).toSorted()).toEqual(["github", "slack"]);
  });
});

describe("identity narrow — the roster a haiku sub-agent judges", () => {
  const members = [
    memberRow({ email: "hollis@example.com", nativeId: "Hollis Grantham", source: "slack" }),
    memberRow({ email: "petra@example.com", nativeId: "Petra Vance", source: "slack" }),
  ];

  it("prints the brief from the member index alone — no corpus walk to hand somebody a roster", () => {
    const { deps, out, loads } = fakeDeps({ members, orgDomains: ["example.com"] });
    const code = runIdentityNarrowWithDeps({ argv: argv({ tail: ["narrow", "Hollis Grantam"] }), deps });
    expect(code).toBe(EXIT_OK);
    const text = out.join("\n");
    expect(text).toContain('token: "Hollis Grantam"');
    expect(text).toContain("THE ROSTER — 2 people");
    expect(text).toContain("  hollis@example.com | Hollis Grantham");
    expect(loads()).toBe(0);
  });

  it("carries the framing the caller supplied, which is half of what the judge is given", () => {
    const { deps, out } = fakeDeps({ members, orgDomains: ["example.com"] });
    runIdentityNarrowWithDeps({
      argv: argv({ tail: ["narrow", "Hollis", "--question", "who runs the pool?", "--asked-by", "Petra Vance"] }),
      deps,
    });
    expect(out.join("\n")).toContain("the question it appeared in: who runs the pool?");
    expect(out.join("\n")).toContain("asked by: Petra Vance");
  });

  it("signals an EMPTY roster rather than handing a sub-agent nothing to pick from", () => {
    const { deps, out } = fakeDeps({ members: [], orgDomains: ["example.com"] });
    const code = runIdentityNarrowWithDeps({ argv: argv({ tail: ["narrow", "anyone"] }), deps });
    expect(code).toBe(EXIT_EXPECTED_EMPTY);
    expect(out.join("\n")).toContain("THE ROSTER — 0 people");
  });

  it("re-resolves a pick through the EXACT ladder, so what comes back is a real resolution", () => {
    const { deps, out } = fakeDeps({ members, orgDomains: ["example.com"] });
    const code = runIdentityNarrowWithDeps({
      argv: argv({
        tail: ["narrow", "Hollis Grantam", "--answer", "PICK hollis@example.com\nWHY one letter off"],
      }),
      deps,
    });
    expect(code).toBe(EXIT_OK);
    expect(out[0]).toBe("hollis@example.com  [email]  Hollis Grantham");
    expect(out.join("\n")).toContain("matched-by: email, org-status: org");
  });

  it("REFUSES a key the roster does not carry, instead of resolving an invented person", () => {
    const { deps, out } = fakeDeps({ members, orgDomains: ["example.com"] });
    const code = runIdentityNarrowWithDeps({
      argv: argv({ tail: ["narrow", "Hollis Grantam", "--answer", "PICK hollis.grantham@example.com"] }),
      deps,
    });
    expect(code).toBe(EXIT_ERROR);
    expect(out[0]).toBe(
      'the narrowing pass answered with "hollis.grantham@example.com", which is not a key on the roster it was given.',
    );
    expect(out.join("\n")).toContain("a person that does not exist");
  });

  it("reports an explicit nobody as a judgement, and does not call it a proof", () => {
    const { deps, out } = fakeDeps({ members, orgDomains: ["example.com"] });
    const code = runIdentityNarrowWithDeps({
      argv: argv({ tail: ["narrow", "Winthrop", "--answer", "PICK none\nWHY nobody here is a Winthrop"] }),
      deps,
    });
    expect(code).toBe(EXIT_EXPECTED_EMPTY);
    expect(out[0]).toBe(
      'the narrowing pass answered "none" for "Winthrop" — nobody on the roster was judged to be them.',
    );
    expect(out.join("\n")).toContain("that is a judgement, not a proof");
    expect(out.join("\n")).not.toContain("real absence");
  });

  it("refuses a pick whose own token re-resolves to somebody ELSE, rather than answering with them", () => {
    // Wynn carries no email, and her handle IS the local part of Hollis' address — so re-resolving the pick
    // by the only token she has lands on Hollis. A verification step that handed Hollis back would be the exact
    // failure this path exists to prevent, arrived at from the other direction.
    const collide = [
      memberRow({ email: "hollis@example.com", nativeId: "Hollis Grantham", source: "slack" }),
      handleOnlyRow({ handle: "hollis", name: "Wynn Okafor", nativeId: "U7" }),
    ];
    const { deps, err } = fakeDeps({ members: collide, orgDomains: ["example.com"] });
    const code = runIdentityNarrowWithDeps({
      argv: argv({ tail: ["narrow", "Wynn", "--answer", "PICK slack:U7"] }),
      deps,
    });
    expect(code).toBe(EXIT_ERROR);
    expect(err.join("\n")).toContain('lands on "hollis@example.com"');
    expect(err.join("\n")).toContain("nothing is answered here");
  });

  it("rejects a missing positional as a usage error, I/O-free", () => {
    const { deps, loads } = fakeDeps({ members });
    const code = runIdentityNarrowWithDeps({ argv: argv({ tail: ["narrow"] }), deps });
    expect(code).toBe(EXIT_USAGE);
    expect(loads()).toBe(0);
  });
});

describe("a resolve miss always offers the judged pass, not only the spelling one", () => {
  it("names `identity narrow` when a near match was found", async () => {
    const { deps, out } = fakeDeps({
      members: [memberRow({ email: "hollis@example.com", nativeId: "Hollis Grantham", source: "slack" })],
      orgDomains: ["example.com"],
    });
    await runIdentityResolveWithDeps({ argv: argv({ tail: ["resolve", "Hollis Grantam"] }), deps });
    expect(out.join("\n")).toContain('slopweaver identity narrow "Hollis Grantam"');
  });

  it("names it when NOTHING was spelled near the token — the case the floor cannot reach", async () => {
    const { deps, out } = fakeDeps({
      members: [memberRow({ email: "petra@example.com", nativeId: "Petra Vance", source: "slack" })],
      orgDomains: ["example.com"],
    });
    const code = await runIdentityResolveWithDeps({ argv: argv({ tail: ["resolve", "Dr Petey"] }), deps });
    expect(code).toBe(EXIT_EXPECTED_EMPTY);
    expect(out.join("\n")).toContain("nothing in the member index is spelled near it");
    expect(out.join("\n")).toContain('slopweaver identity narrow "Dr Petey"');
  });
});
