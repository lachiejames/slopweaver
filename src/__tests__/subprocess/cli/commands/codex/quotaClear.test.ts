/**
 * The SHIPPED `codex quota clear` naming no `--plan`. There is no default destination: a login merely found in
 * `$CODEX_HOME` is never a plan, so an unnamed clear is a usage refusal that writes no mark for
 * any alias. It refuses before the register is read, so it runs store-free on every lane.
 *
 * The three cases that cleared the ambient default went with it, and are re-keyed on a registered plan over a real
 * store in `quotaClearRegistered.test.ts`, required in CI.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { stateHomePaths } from "../../../../../stateHome.js";
import { accountSandboxChildEnv } from "../../../../accountHomeSandboxChild.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../../..");
const BIN = join(repoRoot, "bin", "slopweaver");

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "quota-clear-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

describe("bin/slopweaver codex quota clear", () => {
  it("refuses a clear naming no --plan as usage, and writes no mark for any alias", { timeout: 60_000 }, () => {
    // The clear marks' own directory, made in advance so its listing after the run is exact rather than conditional.
    const marks = join(stateHomePaths({ home }).codexQuotaDir, "cleared");
    mkdirSync(marks, { recursive: true });

    // `HOME` stays the runner's own: the toolchain shim resolves the pinned Node from it, and this verb reads nothing
    // under it. `CODEX_HOME` points at a login the user never registered, which must not become the destination.
    const run = spawnSync(BIN, ["codex", "quota", "clear", "--home", home], {
      encoding: "utf8",
      env: {
        ...accountSandboxChildEnv(),
        CODEX_HOME: join(home, "ambient-codex"),
        HOME: process.env["HOME"]!,
        PATH: process.env["PATH"]!,
        SLOPWEAVER_CLI_DIR: repoRoot,
        SLOPWEAVER_HOME: home,
        TMPDIR: process.env["TMPDIR"]!,
      },
      timeout: 60_000,
    });

    expect(run.status).toBe(2);
    expect(run.stderr).toContain("name the registered Codex plan to act on with --plan <alias>");
    expect(readdirSync(marks)).toStrictEqual([]);
  });
});
