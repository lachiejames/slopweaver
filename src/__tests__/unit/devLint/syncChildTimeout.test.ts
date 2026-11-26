/**
 * The sync-child-timeout gate's criterion: a synchronous child-process call carries its own `timeout`.
 *
 * Red on main by construction — the gate does not exist there, so this file cannot even import it — and
 * green here. The negative cases matter as much as the positive ones: a shape the gate wrongly flags is a
 * correct call somebody has to bend, and a shape it wrongly passes is the hung seat it exists to prevent.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  isScannablePath,
  judgeAgainstDebt,
  parseSyncChildTimeoutBaseline,
  scanSyncChildTimeout,
} from "../../../devLint/syncChildTimeout.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

const DEBT = unwrap(
  parseSyncChildTimeoutBaseline({
    text: readFileSync(
      fileURLToPath(new URL("../../../../.baselines/sync-child-timeout-baseline.json", import.meta.url)),
      "utf8",
    ),
  }),
);

/** Scan a snippet as an ordinary production source file, answering `line:api` per hit. */
function hits({ content, path = "src/example.ts" }: { content: string; path?: string }): readonly string[] {
  return scanSyncChildTimeout({ content, path }).map((hit) => `${String(hit.line)}:${hit.api}`);
}

const NAMED = 'import { execFileSync, execSync, spawnSync } from "node:child_process";\n';

