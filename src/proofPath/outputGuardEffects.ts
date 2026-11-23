/**
 * The effectful half of the proof-output guard: canonicalise an output path, find the git work tree it sits
 * in, and render the refusal. `outputGuard.ts` owns the decision; this file only gathers its facts.
 *
 * The output is resolved the way the kernel will resolve it: one segment at a time from the root, following
 * each symlink as it is met, so `link/..` means the parent of the link's TARGET. A lexical `resolve()` first
 * would collapse `link/..` away and let the capture land in a checkout the guard never saw. The output
 * usually does not exist yet, so the walk stops at the first missing segment and appends the rest; a
 * missing directory holds no symlink, so that tail is safe to treat lexically. A dangling symlink is followed
 * too, because writing through one creates its target.
 */
import { execFileSync } from "node:child_process";
import { lstatSync, readlinkSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, sep } from "node:path";

import { hatchFor } from "../hatch/lookup.js";
import { hatchRefusalLines } from "../hatch/render.js";
import { gitEnv } from "../lib/gitRepo.js";
import { err, ok, type Result } from "../lib/result.js";
import { type ProofOutputLocation, proofOutputRefusal } from "./outputGuard.js";

/**
 * How long one git read here may take before it is killed. It is local work that answers in well under a
 * second on a healthy repository; two minutes, the bound `src/worktree/pruneGit.ts` and
 * `src/worktree/salvageScan.ts` already put on the same class of read, ends one wedged on a held lock, a FIFO
 * config or a prompt nobody can see instead of blocking the event loop for good. SIGKILL, because a child that
 * traps the default SIGTERM would outlive the bound.
 */
const GIT_READ_TIMEOUT_MS = 2 * 60_000;

/** Git's own wording when the directory it was pointed at is in no repository at all. */
const NOT_A_REPOSITORY = "not a git repository";

/** How many symlinks one walk follows before it refuses, as the kernel does with ELOOP. */
const MAX_SYMLINK_HOPS = 40;

/** Where a physical walk stands: the segments still to read, the deepest existing directory, and the tail. */
interface Walk {
  readonly queue: string[];
  readonly tail: string[];
  current: string;
  hops: number;
}

/** Take one segment the filesystem does not need to answer, returning false when it does. */
function stepLexically({ walk, segment }: { walk: Walk; segment: string }): boolean {
  if (segment === "" || segment === ".") {
    return true;
  }
  if (segment === ".." && walk.tail.length > 0) {
    walk.tail.pop();
    return true;
  }
  if (segment === "..") {
    walk.current = dirname(walk.current);
    return true;
  }
  // Past the first missing segment nothing exists, so nothing below it can be a symlink.
  if (walk.tail.length > 0) {
    walk.tail.push(segment);
    return true;
  }
  return false;
}

/** Take one segment below an existing directory: descend, follow a symlink, or start the missing tail. */
function stepOnDisk({ walk, segment, path }: { walk: Walk; segment: string; path: string }): void {
  const next = join(walk.current, segment);
  const entry = lstatSync(next, { throwIfNoEntry: false });
  if (entry === undefined) {
    walk.tail.push(segment);
    return;
  }
  if (!entry.isSymbolicLink()) {
    walk.current = next;
    return;
  }
  walk.hops += 1;
  if (walk.hops > MAX_SYMLINK_HOPS) {
    throw new Error(`more than ${String(MAX_SYMLINK_HOPS)} symlinks resolving ${path}`);
  }
  const target = readlinkSync(next);
  if (isAbsolute(target)) {
    walk.current = sep;
  }
  walk.queue.unshift(...target.split(sep));
}

/**
 * Resolve an absolute path physically: every existing segment's symlinks followed in order, and the
 * not-yet-created tail appended.
 */
function canonical({ path }: { path: string }): { resolved: string; existing: string } {
  const walk: Walk = { current: sep, hops: 0, queue: path.split(sep), tail: [] };
  while (walk.queue.length > 0) {
    const segment = walk.queue.shift()!;
    if (!stepLexically({ segment, walk })) {
      stepOnDisk({ path, segment, walk });
    }
  }
  // The spelling on disk, not the caller's: on a case-insensitive volume `proofhome` and `ProofHome` are one
  // directory, and every path the guard compares must agree with the work tree git reports for it.
  const existing = realpathSync.native(walk.current);
  return { existing, resolved: join(existing, ...walk.tail) };
}

