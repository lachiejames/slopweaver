/**
 * The source-noun canon binding: a source this build HAS is a source it can route to.
 *
 * Two describe groups, the shape `ratchetGates.test.ts` established: the first drives the pure functions in
 * `../../../route/sourceNouns.js` on inline fixtures and knows nothing about this build, and the last reads
 * THIS build's real verb registry against the real capability table — generic rows plus the atlas rows
 * derived from `atlasPlatforms()` — and fails in every direction a source can go dark.
 *
 * The directions are not decoration, they are the failure this closes. Capability rows were hand-authored
 * into each install's own `capability-profile.json`, so a source became routable only when somebody
 * remembered to write a row: MEASURED once: 24 of 37 registered atlases were unroutable and so were
 * hex, the live Slack reads, the knowledge register, transcripts, identity, the store's own query layer and
 * `facts`. One direction here catches a new noun nobody classified; another catches a classified noun whose
 * row was deleted; another catches a registered atlas the derivation stopped covering.
 */
import { describe, expect, it } from "vitest";

import { atlasPlatforms } from "../../../atlas/registry.js";
import { NOUN_GROUPS } from "../../../cli/nounGroups.js";
import { derivedAtlasCapability, withDerivedAtlasCapabilities } from "../../../route/atlasCapability.js";
import { atlasPlatformOf } from "../../../route/atlasReading.js";
import { registeredAtlasSources } from "../../../route/atlasSources.js";
import { RESERVED_LIVE_NEED_IDS } from "../../../route/liveCapabilityPolicy.js";
import type { SourceCapability } from "../../../route/profile.js";
import {
  misclassifiedNouns,
  NOT_A_SOURCE_NOUNS,
  nounsReachedBy,
  rowReferencesIn,
  SOURCE_READING_NOUNS,
  unclassifiedNouns,
  unresolvedRowReferences,
  unroutableSourceNouns,
} from "../../../route/sourceNouns.js";
import { GENERIC_SOURCE_CAPABILITIES } from "../../../route/sourcePlan.js";

/** A capability row whose only interesting fields are the three `nounsReachedBy` reads. */
function row({
  command,
  detail = "nothing to add",
  what = "a source",
}: {
  command: readonly string[];
  detail?: string;
  what?: string;
}): SourceCapability {
  return {
    availability: { kind: "available" },
    command,
    coverage: { detail, kind: "bounded" },
    effect: "read",
    freshness: { detail: "when the command runs", kind: "live" },
    id: "fixture",
    owner: "slopweaver",
    sourceClass: "provider",
    terms: ["fixture"],
    truthMode: "current",
    what,
  };
}

describe("nounsReachedBy", () => {
  it("takes the noun out of a row's own argv", () => {
    expect([...nounsReachedBy({ capabilities: [row({ command: ["slopweaver", "hex", "verify"] })] })]).toEqual(["hex"]);
  });

  it("takes a noun a row names only in its coverage prose — the scope-command pattern", () => {
    const capabilities = [
      row({
        command: ["slopweaver", "connect", "github", "--check"],
        detail: "the READING is `slopweaver github read <object-url>`",
      }),
    ];
    expect([...nounsReachedBy({ capabilities })].toSorted()).toEqual(["connect", "github"]);
  });

  it("reads `what` as well as `coverage.detail`", () => {
    const capabilities = [row({ command: [], what: "whatever `slopweaver transcripts turns` shows" })];
    expect([...nounsReachedBy({ capabilities })]).toEqual(["transcripts"]);
  });

  it("does not take a hyphenated or suffixed word as the noun", () => {
    const capabilities = [row({ command: [], detail: "not slopweaver-ish, and not slopweaverish either" })];
    expect([...nounsReachedBy({ capabilities })]).toEqual([]);
  });

  it("deduplicates a noun two rows both reach", () => {
    const capabilities = [
      row({ command: ["slopweaver", "store", "status"] }),
      row({ command: ["slopweaver", "store", "query"] }),
    ];
    expect([...nounsReachedBy({ capabilities })]).toEqual(["store"]);
  });

  it("answers an empty set for a table that names no invocation at all", () => {
    expect([...nounsReachedBy({ capabilities: [row({ command: [] })] })]).toEqual([]);
  });
});

