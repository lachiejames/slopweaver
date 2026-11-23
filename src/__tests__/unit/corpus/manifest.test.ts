import { describe, expect, it } from "vitest";
import {
  buildCorpusManifest,
  compareManifests,
  isLocalOrigin,
  manifestConserved,
  NAMED_LOSS_LIMIT,
  parseCorpusManifest,
  renderManifestComparison,
} from "../../../corpus/manifest.js";
import type { CorpusRecord } from "../../../corpus/types.js";

/**
 * The existence seam every call here passes: a plain set of paths that "exist". Not a mock — the real verb
 * hands `existsSync` in at the same seam.
 */
function existsIn({ paths }: { paths: readonly string[] }): (input: { path: string }) => boolean {
  const present = new Set(paths);
  return ({ path }) => present.has(path);
}

/** The seam for a corpus with no local origins at all — nothing on disk, and nothing asking. */
const NOTHING_EXISTS = existsIn({ paths: [] });

/** One record, defaulted. */
function record({ overrides = {} }: { overrides?: Partial<CorpusRecord> } = {}): CorpusRecord {
  return {
    container: "linear/ENG",
    kind: "issue",
    refs: [],
    source: "linear",
    sourceId: "ENG-1",
    text: "t",
    tsIso: "2026-05-01T00:00:00.000Z",
    url: "u",
    ...overrides,
  };
}

describe("buildCorpusManifest", () => {
  it("tallies per source, per source/kind and per container", () => {
    const manifest = buildCorpusManifest({
      exists: NOTHING_EXISTS,
      records: [
        record({ overrides: { sourceId: "ENG-1" } }),
        record({ overrides: { container: "linear/PLAT", sourceId: "PLAT-1" } }),
        record({ overrides: { kind: "comment", sourceId: "ENG-1:comment:c1" } }),
        record({ overrides: { container: "owner/repo", kind: "pr", source: "github", sourceId: "#1" } }),
      ],
    });
    expect(manifest.records).toBe(4);
    expect(manifest.bySource).toEqual({ github: 1, linear: 3 });
    expect(manifest.bySourceKind).toEqual({ "github/pr": 1, "linear/comment": 1, "linear/issue": 2 });
    expect(manifest.containersBySource).toEqual({ github: 1, linear: 2 });
  });

  it("stores the identity SET per source, sorted, so a loss can be NAMED", () => {
    const manifest = buildCorpusManifest({
      exists: NOTHING_EXISTS,
      records: [record({ overrides: { sourceId: "ENG-2" } }), record({ overrides: { sourceId: "ENG-1" } })],
    });
    // Counts alone cannot catch a rebuild that lost 400 records and gained 400 others.
    expect(manifest.identitiesBySource["linear"]!.length).toBe(2);
    expect(manifest.identitiesBySource["linear"]!.toSorted()).toEqual(manifest.identitiesBySource["linear"]);
  });

  it("counts curated edges across every record", () => {
    const manifest = buildCorpusManifest({
      exists: NOTHING_EXISTS,
      records: [
        record({ overrides: { attrs: { curatedEdges: ["blocks|linear:ENG-2", "sub-issue|linear:ENG-3"] } } }),
        record({ overrides: { attrs: { curatedEdges: ["relation|linear:ENG-4"] }, sourceId: "ENG-2" } }),
        record({ overrides: { sourceId: "ENG-3" } }),
      ],
    });
    expect(manifest.curatedEdges).toBe(3);
  });

  it("is an honest zero for an empty corpus", () => {
    expect(buildCorpusManifest({ exists: NOTHING_EXISTS, records: [] })).toEqual({
      bySource: {},
      bySourceKind: {},
      containersBySource: {},
      curatedEdges: 0,
      identitiesBySource: {},
      originsMissingBySource: {},
      originsPresentBySource: {},
      records: 0,
      version: 2,
    });
  });
});

