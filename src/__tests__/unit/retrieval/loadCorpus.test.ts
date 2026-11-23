/**
 * `loadCorpus` over a real temp corpus tree — a filesystem round-trip, which `testing.md` allows for a
 * genuine fixture. The point of every case here is a state that used to be indistinguishable from silence.
 */
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { goldDir } from "../../../corpus/corpusPaths.js";
import type { CorpusRecord } from "../../../corpus/types.js";
import type { HeapGuard } from "../../../lib/heapBudget.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";
import type { CoverageLeg } from "../../../retrieval/coverage.js";
import { loadCorpus } from "../../../retrieval/loadCorpus.js";

const NOW = "2026-08-06T00:00:00.000Z";

const homes: string[] = [];

afterEach(() => {
  for (const home of homes.splice(0)) {
    // Restore any permission bit a test removed, or the temp dir cannot be cleaned up.
    chmodSync(join(home, "corpus", "bronze"), 0o755);
    rmSync(home, { force: true, recursive: true });
  }
});

/** A bronze row for a source, written into `bronze/<source>/w.jsonl`. */
function row(over: Partial<CorpusRecord> & { source: CorpusRecord["source"] }): string {
  const record: CorpusRecord = {
    container: "c",
    kind: "message",
    refs: [],
    sourceId: "s1",
    text: "body",
    tsIso: NOW,
    url: "https://example.test/s1",
    ...over,
  };
  return JSON.stringify(record);
}

/** Build a temp home whose bronze tree holds one file per named source. */
function corpusHome({ files }: { files: Record<string, readonly string[]> }): string {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-loadcorpus-"));
  homes.push(home);
  for (const [source, lines] of Object.entries(files)) {
    const dir = join(home, "corpus", "bronze", source);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "w.jsonl"), `${lines.join("\n")}\n`, "utf8");
  }
  return home;
}

/** The leg with a given name, or a throwing lookup — never a conditional inside an assertion. */
function legNamed({ legs, name }: { legs: readonly CoverageLeg[]; name: string }): CoverageLeg {
  return legs.find((leg) => leg.leg === name)!;
}

