/**
 * The `heap-ceiling-ratchet` shell against real temporary repositories: the base half reads the base
 * commit's own files through `git show`, so what it catches is only provable over a real commit.
 *
 * Assertions are about EXIT CODES and the text written. The writers are plain functions collecting
 * strings — a seam, not a mock.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { FLOOR_BASE_ENV } from "../../../devLint/gitAtCommit.js";
import { runHeapCeilingRatchet } from "../../../devLint/heapCeilingRatchetRun.js";
import { gitInTemp, REAL_GIT_TIMEOUT_MS } from "../../tempGitRepo.js";

const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** One well-formed raise of `build` from 10,240 to 12,288 MiB. */
const RAISE = {
  anchor: "talk:00000000-0000-0000-0000-000000000000",
  approvedIso: "2026-11-02T01:00:00Z",
  fromMiB: 10240,
  key: "package-script.build",
  recordedIso: "2026-11-02T01:05:00Z",
  toMiB: 12288,
};

/** The two lint-gate pins every fixture carries unchanged. */
const GATE_PINS = { "lint-gate.named-object-params": 8192, "named-object-params.budget": 6543 };

/**
 * Write the ceiling sources — both gate files and every manifest that pins TypeScript — and the pins file
 * into a directory.
 *
 * @param dir the repository
 * @param buildMiB the `build` script's ceiling
 * @param pinnedMiB what the pins file says `build` is
 * @param raises the raise records
 */
function writeTree({
  dir,
  buildMiB,
  pinnedMiB,
  raises,
}: {
  dir: string;
  buildMiB: number;
  pinnedMiB: number;
  raises: readonly unknown[];
}): void {
  const files: Record<string, string> = {
    ".baselines/heap-ceilings.json": JSON.stringify({
      ceilingsMiB: {
        "lint-gate.named-object-params": 8192,
        "named-object-params.budget": 6543,
        "package-script.build": pinnedMiB,
      },
      raises,
      schemaVersion: 1,
    }),
    "desktop/package.json": JSON.stringify({ scripts: { build: "tsc -p tsconfig.json" } }),
    "site/package.json": JSON.stringify({ scripts: { build: "next build" } }),
    "package.json": JSON.stringify({
      scripts: { build: `node --max-old-space-size=${String(buildMiB)} node_modules/typescript/bin/tsc -p x.json` },
    }),
    "src/devLint/gateGroups.ts": `export const g = [{ args: ["--max-old-space-size=8192", "a.ts"], name: "named-object-params" }];\n`,
    "src/devLint/namedObjectParamsHeap.ts": "export const HEAP_BUDGET_MIB = 6543;\n",
  };
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
}

/**
 * A repository whose one commit holds `build` at 10,240 MiB, pinned, with no raise records.
 *
 * @returns the directory and the base commit
 */
function baseRepo(): { dir: string; sha: string } {
  const dir = mkdtempSync(join(tmpdir(), "slopweaver-heap-"));
  fixtureDirs.push(dir);
  gitInTemp({ args: ["init", "-q"], cwd: dir });
  gitInTemp({ args: ["config", "user.email", "test@example.com"], cwd: dir });
  gitInTemp({ args: ["config", "user.name", "Test"], cwd: dir });
  writeTree({ buildMiB: 10240, dir, pinnedMiB: 10240, raises: [] });
  gitInTemp({ args: ["add", "-A"], cwd: dir });
  gitInTemp({ args: ["commit", "-qm", "base"], cwd: dir });
  return { dir, sha: gitInTemp({ args: ["rev-parse", "HEAD"], cwd: dir }) };
}

/**
 * Run the gate and collect what it wrote.
 *
 * @param dir the repository
 * @param env the environment the gate reads its base from
 * @returns its exit code and both streams
 */
function run({ dir, env }: { dir: string; env: NodeJS.ProcessEnv }): { code: number; out: string; err: string } {
  const out: string[] = [];
  const err: string[] = [];
  const code = runHeapCeilingRatchet({
    env,
    root: dir,
    writeErr: ({ text }) => err.push(text),
    writeOut: ({ text }) => out.push(text),
  });
  return { code, err: err.join(""), out: out.join("") };
}

