/**
 * `fleet restore-policy`: the exit codes, and `--apply`'s file effects for real — a backup beside the config, the
 * original mode kept, a symlink, a hard link, non-UTF-8 bytes, a byte-order mark and an absent file refused — over a
 * throwaway directory. Only the clock, the
 * `cmux reload-config` call and the two output channels are swapped, as plain fakes.
 */
import {
  chmodSync,
  linkSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { productionRestorePolicyDeps } from "../../../../../cli/commands/fleet/restorePolicyDeps.js";
import {
  backupStamp,
  type RestorePolicyDeps,
  runFleetRestorePolicy,
} from "../../../../../cli/commands/fleet/restorePolicyRun.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { err, ok, type Result } from "../../../../../lib/result.js";

/** A local-time instant, so the backup stamp is the same in every timezone. */
const NOW = new Date(2026, 9, 11, 14, 5, 9);

const ON_BY_DEFAULT = '{\n  // their comment\n  "terminal": {\n    "agentHibernation": { "enabled": false }\n  }\n}\n';

let dir = "";

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "restore-policy-"));
});

afterEach(() => {
  rmSync(dir, { force: true, recursive: true });
});

/** Real file effects, fake clock, fake cmux, captured output. */
function harness({ reload }: { reload: Result<string, string> }): {
  deps: RestorePolicyDeps;
  out: string[];
  diagnostics: string[];
  reloads: number[];
} {
  const out: string[] = [];
  const diagnostics: string[] = [];
  const reloads: number[] = [];
  const deps: RestorePolicyDeps = {
    ...productionRestorePolicyDeps(),
    defaultConfigPath: () => join(dir, "cmux.json"),
    now: () => NOW,
    reloadConfig: () => {
      reloads.push(1);
      return reload;
    },
    writeDiagnostic: (line) => {
      diagnostics.push(line);
    },
    writeOut: (line) => {
      out.push(line);
    },
  };
  return { deps, diagnostics, out, reloads };
}

/** Write a config at mode 0600, as the owner's is. */
function writeConfig({ text }: { text: string }): string {
  const path = join(dir, "cmux.json");
  writeFileSync(path, text);
  chmodSync(path, 0o600);
  return path;
}

describe("backupStamp", () => {
  it("is YYYYMMDD-HHMMSS in local time", () => {
    expect(backupStamp({ date: NOW })).toBe("20261011-140509");
  });
});

describe("fleet restore-policy (read)", () => {
  it("exits 3 when cmux's default leaves it on", () => {
    const path = writeConfig({ text: ON_BY_DEFAULT });
    const run = harness({ reload: ok("") });
    expect(runFleetRestorePolicy({ deps: run.deps, rest: ["--config", path, "--json"] })).toBe(EXIT_EXPECTED_EMPTY);
    expect(run.out).toEqual([JSON.stringify({ configPath: path, policy: "on-default", wrote: false })]);
  });

  it("says the default leaves it on, costing a token seat its token", () => {
    const path = writeConfig({ text: ON_BY_DEFAULT });
    const run = harness({ reload: ok("") });
    runFleetRestorePolicy({ deps: run.deps, rest: ["--config", path] });
    expect(run.out).toEqual([
      `cmux restore policy: on, cmux's default (no autoResumeAgentSessions key in ${path}) — cmux relaunches Claude seats bare, so a seat on a setup token comes back without it; slopweaver fleet restore-policy --apply turns it off`,
    ]);
  });

  it("says an explicit true leaves it on, costing a token seat its token", () => {
    const path = writeConfig({ text: '{ "terminal": { "autoResumeAgentSessions": true } }' });
    const run = harness({ reload: ok("") });
    runFleetRestorePolicy({ deps: run.deps, rest: ["--config", path] });
    expect(run.out).toEqual([
      `cmux restore policy: on, set true in ${path} — cmux relaunches Claude seats bare, so a seat on a setup token comes back without it; slopweaver fleet restore-policy --apply turns it off`,
    ]);
  });

  it("exits 0 when it is off", () => {
    const path = writeConfig({ text: '{ "terminal": { "autoResumeAgentSessions": false } }' });
    const run = harness({ reload: ok("") });
    expect(runFleetRestorePolicy({ deps: run.deps, rest: ["--config", path] })).toBe(EXIT_OK);
    expect(run.out[0]).toContain("cmux restore policy: off");
  });

  it("exits 1 on a shape it will not read", () => {
    const path = writeConfig({ text: '{ "terminal": [] }' });
    const run = harness({ reload: ok("") });
    expect(runFleetRestorePolicy({ deps: run.deps, rest: ["--config", path] })).toBe(EXIT_ERROR);
    expect(run.diagnostics[0]).toContain('"terminal" is not an object');
  });

  it("reads an absent file as cmux's default, on", () => {
    const run = harness({ reload: ok("") });
    expect(runFleetRestorePolicy({ deps: run.deps, rest: [] })).toBe(EXIT_EXPECTED_EMPTY);
    expect(run.out[1]).toBe(
      `  (no config file at ${join(dir, "cmux.json")}; cmux writes its template there on launch)`,
    );
  });

  it("refuses a positional argument as a usage error", () => {
    const run = harness({ reload: ok("") });
    expect(runFleetRestorePolicy({ deps: run.deps, rest: ["stray"] })).toBe(EXIT_USAGE);
  });
});