describe("scanSyncChildTimeout: what it refuses", () => {
  it("refuses each of the three launchers when no options object is passed at all", () => {
    const content = `${NAMED}execFileSync("tool", ["status"]);\nexecSync("ls");\nspawnSync("tool", ["push"]);\n`;
    expect(hits({ content })).toEqual(["2:execFileSync", "3:execSync", "4:spawnSync"]);
  });

  it("refuses an options literal that sets everything but a timeout — the keychain read's own shape", () => {
    const content = `${NAMED}execFileSync("security", ["find-generic-password", "-w"], { encoding: "utf8" });\n`;
    expect(hits({ content })).toEqual(["2:execFileSync"]);
  });

  it("refuses `timeout: 0` and `timeout: undefined`, which Node reads as no bound at all", () => {
    const content =
      `${NAMED}spawnSync("tool", ["push"], { stdio: "inherit", timeout: 0 });\n` +
      'execSync("ls", { timeout: undefined });\n';
    expect(hits({ content })).toEqual(["2:spawnSync", "3:execSync"]);
  });

  // A shorthand `timeout` was read as bounded without evaluating the name it carries.
  it("refuses a shorthand or named `timeout` whose same-file const evaluates to zero or undefined", () => {
    const content =
      `${NAMED}const timeout = 0;\nspawnSync("node", ["-e", "setInterval(() => {}, 1000)"], { timeout });\n` +
      'const NONE = undefined;\nconst ZERO = 2 * 0;\nexecFileSync("tool", [], { timeout: NONE });\nexecSync("ls", { timeout: ZERO });\n';
    expect(hits({ content })).toEqual(["3:spawnSync", "6:execFileSync", "7:execSync"]);
  });

  // `%` fell to "decided elsewhere" and was trusted, though this file decides it is zero.
  it("refuses every operator and short-circuit that this file evaluates to zero, undefined or a negative", () => {
    const content =
      `${NAMED}execFileSync("tool", [], { timeout: 1 % 1 });\nexecFileSync("tool", [], { timeout: 0 ** 2 });\n` +
      'execFileSync("tool", [], { timeout: 0 || undefined });\nexecFileSync("tool", [], { timeout: void 0 });\n' +
      'execFileSync("tool", [], { timeout: -(2 * 1_000) });\nexecFileSync("tool", [], { timeout: 5_000 && 0 });\n';
    expect(hits({ content })).toEqual([
      "2:execFileSync",
      "3:execFileSync",
      "4:execFileSync",
      "5:execFileSync",
      "6:execFileSync",
      "7:execFileSync",
    ]);
  });

  it("refuses a same-file value it cannot read as a number: a string, a boolean, null, a template, a bit operator", () => {
    const content =
      `${NAMED}execFileSync("tool", [], { timeout: "5000" });\nexecFileSync("tool", [], { timeout: true });\n` +
      'execFileSync("tool", [], { timeout: null });\nexecFileSync("tool", [], { timeout: `${1}` });\n' +
      'execFileSync("tool", [], { timeout: 1 << 0 });\nexecFileSync("tool", [], { timeout: NaN });\n';
    expect(hits({ content })).toEqual([
      "2:execFileSync",
      "3:execFileSync",
      "4:execFileSync",
      "5:execFileSync",
      "6:execFileSync",
      "7:execFileSync",
    ]);
  });

  it("refuses a value one branch of which this file leaves unbounded, and a zero read off its own object", () => {
    const content =
      `${NAMED}function f(fast: boolean, ms: number) {\n` +
      '  execFileSync("tool", [], { timeout: fast ? 5_000 : 0 });\n  execFileSync("tool", [], { timeout: ms || 0 });\n}\n' +
      'const LIMITS = { git: 0 };\nexecFileSync("tool", [], { timeout: LIMITS.git });\n' +
      'execFileSync("tool", [], { timeout: LIMITS["git"] });\nexecFileSync("tool", [], { timeout: [0][0] });\n' +
      'function g(ms: number) {\n  return execFileSync("tool", [], { timeout: ms * 0 });\n}\n';
    expect(hits({ content })).toEqual([
      "3:execFileSync",
      "4:execFileSync",
      "7:execFileSync",
      "8:execFileSync",
      "9:execFileSync",
      "11:execFileSync",
    ]);
  });

  // A destructured const was read as "decided elsewhere" and trusted, though its source is a literal here.
  it("refuses a destructured const or a nested read that this file's own literal leaves at zero", () => {
    const content =
      `${NAMED}const { timeout } = { timeout: 0 };\nexecFileSync("tool", [], { timeout });\n` +
      'const { git: ms = 5_000 } = { git: 0 };\nexecFileSync("tool", [], { timeout: ms });\n' +
      'const { absent = 0 } = {};\nexecFileSync("tool", [], { timeout: absent });\n' +
      'const C = { limits: { git: 0 } };\nexecFileSync("tool", [], { timeout: C.limits.git });\n' +
      'const { limits: { git } } = C;\nexecFileSync("tool", [], { timeout: git });\n';
    expect(hits({ content })).toEqual([
      "3:execFileSync",
      "5:execFileSync",
      "7:execFileSync",
      "9:execFileSync",
      "11:execFileSync",
    ]);
  });

  it("refuses an aliased import, a namespace import and a default import alike", () => {
    const content =
      'import { execFileSync as run } from "child_process";\n' +
      'import * as cp from "node:child_process";\n' +
      'import childProcess from "node:child_process";\n' +
      'run("tool", ["fetch"]);\ncp.spawnSync("tool", ["push"]);\nchildProcess.execSync("gh auth token");\n';
    expect(hits({ content })).toEqual(["4:execFileSync", "5:spawnSync", "6:execSync"]);
  });

  it("refuses options passed by a name the file does not bind to a literal carrying a timeout", () => {
    const content = `${NAMED}function f(opts: object) {\n  return execFileSync("tool", ["status"], opts);\n}\n`;
    expect(hits({ content })).toEqual(["3:execFileSync"]);
  });

  it("refuses a spread of options that carry no timeout of their own", () => {
    const content = `${NAMED}const base = { encoding: "utf8" } as const;\nexecFileSync("tool", ["log"], { ...base });\n`;
    expect(hits({ content })).toEqual(["3:execFileSync"]);
  });

  // Property order is the bound: the LAST word on `timeout` is the one Node reads.
  it("refuses a bounded spread overridden by a later `timeout: 0`", () => {
    const content = `${NAMED}const bounded = { timeout: 5_000 };\nexecFileSync("tool", ["log"], { ...bounded, timeout: 0 });\n`;
    expect(hits({ content })).toEqual(["3:execFileSync"]);
  });

  it("refuses a timeout followed by a spread it cannot see into, which could overwrite it", () => {
    const content = `${NAMED}function f(rest: object) {\n  return execFileSync("tool", [], { timeout: 5_000, ...rest });\n}\n`;
    expect(hits({ content })).toEqual(["3:execFileSync"]);
  });

  it("refuses options bound by `let`, by an import, or to something that is not an object literal", () => {
    const content =
      `${NAMED}import { SHARED } from "./shared.js";\n` +
      "let mutable = { timeout: 5_000 };\nconst built = makeOptions();\n" +
      'execFileSync("tool", [], mutable);\nexecFileSync("tool", [], SHARED);\nexecFileSync("tool", [], built);\n';
    expect(hits({ content })).toEqual(["5:execFileSync", "6:execFileSync", "7:execFileSync"]);
  });

  it("refuses a later conditional spread where one branch could zero the bound", () => {
    const content =
      `${NAMED}function f(fast: boolean) {\n` +
      '  return execFileSync("tool", [], { timeout: 5_000, ...(fast ? { timeout: 0 } : {}) });\n}\n';
    expect(hits({ content })).toEqual(["3:execFileSync"]);
  });

  it("scans TSX, where the console's own child processes live", () => {
    const content = `${NAMED}export const x = <div>{String(execFileSync("ps", ["-o", "args="]))}</div>;\n`;
    expect(hits({ content, path: "site/app/page.tsx" })).toEqual(["2:execFileSync"]);
  });
});

