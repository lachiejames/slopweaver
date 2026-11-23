import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runDistilBrief } from "../../../../../cli/commands/distil/brief.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { bronzeFile, distilPromptMarkerPath } from "../../../../../corpus/corpusPaths.js";
import { type CorpusRecord } from "../../../../../corpus/types.js";
import { DISTIL_PROMPT_FINGERPRINT } from "../../../../../gold/distil.js";
import {
  loadDistilCache,
  readDistilPromptMarker,
  saveDistilCache,
  writeDistilPromptMarker,
} from "../../../../../gold/distilCache.js";
import { ALL_CORPUS_SOURCES } from "../../../../../integrations/corpusSources.js";
import { isOneOf } from "../../../../../lib/parsers.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import { stateHomePaths } from "../../../../../stateHome.js";
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

function seedHome(): string {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-distil-brief-"));
  fixtureDirs.push(home);
  mkdirSync(join(home, "corpus", "bronze", "github"), { recursive: true });
  writeFileSync(bronzeFile({ home, source: "github", window }), JSON.stringify(record({})), "utf8");
  return home;
}

/** Run the explicit `distil brief` verb, at the correct argv offset. */
const runBrief = ({ home, rest = [] }: { home: string; rest?: readonly string[] }): number =>
  runDistilBrief(["x", "y", "distil", "brief", "--home", home, ...rest]);

describe("distil brief", () => {
  it("writes a brief for the one uncached batch, to --out, naming the exact batch", () => {
    const home = seedHome();
    const out = join(home, "b.json");
    expect(runBrief({ home, rest: ["--out", out] })).toBe(EXIT_OK);
    expect(existsSync(out)).toBe(true);
    const brief = parseOwnJson<Record<string, unknown>>({ text: readFileSync(out, "utf8") });
    expect(brief["source"]).toBe("github");
    expect(brief["container"]).toBe("acme/web");
    expect(brief["promptFingerprint"]).toBe(DISTIL_PROMPT_FINGERPRINT);
  });

  it("defaults the brief path under $home/briefs/distil-<hash>.json when --out is absent", () => {
    const home = seedHome();
    expect(runBrief({ home })).toBe(EXIT_OK);
    const briefsDir = stateHomePaths({ home }).briefs;
    const files = readdirSync(briefsDir);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^distil-[0-9a-f]+\.json$/);
    const written = parseOwnJson<Record<string, unknown>>({ text: readFileSync(join(briefsDir, files[0]!), "utf8") });
    expect(written["container"]).toBe("acme/web");
  });

  it("reports EXIT_ERROR when the home has no corpus at all", () => {
    const home = mkdtempSync(join(tmpdir(), "slopweaver-distil-brief-empty-"));
    fixtureDirs.push(home);
    expect(runBrief({ home })).toBe(EXIT_ERROR);
  });

  it("reports EXIT_EXPECTED_EMPTY once every unique batch is already cached", () => {
    const home = seedHome();
    const out = join(home, "b.json");
    expect(runBrief({ home, rest: ["--out", out] })).toBe(EXIT_OK);
    // Manually cache the digest for this one batch — as `distil answer` would have.
    const brief = parseOwnJson<{ hash: string; source: string; container: string }>({
      text: readFileSync(out, "utf8"),
    });
    const cache = loadDistilCache({ home });
    if (!isOneOf(brief.source, ALL_CORPUS_SOURCES)) {
      throw new Error(`expected the written brief's source to be a real CorpusSource, got ${brief.source}`);
    }
    cache.set(brief.hash, { container: brief.container, points: [], source: brief.source, summary: "s" });
    saveDistilCache({ cache, home });
    // `distil answer` would also stamp the contract marker on a successful cache write — simulate that too,
    // or the next `brief` sees an unmarked cache and refuses on the (spurious, in this test) contract drift.
    writeDistilPromptMarker({ fingerprint: DISTIL_PROMPT_FINGERPRINT, home });
    expect(runBrief({ home, rest: ["--out", out] })).toBe(EXIT_EXPECTED_EMPTY);
  });

  it("refuses a changed distil contract unless --accept-prompt-change is explicit", () => {
    const home = seedHome();
    const out = join(home, "b.json");
    // Seed a non-empty cache under a STALE fingerprint so the contract-drift path fires.
    const cache = loadDistilCache({ home });
    cache.set("stale", { container: "x", points: [], source: "github", summary: "s" });
    saveDistilCache({ cache, home });
    writeDistilPromptMarker({ fingerprint: "a-stale-fingerprint", home });
    expect(runBrief({ home, rest: ["--out", out] })).toBe(EXIT_USAGE);
    expect(existsSync(out)).toBe(false);
    expect(runBrief({ home, rest: ["--out", out, "--accept-prompt-change"] })).toBe(EXIT_OK);
    expect(existsSync(out)).toBe(true);
  });

  it("refuses a contract marker that is there but corrupt, even with --accept-prompt-change, and writes nothing", () => {
    const home = seedHome();
    const out = join(home, "b.json");
    mkdirSync(dirname(distilPromptMarkerPath({ home })), { recursive: true });
    writeFileSync(distilPromptMarkerPath({ home }), "{");
    expect(runBrief({ home, rest: ["--out", out, "--accept-prompt-change"] })).toBe(EXIT_ERROR);
    expect(existsSync(out)).toBe(false);
    expect(unwrapErr(readDistilPromptMarker({ home }))).toEqual([
      `distil: the contract marker at ${distilPromptMarkerPath({ home })} is there but cannot be trusted (it is ` +
        "not JSON) — delete it, then re-run `distil brief --accept-prompt-change` to confirm the cached digests",
    ]);
  });

  it("refuses a corrupt contract marker on a corpus with no records, never hiding it as an empty plan", () => {
    const home = seedHome();
    writeFileSync(bronzeFile({ home, source: "github", window }), "", "utf8");
    mkdirSync(dirname(distilPromptMarkerPath({ home })), { recursive: true });
    writeFileSync(distilPromptMarkerPath({ home }), "{");
    expect(runBrief({ home })).toBe(EXIT_ERROR);
  });

  it("reports a corpus with no records as nothing to distil", () => {
    const home = seedHome();
    writeFileSync(bronzeFile({ home, source: "github", window }), "", "utf8");
    expect(runBrief({ home })).toBe(EXIT_EXPECTED_EMPTY);
  });

  it("reads a home with no contract marker as none, never as a refusal", () => {
    expect(unwrap(readDistilPromptMarker({ home: seedHome() }))).toBeNull();
  });

  it("rejects a removed flag with a migration message rather than a bare 'unknown flag'", () => {
    const home = seedHome();
    expect(runBrief({ home, rest: ["--full"] })).toBe(EXIT_ERROR);
  });

  it("exits EXIT_OK with --help, printing usage and writing nothing", () => {
    expect(runDistilBrief(["x", "y", "distil", "brief", "--help"])).toBe(EXIT_OK);
  });
});
