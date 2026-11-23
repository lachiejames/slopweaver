/**
 * The git edges only a BATCH lap reaches, for production: the simulated squash of one member onto the chain,
 * what `github merge`'s guard will measure for a member over the tip it lands on, and a landed commit's parents
 * and tree. `./lapShell.ts` spreads them into the lap's deps; the decisions are `./lapBatchCore.ts`'s.
 */

import { execFileSync } from "node:child_process";
import { err, ok, type Result } from "../../../lib/result.js";
import { measureMergeFacts } from "../../../outbound/github/mergeFacts.js";
import { isAncestor } from "./gitAncestry.js";
import type { LandedCommit, MemberMergeFacts } from "./lapBatchCore.js";
import type { GithubLapDeps, SquashOutcome } from "./lapDeps.js";
import { type LapError, LapErrors } from "./lapErrors.js";
import { lapOwnEnv, runLapCommand } from "./lapProcess.js";

/**
 * The identity a simulated squash commit is written under. The commit never leaves this machine — it is checked
 * out and lapped, never pushed — so it carries a fixed name rather than the seat's, which `lapOwnEnv` keeps out.
 * Its sha is a handle for the chain, never a prediction of the squash GitHub will write.
 */
const SIMULATED_COMMIT_IDENTITY: readonly string[] = [
  "-c",
  "user.name=slopweaver lap",
  "-c",
  "user.email=lap@slopweaver.invalid",
];

/** A clean merge's whole stdout, byte for byte: one object id (SHA-1's 40 hex, or SHA-256's 64) and its newline. */
const CLEAN_TREE_OUTPUT = /^(?:[0-9a-f]{40}|[0-9a-f]{64})\n$/u;

/** How long one in-memory merge may take before it is killed: a local object read, never a network fetch. */
const MERGE_TREE_TIMEOUT_MS = 2 * 60_000;

/**
 * The stdout of a merge-tree that exited 1 (it conflicted), read off the thrown error; `undefined` for any other
 * failure, a timeout's kill included, which is never a conflict.
 */
function conflictedStdout({ error }: { error: unknown }): string | undefined {
  if (typeof error !== "object" || error === null || !("status" in error) || !("stdout" in error)) {
    return undefined;
  }
  if (error.status !== 1 || typeof error.stdout !== "string") {
    return undefined;
  }
  return error.stdout;
}

/**
 * A batch's simulated squash of `head` onto `onto`. `git merge-tree --write-tree` exits 0 with the merged tree,
 * or 1 with the tree and the conflicted paths after it (`--name-only`); anything else is a failure. A clean tree
 * is recorded with ONE parent, `onto`, as GitHub records a squash. Objects are read with `--no-replace-objects`,
 * as the plan sources are, so a local replace ref cannot stand in for a fetched head.
 */
function simulateSquash({
  cwd,
  onto,
  head,
  message,
}: {
  cwd: string;
  onto: string;
  head: string;
  message: string;
}): Result<SquashOutcome, LapError> {
  const args = ["--no-replace-objects", "merge-tree", "--write-tree", "--name-only", "--no-messages", onto, head];
  let stdout: string;
  let conflicted: boolean;
  try {
    stdout = execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      env: lapOwnEnv({ env: process.env }),
      killSignal: "SIGKILL",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: MERGE_TREE_TIMEOUT_MS,
    });
    conflicted = false;
  } catch (error: unknown) {
    const conflictOutput = conflictedStdout({ error });
    if (conflictOutput === undefined) {
      const cause = error instanceof Error ? error.message : String(error);
      return err(LapErrors.commandFailed({ cause, command: `git ${args.join(" ")}` }));
    }
    stdout = conflictOutput;
    conflicted = true;
  }
  const lines = stdout.split("\n").filter((line) => line.length > 0);
  const [tree, ...rest] = lines;
  if (conflicted) {
    return ok({ kind: "conflict", paths: [...new Set(rest)] });
  }
  // A clean `--name-only` merge prints its tree and nothing else. Anything more is something else writing to the
  // same stdout (a configured merge driver does), so no line of it can be trusted as the tree.
  if (!CLEAN_TREE_OUTPUT.test(stdout)) {
    const cause = `a clean merge-tree printed ${String(stdout.split("\n").length - 1)} line(s), not exactly one object id`;
    return err(LapErrors.commandFailed({ cause, command: `git ${args.join(" ")}` }));
  }
  const committed = runLapCommand({
    args: [...SIMULATED_COMMIT_IDENTITY, "commit-tree", tree!, "-p", onto, "-m", message],
    cwd,
    file: "git",
  });
  return committed.map((commit) => ({ commit, kind: "clean" as const, tree: tree! }));
}

/**
 * A commit's parents and tree, as `rev-list --parents` and `rev-parse <sha>^{tree}` read them with
 * `--no-replace-objects`, so a local replace ref cannot pass GitHub's real landing off as the predicted one.
 */
function commitFacts({ cwd, sha }: { cwd: string; sha: string }): Result<LandedCommit, LapError> {
  const real = "--no-replace-objects";
  const parents = runLapCommand({ args: [real, "rev-list", "--parents", "--max-count=1", sha], cwd, file: "git" });
  const tree = runLapCommand({ args: [real, "rev-parse", `${sha}^{tree}`], cwd, file: "git" });
  if (parents.isErr()) {
    return err(parents.error);
  }
  if (tree.isErr()) {
    return err(tree.error);
  }
  const [self, ...rest] = parents.value.split(" ");
  return ok({ parents: rest, sha: self!, tree: tree.value });
}

/** What `github merge` will measure for `head` over `base`, from the guard's own measurement and ancestry read. */
function memberMergeFacts({
  cwd,
  base,
  head,
}: {
  cwd: string;
  base: string;
  head: string;
}): Result<MemberMergeFacts, LapError> {
  let facts: ReturnType<typeof measureMergeFacts>;
  try {
    facts = measureMergeFacts({ base, cwd, head });
  } catch (error: unknown) {
    const cause = error instanceof Error ? error.message : String(error);
    return err(LapErrors.commandFailed({ cause, command: `measuring ${base}...${head} as github merge does` }));
  }
  return isAncestor({ ancestor: base, cwd, descendant: head })
    .mapErr((error) =>
      LapErrors.commandFailed({ cause: error.message, command: `git merge-base --is-ancestor ${base} ${head}` }),
    )
    .map((headContainsTip) => ({
      baseMoved: facts.baseAhead,
      headChanged: facts.diff.map((entry) => entry.path),
      headContainsTip,
      reverted: facts.reverted,
    }));
}

/**
 * The batch seams over the repository at `cwd`.
 *
 * @param cwd the checkout every git read and write runs in
 * @returns the three seams `./lapDeps.ts` declares for a batch
 */
export function lapBatchSeams({
  cwd,
}: {
  cwd: string;
}): Pick<GithubLapDeps, "commitFacts" | "memberMergeFacts" | "simulateSquash"> {
  return {
    commitFacts: ({ sha }) => commitFacts({ cwd, sha }),
    memberMergeFacts: ({ base, head }) => memberMergeFacts({ base, cwd, head }),
    simulateSquash: ({ onto, head, message }) => simulateSquash({ cwd, head, message, onto }),
  };
}
