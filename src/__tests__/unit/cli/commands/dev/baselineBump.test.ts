import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runDevBaselineBumpWithDeps } from "../../../../../cli/commands/dev/baselineBump.js";
import { bumpManifestFor, parseBaselineBumpArgs } from "../../../../../cli/commands/dev/baselineBumpCore.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { readBumpRecords } from "../../../../../codex/bumpRecordStore.js";
import { digestOf, manifestFileName } from "../../../../../devLint/baselineBump.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import { stateHomePaths } from "../../../../../stateHome.js";
import { gitInTemp, REAL_GIT_TIMEOUT_MS } from "../../../../tempGitRepo.js";

/** The main commit every fixture record is declared against. */
const BASE = "a".repeat(40);

const SIZE = ".baselines/file-size-baseline.json";

describe("parseBaselineBumpArgs", () => {
  it("reads the reason, the base, the home and the dry-run switch", () => {
    expect(
      unwrap(parseBaselineBumpArgs({ rest: ["--reason", " why ", "--base", "abc", "--home", "/h", "--dry-run"] })),
    ).toEqual({ base: "abc", dryRun: true, home: "/h", reason: "why" });
  });

  it("leaves the base and the home unset when neither is given", () => {
    expect(unwrap(parseBaselineBumpArgs({ rest: ["--reason", "why"] }))).toEqual({
      base: undefined,
      dryRun: false,
      home: undefined,
      reason: "why",
    });
  });

  it("refuses a missing reason, naming what it is for", () => {
    expect(unwrapErr(parseBaselineBumpArgs({ rest: [] }))).toEqual([
      "--reason is required: why each loosening is right, in words the witness will judge",
    ]);
  });
});

// deleted-with-code: BUMP_DIR
describe("bumpManifestFor", () => {
  const grown = { entry: "offenders:src/a.ts", file: SIZE, from: 310, to: 320 };
  const widened = { entry: "offenders:tools/gen.ts", file: SIZE, from: null, to: 319 };

  it("derives each cause from whether the change touched the file", () => {
    const manifest = bumpManifestFor({
      base: BASE,
      changedPaths: new Set(["src/a.ts"]),
      loosened: [grown, widened],
      reason: "r",
    })!;
    expect(manifest.loosenings).toEqual([
      { ...grown, cause: "growth" },
      { ...widened, cause: "widening" },
    ]);
    expect(manifest.digest).toBe(digestOf({ base: BASE, rows: manifest.loosenings }));
  });

  it("is undefined when nothing loosened", () => {
    expect(bumpManifestFor({ base: BASE, changedPaths: new Set(), loosened: [], reason: "r" })).toBeUndefined();
  });
});

describe("the verb over a real checkout", () => {
  let root = "";
  let base = "";
  let home = "";
  const lines: string[] = [];
  const log = {
    error: ({ msg }: { msg: string }) => lines.push(msg),
    out: ({ line }: { line: string }) => lines.push(line),
  };
  const git = (...args: readonly string[]): string => gitInTemp({ args, cwd: root });
  const put = ({ path, text }: { path: string; text: string }): void => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  const rows = [{ cause: "widening" as const, entry: "offenders:tools/gen.ts", file: SIZE, from: null, to: 319 }];

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "baseline-bump-verb-"));
    home = mkdtempSync(join(tmpdir(), "baseline-bump-home-"));
    git("init", "--initial-branch=main", ".");
    git("config", "user.email", "fixture@example.invalid");
    git("config", "user.name", "Fixture");
    put({ path: SIZE, text: JSON.stringify({ exempt: [], offenders: [] }) });
    put({ path: "tools/gen.ts", text: "export {};\n" });
    git("add", ".");
    git("commit", "-m", "base");
    base = git("rev-parse", "HEAD");
    put({ path: SIZE, text: JSON.stringify({ exempt: [], offenders: [{ codeLines: 319, path: "tools/gen.ts" }] }) });
    git("add", ".");
    git("commit", "-m", "widen");
  }, REAL_GIT_TIMEOUT_MS);

  afterAll(() => {
    rmSync(root, { force: true, recursive: true });
    rmSync(home, { force: true, recursive: true });
  });

  it(
    "refuses a bare run before reading anything",
    () => {
      expect(runDevBaselineBumpWithDeps({ argv: ["n", "s", "dev", "baseline-bump"], cwd: root, log })).toBe(EXIT_USAGE);
    },
    REAL_GIT_TIMEOUT_MS,
  );

  it(
    "previews a dry run and writes nothing, in the home or the tree",
    () => {
      const argv = ["n", "s", "dev", "baseline-bump", "--reason", "r", "--base", base, "--home", home, "--dry-run"];
      expect(runDevBaselineBumpWithDeps({ argv, cwd: root, log })).toBe(EXIT_OK);
      expect(existsSync(stateHomePaths({ home }).baselineBumps)).toBe(false);
      expect(existsSync(join(root, ".baselines/bumps"))).toBe(false);
    },
    REAL_GIT_TIMEOUT_MS,
  );

  it(
    "writes a record into the home under its own digest, with the widening derived, and nothing into the tree",
    () => {
      const argv = [
        "n",
        "s",
        "dev",
        "baseline-bump",
        "--reason",
        "tools/ joined the cap",
        "--base",
        base,
        "--home",
        home,
      ];
      expect(runDevBaselineBumpWithDeps({ argv, cwd: root, log })).toBe(EXIT_OK);
      const records = unwrap(readBumpRecords({ home }));
      expect(records.map((one) => one.path)).toEqual([
        `ledgers/baseline-bumps/${manifestFileName({ digest: digestOf({ base, rows }) })}`,
      ]);
      expect(records[0]!.manifest.loosenings).toEqual(rows);
      expect(records[0]!.manifest.reason).toBe("tools/ joined the cap");
      expect(existsSync(join(root, ".baselines/bumps"))).toBe(false);
      expect(git("status", "--porcelain")).toBe("");
      expect(
        lines.some((line) => line.startsWith("  slopweaver codex review --pass r3 --property-id baseline-bump-")),
      ).toBe(true);
    },
    REAL_GIT_TIMEOUT_MS,
  );

  it(
    "refuses a second declaration of the same rows against the same base, leaving the record's bytes as they were",
    () => {
      const path = join(stateHomePaths({ home }).baselineBumps, manifestFileName({ digest: digestOf({ base, rows }) }));
      const before = readFileSync(path, "utf8");
      const argv = ["n", "s", "dev", "baseline-bump", "--reason", "other words", "--base", base, "--home", home];
      expect(runDevBaselineBumpWithDeps({ argv, cwd: root, log })).toBe(EXIT_ERROR);
      expect(readFileSync(path, "utf8")).toBe(before);
      expect(lines.at(-1)).toBe(
        `baseline-bump: ledgers/baseline-bumps/${manifestFileName({ digest: digestOf({ base, rows }) })} already ` +
          "exists — the same rows are already declared against the same base",
      );
    },
    REAL_GIT_TIMEOUT_MS,
  );

  it(
    "says nothing is left to declare when HEAD loosens nothing",
    () => {
      const argv = ["n", "s", "dev", "baseline-bump", "--reason", "again", "--base", "HEAD", "--home", home];
      expect(runDevBaselineBumpWithDeps({ argv, cwd: root, log })).toBe(EXIT_EXPECTED_EMPTY);
    },
    REAL_GIT_TIMEOUT_MS,
  );
});
