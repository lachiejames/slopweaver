import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runDevManifest } from "../../../../../cli/commands/dev/manifest.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { serialiseRecord } from "../../../../../corpus/recordSerialisation.js";
import type { CorpusRecord } from "../../../../../corpus/types.js";
import { parseOwnJson } from "../../../../parseOwnJson.js";

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** One record, defaulted. Named-object parameter like every other function here — the rule covers tests too. */
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

/**
 * A temp home holding one bronze window file per source. A real filesystem round-trip, not a mock: the verb's
 * whole job is reading bronze off disk and writing a manifest to it.
 */
function seedHome({ records }: { records: readonly CorpusRecord[] }): string {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-devmanifest-"));
  fixtureDirs.push(home);
  for (const source of new Set(records.map((r) => r.source))) {
    const dir = join(home, "corpus", "bronze", source);
    mkdirSync(dir, { recursive: true });
    const lines = records.filter((r) => r.source === source).map((r) => serialiseRecord({ record: r }));
    writeFileSync(join(dir, "2020-01-01_2030-01-01.jsonl"), `${lines.join("\n")}\n`, "utf8");
  }
  return home;
}

/** `slopweaver dev manifest <tail>` — the tail starts at argv index 4. */
function argv({ tail }: { tail: readonly string[] }): readonly string[] {
  return ["node", "slopweaver", "dev", "manifest", ...tail];
}

describe("runDevManifest", () => {
  it("prints usage for --help", () => {
    expect(runDevManifest(argv({ tail: ["--help"] }))).toBe(EXIT_OK);
  });

  it("rejects an unknown flag rather than ignoring it", () => {
    expect(runDevManifest(argv({ tail: ["--definitely-not-a-real-flag"] }))).toBe(EXIT_USAGE);
  });

  it("writes a snapshot that reads back as a version-2 manifest", () => {
    const home = seedHome({ records: [record(), record({ overrides: { sourceId: "ENG-2" } })] });
    const out = join(home, "before.json");
    expect(runDevManifest(argv({ tail: ["--home", home, "--out", out] }))).toBe(EXIT_OK);
    const written = parseOwnJson<{ version: number; records: number }>({ text: readFileSync(out, "utf8") });
    expect(written.version).toBe(2);
    expect(written.records).toBe(2);
  });

  it("REFUSES a version-1 snapshot rather than comparing against one with no origin tallies", () => {
    const home = seedHome({ records: [record()] });
    const stale = join(home, "v1.json");
    writeFileSync(stale, '{"version":1,"records":1,"bySource":{"linear":1}}\n', "utf8");
    expect(runDevManifest(argv({ tail: ["--home", home, "--compare", stale] }))).toBe(EXIT_ERROR);
  });

  it("reports ORIGIN SURVIVAL off the real disk — a scanned lane whose files are gone cannot be rebuilt", () => {
    // The seeded home writes bronze only; the paths these `self` records name were never created, so the
    // verb's own `existsSync` seam finds them missing. That is the whole reading, end to end.
    const home = seedHome({
      records: [
        record({ overrides: { container: "notes", kind: "file", source: "self", sourceId: "a", url: "/gone/a.md" } }),
        record({ overrides: { container: "notes", kind: "file", source: "self", sourceId: "b", url: "/gone/b.md" } }),
      ],
    });
    const out = join(home, "before.json");
    expect(runDevManifest(argv({ tail: ["--home", home, "--out", out] }))).toBe(EXIT_OK);
    const written = parseOwnJson<{
      originsMissingBySource: Record<string, number>;
      originsPresentBySource: Record<string, number>;
    }>({ text: readFileSync(out, "utf8") });
    expect(written.originsMissingBySource["self"]).toBe(2);
    expect(written.originsPresentBySource["self"]).toBe(0);
  });

  it("finds a scanned lane INTACT when its origin files are still on disk", () => {
    const originDir = mkdtempSync(join(tmpdir(), "slopweaver-devmanifest-origins-"));
    fixtureDirs.push(originDir);
    const origin = join(originDir, "a.md");
    writeFileSync(origin, "the note this record was scanned from\n", "utf8");
    const home = seedHome({
      records: [
        record({ overrides: { container: "notes", kind: "file", source: "self", sourceId: "a", url: origin } }),
      ],
    });
    const out = join(home, "before.json");
    expect(runDevManifest(argv({ tail: ["--home", home, "--out", out] }))).toBe(EXIT_OK);
    const written = parseOwnJson<{
      originsMissingBySource: Record<string, number>;
      originsPresentBySource: Record<string, number>;
    }>({ text: readFileSync(out, "utf8") });
    expect(written.originsPresentBySource["self"]).toBe(1);
    expect(written.originsMissingBySource["self"]).toBe(0);
  });

  it("PASSES when the rebuild only added", () => {
    const home = seedHome({ records: [record()] });
    const out = join(home, "before.json");
    runDevManifest(argv({ tail: ["--home", home, "--out", out] }));
    const grown = seedHome({ records: [record(), record({ overrides: { sourceId: "ENG-2" } })] });
    expect(runDevManifest(argv({ tail: ["--home", grown, "--compare", out] }))).toBe(EXIT_OK);
  });

  it("FAILS when a source the rebuild did not touch has vanished", () => {
    // The whole point of the verb: `derive` overwrites shared silver, so a Linear-only rebuild can be green on
    // Linear while having erased GitHub from every derived artefact.
    const home = seedHome({
      records: [
        record(),
        record({ overrides: { container: "owner/repo", kind: "pr", source: "github", sourceId: "#1" } }),
      ],
    });
    const out = join(home, "before.json");
    runDevManifest(argv({ tail: ["--home", home, "--out", out] }));
    const linearOnly = seedHome({ records: [record(), record({ overrides: { sourceId: "ENG-2" } })] });
    expect(runDevManifest(argv({ tail: ["--home", linearOnly, "--compare", out] }))).toBe(EXIT_ERROR);
  });

  it("errors rather than passing vacuously when the comparison file is missing or not a manifest", () => {
    const home = seedHome({ records: [record()] });
    expect(runDevManifest(argv({ tail: ["--home", home, "--compare", join(home, "nope.json")] }))).toBe(EXIT_ERROR);
    const notAManifest = join(home, "junk.json");
    writeFileSync(notAManifest, '{"version":99}\n', "utf8");
    expect(runDevManifest(argv({ tail: ["--home", home, "--compare", notAManifest] }))).toBe(EXIT_ERROR);
  });
});
