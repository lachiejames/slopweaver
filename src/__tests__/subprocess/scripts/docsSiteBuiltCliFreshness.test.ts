/**
 * A dev console over a stale built CLI is refused before anything is served — `scripts/docs-site.sh`'s
 * `check_serving_cli`, and the source-run entry it calls, `src/builtCli/docsSiteStart.entry.ts`.
 *
 * The incident: a worktree's dev console answered every page in about 30 s and drew "Organisation required", because
 * each page's organisation read is a console child that waits out the 30 s rebuild bound over a stale `dist-cli`, and
 * nothing in a worktree rebuilds one. Two halves are driven for real here. The script is copied into a throwaway
 * checkout whose `node_modules/.bin/tsx` is a fake that records its argv and refuses, so both dev starts — `--start`
 * and the foreground `yarn docs` — are shown to call the check FIRST and start nothing past it; the fake `yarn` would
 * record any start. The entry is then run by the real tsx over a throwaway built checkout, stale and then fresh.
 */

import { spawnSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { builtCheckoutFixture } from "../../builtCheckoutFixture.js";
import { gitInTemp } from "../../tempGitRepo.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const SCRIPT = join(repoRoot, "scripts", "docs-site.sh");
const ENTRY = join(repoRoot, "src", "builtCli", "docsSiteStart.entry.ts");
const TSX = join(repoRoot, "node_modules", ".bin", "tsx");
/** What the fake tsx prints, standing in for the entry's own refusal. */
const FAKE_REFUSAL = "docs-site: refusing to serve or walk the console (fake check)";

const dirs: string[] = [];

afterEach(() => {
  while (dirs.length > 0) {
    rmSync(dirs.pop()!, { force: true, recursive: true });
  }
});

/** A fresh throwaway directory, removed after the test. */
function scratch({ prefix }: { prefix: string }): string {
  const at = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(at);
  return at;
}

/**
 * A checkout holding the script, a `site/` whose install is current, a fake `yarn` that logs every run, and — unless
 * `withInstall` is false — a fake `tsx` that logs its argv, prints the refusal on stderr and exits 3. With `stale` it
 * prints the entry's `stale` token on stdout too, which is the refusal; without it, it is a check that crashed and
 * happened to exit 3.
 *
 * @returns the checkout's root
 */
function scriptCheckout({ withInstall, stale = true }: { withInstall: boolean; stale?: boolean }): string {
  const at = scratch({ prefix: "docs-fresh-" });
  cpSync(SCRIPT, join(at, "scripts", "docs-site.sh"));
  mkdirSync(join(at, "site", "node_modules"), { recursive: true });
  writeFileSync(join(at, "site", "yarn.lock"), "");
  writeFileSync(join(at, "site", "node_modules", ".yarn-state.yml"), "");
  mkdirSync(join(at, "bin"));
  writeFileSync(join(at, "bin", "yarn"), `#!/bin/sh\necho "$@" >> "${join(at, "yarn.log")}"\n`);
  chmodSync(join(at, "bin", "yarn"), 0o755);
  if (withInstall) {
    mkdirSync(join(at, "node_modules", ".bin"), { recursive: true });
    const tsx = join(at, "node_modules", ".bin", "tsx");
    const token = stale ? "echo stale\n" : "";
    writeFileSync(
      tsx,
      `#!/bin/sh\necho "$@" > "${join(at, "tsx.argv")}"\necho "${FAKE_REFUSAL}" >&2\n${token}exit 3\n`,
    );
    chmodSync(tsx, 0o755);
  }
  return at;
}

/** Run the copied script with the fake `yarn` first on PATH, under a throwaway home and cache root. */
function runScript({ at, args }: { at: string; args: readonly string[] }): ReturnType<typeof spawnSync> {
  return spawnSync("bash", [join(at, "scripts", "docs-site.sh"), ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${join(at, "bin")}:${process.env["PATH"]!}`,
      SLOPWEAVER_CACHE_HOME: join(at, "cache"),
      SLOPWEAVER_HOME: join(at, "home"),
    },
  });
}

describe("docs-site.sh checks the built CLI before either dev start", () => {
  it.each([
    ["--start", ["--start"]],
    ["the foreground serve", []],
  ] as const)("%s runs the check first and starts nothing when it refuses", (_name, args) => {
    const at = scriptCheckout({ withInstall: true });

    const run = runScript({ args, at });

    expect([run.status, run.stdout, run.stderr]).toEqual([1, "", `${FAKE_REFUSAL}\n`]);
    expect(readFileSync(join(at, "tsx.argv"), "utf8")).toBe(
      `${join(at, "src/builtCli/docsSiteStart.entry.ts")} ${at}\n`,
    );
    expect(existsSync(join(at, "yarn.log"))).toBe(false);
  });

  it("reads a check that crashed as unchecked, never as a refusal, even on the refusal's own exit code", () => {
    const at = scriptCheckout({ stale: false, withInstall: true });

    const run = runScript({ args: ["--start"], at });

    expect(String(run.stderr).split("\n").slice(0, 2)).toEqual([
      FAKE_REFUSAL,
      "docs-site: the built-CLI check could not run (exit 3), so it was not checked before serving",
    ]);
    expect(readFileSync(join(at, "yarn.log"), "utf8").split(" ")[0]).toBe("dev");
  });

  it("says a checkout with no root install went unchecked, and starts as before rather than refusing it", () => {
    const at = scriptCheckout({ withInstall: false });

    const run = runScript({ args: ["--start"], at });

    expect(String(run.stderr).split("\n")[0]).toBe(
      `docs-site: ${at} has no root install, so its built CLI was not checked before serving`,
    );
    expect(readFileSync(join(at, "yarn.log"), "utf8").split(" ")[0]).toBe("dev");
  });
});

/** A built checkout, removed after the test. */
function builtCheckout(): string {
  const at = builtCheckoutFixture({ prefix: "docs-built-" });
  dirs.push(at);
  return at;
}

/** Run the real entry, from source, against one checkout. */
function runEntry({ checkout }: { checkout: string }): ReturnType<typeof spawnSync> {
  return spawnSync(TSX, [ENTRY, checkout], { cwd: repoRoot, encoding: "utf8" });
}

describe("docsSiteStart.entry.ts — the check the script runs, from source", () => {
  it("is silent and exits 0 over a fresh build", () => {
    const checkout = builtCheckout();

    const run = runEntry({ checkout });

    expect([run.status, run.stdout, run.stderr]).toEqual([0, "", ""]);
  });

  it("refuses a stale build in one line naming the checkout, the file that moved and `slopweaver dev build`", () => {
    const checkout = builtCheckout();
    writeFileSync(join(checkout, "src/a.ts"), "export const a = 11;\n");

    const run = runEntry({ checkout });

    expect([run.status, run.stdout, run.stderr]).toEqual([
      3,
      "stale\n",
      `docs-site: refusing to serve or walk the console from ${checkout}: its built CLI is stale (src/a.ts is 21 ` +
        "bytes, 20 at build time), so every console page would wait 30s for a rebuild nothing here starts — run " +
        "`slopweaver dev build` in that checkout\n",
    ]);
  });

  it("keeps the refusal on one line when the file that moved has a line break in its name", () => {
    const checkout = builtCheckout();
    writeFileSync(join(checkout, "src/line\nbreak.ts"), "export const b = 1;\n");
    gitInTemp({ args: ["add", "--", "src/line\nbreak.ts"], cwd: checkout });

    const run = runEntry({ checkout });

    expect([run.status, run.stdout, run.stderr]).toEqual([
      3,
      "stale\n",
      `docs-site: refusing to serve or walk the console from ${checkout}: its built CLI is stale (` +
        String.raw`"src/line\nbreak.ts"` +
        " is new since the build), so every console page would wait 30s for a rebuild nothing here starts — run " +
        "`slopweaver dev build` in that checkout\n",
    ]);
  });
});
