import { describe, expect, it } from "vitest";
import type { MemberBronzeRow } from "../../../corpus/members/types.js";
import type { CorpusRecord } from "../../../corpus/types.js";
import { describeAttribution, measureAttribution } from "../../../silver/attribution.js";
import type { IdentityResolution } from "../../../silver/identity.js";
import { resolveFromRecords } from "../../../silver/personResolver.js";

const rec = (over: Partial<CorpusRecord> = {}): CorpusRecord => ({
  container: "slack/c",
  kind: "message",
  refs: [],
  source: "slack",
  sourceId: "s1",
  text: "t",
  tsIso: "2026-05-01T00:00:00Z",
  url: "u",
  ...over,
});

const member = ({
  source = "slack",
  ...over
}: Partial<MemberBronzeRow["identity"]> & { nativeId: string }): MemberBronzeRow => ({
  fetchedAtIso: "2026-06-01T00:00:00.000Z",
  identity: { emailTrust: "trusted", source, ...over },
  profile: {},
  provenance: ["fixture"],
  raw: {},
  source,
  sourceId: over.nativeId,
  version: 1,
  warnings: [],
});

const EMPTY: IdentityResolution = { candidates: [], conflicts: [], index: new Map(), people: [] };

/** Ada, linked slack↔github by a shared trusted email — the resolution every case below measures against. */
const linked = resolveFromRecords({
  extraCandidates: [
    { email: "ada@x.co", name: "Ada Lovelace", nativeId: "U1", source: "slack" },
    { email: "ada@x.co", name: "ada", nativeId: "ada", source: "github" },
  ],
  records: [],
  roster: [],
});

describe("measureAttribution — the coverage", () => {
  it("counts authored records that reach a person, and the distinct people credited", () => {
    const coverage = measureAttribution({
      records: [
        rec({ author: "U1", raw: { user: "U1" }, sourceId: "s1" }),
        rec({ author: "U1", raw: { user: "U1" }, sourceId: "s2" }),
        rec({ author: "ada", container: "o/r", kind: "pr", source: "github", sourceId: "#1" }),
      ],
      resolution: linked,
    });
    expect(coverage.records).toBe(3);
    expect(coverage.authored).toBe(3);
    expect(coverage.attributed).toBe(3);
    expect(coverage.people).toBe(1);
    expect(coverage.residual).toEqual([]);
  });

  it("does not count an author-less record as authored, but does count it as a record", () => {
    const coverage = measureAttribution({ records: [rec(), rec({ author: "" })], resolution: linked });
    expect(coverage.records).toBe(2);
    expect(coverage.authored).toBe(0);
    expect(coverage.attributed).toBe(0);
  });

  it("attributes a chat upload whose author is a display name, via the native id in its raw payload", () => {
    const coverage = measureAttribution({
      records: [rec({ author: "Ada Lovelace", kind: "file", raw: { user: "U1" }, sourceId: "s1:file:F1" })],
      resolution: linked,
    });
    expect(coverage.attributed).toBe(1);
    expect(coverage.residual).toEqual([]);
  });

  it("attributes nothing at all against an empty resolution", () => {
    const coverage = measureAttribution({ records: [rec({ author: "U1", raw: { user: "U1" } })], resolution: EMPTY });
    expect(coverage.attributed).toBe(0);
    expect(coverage.authored).toBe(1);
    expect(coverage.people).toBe(0);
  });

  it("reports zeros and an empty residual for an empty corpus", () => {
    const coverage = measureAttribution({ records: [], resolution: linked });
    expect(coverage).toEqual({
      attributed: 0,
      authored: 0,
      machineAuthored: 0,
      people: 0,
      records: 0,
      residual: [],
      sources: [],
    });
  });

  it("splits the coverage per source, sorted by source name", () => {
    const coverage = measureAttribution({
      records: [
        rec({ author: "U1", raw: { user: "U1" } }),
        rec({ author: "stranger", container: "o/r", kind: "pr", source: "github", sourceId: "#1" }),
      ],
      resolution: linked,
    });
    expect(coverage.sources).toEqual([
      { attributed: 0, authored: 1, machineAuthored: 0, records: 1, source: "github" },
      { attributed: 1, authored: 1, machineAuthored: 0, records: 1, source: "slack" },
    ]);
  });
});

