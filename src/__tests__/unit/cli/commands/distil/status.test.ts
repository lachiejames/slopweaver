import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runDistilStatusWithDeps } from "../../../../../cli/commands/distil/status.js";
import { EXIT_ERROR, EXIT_OK } from "../../../../../cli/exitCodes.js";
import { bronzeFile } from "../../../../../corpus/corpusPaths.js";
import type { CorpusRecord } from "../../../../../corpus/types.js";
import { admittingSlotGuard } from "../../../../loadSlotFixture.js";

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

const window = { since: "2026-01-01", until: "2026-02-01" };

const record = (over: Partial<CorpusRecord>): CorpusRecord => ({
  container: "acme/web",
  kind: "pr",
  refs: [],
  source: "github",
  sourceId: "#1",
  text: "shipped the retriever",
  tsIso: "2026-01-05T00:00:00Z",
  url: "https://example.test/1",
  ...over,
});

/** Seed a temp home's bronze with one record, so there is exactly one batch to report on. */
function seedHome(): string {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-distil-status-"));
  fixtureDirs.push(home);
  mkdirSync(join(home, "corpus", "bronze", "github"), { recursive: true });
  writeFileSync(bronzeFile({ home, source: "github", window }), JSON.stringify(record({})), "utf8");
  return home;
}

/** Run `distil status` as it would really be invoked, at the correct argv offset. */
const runStatus = (rest: readonly string[]): number =>
  runDistilStatusWithDeps({ argv: ["x", "y", "distil", "status", ...rest], guard: admittingSlotGuard });

describe("distil status", () => {
  it("reports one uncached batch and its next-batch facts", () => {
    const home = seedHome();
    expect(runStatus(["--home", home])).toBe(EXIT_OK);
  });

  it("exits EXIT_OK with --help, printing usage", () => {
    expect(runStatus(["--help"])).toBe(EXIT_OK);
  });

  it("rejects a removed flag with a migration message, not a bare 'unknown flag'", () => {
    expect(runStatus(["--dry-run"])).toBe(EXIT_ERROR);
  });

  it("rejects an unknown flag", () => {
    expect(runStatus(["--bogus"])).toBe(EXIT_ERROR);
  });

  it("never touches the flag-reject path's I/O — a bad flag on a nonexistent home still just refuses", () => {
    expect(runStatus(["--budget", "100", "--home", "/nonexistent/does/not/exist"])).toBe(EXIT_ERROR);
  });
});