describe("compareManifests — the failure this exists for", () => {
  it("reports a source that VANISHED, which is what a rebuild looks like when it wiped the others", () => {
    const before = buildCorpusManifest({
      exists: NOTHING_EXISTS,
      records: [
        record(),
        record({ overrides: { container: "owner/repo", kind: "pr", source: "github", sourceId: "#1" } }),
      ],
    });
    // A Linear-only rebuild that erased GitHub. Every Linear count is healthy; GitHub is simply gone.
    const after = buildCorpusManifest({
      exists: NOTHING_EXISTS,
      records: [record(), record({ overrides: { sourceId: "ENG-2" } })],
    });
    const findings = compareManifests({ after, before });
    expect(manifestConserved({ findings })).toBe(false);
    expect(findings.some((f) => f.severity === "lost" && f.message.includes("source github is GONE"))).toBe(true);
  });

  it("catches a same-COUNT swap that no count comparison could see", () => {
    const before = buildCorpusManifest({
      exists: NOTHING_EXISTS,
      records: [record({ overrides: { sourceId: "ENG-1" } }), record({ overrides: { sourceId: "ENG-2" } })],
    });
    const after = buildCorpusManifest({
      exists: NOTHING_EXISTS,
      records: [record({ overrides: { sourceId: "ENG-1" } }), record({ overrides: { sourceId: "ENG-99" } })],
    });
    expect(after.bySource["linear"]).toBe(before.bySource["linear"]); // the count did not move…
    const findings = compareManifests({ after, before });
    // …and the identity set says one entity disappeared anyway.
    expect(findings.some((f) => f.severity === "lost" && f.message.includes("lost 1 identity"))).toBe(true);
  });

  it("reports a record KIND whose count fell", () => {
    const before = buildCorpusManifest({
      exists: NOTHING_EXISTS,
      records: [
        record({ overrides: { kind: "comment", sourceId: "c1" } }),
        record({ overrides: { kind: "comment", sourceId: "c2" } }),
      ],
    });
    const after = buildCorpusManifest({
      exists: NOTHING_EXISTS,
      records: [record({ overrides: { kind: "comment", sourceId: "c1" } })],
    });
    expect(compareManifests({ after, before }).some((f) => f.message.includes("linear/comment fell from 2 to 1"))).toBe(
      true,
    );
  });

  it("reports a lost container and a fallen edge total", () => {
    const before = buildCorpusManifest({
      exists: NOTHING_EXISTS,
      records: [
        record({ overrides: { attrs: { curatedEdges: ["blocks|linear:ENG-9"] } } }),
        record({ overrides: { container: "linear/PLAT", sourceId: "PLAT-1" } }),
      ],
    });
    const after = buildCorpusManifest({
      exists: NOTHING_EXISTS,
      records: [record(), record({ overrides: { sourceId: "PLAT-1" } })],
    });
    const messages = compareManifests({ after, before }).map((f) => f.message);
    expect(messages.some((m) => m.includes("containers fell from 2 to 1"))).toBe(true);
    expect(messages.some((m) => m.includes("curated edges fell from 1 to 0"))).toBe(true);
  });

  it("passes, and says nothing was lost, when the rebuild only ADDED", () => {
    const before = buildCorpusManifest({ exists: NOTHING_EXISTS, records: [record()] });
    const after = buildCorpusManifest({
      exists: NOTHING_EXISTS,
      records: [
        record(),
        record({ overrides: { sourceId: "ENG-2" } }),
        record({ overrides: { kind: "need", sourceId: "need:n1" } }),
      ],
    });
    const findings = compareManifests({ after, before });
    expect(manifestConserved({ findings })).toBe(true);
    expect(findings.some((f) => f.message.includes("source linear grew from 1 to 3"))).toBe(true);
    expect(findings.some((f) => f.message.includes("linear/need is NEW"))).toBe(true);
  });

  it("is conserved when nothing changed at all", () => {
    const manifest = buildCorpusManifest({ exists: NOTHING_EXISTS, records: [record()] });
    expect(compareManifests({ after: manifest, before: manifest })).toEqual([]);
    expect(manifestConserved({ findings: [] })).toBe(true);
  });

  it("names losses up to the cap, then counts the rest", () => {
    const many = Array.from({ length: NAMED_LOSS_LIMIT + 5 }, (_, index) =>
      record({ overrides: { sourceId: `ENG-${String(index)}` } }),
    );
    const findings = compareManifests({
      after: buildCorpusManifest({ exists: NOTHING_EXISTS, records: [] }),
      before: buildCorpusManifest({ exists: NOTHING_EXISTS, records: many }),
    });
    const identityLoss = findings.find((f) => f.message.includes("identity"))!;
    expect(identityLoss.message).toContain(`(+5 more)`);
  });
});

describe("renderManifestComparison", () => {
  it("leads with the verdict and lists losses before growth", () => {
    const before = buildCorpusManifest({
      exists: NOTHING_EXISTS,
      records: [
        record(),
        record({ overrides: { container: "owner/repo", kind: "pr", source: "github", sourceId: "#1" } }),
      ],
    });
    const after = buildCorpusManifest({
      exists: NOTHING_EXISTS,
      records: [record(), record({ overrides: { sourceId: "ENG-2" } })],
    });
    const lines = renderManifestComparison({ findings: compareManifests({ after, before }) });
    expect(lines[0]!).toBe("conservation: FAIL");
    expect(lines[1]!).toContain("LOST");
    expect(lines.some((line) => line.startsWith("  grew"))).toBe(true);
  });

  it("says so plainly when nothing was lost", () => {
    expect(renderManifestComparison({ findings: [] })).toEqual([
      "conservation: OK (nothing the rebuild did not touch was lost)",
    ]);
  });

  it("withholds the identity NAMES under numbers-only, keeping the counts", () => {
    const before = buildCorpusManifest({
      exists: NOTHING_EXISTS,
      records: [record({ overrides: { sourceId: "SOMETEAM-1234" } })],
    });
    const lines = renderManifestComparison({
      findings: compareManifests({ after: buildCorpusManifest({ exists: NOTHING_EXISTS, records: [] }), before }),
      numbersOnly: true,
    });
    // The identity keys carry container and source ids — team keys, repo slugs — so a capture destined for a
    // public PR must not print them.
    expect(lines.some((line) => line.includes("SOMETEAM-1234"))).toBe(false);
    expect(lines.some((line) => line.includes("[withheld]"))).toBe(true);
  });
});