describe("loadCorpus coverage manifest", () => {
  it("reports a healthy source as OK with the conservation law balancing", () => {
    const home = corpusHome({ files: { github: [row({ source: "github", sourceId: "#1" })] } });
    const loaded = unwrap(loadCorpus({ home, nowIso: NOW }));
    const github = legNamed({ legs: loaded.coverage.legs, name: "github" });
    expect(github.state).toBe("ok");
    expect(github.ingested).toBe(1);
    expect(github.indexed).toBe(1);
    expect(github.skipped).toEqual([]);
    expect(loaded.records).toHaveLength(1);
  });

  it("reports gold as ABSENT rather than silently contributing nothing", () => {
    const home = corpusHome({ files: { github: [row({ source: "github", sourceId: "#1" })] } });
    const gold = legNamed({ legs: unwrap(loadCorpus({ home, nowIso: NOW })).coverage.legs, name: "gold" });
    expect(gold.state).toBe("absent");
    expect(gold.detail).toBe("no records on disk for this leg");
  });

  it("reports a source whose newest record predates the window as STALE, not empty", () => {
    const home = corpusHome({
      files: { linear: [row({ source: "linear", sourceId: "T-1", tsIso: "2026-05-01T00:00:00.000Z" })] },
    });
    const linear = legNamed({ legs: unwrap(loadCorpus({ home, nowIso: NOW })).coverage.legs, name: "linear" });
    expect(linear.state).toBe("stale");
    expect(linear.indexed).toBe(1);
    expect(linear.newestIso).toBe("2026-05-01T00:00:00.000Z");
  });

  it("reports an unreadable file as FAILED — the state that used to read as `no corpus yet`", () => {
    const home = corpusHome({
      files: {
        github: [row({ source: "github", sourceId: "#1" })],
        slack: [row({ source: "slack", sourceId: "s9" })],
      },
    });
    chmodSync(join(home, "corpus", "bronze", "slack", "w.jsonl"), 0o000);
    const loaded = unwrap(loadCorpus({ home, nowIso: NOW }));
    const slack = legNamed({ legs: loaded.coverage.legs, name: "slack" });
    expect(slack.state).toBe("failed");
    expect(slack.detail).toBe("1 path(s) could not be read");
    // The healthy leg is still reported, so the failure is scoped rather than fatal to the whole read.
    expect(legNamed({ legs: loaded.coverage.legs, name: "github" }).state).toBe("ok");
  });

  it("counts a corrupt line as a reasoned skip, so the conservation law still balances", () => {
    const home = corpusHome({
      files: { github: [row({ source: "github", sourceId: "#1" }), "not json at all", '{"source":"nope"}'] },
    });
    const github = legNamed({ legs: unwrap(loadCorpus({ home, nowIso: NOW })).coverage.legs, name: "github" });
    expect(github.ingested).toBe(3);
    expect(github.indexed).toBe(1);
    expect(github.skipped).toEqual([
      { count: 1, reason: "invalid-json" },
      { count: 1, reason: "unknown-source" },
    ]);
  });

  it("counts a superseded version as a reasoned skip rather than losing it from the arithmetic", () => {
    const home = corpusHome({
      files: {
        github: [
          row({ source: "github", sourceId: "#1", text: "old", tsIso: "2026-08-01T00:00:00.000Z" }),
          row({ source: "github", sourceId: "#1", text: "new", tsIso: "2026-08-05T00:00:00.000Z" }),
        ],
      },
    });
    const loaded = unwrap(loadCorpus({ home, nowIso: NOW }));
    const github = legNamed({ legs: loaded.coverage.legs, name: "github" });
    expect(github.ingested).toBe(2);
    expect(github.indexed).toBe(1);
    expect(github.skipped).toEqual([{ count: 1, reason: "superseded" }]);
    expect(loaded.records[0]!.text).toBe("new");
  });

  it("still errs when there is genuinely no corpus — an ABSENCE is not a failure", () => {
    const home = mkdtempSync(join(tmpdir(), "slopweaver-loadcorpus-empty-"));
    mkdirSync(join(home, "corpus", "bronze"), { recursive: true });
    homes.push(home);
    const result = loadCorpus({ home, nowIso: NOW });
    expect(unwrapErr(result).code).toBe("LOAD_CORPUS_EMPTY");
  });

  it("does NOT report an unreadable root as an absence — it becomes a failed leg the caller can refuse on", () => {
    const home = corpusHome({ files: { github: [row({ source: "github", sourceId: "#1" })] } });
    chmodSync(join(home, "corpus", "bronze"), 0o000);
    const loaded = unwrap(loadCorpus({ home, nowIso: NOW }));
    expect(loaded.coverage.legs.map((leg) => `${leg.leg}=${leg.state}`)).toEqual(["(root)=failed", "gold=absent"]);
    expect(loaded.records).toEqual([]);
  });

  // The ambiguity rule: citeToken drops `source` when a container's tail already sits inside the id, so
  // two DIFFERENT identities can render the same retrieval key. Refuses rather than silently merging their
  // postings — the same case `recordKey.test.ts` proves at the unit level, exercised here end-to-end.
  it("refuses when two distinct records collide on one retrieval key", () => {
    const home = corpusHome({
      files: {
        linear: [row({ container: "linear/TEAM", source: "linear", sourceId: "TEAM-9" })],
        self: [row({ container: "notes/TEAM", source: "self", sourceId: "TEAM-9" })],
      },
    });
    const error = unwrapErr(loadCorpus({ home, nowIso: NOW }));
    expect(error.code).toBe("LOAD_CORPUS_RECORD_KEY_COLLISION");
    expect(error.message).toContain('"TEAM-9"');
  });

  // Gold is synthesised fresh per query with no de-duplication of its own — two identical `## ` headings in
  // one doc render the SAME identity twice. Collapsed via the same winner rule bronze uses, rather than left
  // for a downstream Map to silently overwrite, or refused as if it were a genuine cross-record collision.
  it("collapses gold's own duplicate heading rather than refusing or double-indexing it", () => {
    const home = corpusHome({ files: { github: [row({ source: "github", sourceId: "#1" })] } });
    mkdirSync(goldDir({ home }), { recursive: true });
    writeFileSync(
      join(goldDir({ home }), "doc.md"),
      "# Doc\n\n## Overview\nfirst body\n\n## Overview\nsecond body\n",
      "utf8",
    );
    const loaded = unwrap(loadCorpus({ home, nowIso: NOW }));
    const gold = legNamed({ legs: loaded.coverage.legs, name: "gold" });
    expect(gold.ingested).toBe(2);
    expect(gold.indexed).toBe(1);
    expect(gold.skipped).toEqual([{ count: 1, reason: "superseded" }]);
  });
});

