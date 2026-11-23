import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runDistilAnswerWithDeps } from "../../../../../cli/commands/distil/answer.js";
import { runDistilBriefWithRest } from "../../../../../cli/commands/distil/brief.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { bronzeFile, distilCachePath, goldDir } from "../../../../../corpus/corpusPaths.js";
import type { CorpusRecord } from "../../../../../corpus/types.js";
import { admittingSlotGuard } from "../../../../loadSlotFixture.js";
import { parseOwnJson } from "../../../../parseOwnJson.js";

const window = { since: "2026-01-01", until: "2026-02-01" };

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

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

/** Seed a temp home with ONE record ⇒ ONE distil batch, and run derive so gold has a silver index to read. */
function seedHome(): string {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-distil-answer-"));
  fixtureDirs.push(home);
  mkdirSync(join(home, "corpus", "bronze", "github"), { recursive: true });
  writeFileSync(bronzeFile({ home, source: "github", window }), JSON.stringify(record({})), "utf8");
  return home;
}

/** Brief the one batch, returning the brief path (a fixed, known location). */
function briefOneBatch({ home }: { home: string }): string {
  const briefPath = join(home, "brief.json");
  const code = runDistilBriefWithRest({ guard: admittingSlotGuard, rest: ["--home", home, "--out", briefPath] });
  if (code !== EXIT_OK) {
    throw new Error(`briefing failed with exit code ${String(code)}`);
  }
  return briefPath;
}

const FIXED_NOW = (): string => "2026-07-19T00:00:00Z";

const VALID_ANSWER = JSON.stringify({
  points: [{ citations: ["https://example.test/1"], point: "shipped the retriever" }],
  summary: "the retriever shipped",
});

const INVALID_ANSWER = JSON.stringify({ points: [{ citations: [], point: "no evidence" }], summary: "" });

describe("distil answer", () => {
  it("caches a VALID answer and — being the only batch — writes gold immediately", () => {
    const home = seedHome();
    const briefPath = briefOneBatch({ home });
    const answerPath = join(home, "answer.json");
    writeFileSync(answerPath, VALID_ANSWER, "utf8");
    const code = runDistilAnswerWithDeps({
      guard: admittingSlotGuard,
      argv: ["x", "y", "distil", "answer", "--home", home, "--brief", briefPath, "--answer", answerPath],
      nowIso: FIXED_NOW,
    });
    expect(code).toBe(EXIT_OK);
    const cache = parseOwnJson<Record<string, unknown>>({ text: readFileSync(distilCachePath({ home }), "utf8") });
    expect(Object.keys(cache)).toHaveLength(1);
    expect(existsSync(join(goldDir({ home }), "overview.md"))).toBe(true);
    const bySource = readFileSync(join(goldDir({ home }), "by-source", "github.md"), "utf8");
    expect(bySource).toContain("shipped the retriever");
  });

  it("does NOT cache or write gold for an INVALID answer (no summary, no cited point)", () => {
    const home = seedHome();
    const briefPath = briefOneBatch({ home });
    const answerPath = join(home, "answer.json");
    writeFileSync(answerPath, INVALID_ANSWER, "utf8");
    const code = runDistilAnswerWithDeps({
      guard: admittingSlotGuard,
      argv: ["x", "y", "distil", "answer", "--home", home, "--brief", briefPath, "--answer", answerPath],
      nowIso: FIXED_NOW,
    });
    expect(code).toBe(EXIT_ERROR);
    expect(existsSync(distilCachePath({ home }))).toBe(false);
    expect(existsSync(goldDir({ home }))).toBe(false);
  });

  it("refuses when the answer file is not JSON", () => {
    const home = seedHome();
    const briefPath = briefOneBatch({ home });
    const answerPath = join(home, "answer.json");
    writeFileSync(answerPath, "not json", "utf8");
    const code = runDistilAnswerWithDeps({
      guard: admittingSlotGuard,
      argv: ["x", "y", "distil", "answer", "--home", home, "--brief", briefPath, "--answer", answerPath],
      nowIso: FIXED_NOW,
    });
    expect(code).toBe(EXIT_ERROR);
    expect(existsSync(distilCachePath({ home }))).toBe(false);
  });

  it("refuses when the corpus changed since the brief was written (content hash no longer matches)", () => {
    const home = seedHome();
    const briefPath = briefOneBatch({ home });
    // Edit the record's text AFTER the brief was written — the pinned ref still resolves, but the hash moves.
    writeFileSync(
      bronzeFile({ home, source: "github", window }),
      JSON.stringify(record({ text: "an edited body" })),
      "utf8",
    );
    const answerPath = join(home, "answer.json");
    writeFileSync(answerPath, VALID_ANSWER, "utf8");
    const code = runDistilAnswerWithDeps({
      guard: admittingSlotGuard,
      argv: ["x", "y", "distil", "answer", "--home", home, "--brief", briefPath, "--answer", answerPath],
      nowIso: FIXED_NOW,
    });
    expect(code).toBe(EXIT_ERROR);
    expect(existsSync(distilCachePath({ home }))).toBe(false);
  });

  it("requires --brief and --answer, refusing with EXIT_USAGE (not EXIT_ERROR) when they are missing", () => {
    const home = seedHome();
    const code = runDistilAnswerWithDeps({
      guard: admittingSlotGuard,
      argv: ["x", "y", "distil", "answer", "--home", home],
      nowIso: FIXED_NOW,
    });
    expect(code).toBe(EXIT_USAGE);
  });

  it("rejects a removed flag with a migration message", () => {
    const code = runDistilAnswerWithDeps({
      guard: admittingSlotGuard,
      argv: ["x", "y", "distil", "answer", "--concurrency", "4"],
      nowIso: FIXED_NOW,
    });
    expect(code).toBe(EXIT_ERROR);
  });

  it("exits EXIT_OK with --help, doing nothing", () => {
    const code = runDistilAnswerWithDeps({
      guard: admittingSlotGuard,
      argv: ["x", "y", "distil", "answer", "--help"],
      nowIso: FIXED_NOW,
    });
    expect(code).toBe(EXIT_OK);
  });
});