describe("isLocalOrigin", () => {
  it("accepts an absolute path and rejects everything a connector writes", () => {
    expect(isLocalOrigin({ url: "/scan/root/plan.md" })).toBe(true);
    expect(isLocalOrigin({ url: "https://example.invalid/x" })).toBe(false);
    expect(isLocalOrigin({ url: "//cdn.example.invalid/x" })).toBe(false);
    expect(isLocalOrigin({ url: "u" })).toBe(false);
    expect(isLocalOrigin({ url: "" })).toBe(false);
  });
});

describe("origin survival — the reading conservation cannot make", () => {
  /** One self-lane record scanned from `url`. */
  function scanned({ url, sourceId }: { url: string; sourceId: string }): CorpusRecord {
    return record({ overrides: { container: "notes", kind: "document", source: "self", sourceId, url } });
  }

  it("counts DISTINCT origin files, not records, so a long file is not counted many times", () => {
    const manifest = buildCorpusManifest({
      exists: existsIn({ paths: ["/notes/a.md"] }),
      records: [
        scanned({ sourceId: "a#0", url: "/notes/a.md" }),
        scanned({ sourceId: "a#1", url: "/notes/a.md" }),
        scanned({ sourceId: "a#2", url: "/notes/a.md" }),
        scanned({ sourceId: "b#0", url: "/notes/b.md" }),
      ],
    });
    expect(manifest.bySource["self"]).toBe(4);
    expect(manifest.originsPresentBySource["self"]).toBe(1);
    expect(manifest.originsMissingBySource["self"]).toBe(1);
  });

  it("reports a lane whose whole source tree was pruned", () => {
    const manifest = buildCorpusManifest({
      exists: NOTHING_EXISTS,
      records: [scanned({ sourceId: "a", url: "/notes/a.md" }), scanned({ sourceId: "b", url: "/notes/b.md" })],
    });
    expect(manifest.originsPresentBySource["self"]).toBe(0);
    expect(manifest.originsMissingBySource["self"]).toBe(2);
  });

  it("leaves a fetched lane ABSENT from both tallies rather than reporting a reassuring zero", () => {
    const manifest = buildCorpusManifest({ exists: NOTHING_EXISTS, records: [record()] });
    expect(manifest.bySource["linear"]).toBe(1);
    expect(manifest.originsPresentBySource["linear"]).toBe(undefined);
    expect(manifest.originsMissingBySource["linear"]).toBe(undefined);
  });

  it("keeps each lane's origins separate", () => {
    const manifest = buildCorpusManifest({
      exists: existsIn({ paths: ["/notes/kept.md"] }),
      records: [
        scanned({ sourceId: "kept", url: "/notes/kept.md" }),
        record({ overrides: { kind: "finding", source: "gold", sourceId: "g1", url: "/gold/g1.md" } }),
      ],
    });
    expect(manifest.originsPresentBySource["self"]).toBe(1);
    expect(manifest.originsMissingBySource["self"]).toBe(0);
    expect(manifest.originsPresentBySource["gold"]).toBe(0);
    expect(manifest.originsMissingBySource["gold"]).toBe(1);
  });
});

describe("parseCorpusManifest", () => {
  it("round-trips a built manifest through JSON", () => {
    const built = buildCorpusManifest({
      exists: existsIn({ paths: ["/notes/a.md"] }),
      records: [record({ overrides: { source: "self", url: "/notes/a.md" } })],
    });
    const decoded = parseCorpusManifest({ value: JSON.parse(JSON.stringify(built)) as unknown });
    expect(decoded).toEqual(built);
  });

  it("REFUSES a version-1 snapshot rather than reading it as a corpus with no local origins", () => {
    // An absent origin tally decodes as "nothing was scanned locally", which is the exact false reassurance
    // the field was added to prevent — so the old version is refused, not filled in.
    expect(
      parseCorpusManifest({
        value: { bySource: { self: 3 }, bySourceKind: {}, containersBySource: {}, records: 3, version: 1 },
      }),
    ).toBe(undefined);
  });

  it("rejects a value that is not an object", () => {
    expect(parseCorpusManifest({ value: null })).toBe(undefined);
    expect(parseCorpusManifest({ value: "{}" })).toBe(undefined);
  });
});
