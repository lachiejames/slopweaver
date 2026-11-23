/**
 * `browser console-shot` runs three children, and none of them may see the installation's state: every environment is
 * an allowlist, `HOME` and the state home, cache and config directory are the shot's own throwaway ones, the only
 * paths under the real home are three named toolchain caches, and the only value taken from the installation, the
 * maintenance connection, reaches the walk alone.
 */
import { describe, expect, it } from "vitest";

import {
  CONSOLE_CAPTURE_CONFIG,
  CONSOLE_SHOT_INHERITED_ENV,
  consoleShotSteps,
  STORE_ADMIN_URL_ENV,
  toolchainCacheEnv,
} from "../../../../../cli/commands/browser/consoleShotCore.js";
import { CONSOLE_SHOT_DIR_ENV } from "../../../../../visualEvidence/consoleShot.js";

/** The installation's own state, every value under a path the test then refuses to find in any child. */
const INSTALLATION = {
  GH_TOKEN: "ghp_FIXTURE",
  GITHUB_TOKEN: "ghp_FIXTURE",
  HOME: "/Users/acme",
  NODE_OPTIONS: "--require /installation/preload.js",
  PATH: "/usr/bin:/bin",
  SLOPWEAVER_CACHE_HOME: "/installation/cache",
  SLOPWEAVER_HOME: "/installation/home",
  SLOPWEAVER_STORE_URL: "postgresql://acme:FIXTURE@127.0.0.1:55322/installation_store",
  XDG_CONFIG_HOME: "/installation/config",
};

/** The shot's own throwaway directories. */
const DIRECTORIES = {
  cache: "/stage/cache",
  capture: "/stage/capture",
  config: "/stage/config",
  home: "/stage/home",
  user: "/stage/user",
};

/** The maintenance connection on the installation's server. */
const ADMIN_URL = "postgresql://acme:FIXTURE@127.0.0.1:55322/postgres";

/** Every input but the seat's environment and the walk, which the cases vary. */
const FIXED = {
  adminUrl: ADMIN_URL,
  cwd: "/checkout",
  directories: DIRECTORIES,
  nodeBinDir: "/toolchain/node/bin",
  os: "darwin",
  userHome: "/Users/acme",
};

const steps = consoleShotSteps({ ...FIXED, source: INSTALLATION, walk: "automations-context" });