/**
 * The environment git discovers a work tree under here: `gitEnv()`'s, with nothing left that stops the upward
 * search early. An ambient `GIT_CEILING_DIRECTORIES` or a filesystem boundary would hide an enclosing checkout
 * the kernel will still write into, and the question here is where the file lands, not what the caller scoped.
 * For the same reason an ambient `GIT_DIR` or `GIT_WORK_TREE` stays stripped: the checkout judged is the one
 * holding the location on disk, never one a shell variable points elsewhere.
 */
function discoveryEnv(): NodeJS.ProcessEnv {
  const env = gitEnv();
  delete env["GIT_CEILING_DIRECTORIES"];
  env["GIT_DISCOVERY_ACROSS_FILESYSTEM"] = "1";
  return env;
}

/** The work tree containing `dir`, or undefined when git says it is in none; any other git failure throws. */
function containingWorkTree({ dir }: { dir: string }): string | undefined {
  try {
    const top = execFileSync("git", ["-C", dir, "rev-parse", "--show-toplevel"], {
      encoding: "utf8",
      env: discoveryEnv(),
      stdio: ["ignore", "pipe", "pipe"],
      killSignal: "SIGKILL",
      timeout: GIT_READ_TIMEOUT_MS,
    });
    // Only git's own line ending comes off: a directory may be named with nothing but spaces.
    return realpathSync.native(top.replace(/\n$/, ""));
  } catch (error: unknown) {
    const stderr = typeof error === "object" && error !== null && "stderr" in error ? String(error.stderr) : "";
    if (stderr.includes(NOT_A_REPOSITORY)) {
      return undefined;
    }
    throw error;
  }
}

/**
 * Canonicalise an output path and gather what the guard decides on.
 *
 * @param cwd the directory a relative `output` is resolved against — the invocation's own
 * @param output the path the verb was asked to write
 * @param home the state home, which is a work tree the guard allows
 * @returns the location, or why it could not be established
 */
export function inspectProofOutputLocation({
  cwd,
  output,
  home,
}: {
  cwd: string;
  output: string;
  home: string;
}): Result<ProofOutputLocation> {
  try {
    const target = canonical({ path: isAbsolute(output) ? output : `${cwd}${sep}${output}` });
    const probe = statSync(target.existing).isDirectory() ? target.existing : dirname(target.existing);
    const containingGitRoot = containingWorkTree({ dir: probe });
    return ok({
      absolutePath: target.resolved,
      containingGitRoot,
      stateHomeRoot: canonical({ path: isAbsolute(home) ? home : `${cwd}${sep}${home}` }).resolved,
    });
  } catch (error: unknown) {
    return err([`could not tell whether ${output} is inside a git checkout: ${String(error)}`]);
  }
}

/**
 * Refuse, before any capture work, an output path a commit could carry into a pull request.
 *
 * Fails closed: a location that cannot be established is refused too, since the capture has not started.
 *
 * @param cwd the directory a relative `output` is resolved against
 * @param output the path the verb was asked to write
 * @param home the state home
 * @param env the environment, read only for the hatch
 * @returns nothing when the path is allowed, or the lines to print
 */
export function refuseProofOutputInTree({
  cwd,
  output,
  home,
  env,
}: {
  cwd: string;
  output: string;
  home: string;
  env: Readonly<Record<string, string | undefined>>;
}): Result<void> {
  if (env["SLOPWEAVER_ALLOW_PROOF_OUTPUT_IN_TREE"] === "1") {
    return ok(undefined);
  }
  const location = inspectProofOutputLocation({ cwd, home, output });
  if (location.isErr()) {
    return err(location.error);
  }
  const reason = proofOutputRefusal({ location: location.value });
  if (reason === undefined) {
    return ok(undefined);
  }
  return err([
    `${reason}; nothing was captured`,
    ...hatchRefusalLines({
      detail: "write it under $SLOPWEAVER_HOME/proof/<slug>/ or a scratchpad and attach it to the pull request body",
      hatch: hatchFor({ id: "proof-output-in-tree" }),
    }),
  ]);
}