describe("scanSyncChildTimeout: what it leaves alone", () => {
  it("passes a call whose options literal declares a timeout, written out or as shorthand", () => {
    const content =
      `${NAMED}execFileSync("tool", ["status"], { encoding: "utf8", timeout: GIT_TIMEOUT_MS });\n` +
      'const timeout = 5_000;\nspawnSync("tool", ["push"], { stdio: "inherit", timeout });\n';
    expect(hits({ content })).toEqual([]);
  });

  it("passes a same-file const that evaluates positive, and trusts a value decided in another module", () => {
    const content =
      `${NAMED}import { SHARED_TIMEOUT_MS } from "./shared.js";\nconst READ_MS = 2 * 60_000;\n` +
      'execFileSync("tool", [], { timeout: READ_MS });\nfunction f(ms: number) {\n  return spawnSync("tool", [], { timeout: ms });\n}\n' +
      'execSync("ls", { timeout: SHARED_TIMEOUT_MS });\n';
    expect(hits({ content })).toEqual([]);
  });

  it("passes a positive value this file decides through a branch, a default, a remainder or its own object", () => {
    const content =
      `${NAMED}import { configured } from "./config.js";\nconst LIMITS = { git: 2 * 60_000 };\n` +
      'function f(fast: boolean, ms: number) {\n  execFileSync("tool", [], { timeout: fast ? 5_000 : 10_000 });\n' +
      '  execFileSync("tool", [], { timeout: ms ?? 5_000 });\n  execFileSync("tool", [], { timeout: configured() });\n}\n' +
      'execFileSync("tool", [], { timeout: LIMITS.git });\nexecFileSync("tool", [], { timeout: 7 % 5 });\n';
    expect(hits({ content })).toEqual([]);
  });

  it("passes a destructured or nested positive bound, and trusts one destructured from a value decided elsewhere", () => {
    const content =
      `${NAMED}import { LIMITS } from "./limits.js";\nconst { timeout } = { timeout: 5_000 };\n` +
      'execFileSync("tool", [], { timeout });\nconst { absent = 5_000 } = {};\nexecFileSync("tool", [], { timeout: absent });\n' +
      'const C = { limits: { git: 60_000 } };\nexecFileSync("tool", [], { timeout: C.limits["git"] });\n' +
      'const { git } = LIMITS;\nexecFileSync("tool", [], { timeout: git });\n' +
      'function f(opts: { ms: number }) {\n  const { ms } = opts;\n  return execFileSync("tool", [], { timeout: ms });\n}\n';
    expect(hits({ content })).toEqual([]);
  });

  // The named blind spot : Node ignores the fourth argument, the gate does not.
  it("passes an extra argument's bound past the options Node reads — a blind spot TypeScript itself refuses", () => {
    const content = `${NAMED}execFileSync("tool", [], { timeout: 0 }, { timeout: 5_000 });\n`;
    expect(hits({ content })).toEqual([]);
  });

  it("passes options bound to a const whose literal declares a timeout, directly or spread", () => {
    const content =
      `${NAMED}const options = { cwd: "/r", timeout: 120_000 };\n` +
      'execFileSync("tool", ["ls-remote"], options);\nexecFileSync("tool", ["fetch"], { ...options, encoding: "utf8" });\n';
    expect(hits({ content })).toEqual([]);
  });

  it("leaves a local function that merely shares a launcher's name alone, since it is not the import", () => {
    const content = 'function spawnSync(x: string): string {\n  return x;\n}\nspawnSync("tool");\n';
    expect(hits({ content })).toEqual([]);
  });

  it("leaves an inner binding that shadows the imported launcher alone, since the call reaches the binding", () => {
    const content =
      `${NAMED}function run(execFileSync: (file: string) => string) {\n  return execFileSync("tool");\n}\n` +
      'function other() {\n  const spawnSync = (file: string) => file;\n  return spawnSync("tool");\n}\n';
    expect(hits({ content })).toEqual([]);
  });

  it("passes a timeout written after a spread it cannot see into, because the later member wins", () => {
    const content = `${NAMED}function f(rest: object) {\n  return execFileSync("tool", [], { ...rest, timeout: 5_000 });\n}\n`;
    expect(hits({ content })).toEqual([]);
  });

  // The cmux sidebar's own shape: an optional `input` spread in after the bound.
  it("passes a later conditional spread whose branches both leave the timeout alone", () => {
    const content =
      `${NAMED}function f(stdin?: string) {\n` +
      '  return execFileSync("cmux", [], { timeout: 5_000, ...(stdin === undefined ? {} : { input: stdin }) });\n}\n';
    expect(hits({ content })).toEqual([]);
  });

  it("leaves the asynchronous launchers alone: they free the event loop for a watchdog", () => {
    const content =
      'import { execFile, spawn } from "node:child_process";\nspawn("tool", ["push"]);\nexecFile("gh", []);\n';
    expect(hits({ content })).toEqual([]);
  });

  it("leaves a call carrying the reviewed exemption marker, with its reason, on the line above", () => {
    const content =
      `${NAMED}// sync-child-timeout-exempt: a foreground watch that runs until the owner interrupts it\n` +
      'execFileSync("node", ["watch"], { stdio: "inherit" });\n';
    expect(hits({ content })).toEqual([]);
  });

  it("still refuses under a bare marker, because the reason is what a reviewer checks", () => {
    const content = `${NAMED}// sync-child-timeout-exempt:\nexecFileSync("node", ["watch"], { stdio: "inherit" });\n`;
    expect(hits({ content })).toEqual(["3:execFileSync"]);
  });
});

