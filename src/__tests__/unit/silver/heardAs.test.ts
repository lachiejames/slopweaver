/**
 * Heard-as pins, over the population that produced a real mis-tag: the owner said "smith", the relay
 * heard "Smitty", nothing resolved, and a session tagged Orrin Wexley — the author of the thread it had found.
 * John Smith and Orrin Wexley are both here, with the ids the member index carries for them, so every case
 * that resolves names John positively rather than only asserting Orrin's absence.
 */
import { describe, expect, it } from "vitest";

import type { MemberBronzeRow } from "../../../corpus/members/types.js";
import {
  heardAsRoute,
  isUnpinnedMiss,
  lookupMentionsWithHeardAs,
  lookupMentionWithHeardAs,
  markClaims,
  type RoutedMentionLookup,
  routedLookupRefusals,
} from "../../../silver/heardAs.js";
import type { IdentityRecord, IdentitySource } from "../../../silver/identity.js";
import { mentionPeople } from "../../../silver/mentionResolver.js";

const ORG_DOMAINS = ["acme.com"];

/** One member row, spelled the way hydration writes one. */
function row({
  source,
  nativeId,
  name,
  email,
}: {
  source: IdentitySource;
  nativeId: string;
  name: string;
  email: string;
}): MemberBronzeRow {
  return {
    fetchedAtIso: "2026-09-27T00:00:00.000Z",
    identity: { email, emailNormalised: email, emailTrust: "trusted", name, nativeId, source },
    profile: { active: true, bot: false },
    provenance: ["test"],
    raw: {},
    source,
    sourceId: nativeId,
    version: 1,
    warnings: [],
  };
}

const ROWS: readonly MemberBronzeRow[] = [
  row({ email: "john.smith@acme.com", name: "smith", nativeId: "U0SYN000011", source: "slack" }),
  row({ email: "john.smith@acme.com", name: "John Smith", nativeId: "580da7a0", source: "linear" }),
  row({ email: "orrin.wexley@acme.com", name: "Orrin Wexley", nativeId: "U0SYN000016", source: "slack" }),
  row({ email: "smitty.real@acme.com", name: "Smitty Real", nativeId: "U0SYNSMITTYREAL", source: "slack" }),
];

const PEOPLE = mentionPeople({ orgDomains: ORG_DOMAINS, rows: ROWS });

const JOHN: IdentityRecord = {
  email: "john.smith@acme.com",
  handle: "john.smith",
  heardAs: ["Smitty", "smythe"],
  id: "person:john-smith",
  name: "John Smith",
};

describe("heardAsRoute", () => {
  it("sends a declared pronunciation to the claiming record's email, whatever its case or @", () => {
    expect(heardAsRoute({ records: [JOHN], token: "smitty" })).toEqual({
      key: "john.smith@acme.com",
      kind: "target",
      via: "email",
    });
    expect(heardAsRoute({ records: [{ ...JOHN, heardAs: [" @Smitty "] }], token: " @smitty" })).toEqual({
      key: "john.smith@acme.com",
      kind: "target",
      via: "email",
    });
    expect(heardAsRoute({ records: [JOHN], token: "@SMYTHE" })).toEqual({
      key: "john.smith@acme.com",
      kind: "target",
      via: "email",
    });
  });

  it("falls to the record's one Slack id when it carries no email", () => {
    const record: IdentityRecord = {
      handle: "john.smith",
      heardAs: ["smitty"],
      id: "person:john-smith",
      identities: [{ nativeId: "U0SYN000011", source: "slack" }],
      name: "John Smith",
    };
    expect(heardAsRoute({ records: [record], token: "smitty" })).toEqual({
      key: "U0SYN000011",
      kind: "target",
      via: "slack",
    });
  });

  it("refuses a record with no email and two Slack ids, rather than picking by array order", () => {
    const record: IdentityRecord = {
      handle: "john.smith",
      heardAs: ["smitty"],
      id: "person:john-smith",
      identities: [
        { nativeId: "U0SYN000011", source: "slack" },
        { nativeId: "U0SYNSECOND00", source: "slack" },
      ],
      name: "John Smith",
    };
    expect(heardAsRoute({ records: [record], token: "smitty" })).toEqual({
      kind: "unaddressable",
      why: "person:john-smith claims it but carries no email and not exactly one Slack id",
    });
  });

  it("refuses, naming both, when two records claim the same pronunciation", () => {
    const rival: IdentityRecord = { ...JOHN, email: "orrin.wexley@acme.com", id: "person:orrin" };
    expect(heardAsRoute({ records: [JOHN, rival], token: "smitty" })).toEqual({
      kind: "unaddressable",
      why: "2 records claim it (person:john-smith, person:orrin)",
    });
  });

  it("applies no pin to a token nobody declared, or an empty one", () => {
    expect(heardAsRoute({ records: [JOHN], token: "orrin" })).toEqual({ kind: "none" });
    expect(heardAsRoute({ records: [JOHN], token: " @ " })).toEqual({ kind: "none" });
  });
});