// The root cause of the stale-claim class, and the one member of it that is checkable. A reason on the
// not-a-source side earns its place by naming where the reading question goes INSTEAD, and that name is
// the only part a machine can verify. MEASURED the day this was written: of six row references in
// `../../../route/sourceNouns.ts`, `corpus` resolved exactly, `fleet`, `github`, `linear` and `slack`
// resolved to `fleet-status`, `github-live`, `linear-live` and `slack-live` by prefix, and `attachments`
// resolved to NOTHING — canon sending a reader after a leg nobody had written.
// Repro: `grep -oE '.[a-z0-9-]+. row' src/route/sourceNouns.ts`.
describe("rowReferencesIn", () => {
  it("takes the backticked word immediately before the word row", () => {
    const reasons = ["`atlas vanta` is the read; the `corpus` row holds the rest"];
    expect([...rowReferencesIn({ reasons })]).toEqual(["corpus"]);
  });

  it("takes every reference one reason makes, in declaration order", () => {
    const reasons = ["the `slack` row and the `github` row both reach it"];
    expect([...rowReferencesIn({ reasons })]).toEqual(["slack", "github"]);
  });

  it("does not take a backticked word that the word row does not follow", () => {
    expect([...rowReferencesIn({ reasons: ["`atlas vanta` is the read"] })]).toEqual([]);
  });

  it("answers nothing for a reason making no reference at all", () => {
    expect([...rowReferencesIn({ reasons: ["publishes the page a session ends in"] })]).toEqual([]);
  });
});

describe("unresolvedRowReferences", () => {
  const capabilities = [row({ command: ["slopweaver", "hex", "verify"] })];

  it("resolves a reference matching a row id exactly", () => {
    expect(unresolvedRowReferences({ capabilities, reasons: ["the `fixture` row answers it"] })).toEqual([]);
  });

  // The calibration, and it is the rule rather than a convenience. Four of this build's own references read
  // perfectly while naming a PREFIX of the real id, so an exact-match gate would redden prose a reader
  // resolves instantly — which is a gate that gets reworded away instead of obeyed.
  it("resolves a reference naming a hyphen-boundary PREFIX of a row id", () => {
    const withLive = [{ ...row({ command: [] }), id: "slack-live" }];
    expect(unresolvedRowReferences({ capabilities: withLive, reasons: ["the `slack` row is the read"] })).toEqual([]);
  });

  it("names a reference that resolves to no row at all", () => {
    const reasons = ["the `attachments` row names both halves"];
    expect(unresolvedRowReferences({ capabilities, reasons })).toEqual(["attachments"]);
  });

  // A prefix is a HYPHEN boundary, never any substring: `attach` must not resolve against `attachments`,
  // because a reader following it would land on a row about something else.
  it("does not let a bare substring resolve against a longer id", () => {
    const withDocs = [{ ...row({ command: [] }), id: "attachments" }];
    expect(unresolvedRowReferences({ capabilities: withDocs, reasons: ["the `attach` row"] })).toEqual(["attach"]);
  });
});

describe("unclassifiedNouns", () => {
  it("names a noun neither list carries", () => {
    expect(unclassifiedNouns({ nouns: ["hex", "store", "a-brand-new-noun"] })).toEqual(["a-brand-new-noun"]);
  });

  it("answers an empty list when every noun is classified", () => {
    expect(unclassifiedNouns({ nouns: ["hex", "write"] })).toEqual([]);
  });
});

describe("misclassifiedNouns", () => {
  it("answers nothing for a build whose nouns are exactly the classified ones", () => {
    const nouns = [...SOURCE_READING_NOUNS, ...NOT_A_SOURCE_NOUNS.map((entry) => entry.noun)];
    expect(misclassifiedNouns({ nouns })).toEqual({ both: [], gone: [] });
  });

  it("names a classified noun this build no longer registers", () => {
    expect(misclassifiedNouns({ nouns: ["hex"] }).gone).toContain("write");
  });
});

describe("unroutableSourceNouns", () => {
  it("names a source-reading noun no row reaches", () => {
    expect(unroutableSourceNouns({ capabilities: [row({ command: ["slopweaver", "hex", "verify"] })] })).toContain(
      "store",
    );
  });

  it("does not name one a row does reach", () => {
    expect(unroutableSourceNouns({ capabilities: [row({ command: ["slopweaver", "hex", "verify"] })] })).not.toContain(
      "hex",
    );
  });
});

