/**
 * Restart a stale built CLI, in place, on the SOURCE of the checkout its manifest names — the edited code, run under
 * tsx's loader, never the older JavaScript beside it.
 *
 * A seat's worktree is emitted a built CLI when it is made (`src/worktree/provision.ts`), and the first edit to its
 * `src/` makes that build stale. Rebuilding is the seat's to skip — the owner's no-local-CI ruling bars it — so the
 * stale build hands the invocation to the source instead: same pid, same three descriptors, same Node flags, same
 * verb words. `./invocationGuard.ts` decides WHEN; this module is only the HOW, and what it needs to be possible.
 *
 * The command is the launcher's own marked start (`bin/slopweaver`, the `launcher_no_tsx_wrapper` arm): `node
 * --require <tsx>/preflight.cjs --import <loader URL> <root>/src/cli/index.ts …`, with no tsx WRAPPER, so no process
 * waits on a second copy of itself. Every path comes from the manifest's `root` and nowhere else: never the working
 * directory, never the main checkout, never the launcher's shared dependency tree — the code and its loader belong
 * to the one checkout whose source moved.
 *
 * It cannot loop. The source entry sits under `<root>/src`, where no build manifest normally is, so the guard there
 * answers `ran: false` and the verb dispatches once (`builtRootOf`, `./guard.ts`). A manifest planted there anyway —
 * `dev build --out` can name any directory — still cannot re-enter this restart: a process loaded from `.ts` never
 * restarts on source (`runsFromSource`, `./guard.ts`), so it refuses as a stale build always did.
 *
 * MEASURED on v24.21.0 (`src/cli/commands/talk/courierReexec.ts`): an exec of a missing file ABORTS the process
 * rather than throwing, so every file the exec reaches is checked first ({@link sourceLaunchAvailable}).
 */
