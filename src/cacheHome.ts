/**
 * The ONE typed contract for what Slopweaver keeps OUTSIDE `$SLOPWEAVER_HOME` because it is rebuildable or belongs
 * to live processes rather than to the install: the exec store, the Codex plugin export, the console's run records
 * and call leases, the last desktop update's notice, the console's saved readings and the local lap's checkouts. The home is moving into the
 * local store, and none of these is store material — each is either re-derived from something else on the machine
 * or meaningful only while the process that wrote it lives — so they sit in the OS's own cache directory instead.
 *
 * Machine-level, NOT keyed by `--home`: the exec store protects every checkout on the machine, the Codex marketplace
 * is personal and singular, the console records cover every worktree, and there is one installed desktop app. The
 * saved readings are the one exception, keyed by the state home in `scripts/docs-site.sh`, which is their only
 * writer's launcher.
 *
 * ONE root rather than a cache root plus a runtime root, deliberately, though a split was weighed. Node's `os.tmpdir()` reads `TMPDIR` and falls back to `/tmp` when it is unset, so a runtime root under it would
 * resolve differently in a shell, a launchd job and an app opened from Finder, and a call lease written by one would
 * be invisible to the refresh deciding whether to swap over a live call. Every reader of the runtime half already
 * tolerates a file outliving its writer — a lease carries its own expiry, a pid is re-checked against its port — so
 * a cache directory that survives a reboot costs nothing those readers do not already handle.
 *
 * `scripts/docs-site.sh` resolves the same root in bash; `docs-site.sh --print-cache-paths` prints what it resolved
 * and a subprocess test holds the two to agreement. Pure: it computes paths, never creates one.
 */
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

/** The variable that moves the whole cache root — a test sandbox, or an install that wants it elsewhere. */
export const CACHE_HOME_VAR = "SLOPWEAVER_CACHE_HOME";

/** Every path under the cache root. */
export interface CachePaths {
  /** The cache root itself. */
  readonly root: string;
  /**
   * `<cache>/exec-store` — one content-addressed copy of every native binary any checkout's `node_modules` holds,
   * which every checkout is then hardlinked to instead of to yarn's own content store. Rebuildable, and shared across
   * every checkout on the machine rather than duplicated per worktree. `worktree/execInodes.ts` carries why it has to
   * exist: yarn rewrites its own store entries in place, and one such write condemns a native binary PERMANENTLY in
   * every checkout linked to it.
   */
  readonly execStore: string;
  /**
   * `<cache>/codex-plugin` — the tracked-files export of the main checkout's HEAD that the personal Codex
   * marketplace's `slopweaver` entry points at, with `codex plugin-sync`'s lock and background log beside it. Codex
   * copies this tree into its own cache on `codex plugin add`; the checkout itself is too large to be that source
   * (`src/codexPlugin/plan.ts`).
   */
  readonly codexPlugin: string;
  /**
   * `<cache>/docs-site` — one run record, log, refresh lock and log, fetch-claims directory and `<record>.hold/`
   * (the build held behind a live call and each call's lease) per worktree that has served the console.
   * `scripts/docs-site.sh` writes the records and holds; `src/live/machine/devServerRead.ts`,
   * `src/checkouts/consoleBuildRead.ts` and `src/desktop/callLeases.ts` read them.
   */
  readonly docsSite: string;
  /**
   * `<cache>/desktop/last-update.json` — the last `slopweaver desktop update`'s outcome, rewritten whole as it ends:
   * updated onto which commit, or failed with which code and message and whether the previous app was put back.
   * `talk offer` reads it at mint, so a call restarted after an update can say what happened
   * (`src/desktop/updateOutcome.ts`).
   */
  readonly desktopLastUpdateJson: string;
  /**
   * `<cache>/console/saved-readings` — the parent of one directory per state home holding the console's last
   * successful reading of each live verb (`site/lib/savedReadings.ts`). `scripts/docs-site.sh` names the per-home
   * child and hands it to the server as `SLOPWEAVER_CONSOLE_SAVED_READINGS_DIR`; no site code derives it.
   */
  readonly consoleSavedReadings: string;
  /**
   * `<cache>/lap-trees.noindex` — the parent of each detached checkout `slopweaver github lap` installs and runs its
   * lanes in, removed with the lap (`src/cli/commands/github/lapTree.ts`'s `checkoutLapTree`). Outside the OS temp
   * directory because macOS's nightly `dirhelper` empties files there older than three days, and an install keeps
   * the package cache's old mtimes; `.noindex` so Spotlight skips its `node_modules` (`src/worktree/location.ts`).
   */
  readonly lapTrees: string;
}

