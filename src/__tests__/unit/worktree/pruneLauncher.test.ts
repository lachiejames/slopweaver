import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { BUILD_MANIFEST_FILE } from "../../../builtCli/staleness.js";
import { choosePruneLauncher, freshBuild, pruneLaunchEnv } from "../../../worktree/pruneLauncher.js";

describe("freshBuild", () => {
  it("counts a tree with no build as fresh, since its launcher runs from source", () => {
    const root = mkdtempSync(join(tmpdir(), "fresh-build-"));
    try {
      expect(freshBuild({ root })).toBe(true);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it("counts a build whose manifest is valid JSON but no manifest as stale, as the launcher's own guard refuses it", () => {
    const root = mkdtempSync(join(tmpdir(), "fresh-build-"));
    try {
      mkdirSync(join(root, "dist-cli"));
      writeFileSync(join(root, "dist-cli", BUILD_MANIFEST_FILE), "{}");
      expect(freshBuild({ root })).toBe(false);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it("counts a build whose manifest does not even parse as stale, rather than throwing out of the launch", () => {
    const root = mkdtempSync(join(tmpdir(), "fresh-build-"));
    try {
      mkdirSync(join(root, "dist-cli"));
      writeFileSync(join(root, "dist-cli", BUILD_MANIFEST_FILE), "not a manifest");
      expect(freshBuild({ root })).toBe(false);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });
});

describe("choosePruneLauncher", () => {
  const mainCheckouts = [{ path: "/repo/main" }, { path: "/repo/second" }];
  const fallbackRoot = "/plugin";
  const BUNDLED = { cliDir: "/plugin", path: "/plugin/bin/slopweaver", source: "bundled-fallback" } as const;
  const MAIN = { cliDir: "/repo/main", path: "/repo/main/bin/slopweaver", source: "main-checkout" } as const;

  it("launches the first main checkout's own build, and points its code dir there too", () => {
    expect(choosePruneLauncher({ executable: () => true, fallbackRoot, fresh: () => true, mainCheckouts })).toEqual(
      MAIN,
    );
  });

  it("falls back to the bundled build when the first checkout's is not executable — never a later checkout", () => {
    expect(
      choosePruneLauncher({
        executable: ({ path }) => path !== "/repo/main/bin/slopweaver",
        fallbackRoot,
        fresh: () => true,
        mainCheckouts,
      }),
    ).toEqual(BUNDLED);
  });

  it("falls back to a fresh bundled build when the main checkout's build is stale, which refuses every verb", () => {
    const fresh = ({ root }: { root: string }): boolean => root !== "/repo/main";
    expect(choosePruneLauncher({ executable: () => true, fallbackRoot, fresh, mainCheckouts })).toEqual(BUNDLED);
  });

  it("keeps the main checkout when both builds are stale, so its refusal is what the log shows", () => {
    expect(choosePruneLauncher({ executable: () => true, fallbackRoot, fresh: () => false, mainCheckouts })).toEqual(
      MAIN,
    );
  });

  it("keeps a stale main checkout when the bundled launcher cannot be executed at all", () => {
    expect(
      choosePruneLauncher({
        executable: ({ path }) => path === "/repo/main/bin/slopweaver",
        fallbackRoot,
        fresh: ({ root }) => root !== "/repo/main",
        mainCheckouts,
      }),
    ).toEqual(MAIN);
  });

  it("falls back when the first checkout is declared by a relative path, which the detached launch would refuse", () => {
    expect(
      choosePruneLauncher({ executable: () => true, fallbackRoot, fresh: () => true, mainCheckouts: [{ path: "." }] }),
    ).toEqual(BUNDLED);
  });

  it("falls back when no main checkout is declared at all", () => {
    expect(choosePruneLauncher({ executable: () => true, fallbackRoot, fresh: () => true, mainCheckouts: [] })).toEqual(
      {
        cliDir: "/plugin",
        path: "/plugin/bin/slopweaver",
        source: "bundled-fallback",
      },
    );
  });
});

describe("pruneLaunchEnv", () => {
  const base = {
    CLAUDE_PLUGIN_ROOT: "/other/claude-plugin",
    PATH: "/usr/bin",
    PLUGIN_ROOT: "/other/plugin",
    SLOPWEAVER_CLI_DIR: "/stale/seat",
    SLOPWEAVER_HOME: "/elsewhere",
  };

  it("pins every root the launcher reads to the chosen tree, so no inherited one outranks it", () => {
    expect(pruneLaunchEnv({ base, cliDir: "/plugin", home: "/home/acme" })).toEqual({
      PATH: "/usr/bin",
      PLUGIN_ROOT: "/plugin",
      SLOPWEAVER_CLI_DIR: "/plugin",
      SLOPWEAVER_HOME: "/home/acme",
    });
  });

  it("drops every bash startup file, which would run before the launcher and could export a root back in", () => {
    const withStartup = { ...base, BASH_ENV: "/tmp/override.sh", ENV: "/tmp/override.sh" };
    expect(pruneLaunchEnv({ base: withStartup, cliDir: "/plugin", home: "/home/acme" })).toEqual({
      PATH: "/usr/bin",
      PLUGIN_ROOT: "/plugin",
      SLOPWEAVER_CLI_DIR: "/plugin",
      SLOPWEAVER_HOME: "/home/acme",
    });
  });

  it("sets the roots even when the caller inherited none", () => {
    expect(pruneLaunchEnv({ base: { PATH: "/usr/bin" }, cliDir: "/repo/main", home: "/home/acme" })).toEqual({
      PATH: "/usr/bin",
      PLUGIN_ROOT: "/repo/main",
      SLOPWEAVER_CLI_DIR: "/repo/main",
      SLOPWEAVER_HOME: "/home/acme",
    });
  });

  it("leaves the caller's environment untouched", () => {
    pruneLaunchEnv({ base, cliDir: "/plugin", home: "/home/acme" });
    expect(base).toEqual({
      CLAUDE_PLUGIN_ROOT: "/other/claude-plugin",
      PATH: "/usr/bin",
      PLUGIN_ROOT: "/other/plugin",
      SLOPWEAVER_CLI_DIR: "/stale/seat",
      SLOPWEAVER_HOME: "/elsewhere",
    });
  });
});
