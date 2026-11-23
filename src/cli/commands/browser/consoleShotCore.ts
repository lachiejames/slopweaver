/**
 * The pure half of `browser console-shot`: the three child processes it runs and the WHOLE environment each one gets.
 *
 * The verb builds the CLI and the console exactly as the console lane does (`src/testLanes/desktopE2e.entry.ts`), then
 * runs Playwright Test over `config/playwright/capture.ts`, whose global setup and worker fixtures stand up the throwaway
 * store, home and server. What this file adds is the property the lane never needed, because CI has no installation to
 * leak: every child's environment is an ALLOWLIST. The lane passes `process.env` through, and a seat's environment
 * carries the installation's own `SLOPWEAVER_STORE_URL`, a GitHub token and `$XDG_CONFIG_HOME/slopweaver/env` (which
 * `bin/slopweaver` reads for any variable left unset). So a child here gets the few variables a build needs, the
 * stage's throwaway state home, cache and config directory, and nothing naming the installation's state; the store it
 * uses is named to it by the lane's own fixtures, after they create it.
 *
 * `HOME` is the stage's own empty directory too, because a user-level config file under the real one can carry a
 * credential a child would read on startup: Yarn 4 reads `$HOME/.yarnrc.yml` (an `npmAuthToken`) whatever
 * `XDG_CONFIG_HOME` says, and git reads `~/.gitconfig`. `XDG_CONFIG_HOME` is the stage's as well, so neither
 * `bin/slopweaver`'s env file nor `gh`'s login is read. What the toolchain does need from under the real `HOME` is
 * three caches, each a store of downloaded code and never a config file, so each is NAMED to the child at its real
 * location rather than found through `HOME`: Corepack's (`yarn` here is a Corepack shim), Yarn's global folder (this
 * repository links `node_modules` into its store, `nmMode: hardlinks-global`), and Playwright's browsers
 * ({@link toolchainCacheEnv}). The console server itself runs under the lane's own allowlist with a throwaway `HOME`
 * (`src/__tests__/e2e/fixtures/consoleWorker.ts`).
 *
 * `PATH` is led by the running Node's own directory. The console lane is reached through `yarn test:e2e`, so Yarn has put
 * itself on the lane's `PATH`; a seat runs this verb directly, and a version-manager install can put only a `node` shim
 * there, with `yarn` beside the real binary (measured on proto: `~/.proto/shims` holds `node` alone, and
 * `ls ~/.proto/tools/node/<version>/bin` lists `yarn`). `scripts/docs-site.sh --build` runs `yarn`.
 */
import { join } from "node:path";

import { CONSOLE_SHOT_DIR_ENV } from "../../../visualEvidence/consoleShot.js";

/** The config the capture runs under. */
export const CONSOLE_CAPTURE_CONFIG = "config/playwright/capture.ts";

/** The variable the console lane's global setup reads its maintenance connection from. */
export const STORE_ADMIN_URL_ENV = "DESKTOP_E2E_STORE_ADMIN_URL";

/** The only variables a child of the verb inherits from the seat's own environment. */
export const CONSOLE_SHOT_INHERITED_ENV: readonly string[] = ["PATH", "TMPDIR", "LANG", "LC_ALL", "TZ"];

/**
 * The three toolchain caches a child needs from under the seat's real home, each at the location the seat itself
 * uses: the seat's own variable when it set one, else the tool's default under `userHome`.
 *
 * @param source the seat's environment, read only for these three names
 * @param userHome the seat's real home directory, the one each default sits under
 * @param os the running operating system, as `process.platform` names it, which decides where Playwright keeps its
 *   browsers
 * @returns the three variables, every one set
 */
export function toolchainCacheEnv({
  source,
  userHome,
  os,
}: {
  source: Readonly<Record<string, string | undefined>>;
  userHome: string;
  os: string;
}): Readonly<Record<string, string>> {
  let browsers = join(userHome, ".cache", "ms-playwright");
  if (os === "darwin") {
    browsers = join(userHome, "Library", "Caches", "ms-playwright");
  }
  const defaults: Readonly<Record<string, string>> = {
    COREPACK_HOME: join(userHome, ".cache", "node", "corepack"),
    PLAYWRIGHT_BROWSERS_PATH: browsers,
    YARN_GLOBAL_FOLDER: join(userHome, ".yarn", "berry"),
  };
  const resolved: Record<string, string> = {};
  for (const [name, fallback] of Object.entries(defaults)) {
    const seat = source[name];
    resolved[name] = fallback;
    if (seat !== undefined && seat !== "") {
      resolved[name] = seat;
    }
  }
  return resolved;
}