describe("heap-ceiling-ratchet shell", () => {
  it(
    "refuses a raise whose pin moved with it but carries no record of the owner's word",
    () => {
      const { dir, sha } = baseRepo();
      writeTree({ buildMiB: 12288, dir, pinnedMiB: 12288, raises: [] });
      const result = run({ dir, env: { [FLOOR_BASE_ENV]: sha } });
      expect(result.code).toBe(1);
      expect(result.err).toContain(
        "`package-script.build` rises to 12288 MiB (10240 MiB at the base) with no raise record appended for the owner's word",
      );
    },
    REAL_GIT_TIMEOUT_MS,
  );

  it(
    "passes the same raise once a record is appended, and names the base it judged against",
    () => {
      const { dir, sha } = baseRepo();
      writeTree({ buildMiB: 12288, dir, pinnedMiB: 12288, raises: [RAISE] });
      const result = run({ dir, env: { [FLOOR_BASE_ENV]: sha } });
      expect(result.code).toBe(0);
      expect(result.out).toBe(
        `heap-ceiling-ratchet: clean (3 ceiling(s) match .baselines/heap-ceilings.json; no unwitnessed raise against ${sha})\n`,
      );
    },
    REAL_GIT_TIMEOUT_MS,
  );

  it(
    "with a brand-new ref's all-zeroes base, still refuses a ceiling its pin disagrees with",
    () => {
      const { dir } = baseRepo();
      writeTree({ buildMiB: 12288, dir, pinnedMiB: 10240, raises: [] });
      const result = run({ dir, env: { [FLOOR_BASE_ENV]: "0".repeat(40) } });
      expect(result.code).toBe(1);
      expect(result.err).toContain(
        "`package-script.build` is 12288 MiB in the tree and .baselines/heap-ceilings.json pins it at 10240",
      );
    },
    REAL_GIT_TIMEOUT_MS,
  );

  it(
    "is incomplete, never clean, when no base was supplied, and names the command that supplies one",
    () => {
      const { dir } = baseRepo();
      const result = run({ dir, env: {} });
      expect(result.code).toBe(1);
      expect(result.out).toBe("");
      expect(result.err).toBe(
        `heap-ceiling-ratchet: incomplete — no ${FLOOR_BASE_ENV} in the environment, so nothing was compared — ` +
          `run \`git fetch origin main\`, then re-run with \`${FLOOR_BASE_ENV}=$(git merge-base origin/main HEAD)\` ` +
          "in front of the command\n",
      );
    },
    REAL_GIT_TIMEOUT_MS,
  );

  it(
    "with no base supplied, still prints the head half's pin finding beside the incomplete line",
    () => {
      const { dir } = baseRepo();
      writeTree({ buildMiB: 12288, dir, pinnedMiB: 10240, raises: [] });
      const result = run({ dir, env: {} });
      expect(result.code).toBe(1);
      expect(result.err).toContain(
        "`package-script.build` is 12288 MiB in the tree and .baselines/heap-ceilings.json pins it at 10240",
      );
      expect(result.err).toContain(`heap-ceiling-ratchet: incomplete — no ${FLOOR_BASE_ENV} in the environment`);
    },
    REAL_GIT_TIMEOUT_MS,
  );

  it(
    "refuses a flag dropped from a script that still runs, with its pin deleted to match",
    () => {
      const { dir, sha } = baseRepo();
      const pins = { "lint-gate.named-object-params": 8192, "named-object-params.budget": 6543 };
      writeFileSync(
        join(dir, ".baselines/heap-ceilings.json"),
        JSON.stringify({ ceilingsMiB: pins, raises: [], schemaVersion: 1 }),
      );
      writeFileSync(join(dir, "package.json"), JSON.stringify({ scripts: { build: "node x.js" } }));
      const result = run({ dir, env: { [FLOOR_BASE_ENV]: sha } });
      expect(result.code).toBe(1);
      expect(result.err).toContain(
        "`package-script.build` drops its 10240 MiB ceiling, so it runs at V8's own default, which no pin bounds",
      );
    },
    REAL_GIT_TIMEOUT_MS,
  );

  it(
    "passes a V8 ceiling moved onto the owner at the same number, and refuses one a MiB above it",
    () => {
      const { dir, sha } = baseRepo();
      const owned = ({ mib }: { mib: number }): void => {
        const pins = {
          "lint-gate.named-object-params": 8192,
          "named-object-params.budget": 6543,
          "package-script.build.process-tree-rss": mib,
        };
        writeFileSync(
          join(dir, ".baselines/heap-ceilings.json"),
          JSON.stringify({ ceilingsMiB: pins, raises: [], schemaVersion: 1 }),
        );
        const build = `bash scripts/tsc-owner.sh --timeout-seconds 1140 --grace-seconds 5 --rss-ceiling-mib ${String(mib)} -- node_modules/.bin/tsc -p x.json`;
        writeFileSync(join(dir, "package.json"), JSON.stringify({ scripts: { build } }));
      };
      owned({ mib: 10240 });
      expect(run({ dir, env: { [FLOOR_BASE_ENV]: sha } }).code).toBe(0);
      owned({ mib: 10241 });
      const raised = run({ dir, env: { [FLOOR_BASE_ENV]: sha } });
      expect(raised.code).toBe(1);
      expect(raised.err).toContain(
        "`package-script.build.process-tree-rss` rises to 10241 MiB (10240 MiB at the base) with no raise record appended for the owner's word",
      );
    },
    REAL_GIT_TIMEOUT_MS,
  );

  it(
    "refuses a script moved back off the owner onto a lower V8 flag, since its RSS bound is dropped (Codex 8b r1)",
    () => {
      const { dir } = baseRepo();
      const pinsAt = ({ pins }: { pins: Record<string, number> }): void =>
        writeFileSync(
          join(dir, ".baselines/heap-ceilings.json"),
          JSON.stringify({ ceilingsMiB: { ...GATE_PINS, ...pins }, raises: [], schemaVersion: 1 }),
        );
      const owned =
        "bash scripts/tsc-owner.sh --timeout-seconds 1140 --grace-seconds 5 --rss-ceiling-mib 10240 -- node_modules/.bin/tsc -p x.json";
      pinsAt({ pins: { "package-script.build.process-tree-rss": 10240 } });
      writeFileSync(join(dir, "package.json"), JSON.stringify({ scripts: { build: owned } }));
      gitInTemp({ args: ["commit", "-qam", "owned"], cwd: dir });
      const sha = gitInTemp({ args: ["rev-parse", "HEAD"], cwd: dir });
      pinsAt({ pins: { "package-script.build": 4096 } });
      const v8 = "node --max-old-space-size=4096 node_modules/typescript/bin/tsc -p x.json";
      writeFileSync(join(dir, "package.json"), JSON.stringify({ scripts: { build: v8 } }));
      const result = run({ dir, env: { [FLOOR_BASE_ENV]: sha } });
      expect(result.code).toBe(1);
      expect(result.err).toContain("`package-script.build.process-tree-rss` drops its 10240 MiB ceiling");
    },
    REAL_GIT_TIMEOUT_MS,
  );

  it(
    "is incomplete, never clean, when a manifest that pins TypeScript is missing",
    () => {
      const { dir } = baseRepo();
      rmSync(join(dir, "site/package.json"));
      const result = run({ dir, env: {} });
      expect(result.code).toBe(1);
      expect(result.err).toContain("heap-ceiling-ratchet: incomplete — ");
      expect(result.err).toContain("site/package.json");
    },
    REAL_GIT_TIMEOUT_MS,
  );

  it(
    "is incomplete, never clean, when the base commit is not in the checkout",
    () => {
      const { dir } = baseRepo();
      const missing = "a".repeat(40);
      const result = run({ dir, env: { [FLOOR_BASE_ENV]: missing } });
      expect(result.code).toBe(1);
      expect(result.err).toBe(
        `heap-ceiling-ratchet: incomplete — the base commit ${missing} is not in this checkout — fetch it\n`,
      );
    },
    REAL_GIT_TIMEOUT_MS,
  );

  it(
    "bootstraps from a base with no pins file, judging against the base's own ceilings",
    () => {
      const { dir } = baseRepo();
      gitInTemp({ args: ["rm", "-q", ".baselines/heap-ceilings.json"], cwd: dir });
      gitInTemp({ args: ["commit", "-qm", "no pins"], cwd: dir });
      const sha = gitInTemp({ args: ["rev-parse", "HEAD"], cwd: dir });
      writeTree({ buildMiB: 10240, dir, pinnedMiB: 10240, raises: [] });
      const result = run({ dir, env: { [FLOOR_BASE_ENV]: sha } });
      expect(result.code).toBe(0);
      expect(result.out).toContain(`no unwitnessed raise against ${sha}`);
    },
    REAL_GIT_TIMEOUT_MS,
  );
});
