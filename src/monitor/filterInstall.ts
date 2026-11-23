/**
 * Putting the filter where cmux will run it, and taking it back off again.
 *
 * Two files, two lifetimes, and the split is the whole reason this is safe to run twice: the FILTER lives
 * under the state home and is rewritten on every install, while the SHIM sits at the path cmux's config
 * already names and is written once. `cmux.json` itself is never touched by the filter — see `./filter.ts` § shim;
 * its one writer is `fleet restore-policy --apply` (`../cmux/restorePolicy.ts`), which keeps every comment.
 *
 * ## Where the hook path comes from, and why it is not a constant
 *
 * `~/.config/cmux/hooks/log-notification.sh` is a name the owner chose, so it is state rather than code
 * (AGENTS.md, "Tools in the codebase, state outside it"). {@link hookCommandPaths} reads it back out of the
 * owner's own config instead, and a caller that already knows the path passes `--hook-script`.
 *
 * ## Replacing is backed up, never overwritten
 *
 * The file being replaced is one the owner wrote, with its own comments and its own revert instructions. So an
 * install copies it beside itself first and PRINTS the restore, which is the only undo that survives this
 * session ending.
 */
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";

import { errorMessage } from "../lib/errorMessage.js";
import { err, ok, type Result } from "../lib/result.js";
import { writeFileAtomic } from "../lib/writeAtomic.js";

import { type MonitorError, MonitorErrors } from "./errors.js";
import { buildFilterScript, buildFilterShim, type FilterPaths } from "./filter.js";

/** Owner-only, and executable by the owner: cmux runs it as the owner and the pin path it carries names a live session. */
const DIR_MODE = 0o700;
const SCRIPT_MODE = 0o700;

/** A whole-line `//` comment, which is every comment the owner's `cmux.json` carries. */
const LINE_COMMENT = /^\s*\/\//;

/** The `notifications.hooks` array, in a config the comments have already been stripped from. */
const HOOKS_ARRAY = /"hooks"\s*:\s*\[([\s\S]*?)\]/;

/** One hook entry's `command`. */
const HOOK_COMMAND = /"command"\s*:\s*"([^"]*)"/g;

/**
 * Every hook script path a cmux config points at, in the order the config lists them.
 *
 * Comments are dropped line-wise rather than parsed, because the owner's config is JSONC whose every comment is a
 * whole line and a real JSONC parser would be a dependency bought for one regex. A `//` INSIDE a string
 * would survive, which is correct here: a URL in a comment-free line is not a comment.
 *
 * @param configText the whole `cmux.json`, comments and all
 * @returns each hook's command path
 */
export function hookCommandPaths({ configText }: { configText: string }): readonly string[] {
  const stripped = configText
    .split("\n")
    .filter((line) => !LINE_COMMENT.test(line))
    .join("\n");
  const hooks = HOOKS_ARRAY.exec(stripped);
  if (hooks === null) {
    return [];
  }
  const body = hooks[1];
  if (body === undefined) {
    return [];
  }
  return Array.from(body.matchAll(HOOK_COMMAND), (match) => match[1]).filter(
    (path): path is string => path !== undefined && path.length > 0,
  );
}

/** What an install wrote, and what it moved out of the way. */
export interface FilterInstallReceipt {
  /** The real filter's path — rewritten on every install. */
  readonly filterPath: string;
  /** The path cmux's config names, now holding the shim. */
  readonly hookPath: string;
  /** Where the replaced script was copied, or `undefined` when nothing was there to replace. */
  readonly backupPath: string | undefined;
  /** The exact command that puts the owner's own hook back. */
  readonly restore: string;
}

/**
 * Where the backup of a replaced hook script goes.
 *
 * Deterministic, so the restore line an install prints can name it without having looked.
 *
 * @returns the backup path beside the hook itself
 */
export function hookBackupPath({ hookPath }: { hookPath: string }): string {
  return `${hookPath}.slopweaver.bak`;
}

/**
 * Write the filter and the shim, backing up whatever the shim replaces.
 *
 * @param paths the pin to read and the decision log to append, as the emitted script will see them
 * @param filterPath where the real filter goes
 * @param hookPath the path cmux's config names, which becomes the shim
 * @returns what was written, or the first refusal
 */
