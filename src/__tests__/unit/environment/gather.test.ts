/**
 * The free gather over a throwaway machine: a fake `PATH`, a fake user home and a fake state home, all in a
 * temp directory. `PATH` comes only from the env passed in, so nothing on the real machine leaks in — except
 * the two /Applications checks, which this file deliberately never asserts.
 */
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { pinnedStart } from "../../../cli/commands/store/lockCore.js";
import { gatherFreeFacts, installedSupabaseCli } from "../../../environment/gather.js";
import { stateHomePaths } from "../../../stateHome.js";

let root = "";
let bin = "";
let userHome = "";
let home = "";

/** Put an executable stub at a path whose directory already exists. */
function executable({ path }: { path: string }): void {
  writeFileSync(path, "#!/bin/sh\n");
  chmodSync(path, 0o755);
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "env-gather-"));
  bin = join(root, ".proto", "shims");
  userHome = join(root, "user");
  home = join(root, "state");
  mkdirSync(bin, { recursive: true });
  mkdirSync(join(userHome, ".local", "bin"), { recursive: true });
  for (const name of ["node", "git", "yarn"]) {
    executable({ path: join(bin, name) });
  }
});

afterEach(() => {
  rmSync(root, { force: true, recursive: true });
});

describe("gatherFreeFacts", () => {
  it("resolves each probed binary off the given PATH only, and leaves the costed probes unrun", () => {
    const facts = gatherFreeFacts({ env: { PATH: bin }, home, userHome });
    expect(facts.onPath.git).toBe(join(bin, "git"));
    expect(facts.onPath.node).toBe(join(bin, "node"));
    expect(facts.onPath.gh).toBe(null);
    expect(facts.onPath.slopweaver).toBe(null);
    expect(facts.deep).toBe(null);
  });

  it("names the Node manager from where node lives", () => {
    const facts = gatherFreeFacts({ env: { PATH: bin }, home, userHome });
    expect(facts.nodeManager).toBe("proto");
    expect(facts.managersOnPath).toEqual(["proto"]);
  });

  it("finds a dangling slopweaver link, the ~/.local/bin shim and a zshrc function", () => {
    symlinkSync(join(root, "gone"), join(bin, "slopweaver"));
    executable({ path: join(userHome, ".local", "bin", "slopweaver") });
    writeFileSync(join(userHome, ".zshrc"), 'export X=1\nslopweaver() { command slopweaver "$@"; }\n');
    const facts = gatherFreeFacts({ env: { PATH: bin }, home, userHome });
    expect(facts.danglingSlopweaver).toEqual({ link: join(bin, "slopweaver"), target: join(root, "gone") });
    expect(facts.localBinSlopweaver).toBe(join(userHome, ".local", "bin", "slopweaver"));
    expect(facts.zshrcDefinesSlopweaver).toBe(true);
  });

  it("finds no GitHub fallback, then the secrets file, then an environment token ahead of it", () => {
    expect(gatherFreeFacts({ env: { PATH: bin }, home, userHome }).githubFallback).toBe(null);
    const secrets = stateHomePaths({ home }).secrets;
    mkdirSync(secrets, { recursive: true });
    writeFileSync(join(secrets, "github-token"), "fixture\n");
    expect(gatherFreeFacts({ env: { PATH: bin }, home, userHome }).githubFallback).toBe("secrets-file");
    expect(gatherFreeFacts({ env: { GH_TOKEN: "fixture", PATH: bin }, home, userHome }).githubFallback).toBe("env");
  });

  it("reads this checkout's Supabase CLI pin and finds the same exact version installed", () => {
    const facts = gatherFreeFacts({ env: { PATH: bin }, home, userHome });
    expect(facts.pins.supabaseCli).toMatch(/^\d+\.\d+\.\d+$/u);
    expect(facts.installedSupabaseCli).toBe(facts.pins.supabaseCli);
  });

  // The launcher by path, never `yarn run supabase`: Yarn injects `.env.yarn` into every script and binary run,
  // and the launcher obeys SUPABASE_CLI_BINARY_OVERRIDE, so only clearing it on the final `node` reaches the pin
  // (Codex review r3-probe-grades-what-it-reads). `store:start` runs the `store start` verb, which launches the
  // same pinned launcher with the override cleared and then locks the stack (`pinnedStart`, `lockCore.ts`).
  it("runs the store scripts through the pinned launcher only, never PATH or a binary override", () => {
    const manifest = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    expect([manifest.scripts["store:start"], manifest.scripts["store:status"], manifest.scripts["store:stop"]]).toEqual(
      [
        "tsx src/cli/index.ts store start",
        "SUPABASE_CLI_BINARY_OVERRIDE= node node_modules/supabase/dist/supabase.js status",
        "SUPABASE_CLI_BINARY_OVERRIDE= node node_modules/supabase/dist/supabase.js stop",
      ],
    );
    const launch = pinnedStart({
      env: { PATH: "/usr/bin", SUPABASE_CLI_BINARY_OVERRIDE: "/elsewhere/supabase" },
      nodePath: "/usr/bin/node",
      treeRoot: "/checkout",
      workdir: "/checkout",
    });
    expect([launch.command, ...launch.args]).toEqual([
      "/usr/bin/node",
      "/checkout/node_modules/supabase/dist/supabase.js",
      "start",
      "--workdir",
      "/checkout",
      "--exclude",
      "postgrest",
    ]);
    expect(launch.env).toEqual({ PATH: "/usr/bin" });
  });

  it("does not count this checkout's own supabase on PATH as a second install", () => {
    symlinkSync(join(process.cwd(), "node_modules", ".bin", "supabase"), join(bin, "supabase"));
    expect(gatherFreeFacts({ env: { PATH: bin }, home, userHome }).ambientSupabase).toBe(null);
  });

  it("names a supabase on PATH that resolves outside this checkout", () => {
    executable({ path: join(bin, "supabase") });
    expect(gatherFreeFacts({ env: { PATH: bin }, home, userHome }).ambientSupabase).toBe(join(bin, "supabase"));
  });

  it("treats an empty PATH as nothing installed", () => {
    const facts = gatherFreeFacts({ env: {}, home, userHome });
    expect(facts.onPath.git).toBe(null);
    expect(facts.managersOnPath).toEqual([]);
    expect(facts.nodeManager).toBe(null);
    expect(facts.ambientSupabase).toBe(null);
  });
});

