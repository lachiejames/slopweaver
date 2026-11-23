/**
 * `productionDerive` over a real throwaway home: it rebuilds when an input moved and skips, loading no corpus,
 * when none did — the bound on a scheduled resync of a source that wrote nothing.
 */
import { mkdirSync, mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { productionDerive } from "../../../../cli/commands/refresh/derive.js";
import { bronzeFile } from "../../../../corpus/corpusPaths.js";
import type { CorpusRecord, CorpusSource } from "../../../../corpus/types.js";
import { unwrap } from "../../../../lib/result.js";
import { runDerivePipeline, silverArtefactPaths, writeSilverArtifacts } from "../../../../silver/derive/pipeline.js";
import { readFreshnessStamp } from "../../../../silver/derive/stamp.js";
import type { IdentityRosterSnapshot } from "../../../../silver/identityRoster.js";
import { memoryIdentityRosterPort, unavailableIdentityRosterPort } from "../../../identityRosterFixture.js";
import { memorySingletonStore } from "../../../singletonRegisterFixture.js";

const window = { since: "2026-01-01", until: "2026-02-01" };

/** The roster as a store with no row reads it. */
const NO_ROW: IdentityRosterSnapshot = { records: [], retiredFile: undefined, revision: null };

/** One in-memory store for the file: every test has its own home, and rows are keyed by home. */
const ROSTER_STORE = memorySingletonStore();
const ROSTER = memoryIdentityRosterPort({ store: ROSTER_STORE });

const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** One bronze record of a source. */
function record({ source, sourceId }: { source: CorpusSource; sourceId: string }): CorpusRecord {
  return {
    author: "ada",
    container: `${source}/c`,
    kind: "message",
    refs: [],
    source,
    sourceId,
    text: `a ${source} record`,
    tsIso: "2026-01-10T00:00:00Z",
    url: `https://example.test/${sourceId}`,
  };
}

/** Write one source's bronze window file holding one record. */
function writeBronze({ home, source, sourceId }: { home: string; source: CorpusSource; sourceId: string }): void {
  mkdirSync(join(home, "corpus", "bronze", source), { recursive: true });
  writeFileSync(bronzeFile({ home, source, window }), JSON.stringify(record({ source, sourceId })), "utf8");
}

/** Write one source's resume cursor. */
function writeCursor({ home, source, cursor }: { home: string; source: CorpusSource; cursor: string }): void {
  mkdirSync(join(home, "corpus", "watermarks"), { recursive: true });
  writeFileSync(join(home, "corpus", "watermarks", `${source}.json`), JSON.stringify({ cursor, version: 1 }), "utf8");
}

/** A home holding github + slack bronze. */
function seedHome(): string {
  const home = mkdtempSync(join(tmpdir(), "refresh-derive-"));
  fixtureDirs.push(home);
  writeBronze({ home, source: "github", sourceId: "g1" });
  writeBronze({ home, source: "slack", sourceId: "s1" });
  return home;
}

/** Every line one successful derive call printed. */
async function linesOf({ home }: { home: string }): Promise<readonly string[]> {
  const result = await productionDerive({ home, identityRoster: ROSTER });
  expect(result.ok).toBe(true);
  return result.lines.map((line) => line.text);
}

describe("productionDerive — skip when nothing derive reads has moved", () => {
  it("rebuilds on the first call, then skips over the same inputs and names the stamp's instant", async () => {
    const home = seedHome();
    const first = await linesOf({ home });
    expect(first).toHaveLength(2);
    expect(first[0]).toBe(
      "derive: rebuilding — silver is incomplete: " +
        `${Object.values(silverArtefactPaths({ home })).join(", ")} absent`,
    );
    expect(first[1]).toMatch(/^derive: rebuilt silver from 2 record\(s\) and 0 member row\(s\)/);
    const derivedAtIso = readFreshnessStamp({ home })!.derivedAtIso;
    expect(await linesOf({ home })).toEqual([
      `derive: skipped — nothing derive reads has moved since silver was derived ${derivedAtIso}, so no corpus ` +
        "was loaded (`slopweaver derive` rebuilds it regardless)",
    ]);
    expect(readFreshnessStamp({ home })!.derivedAtIso).toBe(derivedAtIso);
  });

  it("rebuilds when a non-roster source gained bronze, saying which", async () => {
    const home = seedHome();
    await linesOf({ home });
    writeBronze({ home, source: "fathom", sourceId: "f1" });
    const lines = await linesOf({ home });
    expect(lines[0]).toBe("derive: rebuilding — bronze, members or structures moved for fathom");
    expect(lines[1]).toMatch(/^derive: rebuilt silver from 3 record\(s\)/);
  });

  it("skips when only a non-roster cursor advanced, and rebuilds when a roster cursor did", async () => {
    const home = seedHome();
    await linesOf({ home });
    writeCursor({ cursor: "2026-10-01T00:00:00Z", home, source: "fathom" });
    expect((await linesOf({ home }))[0]).toMatch(/^derive: skipped/);
    writeCursor({ cursor: "2026-10-01T00:00:00Z", home, source: "slack" });
    expect((await linesOf({ home }))[1]).toMatch(/^derive: rebuilt silver from 2 record\(s\)/);
  });

  it("rebuilds when a .jsonl lands nested under a source, or loose at the bronze root — both of which derive reads", async () => {
    const home = seedHome();
    await linesOf({ home });
    mkdirSync(join(home, "corpus", "bronze", "slack", "archive"), { recursive: true });
    writeFileSync(
      join(home, "corpus", "bronze", "slack", "archive", "old.jsonl"),
      JSON.stringify(record({ source: "slack", sourceId: "s2" })),
    );
    const nested = await linesOf({ home });
    expect(nested[0]).toMatch(/^derive: rebuilding — the corpus tree moved: 2 file\(s\) \d+B, 0 unlistable → 3 file/);
    expect(nested[1]).toMatch(/^derive: rebuilt silver from 3 record\(s\)/);
    writeFileSync(
      join(home, "corpus", "bronze", "loose.jsonl"),
      JSON.stringify(record({ source: "github", sourceId: "g2" })),
    );
    const loose = await linesOf({ home });
    expect(loose[0]).toMatch(/^derive: rebuilding — the corpus tree moved: 3 file\(s\) \d+B, 0 unlistable → 4 file/);
    expect(loose[1]).toMatch(/^derive: rebuilt silver from 4 record\(s\)/);
  });

  it("rebuilds when silver was last derived from a --corpus override, not this home's bronze", async () => {
    const home = seedHome();
    const elsewhere = mkdtempSync(join(tmpdir(), "refresh-derive-corpus-"));
    fixtureDirs.push(elsewhere);
    writeFileSync(join(elsewhere, "one.jsonl"), JSON.stringify(record({ source: "github", sourceId: "x1" })));
    const derived = runDerivePipeline({ corpus: elsewhere, home, roster: NO_ROW });
    expect(derived.isOk()).toBe(true);
    writeSilverArtifacts({ derivedAtIso: "2026-10-01T00:00:00.000Z", home, result: unwrap(derived) });
    expect((await linesOf({ home }))[0]).toBe(
      `derive: rebuilding — silver was derived from ${elsewhere}, not ${join(home, "corpus", "bronze")}`,
    );
  });

  it("rebuilds when an artefact is not the file the stamped derive wrote, even one OLDER than the stamp", async () => {
    const home = seedHome();
    await linesOf({ home });
    const { directory, stamp } = silverArtefactPaths({ home });
    const before = new Date(statSync(stamp).mtimeMs - 5000);
    utimesSync(directory, before, before);
    expect((await linesOf({ home }))[0]).toBe(
      `derive: rebuilding — ${directory} is not what the stamped derive wrote, so silver may mix two derives' output`,
    );
    expect((await linesOf({ home }))[0]).toMatch(/^derive: skipped/);
  });

  it("reports a silver write that throws as a failed derive, never an escaped throw", async () => {
    const home = seedHome();
    const blocked = dirname(silverArtefactPaths({ home }).directory);
    mkdirSync(dirname(blocked), { recursive: true });
    writeFileSync(blocked, "a file where the silver directory belongs", "utf8");
    const result = await productionDerive({ home, identityRoster: ROSTER });
    expect(result.ok).toBe(false);
    expect(result.lines.map((line) => line.level)).toEqual(["out", "error"]);
    expect(result.lines[1]!.text).toBe(`derive: EEXIST: file already exists, mkdir '${blocked}'`);
  });

  it("rebuilds when any one artefact is gone", async () => {
    const home = seedHome();
    await linesOf({ home });
    const structures = silverArtefactPaths({ home }).structures;
    rmSync(structures);
    expect((await linesOf({ home }))[0]).toBe(`derive: rebuilding — silver is incomplete: ${structures} absent`);
  });

  it("rebuilds when the store's roster moved to a new revision, and skips again once it has", async () => {
    const home = seedHome();
    await linesOf({ home });
    const written = await ROSTER.replace({
      expectedRevision: null,
      home,
      records: [{ handle: "ada", id: "U0FIXTUREADA", name: "Ada Acme" }],
    });
    expect(unwrap(written).revision).toBe(1);
    const lines = await linesOf({ home });
    expect(lines[0]).toContain("its sources have moved since: identity roster (override roster revision (none) → 1)");
    expect(readFreshnessStamp({ home })!.overrideRevision).toBe(1);
    expect((await linesOf({ home }))[0]).toMatch(/^derive: skipped/);
  });

  it("fails the lane when the store cannot answer, loading no corpus and writing no silver", async () => {
    const home = seedHome();
    const result = await productionDerive({ home, identityRoster: unavailableIdentityRosterPort() });
    expect(result.ok).toBe(false);
    expect(result.lines.map((line) => line.level)).toEqual(["error"]);
    expect(result.lines[0]!.text).toContain("derive: this install keeps its identity roster in the store");
    expect(readFreshnessStamp({ home })).toBe(undefined);
  });
});