describe("this build's own sources are all routable", () => {
  const capabilities = withDerivedAtlasCapabilities({
    atlases: registeredAtlasSources(),
    baseCapabilities: GENERIC_SOURCE_CAPABILITIES,
  });
  const nouns = Object.keys(NOUN_GROUPS);

  it("declares both sides of the partition", () => {
    expect(SOURCE_READING_NOUNS.length).toBeGreaterThan(0);
    expect(NOT_A_SOURCE_NOUNS.length).toBeGreaterThan(0);
    expect(nouns.length).toBeGreaterThan(0);
  });

  it("gives every not-a-source noun a reason", () => {
    expect(NOT_A_SOURCE_NOUNS.filter((entry) => entry.reason.trim().length === 0)).toEqual([]);
  });

  it("classifies every noun this build registers, exactly once", () => {
    expect(unclassifiedNouns({ nouns })).toEqual([]);
    expect(misclassifiedNouns({ nouns })).toEqual({ both: [], gone: [] });
  });

  // The promise every not-a-source reason makes, checked against the table that has to keep it. This is
  // what the `attachments` failure looked like: `sourceNouns.ts` told a reader that row named both halves
  // of a PDF question, for a week in which no such row existed.
  // The positive assertion comes FIRST, and it is not ceremony: MEASURED by mutation, narrowing
  // `rowReferencesIn`'s pattern so it matches none of the real reasons left the `toEqual([])` below green
  // while checking nothing, because an empty reference set has no unresolved member. The inline cases above
  // caught that one mutation only because they share the real file's prose shape.
  it("keeps every row reference its own reasons make", () => {
    const reasons = NOT_A_SOURCE_NOUNS.map((entry) => entry.reason);
    expect(rowReferencesIn({ reasons }).length).toBeGreaterThan(0);
    expect(unresolvedRowReferences({ capabilities })).toEqual([]);
  });

  it("reaches every source-reading noun from the capability table", () => {
    expect(unroutableSourceNouns({ capabilities })).toEqual([]);
  });

  // A derived row's `what` is the atlas's own catalogue sentence, which is prose nobody writes with this
  // check in mind. If one ever said "slopweaver store …", the derived rows would start COVERING a noun
  // whose real row had been deleted, and this whole group would pass vacuously. The assertion that closes
  // that is the FIRST one: the derived rows reach `atlas` and nothing else, whatever their prose says.
  //
  // The second used to read `["atlas"]` — the one source noun no generic row reached, which made the two
  // halves a clean partition. `saas-spend` moved it: that row is authored into the generic table and runs
  // `slopweaver atlas trelica coverage`, so the generic table now reaches every source-reading noun on its
  // own and the derived half stands in for none of them. That is strictly the stronger property, and
  // `atlas` is pinned as a source noun beside it so an empty filter can never be the vacuous kind.
  it("does not let a derived atlas row's own prose cover a noun the generic table owns", () => {
    const derived = registeredAtlasSources().map((atlas) => derivedAtlasCapability({ atlas }));
    expect([...nounsReachedBy({ capabilities: derived })]).toEqual(["atlas"]);

    const generic = nounsReachedBy({ capabilities: GENERIC_SOURCE_CAPABILITIES });
    expect(SOURCE_READING_NOUNS).toContain("atlas");
    expect(SOURCE_READING_NOUNS.filter((noun) => !generic.has(noun))).toEqual([]);
  });

  it("derives no id live routing would silently refuse to offer", () => {
    const reserved = atlasPlatforms().filter((platform) => RESERVED_LIVE_NEED_IDS.has(`${platform}-atlas`));
    expect(reserved).toEqual([]);
  });

  // The criterion is the PLATFORM a row reads, never the shape of its id. It used to be
  // `ids.has(\`${platform}-atlas\`)`, which was a proxy that held only while every atlas row was the derived
  // kind: `saas-spend` is authored, reads trelica, and suppresses the derived `trelica-atlas` row by
  // platform — so the id proxy called a covered platform uncovered. `atlasPlatformOf` is the same reader
  // `withDerivedAtlasCapabilities` uses to decide coverage, so this asks the question the derivation
  // actually answers and cannot disagree with it.
  it("reaches every registered atlas platform from some row, derived or authored", () => {
    const platforms = atlasPlatforms();
    expect(platforms.length).toBeGreaterThan(0);
    const covered = new Set(
      capabilities.flatMap((capability) => [atlasPlatformOf({ capability })].filter((platform) => platform !== null)),
    );
    expect(platforms.filter((platform) => !covered.has(platform))).toEqual([]);
  });

  it("gives every derived atlas row an id the capability schema accepts", () => {
    expect(atlasPlatforms().filter((platform) => !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(`${platform}-atlas`))).toEqual([]);
  });
});