describe("measureAttribution — the residual, named exactly", () => {
  it("names a bot account rather than counting it as a coverage gap of unknown cause", () => {
    const bot: MemberBronzeRow = {
      ...member({ emailTrust: "missing", name: "Deploy Notifier", nativeId: "U-BOT" }),
      profile: { bot: true },
    };
    const coverage = measureAttribution({
      memberRows: [bot],
      records: [rec({ author: "U-BOT", raw: { user: "U-BOT" } })],
      resolution: linked,
    });
    expect(coverage.residual).toEqual([{ count: 1, reason: "non-human-account" }]);
  });

  it("names a deactivated member", () => {
    const gone: MemberBronzeRow = {
      ...member({ email: "gone@x.co", emailNormalised: "gone@x.co", nativeId: "U-GONE" }),
      profile: { active: false },
    };
    const coverage = measureAttribution({
      memberRows: [gone],
      records: [rec({ author: "U-GONE", raw: { user: "U-GONE" } })],
      resolution: linked,
    });
    expect(coverage.residual).toEqual([{ count: 1, reason: "deactivated-member" }]);
  });

  it("names a HELD email — the member exists but has no trusted join key", () => {
    const coverage = measureAttribution({
      memberRows: [member({ email: "support@x.co", emailTrust: "weak", nativeId: "U-WEAK" })],
      records: [rec({ author: "U-WEAK", raw: { user: "U-WEAK" } })],
      resolution: linked,
    });
    expect(coverage.residual).toEqual([{ count: 1, reason: "email-held" }]);
  });

  it("names the whole-source defect where activity is keyed by handle and the member row by native id", () => {
    const coverage = measureAttribution({
      memberRows: [
        member({
          email: "kel@x.co",
          emailNormalised: "kel@x.co",
          handle: "cal.tate",
          nativeId: "46a863c1-uuid",
          source: "linear",
        }),
      ],
      records: [rec({ author: "cal.tate", container: "T-1", kind: "issue", source: "linear", sourceId: "T-1" })],
      resolution: linked,
    });
    expect(coverage.residual).toEqual([{ count: 1, reason: "handle-not-native-id" }]);
  });

  it("names an id the member store has never heard of", () => {
    const coverage = measureAttribution({
      memberRows: [member({ email: "ada@x.co", emailNormalised: "ada@x.co", nativeId: "U1" })],
      records: [rec({ author: "U-NEVER", raw: { user: "U-NEVER" } })],
      resolution: linked,
    });
    expect(coverage.residual).toEqual([{ count: 1, reason: "no-member-row" }]);
  });

  it("names a linkable member that still failed to link — the reason that should always be 0", () => {
    const coverage = measureAttribution({
      memberRows: [member({ email: "ada@x.co", emailNormalised: "ada@x.co", nativeId: "U9" })],
      records: [rec({ author: "U9", raw: { user: "U9" } })],
      resolution: linked,
    });
    expect(coverage.residual).toEqual([{ count: 1, reason: "linkable-member" }]);
  });

  it("reads every miss as no-member-row when the home was never hydrated", () => {
    const coverage = measureAttribution({ records: [rec({ author: "U-WEAK" })], resolution: linked });
    expect(coverage.residual).toEqual([{ count: 1, reason: "no-member-row" }]);
  });

  it("ranks the residual by count, commonest first", () => {
    const bot: MemberBronzeRow = { ...member({ emailTrust: "missing", nativeId: "U-BOT" }), profile: { bot: true } };
    const coverage = measureAttribution({
      memberRows: [bot],
      records: [
        rec({ author: "U-BOT", sourceId: "s1" }),
        rec({ author: "U-BOT", sourceId: "s2" }),
        rec({ author: "U-NEVER", sourceId: "s3" }),
      ],
      resolution: linked,
    });
    expect(coverage.residual).toEqual([
      { count: 2, reason: "non-human-account" },
      { count: 1, reason: "no-member-row" },
    ]);
  });
});

describe("describeAttribution", () => {
  it("states the coverage as both a count and a percentage, the per-source split, and the residual", () => {
    const bot: MemberBronzeRow = { ...member({ emailTrust: "missing", nativeId: "U-BOT" }), profile: { bot: true } };
    const coverage = measureAttribution({
      memberRows: [bot],
      records: [
        rec({ author: "U1", raw: { user: "U1" }, sourceId: "s1" }),
        rec({ author: "U-BOT", sourceId: "s2" }),
        rec({ sourceId: "s3" }),
      ],
      resolution: linked,
    });
    expect(describeAttribution({ coverage })).toEqual([
      "attribution: 1/2 authored records reach a person (50.0%; 33.3% of all 3), 1 distinct people",
      "  by source: slack 1/2 (50.0%)",
      "  residual: 1 non-human-account",
    ]);
  });

  it("says `none` rather than an empty clause when nothing is left over", () => {
    const coverage = measureAttribution({ records: [], resolution: EMPTY });
    expect(describeAttribution({ coverage })).toEqual([
      "attribution: 0/0 authored records reach a person (0.0%; 0.0% of all 0), 0 distinct people",
      "  residual: none",
    ]);
  });
});

