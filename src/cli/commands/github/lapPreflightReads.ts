/**
 * The two reads `slopweaver github lap` makes before any lane runs, as production edges: whether the running
 * CLI's own plan sources match the head's, and the merge hold read FAIL-CLOSED. What each read MEANS is judged in
 * `./lapVerdict.ts`; the rest of the lap's edges are `./lapShell.ts`'s.
 */

import { lstatSync, readdirSync, readFileSync, readlinkSync, type Stats } from "node:fs";
import { join } from "node:path";
import { err, ok, type Result } from "../../../lib/result.js";
import { safeJsonParse } from "../../../lib/safeJson.js";
import { mergeHoldPath } from "../../../outbound/github/mergeHoldStore.js";
import { type LapError, LapErrors } from "./lapErrors.js";
import { LAP_PLAN_SOURCES } from "./lapPlanSources.js";
import { runLapCommand, runLapRead } from "./lapProcess.js";
import { differingPlanSources, presentUnderExactName, type StandingHold, standingHoldOf } from "./lapVerdict.js";

/** The names one directory holds, or `undefined` when it is absent; any other failure throws. */
function directoryEntries({ path }: { path: string }): readonly string[] | undefined {
  try {
    return readdirSync(path);
  } catch (error: unknown) {
    const code = error instanceof Error && "code" in error ? error.code : undefined;
    if (code === "ENOENT" || code === "ENOTDIR") {
      return undefined;
    }
    throw error;
  }
}

/**
 * A plan source's bytes as git would record them: a symlink is its link text, never what it points at, so a
 * dangling one still reads as present; a file is its contents; no entry at all is
 * `undefined`, and so is an entry present only under another CASE of the name, since a case-insensitive
 * filesystem would otherwise open it for this one. Any other failure, or any other kind of entry (a directory),
 * THROWS, and the caller turns that into a refusal rather than a match.
 */
function localPlanSourceBytes({ root, relative }: { root: string; relative: string }): Uint8Array | undefined {
  if (!presentUnderExactName({ entriesOf: (dir) => directoryEntries({ path: join(root, dir) }), relative })) {
    return undefined;
  }
  const path = join(root, relative);
  let entry: Stats;
  try {
    entry = lstatSync(path);
  } catch (error: unknown) {
    const code = error instanceof Error && "code" in error ? error.code : undefined;
    if (code === "ENOENT" || code === "ENOTDIR") {
      return undefined;
    }
    throw error;
  }
  if (entry.isSymbolicLink()) {
    return Buffer.from(readlinkSync(path));
  }
  if (entry.isFile()) {
    return readFileSync(path);
  }
  throw new Error(`${path} is neither a file nor a symlink, so it cannot match a plan source at the head`);
}

/**
 * One plan source's blob at the head, read past any `refs/replace/<head>`. A failed read THROWS, and the caller
 * turns that into a refusal rather than a match.
 */
function blobAtHead({ cwd, headSha, path }: { cwd: string; headSha: string; path: string }): Uint8Array {
  const read = runLapRead({
    args: ["--no-replace-objects", "cat-file", "blob", `${headSha}:${path}`],
    cwd,
    file: "git",
  });
  if (read.isErr()) {
    throw new Error(read.error.message);
  }
  return read.value;
}

/**
 * The hold document read FAIL-CLOSED, never through the shared store's tolerant read: only a missing file is
 * `clear`; a file that exists but cannot be read (EACCES, a directory) or parsed is `unreadable`, so a lap can
 * never take, merge under and release a hold over one it could not see.
 *
 * @param home the state home whose hold document is read
 * @param slug the `owner/repo` the lap was invoked on, in whatever case the caller typed
 * @returns clear, held and by whom, or unreadable and why
 */
export function readStandingHold({ home, slug }: { home: string; slug: string }): StandingHold {
  const path = mergeHoldPath({ home });
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error: unknown) {
    const code = error instanceof Error && "code" in error ? error.code : undefined;
    if (code === "ENOENT") {
      return { kind: "clear" };
    }
    return { kind: "unreadable", path, why: String(error) };
  }
  let raw: unknown;
  try {
    raw = safeJsonParse({ label: "the merge hold", text });
  } catch (error: unknown) {
    return { kind: "unreadable", path, why: String(error) };
  }
  return standingHoldOf({ path, raw, slug });
}

/**
 * Every plan-source file whose bytes in the RUNNING CLI's own tree differ from the same path at `headSha`. The
 * plan a lap runs is compiled into the code that is running (`lapPlan()`), so that tree is the side compared,
 * never the invoking directory: a runner checked out at the batch's own CI change, invoked from a seat standing
 * in another worktree, refused every batch that changed a plan source.
 *
 * The head is read through git in the INVOKING checkout, which is where the lap fetched it, from that checkout's
 * root: from a tracked subdirectory, `ls-tree` would resolve its paths under it while `<sha>:<path>` reads the
 * root. A path the head lacks reads as absent there; any other `git cat-file` failure is an error, never a
 * match. The head is read with `--no-replace-objects`, so a local `refs/replace/<head>` cannot substitute
 * another commit's tree for the one fetched.
 *
 * @param cwd the directory the lap was invoked in, whose checkout holds the fetched head
 * @param cliTree the root of the tree the running CLI's own code lives in, whose plan sources are compared
 * @param headSha the fetched head commit whose plan sources are compared
 * @returns each differing plan source, or the read that failed
 */
export function planSourcesDiffering({
  cwd: invokedIn,
  cliTree,
  headSha,
}: {
  cwd: string;
  cliTree: string;
  headSha: string;
}): Result<readonly string[], LapError> {
  // Read raw, never through `runLapCommand`'s trim: a root ending in whitespace is a different directory from
  // the trimmed name, which could be a sibling checkout. Only git's own newline goes.
  const root = runLapRead({ args: ["rev-parse", "--show-toplevel"], cwd: invokedIn, file: "git" });
  if (root.isErr()) {
    return err(root.error);
  }
  const cwd = root.value.toString("utf8").replace(/\n$/u, "");
  const listed = runLapCommand({
    args: ["--no-replace-objects", "ls-tree", "--name-only", headSha, "--", ...LAP_PLAN_SOURCES],
    cwd,
    file: "git",
  });
  if (listed.isErr()) {
    return err(listed.error);
  }
  const atHead = new Set(listed.value.split("\n").filter((line) => line.length > 0));
  try {
    return ok(
      differingPlanSources({
        readAtHead: (path) => (atHead.has(path) ? blobAtHead({ cwd, headSha, path }) : undefined),
        readLocal: (path) => localPlanSourceBytes({ relative: path, root: cliTree }),
        sources: LAP_PLAN_SOURCES,
      }),
    );
  } catch (error: unknown) {
    return err(
      LapErrors.commandFailed({
        cause: error instanceof Error ? error.message : String(error),
        command: "reading a plan source here or at the head (lstat, readlink, git cat-file)",
      }),
    );
  }
}