describe("fleet restore-policy --apply", () => {
  it("writes the edit, backs the original up beside it, keeps 0600 and reloads cmux", () => {
    const path = writeConfig({ text: ON_BY_DEFAULT });
    const run = harness({ reload: ok("OK\n") });
    expect(runFleetRestorePolicy({ deps: run.deps, rest: ["--apply", "--config", path, "--json"] })).toBe(EXIT_OK);
    const backupPath = `${path}.20261011-140509.bak`;
    expect(run.out).toEqual([
      JSON.stringify({
        backupPath,
        configPath: path,
        policy: "off",
        reload: { kind: "reloaded", output: "OK" },
        wrote: true,
      }),
    ]);
    expect(readFileSync(backupPath, "utf8")).toBe(ON_BY_DEFAULT);
    expect(readFileSync(path, "utf8")).toContain('    "autoResumeAgentSessions": false,\n    "agentHibernation"');
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(statSync(backupPath).mode & 0o777).toBe(0o600);
    expect(run.reloads).toEqual([1]);
  });

  it("still exits 0 when cmux reload-config fails, and says so", () => {
    const path = writeConfig({ text: ON_BY_DEFAULT });
    const run = harness({ reload: err("cmux: not running") });
    expect(runFleetRestorePolicy({ deps: run.deps, rest: ["--apply", "--config", path] })).toBe(EXIT_OK);
    expect(run.out).toContain(
      "  cmux reload-config did not run (cmux: not running); nothing lost — the policy is read at launch",
    );
    expect(run.out[1]).toContain("takes effect at the next cmux launch");
    expect(run.out[2]).toContain("apply it only once that build is on main");
  });

  it("never pokes the live cmux when --config names a file cmux does not read", () => {
    const path = join(dir, "copy.json");
    writeFileSync(path, ON_BY_DEFAULT);
    const run = harness({ reload: ok("") });
    expect(runFleetRestorePolicy({ deps: run.deps, rest: ["--apply", "--config", path] })).toBe(EXIT_OK);
    expect(run.reloads).toEqual([]);
    expect(run.out).toContain("  cmux reload-config skipped: --config names a file cmux does not read");
  });

  it("writes nothing and makes no backup when the policy is already off", () => {
    const text = '{ "terminal": { "autoResumeAgentSessions": false } }';
    const path = writeConfig({ text });
    const run = harness({ reload: ok("") });
    expect(runFleetRestorePolicy({ deps: run.deps, rest: ["--apply", "--config", path] })).toBe(EXIT_OK);
    expect(readdirSync(dir)).toEqual(["cmux.json"]);
    expect(run.reloads).toEqual([]);
  });

  it("refuses a symlink and leaves its target alone", () => {
    const target = writeConfig({ text: ON_BY_DEFAULT });
    const link = join(dir, "linked.json");
    symlinkSync(target, link);
    const run = harness({ reload: ok("") });
    expect(runFleetRestorePolicy({ deps: run.deps, rest: ["--apply", "--config", link] })).toBe(EXIT_ERROR);
    expect(run.diagnostics[0]).toContain(`${link} is a symlink`);
    expect(readFileSync(target, "utf8")).toBe(ON_BY_DEFAULT);
  });

  it("refuses an absent file, naming the file to create", () => {
    const path = join(dir, "cmux.json");
    const run = harness({ reload: ok("") });
    expect(runFleetRestorePolicy({ deps: run.deps, rest: ["--apply", "--config", path] })).toBe(EXIT_ERROR);
    expect(run.diagnostics[0]).toContain(`no cmux config at ${path}: create it`);
    expect(readdirSync(dir)).toEqual([]);
  });

  it("restores the backup, mode and all, when the written file does not re-read as off", () => {
    const path = writeConfig({ text: ON_BY_DEFAULT });
    chmodSync(path, 0o664);
    const run = harness({ reload: ok("") });
    const deps: RestorePolicyDeps = {
      ...run.deps,
      // A writer that lands something other than the plan: the re-read must catch it and put the original back.
      writeText: ({ path: target }) => {
        writeFileSync(target, "{}");
        return ok(undefined);
      },
    };
    expect(runFleetRestorePolicy({ deps, rest: ["--apply", "--config", path] })).toBe(EXIT_ERROR);
    expect(readFileSync(path, "utf8")).toBe(ON_BY_DEFAULT);
    expect(statSync(path).mode & 0o777).toBe(0o664);
    expect(run.diagnostics[0]).toContain("did not re-read as the planned text; restored");
    expect(run.reloads).toEqual([]);
  });
  it("keeps a mode the umask would strip, not only 0600", () => {
    const path = writeConfig({ text: ON_BY_DEFAULT });
    chmodSync(path, 0o664);
    const run = harness({ reload: ok("") });
    expect(runFleetRestorePolicy({ deps: run.deps, rest: ["--apply", "--config", path] })).toBe(EXIT_OK);
    expect(statSync(path).mode & 0o777).toBe(0o664);
  });

  it("refuses a hard-linked config and leaves both names alone", () => {
    const path = writeConfig({ text: ON_BY_DEFAULT });
    const other = join(dir, "other.json");
    linkSync(path, other);
    const run = harness({ reload: ok("") });
    expect(runFleetRestorePolicy({ deps: run.deps, rest: ["--apply", "--config", path] })).toBe(EXIT_ERROR);
    expect(run.diagnostics[0]).toContain(`${path} has 2 hard links`);
    expect(readFileSync(path, "utf8")).toBe(ON_BY_DEFAULT);
    expect(readdirSync(dir).toSorted()).toEqual(["cmux.json", "other.json"]);
  });

  it("refuses bytes that are not UTF-8 rather than replacing them", () => {
    const path = join(dir, "cmux.json");
    const latin1 = Buffer.concat([
      Buffer.from("{\n  // caf"),
      Buffer.from([0xe9]),
      Buffer.from('\n  "terminal": {}\n}\n'),
    ]);
    writeFileSync(path, latin1);
    const run = harness({ reload: ok("") });
    expect(runFleetRestorePolicy({ deps: run.deps, rest: ["--apply", "--config", path] })).toBe(EXIT_ERROR);
    expect(run.diagnostics[0]).toContain("it is not valid UTF-8");
    expect(readFileSync(path).equals(latin1)).toBe(true);
  });

  it("refuses a byte-order mark rather than splicing around it", () => {
    const text = `\uFEFF${ON_BY_DEFAULT}`;
    const path = writeConfig({ text });
    const run = harness({ reload: ok("") });
    expect(runFleetRestorePolicy({ deps: run.deps, rest: ["--apply", "--config", path] })).toBe(EXIT_ERROR);
    expect(run.diagnostics[0]).toContain("the file carries a byte-order mark");
    expect(readFileSync(path, "utf8")).toBe(text);
  });
});