/**
 * The cache root this process uses: `$SLOPWEAVER_CACHE_HOME` when set and not blank, else the OS's per-user cache
 * directory's `slopweaver` child.
 *
 * @returns the absolute cache root
 */
export function slopweaverCacheRoot(): string {
  return slopweaverCacheRootOf({ env: process.env, platform: process.platform, userHome: homedir() });
}

/**
 * Whether a variable's value is blank: nothing but ASCII space, tab, newline, vertical tab, form feed or carriage
 * return. Not `String.prototype.trim`, which also strips Unicode spaces such as U+FEFF that bash's `[[:space:]]`
 * under `LC_ALL=C` keeps, so the two would disagree on whether an override is set.
 *
 * @returns true when the value is empty or holds only those six characters
 */
function isBlank({ value }: { value: string }): boolean {
  return /^[ \t\n\v\f\r]*$/u.test(value);
}

/**
 * Whether a string carries an ASCII control character, U+0000-U+001F or U+007F: the set bash's `[[:cntrl:]]` names
 * under `LC_ALL=C`. A code-unit scan rather than a character-class regex, which oxlint's `no-control-regex` refuses.
 *
 * @returns true when any code unit is one of those 33
 */
function hasControl({ text }: { text: string }): boolean {
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) {
      return true;
    }
  }
  return false;
}

/**
 * A directory variable's value, refused when it carries an ASCII control character. Bash's command substitution strips a
 * trailing newline that `path.resolve` keeps, so `scripts/docs-site.sh` and this module would name two roots for one
 * value; both refuse it instead.
 *
 * @param name the variable, for the refusal
 * @param value what it holds
 * @returns the value unchanged, or throws when it, or the working directory a relative one resolves against,
 * carries a control character (`$(pwd -P)` strips a trailing newline a directory name may end in)
 */
function printableDirectory({ name, value }: { name: string; value: string }): string {
  if (hasControl({ text: value })) {
    throw new Error(`cache root: ${name} carries a control character; set it to a plain directory path`);
  }
  if (!isAbsolute(value) && hasControl({ text: process.cwd() })) {
    throw new Error("cache root: the working directory carries a control character; pass an absolute path");
  }
  return value;
}

/**
 * {@link slopweaverCacheRoot}'s rule over an injected environment: `$SLOPWEAVER_CACHE_HOME` resolved against the
 * working directory when set and not blank; on darwin `~/Library/Caches/slopweaver`; elsewhere
 * `$XDG_CACHE_HOME/slopweaver` when that is set and not blank, else `~/.cache/slopweaver`.
 *
 * @param env the environment the two variables are read from
 * @param platform the operating system, which picks the default
 * @param userHome the user's own home directory, under which every default sits
 * @returns the absolute cache root, or throws when a variable it reads carries a control character, or when no
 * override is set and the user's home is not absolute
 */
export function slopweaverCacheRootOf({
  env,
  platform,
  userHome,
}: {
  env: Readonly<Record<string, string | undefined>>;
  platform: NodeJS.Platform;
  userHome: string;
}): string {
  const override = env[CACHE_HOME_VAR];
  if (override !== undefined && !isBlank({ value: override })) {
    return resolve(printableDirectory({ name: CACHE_HOME_VAR, value: override }));
  }
  // `os.homedir()` answers `""` when `HOME` is empty (`env HOME= node -e 'console.log(require("os").homedir())'`),
  // which would join into a root relative to the working directory while bash's `$HOME/...` names one under `/`.
  // Neither is the user's cache, so both refuse.
  if (!isAbsolute(userHome)) {
    throw new Error(`cache root: the user's home directory "${userHome}" is not absolute; set ${CACHE_HOME_VAR}`);
  }
  if (platform === "darwin") {
    return join(userHome, "Library", "Caches", "slopweaver");
  }
  const xdg = env["XDG_CACHE_HOME"];
  if (xdg !== undefined && !isBlank({ value: xdg })) {
    return join(resolve(printableDirectory({ name: "XDG_CACHE_HOME", value: xdg })), "slopweaver");
  }
  return join(userHome, ".cache", "slopweaver");
}

/**
 * Every path under a cache root.
 *
 * @param root the cache root; this process's own when omitted
 * @returns the paths, none of them created
 */
export function cachePaths({ root = slopweaverCacheRoot() }: { root?: string } = {}): CachePaths {
  return {
    codexPlugin: join(root, "codex-plugin"),
    consoleSavedReadings: join(root, "console", "saved-readings"),
    desktopLastUpdateJson: join(root, "desktop", "last-update.json"),
    docsSite: join(root, "docs-site"),
    execStore: join(root, "exec-store"),
    lapTrees: join(root, "lap-trees.noindex"),
    root,
  };
}