describe("judgeAgainstDebt", () => {
  const hit = ({ path, line }: { path: string; line: number }) => ({ api: "execFileSync" as const, line, path });

  it("passes a file whose count matches its entry, wherever in the file the calls moved to", () => {
    const verdict = judgeAgainstDebt({
      debt: [{ count: 2, path: "src/a.ts" }],
      hits: [hit({ line: 9, path: "src/a.ts" }), hit({ line: 40, path: "src/a.ts" })],
    });
    expect(verdict).toEqual({ fresh: [], invalid: [], stale: [] });
  });

  it("refuses every call in a file that grew past its entry, and every call in a file with none", () => {
    const verdict = judgeAgainstDebt({
      debt: [{ count: 1, path: "src/a.ts" }],
      hits: [
        hit({ line: 1, path: "src/a.ts" }),
        hit({ line: 2, path: "src/a.ts" }),
        hit({ line: 3, path: "src/b.ts" }),
      ],
    });
    expect(verdict.fresh.map((one) => `${one.path}:${String(one.line)}`)).toEqual([
      "src/a.ts:1",
      "src/a.ts:2",
      "src/b.ts:3",
    ]);
    expect(verdict.stale).toEqual([]);
  });

  it("refuses an entry larger than what the file still holds, so the list can only shrink", () => {
    const verdict = judgeAgainstDebt({
      debt: [
        { count: 2, path: "src/a.ts" },
        { count: 1, path: "src/gone.ts" },
      ],
      hits: [hit({ line: 1, path: "src/a.ts" })],
    });
    expect(verdict.fresh).toEqual([]);
    expect(verdict.stale).toEqual(["src/a.ts: recorded 2, found 1", "src/gone.ts: recorded 1, found 0"]);
  });

  // A zero never goes stale and a repeated path is summed, so either would let an entry outlive its debt.
  it("refuses a malformed list: a non-positive count, a path listed twice, a path out of order", () => {
    const verdict = judgeAgainstDebt({
      debt: [
        { count: 0, path: "src/b.ts" },
        { count: 1, path: "src/a.ts" },
        { count: 1, path: "src/a.ts" },
      ],
      hits: [hit({ line: 1, path: "src/a.ts" }), hit({ line: 2, path: "src/a.ts" })],
    });
    expect(verdict.invalid).toEqual([
      "src/b.ts: count 0 is not a positive integer",
      "src/a.ts: out of path order (after src/b.ts)",
      "src/a.ts: listed more than once",
    ]);
  });
});

