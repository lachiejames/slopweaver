/**
 * The half of Node subpath imports (`package.json`'s `imports` field) a unit test cannot observe: that the
 * mapping resolves in a REAL child process, and specifically in the one shape this CLI actually runs in.
 *
 * `bin/slopweaver` runs tsx on `"$DIR/src/cli/index.ts" "$@"` — an ABSOLUTE entry path, run from
 * wherever the caller happens to be standing. That is the launcher's whole reason for existing, and it is
 * the shape that decided the mechanism: measured on this tree, tsconfig `paths` resolve under tsx only when
 * tsx finds the tsconfig from the CWD, so a `paths`-based alias dies with ERR_MODULE_NOT_FOUND for every
 * caller outside the repo root, while an `imports` mapping resolves because Node itself resolves it
 * (`src/lib/subpathImports.ts` carries the full four-row matrix). So this test runs the shipped launcher
 * from a directory that is not the repo.
 *
 * `SLOPWEAVER_CLI_DIR` is set deliberately: without it the launcher runs whatever the ambient `PLUGIN_ROOT`
 * names, so a worktree's proof would silently exercise the plugin mirror's copy of `main` instead of the
 * code under test.
 *
 * The falsifiable half is the undeclared root. A green first case alone would also be green if `#lib/…`
 * were resolving through something ambient rather than through this package's own field, so the second case
 * asserts that a specifier under a root this manifest does NOT declare fails to resolve in the same child.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

/** This checkout's root — four levels up from `src/__tests__/subprocess/lib/`. */
const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

/** A directory that is deliberately not the repository, so the launcher runs with a foreign CWD. */
const FOREIGN_CWD = mkdtempSync(join(tmpdir(), "subpath-foreign-"));

afterAll(() => {
  rmSync(FOREIGN_CWD, { force: true, recursive: true });
});

/** What a child Node resolves one specifier to, or `"unresolved"` when Node refuses it. */
function resolvedInChild({ specifier }: { specifier: string }): string {
  try {
    return execFileSync(
      process.execPath,
      ["--input-type=module", "-e", `process.stdout.write(import.meta.resolve(${JSON.stringify(specifier)}))`],
      { cwd: REPO_ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    );
  } catch {
    return "unresolved";
  }
}

describe("node resolves this package's declared subpath imports", () => {
  it("resolves the declared lib root to the real file", () => {
    expect(resolvedInChild({ specifier: "#lib/result.js" })).toBe(
      new URL("src/lib/result.js", new URL(`file://${REPO_ROOT}`)).href,
    );
  });

  it("refuses a root the manifest does not declare", () => {
    expect(resolvedInChild({ specifier: "#corpus/types.js" })).toBe("unresolved");
  });
});

describe("the shipped launcher resolves subpath imports from a foreign working directory", () => {
  it("prints its usage banner when run from outside the repository", () => {
    // `--help` is an exit-2 path and writes its banner to STDERR, so this is `spawnSync` and the witness is
    // that banner, never the exit code. An unresolved `#lib/…` dies with ERR_MODULE_NOT_FOUND before the
    // CLI prints anything, so the banner's presence is what proves the whole module graph resolved.
    const run = spawnSync(join(REPO_ROOT, "bin", "slopweaver"), ["--help"], {
      cwd: FOREIGN_CWD,
      encoding: "utf8",
      env: { ...process.env, SLOPWEAVER_CLI_DIR: REPO_ROOT },
    });

    expect(run.stderr).toContain("usage: slopweaver <noun> <verb>");
    expect(run.stderr).not.toContain("ERR_MODULE_NOT_FOUND");
  });
});