describe("loadCorpus heap guards", () => {
  /** A guard that refuses exactly the Nth projection it is asked about (1-based), fitting every other. */
  function refuseNth({ n }: { n: number }): { guard: HeapGuard; seen: number[] } {
    const seen: number[] = [];
    const guard: HeapGuard = ({ projectedBytes }) => {
      seen.push(projectedBytes);
      return seen.length === n
        ? {
            collected: true,
            fits: false,
            limitBytes: 4000,
            projectedBytes,
            shortfallBytes: 1,
            suggestedLimitMib: 4608,
            usedBytes: 3000,
          }
        : { fits: true, headroomBytes: 1 };
    };
    return { guard, seen };
  }

  it("loads in the retrieval projection, so no record carries `raw`", () => {
    const home = corpusHome({
      files: { github: [row({ raw: { big: "payload" }, source: "github", sourceId: "#1" })] },
    });
    const loaded = unwrap(loadCorpus({ home, nowIso: NOW }));
    expect(loaded.records.map((record) => record.raw)).toEqual([undefined]);
    expect(loaded.records[0]!.text).toBe("body");
  });

  it("keeps `raw` when a caller asks for the bronze projection", () => {
    const home = corpusHome({
      files: { github: [row({ raw: { big: "payload" }, source: "github", sourceId: "#1" })] },
    });
    const loaded = unwrap(loadCorpus({ home, nowIso: NOW, projection: "bronze" }));
    expect(loaded.records[0]!.raw).toEqual({ big: "payload" });
  });

  it("consults the guard for the corpus preflight and each read chunk, and for nothing else", () => {
    const home = corpusHome({
      files: { github: [row({ source: "github", sourceId: "#1", text: "ten chars!" })] },
    });
    const { guard, seen } = refuseNth({ n: 99 });
    unwrap(loadCorpus({ heapGuard: guard, home, nowIso: NOW }));
    // Preflight, then two in-file chunk checks for the one file (the chunk that reads it, then the one that
    // finds EOF). The in-file checks replaced a single whole-FILE projection, which over-projected a 2 GiB
    // Slack window 3.5× and refused a corpus that fits. There is no FOURTH projection any more: no caller in
    // this path ever builds a BM25 index over the load's own records in heap.
    expect(seen).toHaveLength(3);
  });

  it("maps the reader's heap refusal to the records stage, message intact", () => {
    const home = corpusHome({ files: { github: [row({ source: "github", sourceId: "#1" })] } });
    const { guard } = refuseNth({ n: 1 });
    const error = unwrapErr(loadCorpus({ heapGuard: guard, home, nowIso: NOW }));
    expect(error.code).toBe("LOAD_CORPUS_HEAP_CEILING");
    expect(error).toMatchObject({ limitBytes: 4000, stage: "records", suggestedLimitMib: 4608, usedBytes: 3000 });
    expect(error.message).toContain("too large for this process's heap ceiling");
  });

  // No caller in this path builds an in-heap BM25 index any more — see `loadCorpus`'s own doc comment for
  // why refusing here for an allocation nothing makes would be a refusal of a corpus that fits.
  it("does not refuse a load whose records fit, whatever an index over them would cost", () => {
    const home = corpusHome({ files: { github: [row({ source: "github", sourceId: "#1" })] } });
    const { guard } = refuseNth({ n: 4 });
    const loaded = loadCorpus({ heapGuard: guard, home, nowIso: NOW });
    expect(loaded.isOk()).toBe(true);
    expect(unwrap(loaded).records.length).toBe(1);
  });
});