/** One child process the verb runs, to completion, in order. */
export interface ConsoleShotStep {
  /** How a failure names the step. */
  readonly name: string;
  readonly command: string;
  readonly args: readonly string[];
  /** The child's WHOLE environment. */
  readonly env: Readonly<Record<string, string>>;
}

/** The throwaway directories one console shot owns. */
export interface ConsoleShotDirectories {
  /** The stage's `$SLOPWEAVER_HOME`, for the builds and the Playwright process. */
  readonly home: string;
  /** The stage's `$SLOPWEAVER_CACHE_HOME`. */
  readonly cache: string;
  /** The stage's `$XDG_CONFIG_HOME`, empty, so no installation config file is read. */
  readonly config: string;
  /** Every child's `$HOME`, empty, so no user-level config file under the real home is read. */
  readonly user: string;
  /** Where the capture spec writes its picture and observation. */
  readonly capture: string;
}

/**
 * The steps one console shot runs: build the CLI, build the console, run the one walk.
 *
 * @param cwd the checkout whose console is photographed
 * @param source the seat's environment, read only for the allowlisted names
 * @param directories the shot's throwaway directories
 * @param adminUrl the maintenance connection the lane's global setup creates its throwaway database through
 * @param walk the registered walk's name, matched exactly by `--grep`
 * @param nodeBinDir the directory of the Node binary running the verb, put first on every child's `PATH`
 * @param userHome the seat's real home directory, read only for where its three toolchain caches sit
 * @param os the running operating system, as `process.platform` names it, for where Playwright keeps its browsers
 * @returns the steps, in order
 */
export function consoleShotSteps({
  cwd,
  source,
  directories,
  adminUrl,
  walk,
  nodeBinDir,
  userHome,
  os,
}: {
  cwd: string;
  source: Readonly<Record<string, string | undefined>>;
  directories: ConsoleShotDirectories;
  adminUrl: string;
  walk: string;
  nodeBinDir: string;
  userHome: string;
  os: string;
}): readonly ConsoleShotStep[] {
  const inherited: Record<string, string> = {};
  for (const name of CONSOLE_SHOT_INHERITED_ENV) {
    const value = source[name];
    if (value !== undefined) {
      inherited[name] = value;
    }
  }
  const seatPath = inherited["PATH"];
  const stage = {
    ...inherited,
    ...toolchainCacheEnv({ os, source, userHome }),
    HOME: directories.user,
    PATH: seatPath === undefined ? nodeBinDir : `${nodeBinDir}:${seatPath}`,
    SLOPWEAVER_CACHE_HOME: directories.cache,
    SLOPWEAVER_HOME: directories.home,
    XDG_CONFIG_HOME: directories.config,
  };
  return [
    { args: ["dev", "build"], command: join(cwd, "bin", "slopweaver"), env: stage, name: "the CLI build" },
    { args: [join(cwd, "scripts", "docs-site.sh"), "--build"], command: "bash", env: stage, name: "the console build" },
    {
      args: ["test", "--config", CONSOLE_CAPTURE_CONFIG, "--grep", `walk:${escapedForGrep({ text: walk })}$`],
      command: join(cwd, "node_modules", ".bin", "playwright"),
      // `#lib/…` subpath imports resolve through tsx's loader, which Playwright's own transform does not install.
      env: {
        ...stage,
        [CONSOLE_SHOT_DIR_ENV]: directories.capture,
        NODE_OPTIONS: "--import tsx",
        [STORE_ADMIN_URL_ENV]: adminUrl,
      },
      name: "the walk",
    },
  ];
}

/**
 * A walk name as a literal inside Playwright's `--grep` regular expression.
 *
 * @param text the walk's name
 * @returns the name with every regular-expression metacharacter escaped
 */
function escapedForGrep({ text }: { text: string }): string {
  return text.replace(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`);
}