/** Write `node_modules/<name>/package.json` at a version under the fixture checkout. */
function installPackage({ name, version }: { name: string; version: string }): void {
  mkdirSync(join(root, "node_modules", name, "bin"), { recursive: true });
  writeFileSync(join(root, "node_modules", name, "package.json"), JSON.stringify({ name, version }));
}

describe("installedSupabaseCli", () => {
  const darwin = { arch: "arm64", platform: "darwin" };

  it("reads the launcher's version when this platform's binary package holds an executable at that version", () => {
    installPackage({ name: "supabase", version: "2.109.1" });
    installPackage({ name: "@supabase/cli-darwin-arm64", version: "2.109.1" });
    executable({ path: join(root, "node_modules", "@supabase", "cli-darwin-arm64", "bin", "supabase") });
    expect(installedSupabaseCli({ ...darwin, root })).toBe("2.109.1");
  });

  it("counts no install when the launcher is there and the optional binary package was never installed", () => {
    installPackage({ name: "supabase", version: "2.109.1" });
    expect(installedSupabaseCli({ ...darwin, root })).toBe(null);
  });

  it("counts no install when the binary package is there but its binary is not executable", () => {
    installPackage({ name: "supabase", version: "2.109.1" });
    installPackage({ name: "@supabase/cli-darwin-arm64", version: "2.109.1" });
    writeFileSync(join(root, "node_modules", "@supabase", "cli-darwin-arm64", "bin", "supabase"), "");
    expect(installedSupabaseCli({ ...darwin, root })).toBe(null);
  });

  it("counts no install when the binary package is a different version from the launcher", () => {
    installPackage({ name: "supabase", version: "2.109.1" });
    installPackage({ name: "@supabase/cli-darwin-arm64", version: "2.100.0" });
    executable({ path: join(root, "node_modules", "@supabase", "cli-darwin-arm64", "bin", "supabase") });
    expect(installedSupabaseCli({ ...darwin, root })).toBe(null);
  });

  it("ignores another platform's binary package", () => {
    installPackage({ name: "supabase", version: "2.109.1" });
    installPackage({ name: "@supabase/cli-darwin-x64", version: "2.109.1" });
    executable({ path: join(root, "node_modules", "@supabase", "cli-darwin-x64", "bin", "supabase") });
    expect(installedSupabaseCli({ ...darwin, root })).toBe(null);
  });

  it("takes linux's musl binary package, the launcher's second choice there", () => {
    installPackage({ name: "supabase", version: "2.109.1" });
    installPackage({ name: "@supabase/cli-linux-x64-musl", version: "2.109.1" });
    executable({ path: join(root, "node_modules", "@supabase", "cli-linux-x64-musl", "bin", "supabase") });
    expect(installedSupabaseCli({ arch: "x64", platform: "linux", root })).toBe("2.109.1");
  });

  it("counts no install when the checkout has no launcher at all", () => {
    expect(installedSupabaseCli({ ...darwin, root })).toBe(null);
  });
});
