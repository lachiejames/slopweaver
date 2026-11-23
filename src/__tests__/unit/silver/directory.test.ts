import { describe, expect, it } from "vitest";
import type { MemberBronzeRow } from "../../../corpus/members/types.js";
import type { CorpusRecord } from "../../../corpus/types.js";
import { accountKindIndex } from "../../../silver/accountKind.js";
import { buildDirectory } from "../../../silver/directory.js";
import type { IdentityRecord } from "../../../silver/identity.js";
import { resolveFromRecords } from "../../../silver/personResolver.js";

const rec = (over: Partial<CorpusRecord> = {}): CorpusRecord => ({
  container: "o/r",
  kind: "pr",
  refs: [],
  source: "github",
  sourceId: "#1",
  text: "t",
  tsIso: "2024-01-01T00:00:00Z",
  url: "u",
  ...over,
});

describe("buildDirectory", () => {
  it("tallies people from authors + @mentions, and containers, ranked by record count", () => {
    const { people, containers } = buildDirectory({
      records: [rec({ author: "alice", refs: ["@bob"], sourceId: "#1" }), rec({ author: "alice", sourceId: "#2" })],
    });
    expect(people.find((p) => p.id === "alice")!.recordCount).toBe(2);
    expect(people.find((p) => p.id === "bob")!.recordCount).toBe(1);
    expect(people[0]!.id).toBe("alice"); // ranked first
    expect(containers.find((c) => c.id === "o/r")!.recordCount).toBe(2);
  });

  it("counts a person at most once per record", () => {
    const { people } = buildDirectory({ records: [rec({ author: "alice", refs: ["@alice"] })] });
    expect(people.find((p) => p.id === "alice")!.recordCount).toBe(1);
  });

  it("leaves ids raw when no resolution is supplied (behaviour-preserving)", () => {
    const records = [rec({ author: "ada", source: "github" }), rec({ author: "U1", source: "slack", sourceId: "s1" })];
    const { people } = buildDirectory({ records });
    expect(people.map((p) => p.id).toSorted()).toEqual(["U1", "ada"]);
  });
});

describe("buildDirectory — cross-source identity merge", () => {
  const records: readonly CorpusRecord[] = [
    rec({ author: "ada", source: "github", sourceId: "gh1" }),
    rec({ author: "U1", container: "slack/c", source: "slack", sourceId: "s1" }),
    rec({ author: "Ada Lovelace", container: "T-1", source: "linear", sourceId: "l1" }),
  ];
  const roster: readonly IdentityRecord[] = [
    {
      handle: "ada",
      id: "person:ada",
      identities: [
        { nativeId: "ada", source: "github" },
        { nativeId: "U1", source: "slack" },
        { nativeId: "Ada Lovelace", source: "linear" },
      ],
      name: "Ada Lovelace",
    },
  ];

  it("collapses N per-source dupes into ONE canonical person carrying confidence + provenance", () => {
    const resolution = resolveFromRecords({ records, roster });
    const { people } = buildDirectory({ records, resolution });
    expect(people).toHaveLength(1);
    const person = people[0]!;
    expect(person.id).toBe("person:ada");
    expect(person.recordCount).toBe(3);
    expect(person.sources).toEqual(["github", "linear", "slack"]);
    expect(person.displayName).toBe("Ada Lovelace");
    expect(person.confidence).toBe("override");
    expect(person.provenance).toEqual(["override:person:ada"]);
    expect(person.identities!.map((i) => i.source).toSorted()).toEqual(["github", "linear", "slack"]);
  });

  it("does NOT merge a low-confidence name-only match — the ids stay separate", () => {
    // no roster ⇒ same-name people across sources are HELD, never merged
    const resolution = resolveFromRecords({ records, roster: [] });
    const { people } = buildDirectory({ records, resolution });
    expect(people.map((p) => p.id).toSorted()).toEqual(["Ada Lovelace", "U1", "ada"]);
    expect(people.every((p) => p.confidence === undefined || p.confidence === "single-source")).toBe(true);
  });
});

describe("buildDirectory — a chat upload counts against the SAME person as their messages", () => {
  // The Slack `file`/`pin` projections store a display name as the author; the joinable `U…` id is in `raw`.
  const records: readonly CorpusRecord[] = [
    rec({ author: "U1", container: "slack/c", kind: "message", raw: { user: "U1" }, source: "slack", sourceId: "s1" }),
    rec({
      author: "Ada Lovelace",
      container: "slack/c",
      kind: "file",
      raw: { user: "U1" },
      source: "slack",
      sourceId: "s1:file:F1",
    }),
  ];
  const resolution = resolveFromRecords({
    extraCandidates: [
      { email: "ada@x.co", name: "Ada Lovelace", nativeId: "U1", source: "slack" },
      { email: "ada@x.co", name: "ada", nativeId: "ada", source: "github" },
    ],
    records,
    roster: [],
  });

  it("credits both records to one canonical person instead of splitting id from display name", () => {
    const { people } = buildDirectory({ records, resolution });
    expect(people.map((p) => p.id)).toEqual(["person:email:ada@x.co"]);
    expect(people[0]!.recordCount).toBe(2);
  });

  it("keeps an unresolvable uploader's raw display name — no fallback guess", () => {
    const stranger = [rec({ author: "Nobody At All", kind: "file", raw: { user: "U404" }, source: "slack" })];
    const { people } = buildDirectory({ records: stranger, resolution });
    expect(people.map((p) => p.id)).toEqual(["Nobody At All"]);
  });

  it("does not lift a raw native id for a MENTION — a mention is only ever the handle as written", () => {
    const mentioned = [
      rec({ author: "U1", kind: "message", raw: { user: "U1" }, refs: ["@ada"], source: "slack", sourceId: "s9" }),
    ];
    const { people } = buildDirectory({ records: mentioned, resolution });
    expect(people.map((p) => p.id).toSorted()).toEqual(["ada", "person:email:ada@x.co"]);
  });
});

describe("buildDirectory — PR4.8 bot/integration filtering", () => {
  const botRow: MemberBronzeRow = {
    fetchedAtIso: "2026-06-01T00:00:00.000Z",
    identity: { emailTrust: "missing", name: "Deploy Notifier", nativeId: "U-BOT-1", source: "slack" },
    profile: { bot: true },
    provenance: ["fixture"],
    raw: {},
    source: "slack",
    sourceId: "U-BOT-1",
    version: 1,
    warnings: [],
  };
  const records: readonly CorpusRecord[] = [
    rec({ author: "ada", source: "github", sourceId: "gh1" }),
    rec({ author: "Deploy Notifier", container: "slack/c", source: "slack", sourceId: "s1" }),
    rec({ author: "github-actions[bot]", source: "github", sourceId: "gh2" }),
  ];

  it("drops bot/integration accounts from `people`, counts them, and keeps every record in `containers`", () => {
    const { people, containers, excludedPeople } = buildDirectory({
      accountKinds: accountKindIndex({ rows: [botRow] }),
      records,
    });
    expect(people.map((p) => p.id)).toEqual(["ada"]);
    expect(excludedPeople).toBe(2);
    expect(containers.map((c) => c.recordCount).reduce((a, b) => a + b, 0)).toBe(records.length);
  });

  it("with NO member rows, still drops a structural `[bot]` login but keeps the un-hydratable rest", () => {
    const { people, excludedPeople } = buildDirectory({ records });
    expect(people.map((p) => p.id).toSorted()).toEqual(["Deploy Notifier", "ada"]);
    expect(excludedPeople).toBe(1);
  });
});