export function installFilter({
  paths,
  filterPath,
  hookPath,
}: {
  paths: FilterPaths;
  filterPath: string;
  hookPath: string;
}): Result<FilterInstallReceipt, MonitorError> {
  const script = buildFilterScript({ paths });
  if (script.isErr()) {
    return err(script.error);
  }
  const shim = buildFilterShim({ filterPath });
  if (shim.isErr()) {
    return err(shim.error);
  }
  const backupPath = hookBackupPath({ hookPath });
  try {
    mkdirSync(directoryOf({ path: filterPath }), { mode: DIR_MODE, recursive: true });
    writeFileAtomic({ contents: script.value, dirMode: DIR_MODE, fileMode: SCRIPT_MODE, path: filterPath });
    chmodSync(filterPath, SCRIPT_MODE);
  } catch (cause) {
    return err(MonitorErrors.filterUnwritable({ detail: errorMessage({ error: cause }), path: filterPath }));
  }
  const replaced = existsSync(hookPath);
  try {
    if (replaced && !existsSync(backupPath)) {
      // Never overwrite an existing backup: a second install would replace the owner's original with our own shim.
      copyFileSync(hookPath, backupPath);
    }
    mkdirSync(directoryOf({ path: hookPath }), { mode: DIR_MODE, recursive: true });
    writeFileAtomic({ contents: shim.value, dirMode: DIR_MODE, fileMode: SCRIPT_MODE, path: hookPath });
    chmodSync(hookPath, SCRIPT_MODE);
  } catch (cause) {
    return err(MonitorErrors.filterUnwritable({ detail: errorMessage({ error: cause }), path: hookPath }));
  }
  return ok({
    backupPath: replaced ? backupPath : undefined,
    filterPath,
    hookPath,
    restore: `cp ${backupPath} ${hookPath}`,
  });
}

/**
 * The directory one path sits in.
 *
 * Spelled here rather than imported so this module's only `node:path` need does not pull the whole import in
 * for a `lastIndexOf`.
 *
 * @param path the file
 * @returns its directory
 */
function directoryOf({ path }: { path: string }): string {
  const cut = path.lastIndexOf("/");
  if (cut <= 0) {
    return ".";
  }
  return path.slice(0, cut);
}

/** What `monitor filter status` found on disk. */
export interface FilterStatus {
  /** True when the shim is where cmux's config points. */
  readonly installed: boolean;
  /** True when the real filter is where the shim sends it. */
  readonly filterPresent: boolean;
  /** How many decisions the filter has recorded, and how many of those passed. */
  readonly decisions: { readonly judged: number; readonly passed: number } | undefined;
}

/**
 * Read what the filter has actually done, rather than what it was supposed to do.
 *
 * The decision counts are the falsifiable half: a filter cmux never ran records nothing, and that reads
 * differently from one recording every notification as passed.
 *
 * @param filterPath the real filter
 * @param hookPath the path cmux's config names
 * @param decisionsPath the decision log the emitted script appends to
 * @returns what is on disk
 */
export function readFilterStatus({
  filterPath,
  hookPath,
  decisionsPath,
}: {
  filterPath: string;
  hookPath: string;
  decisionsPath: string;
}): FilterStatus {
  const installed = shimPointsAtFilter({ filterPath, hookPath });
  let decisions: FilterStatus["decisions"];
  try {
    const lines = readFileSync(decisionsPath, "utf8")
      .split("\n")
      .filter((line) => line.trim().length > 0);
    decisions = { judged: lines.length, passed: lines.filter((line) => line.includes('"passed"')).length };
  } catch {
    // No log is a real answer — the filter has judged nothing — and is reported as `undefined`, never zero.
  }
  return { decisions, filterPresent: existsSync(filterPath), installed };
}

/**
 * Whether the script at the hook path is our shim for THIS filter.
 *
 * Matched on the filter's own path appearing in the file rather than on a marker comment, because a marker
 * is true of a shim pointing somewhere else entirely — a `--home` install, say, whose filter this one is not.
 *
 * @param filterPath the real filter
 * @param hookPath the path cmux's config names
 * @returns true when the hook hands off to this filter
 */
function shimPointsAtFilter({ filterPath, hookPath }: { filterPath: string; hookPath: string }): boolean {
  try {
    return readFileSync(hookPath, "utf8").includes(filterPath);
  } catch {
    return false;
  }
}