describe("measureAttribution — machine authorship is named, not counted as a miss", () => {
  it("tallies a GraphQL Bot author under machine-author rather than no-member-row", () => {
    const coverage = measureAttribution({
      records: [
        rec({
          author: "coderabbitai",
          container: "o/r",
          kind: "review",
          raw: { author: { __typename: "Bot" } },
          source: "github",
          sourceId: "#1",
        }),
      ],
      resolution: EMPTY,
    });
    expect(coverage.residual).toEqual([{ count: 1, reason: "machine-author" }]);
    expect(coverage.machineAuthored).toBe(1);
  });

  it("tallies a REST Bot author the same way — the pr leg carries no typename at all", () => {
    const coverage = measureAttribution({
      records: [
        rec({
          author: "acme-renovate[bot]",
          container: "o/r",
          kind: "pr",
          raw: { user: { type: "Bot" } },
          source: "github",
          sourceId: "#2",
        }),
      ],
      resolution: EMPTY,
    });
    expect(coverage.residual).toEqual([{ count: 1, reason: "machine-author" }]);
  });

  it("leaves a human author with no member row as no-member-row, which is a real gap", () => {
    const coverage = measureAttribution({
      records: [
        rec({
          author: "outside-contributor",
          container: "o/r",
          kind: "pr",
          raw: { user: { type: "User" } },
          source: "github",
          sourceId: "#3",
        }),
      ],
      resolution: EMPTY,
    });
    expect(coverage.residual).toEqual([{ count: 1, reason: "no-member-row" }]);
    expect(coverage.machineAuthored).toBe(0);
  });

  it("keeps the residual summing to authored minus attributed across a mixed corpus", () => {
    const coverage = measureAttribution({
      records: [
        rec({ author: "U1", raw: { user: "U1" }, sourceId: "s1" }),
        rec({
          author: "bot",
          container: "o/r",
          kind: "review",
          raw: { author: { __typename: "Bot" } },
          source: "github",
          sourceId: "#1",
        }),
        rec({ author: "who", container: "o/r", kind: "pr", source: "github", sourceId: "#2" }),
      ],
      resolution: linked,
    });
    const residual = coverage.residual.reduce((sum, entry) => sum + entry.count, 0);
    expect(coverage.authored).toBe(3);
    expect(coverage.attributed).toBe(1);
    expect(residual).toBe(2);
  });

  it("counts machineAuthored per source, not only in total", () => {
    const coverage = measureAttribution({
      records: [
        rec({
          author: "bot",
          container: "o/r",
          kind: "review",
          raw: { author: { __typename: "Bot" } },
          source: "github",
          sourceId: "#1",
        }),
        rec({ author: "U9", raw: { user: "U9" }, sourceId: "s1" }),
      ],
      resolution: EMPTY,
    });
    expect(coverage.sources.find((s) => s.source === "github")!.machineAuthored).toBe(1);
    expect(coverage.sources.find((s) => s.source === "slack")!.machineAuthored).toBe(0);
  });
});

describe("describeAttribution — both ratios, so neither can flatter", () => {
  it("keeps the raw ratio as the headline and names the machine share beside it", () => {
    const lines = describeAttribution({
      coverage: measureAttribution({
        records: [
          rec({
            author: "bot",
            container: "o/r",
            kind: "review",
            raw: { author: { __typename: "Bot" } },
            source: "github",
            sourceId: "#1",
          }),
          rec({ author: "who", container: "o/r", kind: "pr", source: "github", sourceId: "#2" }),
        ],
        resolution: EMPTY,
      }),
    });
    expect(lines[0]).toContain("0/2 authored records reach a person (0.0%");
    expect(lines[1]).toContain("1 of the misses were written by a machine");
    expect(lines[2]).toContain("github 0/2 (0.0%) [1 machine-authored; 0.0% of the 1 left]");
  });

  it("says nothing extra when no machine wrote anything", () => {
    const lines = describeAttribution({
      coverage: measureAttribution({ records: [rec({ author: "U1", raw: { user: "U1" } })], resolution: linked }),
    });
    expect(lines.join("\n")).not.toContain("machine");
  });
});