describe("consoleShotSteps", () => {
  it("builds the CLI, builds the console, then runs the one walk", () => {
    expect(steps.map((step) => [step.command, ...step.args])).toEqual([
      ["/checkout/bin/slopweaver", "dev", "build"],
      ["bash", "/checkout/scripts/docs-site.sh", "--build"],
      [
        "/checkout/node_modules/.bin/playwright",
        "test",
        "--config",
        CONSOLE_CAPTURE_CONFIG,
        "--grep",
        "walk:automations-context$",
      ],
    ]);
  });

  it("hands every child the shot's own home, cache and config directory, never the installation's", () => {
    expect(steps.length).toBe(3);
    expect(
      steps.map((step) => [
        step.env["SLOPWEAVER_HOME"],
        step.env["SLOPWEAVER_CACHE_HOME"],
        step.env["XDG_CONFIG_HOME"],
      ]),
    ).toEqual(steps.map(() => ["/stage/home", "/stage/cache", "/stage/config"]));
  });

  it("carries no installation path, store selection or credential into any child", () => {
    const leaked = steps.flatMap((step) =>
      Object.entries(step.env).filter(
        ([name, value]) =>
          value.includes("/installation") ||
          value.includes("installation_store") ||
          value.includes("ghp_") ||
          ["SLOPWEAVER_STORE_URL", "GITHUB_TOKEN", "GH_TOKEN"].includes(name),
      ),
    );
    expect(INSTALLATION.SLOPWEAVER_HOME).toContain("/installation");
    expect(leaked).toEqual([]);
  });

  it("names the maintenance connection and the capture directory to the walk alone", () => {
    expect(steps.map((step) => [step.env[STORE_ADMIN_URL_ENV], step.env[CONSOLE_SHOT_DIR_ENV]])).toEqual([
      [undefined, undefined],
      [undefined, undefined],
      [ADMIN_URL, "/stage/capture"],
    ]);
  });

  it("replaces the seat's NODE_OPTIONS preload with the walk's own loader", () => {
    expect(steps.map((step) => step.env["NODE_OPTIONS"])).toEqual([undefined, undefined, "--import tsx"]);
  });

  it("leads every child's PATH with the running Node's directory, where a version manager keeps yarn", () => {
    expect(steps.map((step) => step.env["PATH"])).toEqual(steps.map(() => "/toolchain/node/bin:/usr/bin:/bin"));
  });

  it("names only the Node directory on PATH when the seat has none", () => {
    const [build] = consoleShotSteps({ ...FIXED, source: {}, walk: "automations-context" });
    expect(build!.env["PATH"]).toBe("/toolchain/node/bin");
  });

  it("gives every child the shot's own empty HOME, so no user-level config under the real one is read", () => {
    expect(INSTALLATION.HOME).toBe("/Users/acme");
    expect(steps.map((step) => step.env["HOME"])).toEqual(steps.map(() => "/stage/user"));
  });

  it("names the three toolchain caches at the seat's real locations, and no other path under its home", () => {
    expect(steps.map((step) => Object.values(step.env).filter((value) => value.includes("/Users/acme")))).toEqual(
      steps.map(() => [
        "/Users/acme/.cache/node/corepack",
        "/Users/acme/Library/Caches/ms-playwright",
        "/Users/acme/.yarn/berry",
      ]),
    );
  });

  it("inherits only names that carry no state", () => {
    expect(CONSOLE_SHOT_INHERITED_ENV.length).toBeGreaterThan(0);
    expect(
      CONSOLE_SHOT_INHERITED_ENV.filter((name) => /TOKEN|KEY|SECRET|SLOPWEAVER|STORE|XDG|NODE/u.test(name)),
    ).toEqual([]);
  });

  it("escapes a walk name into the grep as a literal", () => {
    const [, , walk] = consoleShotSteps({ ...FIXED, source: {}, walk: "a.b" });
    expect(walk!.args.at(-1)).toBe(String.raw`walk:a\.b$`);
  });
});

describe("toolchainCacheEnv", () => {
  it("defaults each cache under the real home, Playwright's at the darwin location", () => {
    expect(toolchainCacheEnv({ os: "darwin", source: {}, userHome: "/Users/acme" })).toEqual({
      COREPACK_HOME: "/Users/acme/.cache/node/corepack",
      PLAYWRIGHT_BROWSERS_PATH: "/Users/acme/Library/Caches/ms-playwright",
      YARN_GLOBAL_FOLDER: "/Users/acme/.yarn/berry",
    });
  });

  it("puts Playwright's browsers under ~/.cache off darwin", () => {
    expect(toolchainCacheEnv({ os: "linux", source: {}, userHome: "/home/acme" })["PLAYWRIGHT_BROWSERS_PATH"]).toBe(
      "/home/acme/.cache/ms-playwright",
    );
  });

  it("keeps a location the seat set itself, and ignores an empty one", () => {
    expect(
      toolchainCacheEnv({
        os: "darwin",
        source: { COREPACK_HOME: "", PLAYWRIGHT_BROWSERS_PATH: "/opt/browsers", YARN_GLOBAL_FOLDER: "/opt/yarn" },
        userHome: "/Users/acme",
      }),
    ).toEqual({
      COREPACK_HOME: "/Users/acme/.cache/node/corepack",
      PLAYWRIGHT_BROWSERS_PATH: "/opt/browsers",
      YARN_GLOBAL_FOLDER: "/opt/yarn",
    });
  });
});