describe("parseSyncChildTimeoutBaseline", () => {
  it("decodes a well-formed list into its rows, each keeping its reason", () => {
    const row = { count: 2, path: "src/a.ts", reason: "a build whose ceiling is unmeasured" };

    expect(unwrap(parseSyncChildTimeoutBaseline({ text: JSON.stringify({ files: [row] }) }))).toEqual([row]);
  });

  it("names a file that is not JSON as malformed", () => {
    expect(unwrapErr(parseSyncChildTimeoutBaseline({ text: "[" })).code).toBe("BASELINE_MALFORMED");
  });

  it("refuses a row carrying a field the gate does not read, rather than dropping it", () => {
    const row = { count: 1, path: "src/a.ts", reason: "r", tightenedAt: "x" };

    expect(unwrapErr(parseSyncChildTimeoutBaseline({ text: JSON.stringify({ files: [row] }) })).code).toBe(
      "BASELINE_SHAPE_INVALID",
    );
  });

  it("refuses a row with a blank reason as the wrong shape, so an entry cannot lose why it is unbounded", () => {
    const error = unwrapErr(
      parseSyncChildTimeoutBaseline({ text: JSON.stringify({ files: [{ count: 1, path: "src/a.ts", reason: " " }] }) }),
    );

    expect(error.code).toBe("BASELINE_SHAPE_INVALID");
    expect(error.message).toContain("{ files: [{ path, count, reason }, …] }");
  });
});

describe("the committed debt list", () => {
  it("is non-empty, so the per-entry checks below are about real rows", () => {
    expect(DEBT.length).toBeGreaterThan(0);
  });

  it("holds 14 calls across 11 files", () => {
    expect(DEBT.length).toBe(11);
    expect(DEBT.reduce((sum, entry) => sum + entry.count, 0)).toBe(14);
  });

  it("is well formed — one row per path, positive counts, path order — and inside the gate's own scope", () => {
    expect(judgeAgainstDebt({ debt: DEBT, hits: [] }).invalid).toEqual([]);
    expect(DEBT.filter((entry) => !isScannablePath({ path: entry.path }))).toEqual([]);
  });
});

describe("isScannablePath", () => {
  it("covers production code in every tree that starts a child process", () => {
    expect(isScannablePath({ path: "src/browser/cookieJar.ts" })).toBe(true);
    expect(isScannablePath({ path: "desktop/src/makeSystemAudioPermission.ts" })).toBe(true);
    expect(isScannablePath({ path: "site/app/api/console/call/route.ts" })).toBe(true);
  });

  it("leaves tests and this gate's own files out", () => {
    expect(isScannablePath({ path: "src/__tests__/subprocess/cli/x.test.ts" })).toBe(false);
    expect(isScannablePath({ path: "src/__tests__/tempGitRepo.ts" })).toBe(false);
    expect(isScannablePath({ path: "site/components/Panel.test.tsx" })).toBe(false);
    expect(isScannablePath({ path: "src/devLint/syncChildTimeout.ts" })).toBe(false);
  });
});