describe("lookupMentionWithHeardAs", () => {
  it("resolves Smitty and Smythe to John Smith on Slack, never Orrin Wexley", () => {
    for (const token of ["Smitty", "Smythe"]) {
      const lookup = lookupMentionWithHeardAs({
        people: PEOPLE.filter((p) => p.displayName !== "Smitty Real"),
        records: [JOHN],
        source: "slack",
        token,
      });
      expect(lookup.kind).toBe("resolved");
      expect(lookup).toMatchObject({ heardAsTarget: "john.smith@acme.com", nativeId: "U0SYN000011" });
    }
  });

  it("re-resolves the pin on the surface asked for, so Linear gets John's Linear id", () => {
    const lookup = lookupMentionWithHeardAs({ people: PEOPLE, records: [JOHN], source: "linear", token: "smythe" });
    expect(lookup).toMatchObject({
      heardAsTarget: "john.smith@acme.com",
      kind: "resolved",
      nativeId: "580da7a0",
    });
  });

  it("lets a colleague who really carries the token win over the pin", () => {
    const lookup = lookupMentionWithHeardAs({ people: PEOPLE, records: [JOHN], source: "slack", token: "Smitty" });
    expect(lookup).toMatchObject({ kind: "resolved", nativeId: "U0SYNSMITTYREAL" });
    expect(lookup.heardAsTarget).toBe(undefined);
  });

  it("leaves smith on the exact ladder, where it already resolves", () => {
    const lookup = lookupMentionWithHeardAs({ people: PEOPLE, records: [JOHN], source: "slack", token: "smith" });
    expect(lookup).toMatchObject({ kind: "resolved", nativeId: "U0SYN000011" });
    expect(lookup.heardAsTarget).toBe(undefined);
  });

  it("names the pin when its target no longer resolves, instead of reading like an undeclared token", () => {
    const gone: IdentityRecord = { ...JOHN, email: "left.company@acme.com" };
    const lookup = lookupMentionWithHeardAs({ people: PEOPLE, records: [gone], source: "slack", token: "smythe" });
    expect(lookup).toEqual({ heardAsTarget: "left.company@acme.com", kind: "unknown" });
    expect(routedLookupRefusals({ key: "smythe", lookup, source: "slack" })).toEqual([
      '"smythe" is pinned heard-as left.company@acme.com in the identity roster (slopweaver identity roster replace), but the member index does not resolve that target on slack.',
    ]);
  });
});

describe("a claimed token that cannot follow its pin", () => {
  const rival: IdentityRecord = { ...JOHN, email: "orrin.wexley@acme.com", id: "person:orrin" };
  const lookup = lookupMentionWithHeardAs({
    people: PEOPLE.filter((p) => p.displayName !== "Smitty Real"),
    records: [JOHN, rival],
    source: "slack",
    token: "smitty",
  });

  it("stays unknown and says why, so no caller can mistake it for a token nobody claims", () => {
    expect(lookup).toEqual({
      heardAsUnaddressable: "2 records claim it (person:john-smith, person:orrin)",
      kind: "unknown",
    });
    expect(isUnpinnedMiss({ lookup })).toBe(false);
  });

  it("is refused by name, with the fix", () => {
    expect(routedLookupRefusals({ key: "smitty", lookup, source: "slack" })).toEqual([
      '"smitty" cannot follow its heard-as pin in the identity roster (slopweaver identity roster replace): 2 records claim it (person:john-smith, person:orrin). Leave exactly one record claiming it, with an email or one Slack id.',
    ]);
  });
});

describe("isUnpinnedMiss", () => {
  it("frees only an unknown no record claims, or a key never looked up, to reach the derived roster", () => {
    expect(isUnpinnedMiss({ lookup: undefined })).toBe(true);
    expect(isUnpinnedMiss({ lookup: { kind: "unknown" } })).toBe(true);
    expect(isUnpinnedMiss({ lookup: { heardAsTarget: "john.smith@acme.com", kind: "unknown" } })).toBe(false);
  });
});

