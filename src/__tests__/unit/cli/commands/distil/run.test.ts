import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runDistil } from "../../../../../cli/commands/distil/run.js";
import { EXIT_ERROR, EXIT_OK } from "../../../../../cli/exitCodes.js";
import { bronzeFile } from "../../../../../corpus/corpusPaths.js";
import type { CorpusRecord } from "../../../../../corpus/types.js";
import { stateHomePaths } from "../../../../../stateHome.js";

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
  const home = mkdtempSync(join(tmpdir(), "slopweaver-distil-run-"));
  fixtureDirs.push(home);
  mkdirSync(join(home, "corpus", "bronze", "github"), { recursive: true });
  writeFileSync(bronzeFile({ home, source: "github", window }), JSON.stringify(record({})), "utf8");
  return home;
}

describe("distil (bare noun)", () => {
  it("is an alias of `distil brief` — writes the same default brief with no verb word in argv", () => {
    const home = seedHome();
    // No "brief" token at argv[3]: [node, cli, "distil", "--home", home] — the bare-noun shape.
    const code = runDistil(["x", "y", "distil", "--home", home]);
    expect(code).toBe(EXIT_OK);
    const briefsDir = stateHomePaths({ home }).briefs;
    expect(existsSync(briefsDir)).toBe(true);
    expect(readdirSync(briefsDir)).toHaveLength(1);
  });

  it("still rejects a removed flag with a migration message at the bare-noun offset", () => {
    const home = seedHome();
    expect(runDistil(["x", "y", "distil", "--home", home, "--dry-run"])).toBe(EXIT_ERROR);
  });
});