import { accessSync, constants, statSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { err, ok, type Result } from "#lib/result.js";
import { restartEnv } from "./restart.js";

/** A checkout whose source an invocation can be restarted on. */
export interface SourceLaunch {
  /** The checkout root, absolute — the stale manifest's own `root`. */
  readonly root: string;
}

/** This Node cannot replace its own image. */
export interface NoExecveError {
  readonly code: "NO_EXECVE";
  readonly message: string;
}

/** A file the source restart would exec into is not a readable regular file — absent, a directory, or unreadable. */
export interface SourceFileMissingError {
  readonly code: "NO_TSX_PREFLIGHT" | "NO_TSX_LOADER" | "NO_SOURCE_ENTRY";
  readonly message: string;
  readonly path: string;
}

/** Why an invocation cannot be restarted on its checkout's source. */
export type SourceLaunchError = NoExecveError | SourceFileMissingError;

/** Factories for {@link SourceLaunchError}. */
export const SourceLaunchErrors = {
  fileMissing: ({ code, path }: { code: SourceFileMissingError["code"]; path: string }): SourceFileMissingError => ({
    code,
    message: `${path} is not a readable file to restart on`,
    path,
  }),
  noExecve: ({ version }: { version: string }): NoExecveError => ({
    code: "NO_EXECVE",
    message: `this Node (${version}) has no process.execve, so it cannot restart on the source`,
  }),
} as const;

/** The files one checkout's source restart reaches, in the order a reader would check them. */
function sourceFiles({ root }: { root: string }): {
  readonly preflight: string;
  readonly loader: string;
  readonly entry: string;
} {
  const tsxDist = join(root, "node_modules", "tsx", "dist");
  return {
    entry: join(root, "src", "cli", "index.ts"),
    loader: join(tsxDist, "loader.mjs"),
    preflight: join(tsxDist, "preflight.cjs"),
  };
}

/**
 * Whether an invocation can be restarted on this checkout's source: this Node can exec, and the tsx preflight, the
 * tsx loader and the CLI's source entry all stand inside the checkout itself as readable regular files. Existence is
 * not enough: a directory or an unreadable file there would pass, the fallback line would print, and Node would fail
 * AFTER the exec, where the four-line refusal can no longer be given.
 *
 * @param root the checkout root, absolute — the stale manifest's `root`
 * @param execveAvailable whether `process.execve` exists on this Node
 * @param readableFile whether a path is a regular file this process can read; production passes {@link isReadableFile}
 * @param version this Node's version, named when it cannot exec
 * @returns the launch, or the first thing missing
 */
export function sourceLaunchAvailable({
  root,
  execveAvailable,
  readableFile,
  version,
}: {
  root: string;
  execveAvailable: boolean;
  readableFile: (options: { path: string }) => boolean;
  version: string;
}): Result<SourceLaunch, SourceLaunchError> {
  if (!execveAvailable) {
    return err(SourceLaunchErrors.noExecve({ version }));
  }
  const files = sourceFiles({ root });
  const required = [
    { code: "NO_TSX_PREFLIGHT", path: files.preflight },
    { code: "NO_TSX_LOADER", path: files.loader },
    { code: "NO_SOURCE_ENTRY", path: files.entry },
  ] as const;
  const missing = required.find(({ path }) => !readableFile({ path }));
  if (missing !== undefined) {
    return err(SourceLaunchErrors.fileMissing(missing));
  }
  return ok({ root });
}

/**
 * Whether a path is a regular file this process can read — following a symlink, as the exec's own open would.
 *
 * @param path the file the exec would reach
 * @returns false for an absent path, a directory or any non-regular file, and a file this process cannot read
 */
export function isReadableFile({ path }: { path: string }): boolean {
  try {
    if (!statSync(path).isFile()) {
      return false;
    }
    accessSync(path, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * {@link sourceLaunchAvailable} over the real process and file system.
 *
 * @param root the checkout root, absolute
 * @returns the launch, or the first thing missing
 */
export function productionSourceLaunch({ root }: { root: string }): Result<SourceLaunch, SourceLaunchError> {
  return sourceLaunchAvailable({
    execveAvailable: process.execve !== undefined,
    readableFile: isReadableFile,
    root,
    version: process.version,
  });
}

/**
 * The new image's argv: the same Node and Node flags, then tsx's preflight and loader, then the checkout's source
 * entry in place of the built one, then the verb's own words.
 *
 * The loader goes in as a URL built by node itself, as the launcher's does: a raw path or a hand-built `file://`
 * breaks on a space or a `%`.
 *
 * @param execPath this Node's own binary
 * @param execArgv the Node flags this process started with — a heap ceiling or `--env-file` among them
 * @param argv this process's argv — Node, then the built entrypoint, then the verb's words
 * @param root the checkout whose source runs
 * @returns the argv to exec, its first entry the binary
 */
export function sourceRestartArgv({
  execPath,
  execArgv,
  argv,
  root,
}: {
  execPath: string;
  execArgv: readonly string[];
  argv: readonly string[];
  root: string;
}): readonly string[] {
  const files = sourceFiles({ root });
  return [
    execPath,
    ...execArgv,
    "--require",
    files.preflight,
    "--import",
    pathToFileURL(files.loader).href,
    files.entry,
    ...argv.slice(2),
  ];
}

/**
 * Exec the checkout's source in place of this process. It returns only when the exec cannot be attempted.
 *
 * The environment is the fresh-build restart's own ({@link restartEnv}): the console marker closed, every other
 * variable kept.
 *
 * @param argv this process's argv
 * @param env this process's environment
 * @param root the checkout whose source runs
 * @returns why the restart could not be attempted
 */
export function restartOnSource({
  argv,
  env,
  root,
}: {
  argv: readonly string[];
  env: NodeJS.ProcessEnv;
  root: string;
}): string {
  const launch = productionSourceLaunch({ root });
  if (launch.isErr()) {
    return `slopweaver: [stale-build] ${launch.error.message}`;
  }
  // Checked by the launch above; repeated so the compiler sees it on the call it guards.
  if (process.execve === undefined) {
    return `slopweaver: [stale-build] ${SourceLaunchErrors.noExecve({ version: process.version }).message}`;
  }
  return process.execve(
    process.execPath,
    [...sourceRestartArgv({ argv, execArgv: process.execArgv, execPath: process.execPath, root })],
    restartEnv({ env }),
  );
}