describe("lookupMentionsWithHeardAs", () => {
  it("answers each distinct key once, pinned and exact side by side", () => {
    const rows = ROWS.filter((r) => r.identity.name !== "Smitty Real");
    const lookups = lookupMentionsWithHeardAs({
      keys: ["Smitty", "Orrin Wexley", "Smitty"],
      orgDomains: ORG_DOMAINS,
      records: [JOHN],
      rows,
      source: "slack",
    });
    expect([...lookups.keys()]).toEqual(["Smitty", "Orrin Wexley"]);
    expect(lookups.get("Smitty")).toMatchObject({
      heardAsTarget: "john.smith@acme.com",
      nativeId: "U0SYN000011",
    });
    expect(lookups.get("Orrin Wexley")).toMatchObject({ kind: "resolved", nativeId: "U0SYN000016" });
  });
});

describe("markClaims", () => {
  it("marks an unrouted claimed key, and leaves a routed or unclaimed one exactly as it was", () => {
    const routed: RoutedMentionLookup = { heardAsTarget: "john.smith@acme.com", kind: "unknown" };
    const marked = markClaims({
      keys: ["smitty", "smythe", "orrin"],
      lookups: new Map([
        ["smitty", { kind: "unknown" }],
        ["smythe", routed],
      ]),
      records: [JOHN],
    });
    expect(marked.get("smitty")).toEqual({
      heardAsUnaddressable: "its member lookup was never routed through the pin",
      kind: "unknown",
    });
    expect(marked.get("smythe")).toBe(routed);
    expect(marked.has("orrin")).toBe(false);
  });
});

describe("a pin whose address lands on somebody else", () => {
  it("refuses when the declared Slack id resolves to a person who does not carry it on Slack", () => {
    const rows: readonly MemberBronzeRow[] = [
      row({ email: "orrin.wexley@acme.com", name: "owexley", nativeId: "U0SYN000011", source: "github" }),
      row({
        email: "orrin.wexley@acme.com",
        name: "Orrin Wexley",
        nativeId: "U0SYN000016",
        source: "slack",
      }),
    ];
    const record: IdentityRecord = {
      handle: "john.smith",
      heardAs: ["smitty"],
      id: "person:john-smith",
      identities: [{ nativeId: "U0SYN000011", source: "slack" }],
      name: "John Smith",
    };
    const lookup = lookupMentionWithHeardAs({
      people: mentionPeople({ orgDomains: ORG_DOMAINS, rows }),
      records: [record],
      source: "slack",
      token: "smitty",
    });
    expect(lookup).toEqual({
      heardAsUnaddressable: "U0SYN000011 resolves to owexley, who does not carry it as their slack",
      kind: "unknown",
    });
  });
});

describe("a pin whose email folds two accounts on one surface", () => {
  // Two Slack members share John's email, Orrin's account first, so the fold by
  // email keeps Orrin's Slack id and an unguarded pin would tag the wrong person.
  const shared = mentionPeople({
    orgDomains: ORG_DOMAINS,
    rows: [
      row({ email: "john.smith@acme.com", name: "Orrin Wexley", nativeId: "U0SYN000016", source: "slack" }),
      row({ email: "john.smith@acme.com", name: "smith", nativeId: "U0SYN000011", source: "slack" }),
    ],
  });

  it("refuses when the record declares its own Slack id and the fold picked another", () => {
    const record: IdentityRecord = { ...JOHN, identities: [{ nativeId: "U0SYN000011", source: "slack" }] };
    expect(lookupMentionWithHeardAs({ people: shared, records: [record], source: "slack", token: "Smitty" })).toEqual({
      heardAsUnaddressable:
        "john.smith@acme.com resolves to slack id U0SYN000016, which the claiming record does not declare",
      kind: "unknown",
    });
  });

  it("resolves when the id the fold picked is the one the record declares", () => {
    const record: IdentityRecord = { ...JOHN, identities: [{ nativeId: "U0SYN000016", source: "slack" }] };
    const lookup = lookupMentionWithHeardAs({ people: shared, records: [record], source: "slack", token: "Smitty" });
    expect(lookup).toMatchObject({
      heardAsTarget: "john.smith@acme.com",
      kind: "resolved",
      nativeId: "U0SYN000016",
    });
  });
});
