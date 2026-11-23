/**
 * `tools/generateGoogleSecopsSurfaces.ts`, run for real: the dispatch in its `main()` that decides whether a
 * `--verify --spec-dir <dir>` reads the pinned bytes at all. The flag parsing is unit-tested in
 * `generatorArgs.test.ts`; what only a real run shows is that a spec directory missing every pin FAILS, rather
 * than the tool falling back to the committed-only check and printing success — which is what a dispatch
 * mutant measured once did, exiting 0 with "verified 92 committed methods".
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const TSX = join(repoRoot, "node_modules", ".bin", "tsx");
const TOOL = join(repoRoot, "tools", "generateGoogleSecopsSurfaces.ts");

let root: string | undefined;

afterEach(() => {
  if (root !== undefined) {
    rmSync(root, { force: true, recursive: true });
    root = undefined;
  }
});

/**
 * Run the generator with these arguments.
 *
 * @param args the arguments after the script path
 * @returns its exit status and both streams
 */
function runTool({ args }: { args: readonly string[] }): { status: number | null; stdout: string; stderr: string } {
  const run = spawnSync(TSX, [TOOL, ...args], { cwd: repoRoot, encoding: "utf8" });
  return { status: run.status, stderr: run.stderr, stdout: run.stdout };
}

describe("generateGoogleSecopsSurfaces", () => {
  it("verifies the committed table with --verify alone", () => {
    const run = runTool({ args: ["--verify"] });
    expect(run.status).toBe(0);
    expect(run.stdout).toBe("verified 92 committed methods against every census and disposition rule\n");
  });

  it("fails --verify --spec-dir over a directory holding no pin, never falling back to the committed-only check", () => {
    root = mkdtempSync(join(tmpdir(), "secops-pins-"));
    const run = runTool({ args: ["--verify", "--spec-dir", root] });
    expect(run.status).toBe(1);
    expect(run.stdout).toBe("");
    expect(run.stderr).toContain("is absent — fetch every file with --fetch, or from the URLs in protoLock.ts");
  });

  it("fails a command line it cannot read, rather than exiting clean having done nothing", () => {
    const runs = [["--verify", "--spec-dir"], ["--verify", "--spec-dirr", "/pins"], []].map((args) =>
      runTool({ args }),
    );
    expect(runs.map((run) => [run.status, run.stdout])).toStrictEqual([
      [1, ""],
      [1, ""],
      [1, ""],
    ]);
    expect(runs[0]!.stderr).toContain("--spec-dir takes exactly one directory, given once");
    expect(runs[1]!.stderr).toContain("unknown argument --spec-dirr");
    expect(runs[2]!.stderr).toContain("writing the inventory needs --fetch <dir> or --spec-dir <dir>");
  });
});
