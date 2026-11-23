/*
 * What the stack-facts test files share: a Git fake keyed on cwd and argv, a `getPr`-only API fake, an ancestry
 * fake, the pull-request, stack-entry and worktree fixture builders, and the commit SHAs more than one file reads.
 * Every fake records what it was asked and throws on a question it was not given an answer for. A plain module,
 * not a `*.test.ts`, so no test registers twice. It moved here when the stack-facts suite was split by behaviour.
 */
import { errAsync, okAsync } from "neverthrow";

import type { GithubPushDeps } from "../../../../../../cli/commands/github/pushPrimitives.js";
import type { StackFactContext } from "../../../../../../cli/commands/github/stackFacts.js";
import type { GithubStackWorktree } from "../../../../../../cli/commands/github/stackWorktrees.js";
import type { GithubStackEntry } from "../../../../../../corpus/github/stack.js";
import type { WrittenPr } from "../../../../../../corpus/github/write.js";
import type { IngestError } from "../../../../../../lib/ingestError.js";
import { memoryDoorLedger } from "../../../../../doorLedgerFixture.js";

/** One Git read the fake answered, exactly as the module asked for it. */
interface GitRead {
  readonly cwd: string;
  readonly args: readonly string[];
}

/**
 * A Git fake keyed on `<cwd> :: <argv>`. An `Error` answer is thrown, exactly as a failed `execFileSync` read
 * would; a command with no answer at all throws too, so an unexpected read can never pass silently.
 *
 * @returns the push deps whose only working seam is `readGit`, and every read it answered, in order
 */
export function gitFake({ answers }: { answers: readonly (readonly [string, string | Error])[] }): {
  readonly git: GithubPushDeps;
  readonly reads: GitRead[];
} {
  const table = new Map(answers);
  const reads: GitRead[] = [];
  const git: GithubPushDeps = {
    cwd: () => {
      throw new Error("the stack facts must never read the process cwd");
    },
    doorLedger: memoryDoorLedger().port,
    out: () => {
      throw new Error("the stack facts must never print");
    },
    readGit: ({ cwd, args }) => {
      reads.push({ args, cwd });
      const key = `${cwd} :: ${args.join(" ")}`;
      const answer = table.get(key);
      if (answer === undefined) {
        throw new Error(`unexpected Git read: ${key}`);
      }
      if (answer instanceof Error) {
        throw answer;
      }
      return answer;
    },
    writeGit: () => {
      throw new Error("the stack facts must never write");
    },
  };
  return { git, reads };
}

/** One `getPr` request the API fake received. */
interface PrRead {
  readonly number: number;
  readonly owner: string;
  readonly repo: string;
}

/**
 * A `getPr`-only API fake answering by pull-request number, throwing on a number it was not given.
 *
 * @returns the API seam, and every `getPr` request it received, in order
 */
export function apiFake({ answers }: { answers: ReadonlyMap<number, WrittenPr | IngestError> }): {
  readonly api: StackFactContext["api"];
  readonly calls: PrRead[];
} {
  const calls: PrRead[] = [];
  return {
    api: {
      getPr: ({ number, owner, repo }) => {
        calls.push({ number, owner, repo });
        const answer = answers.get(number);
        if (answer === undefined) {
          throw new Error(`unexpected getPr #${String(number)}`);
        }
        return "kind" in answer ? errAsync(answer) : okAsync(answer);
      },
    },
    calls,
  };
}

/** One ancestry question the fake was asked. */
interface AncestryCall {
  readonly ancestor: string;
  readonly descendant: string;
  readonly cwd: string;
}

/**
 * An ancestry fake answering by descendant ref, throwing on any ref it was not given.
 *
 * @returns the ancestry seam, and every question it was asked, in order
 */
export function ancestryFake({ answers }: { answers: ReadonlyMap<string, boolean> }): {
  readonly isAncestor: StackFactContext["isAncestor"];
  readonly calls: AncestryCall[];
} {
  const calls: AncestryCall[] = [];
  return {
    calls,
    isAncestor: ({ ancestor, descendant, cwd }) => {
      calls.push({ ancestor, cwd, descendant });
      const answer = answers.get(descendant);
      if (answer === undefined) {
        throw new Error(`unexpected ancestry question for ${descendant}`);
      }
      return answer;
    },
  };
}

/**
 * A complete `WrittenPr`; only `commits` and `head.sha` are read by the module, so the rest stay inert.
 *
 * @returns an open draft pull request carrying the given number, commit count and head
 */
export function writtenPr({
  number,
  commits,
  headSha,
  headRef,
}: {
  number: number;
  commits: number;
  headSha: string;
  headRef: string;
}): WrittenPr {
  return {
    authorId: 4401,
    baseRef: "pr-payload-base",
    baseRepoFullName: "payload-owner/payload-repo",
    body: "payload body text",
    commits,
    draft: true,
    head: { label: "payload-label", ref: headRef, repoFullName: "payload-head/payload-fork", sha: headSha },
    htmlUrl: `https://example.invalid/pull/${String(number)}`,
    mergedAtIso: undefined,
    nodeId: `PR_node_${String(number)}`,
    number,
    stack: undefined,
    state: "open",
    title: "payload title words",
    updatedAtIso: "2026-09-02T11:22:33Z",
  };
}

/**
 * One native stack entry, every field supplied by the scenario — `state` included, so a closed pull request
 * that never merged can sit beside a merged one and merge status cannot be read off `state`.
 *
 * @returns the stack entry, field for field
 */
export function entry({
  number,
  headRef,
  baseRef,
  mergedAtIso,
  state,
}: {
  number: number;
  headRef: string;
  baseRef: string;
  mergedAtIso: string | undefined;
  state: GithubStackEntry["state"];
}): GithubStackEntry {
  return { baseRef, headRef, mergedAtIso, number, state };
}

/**
 * One `git worktree list --porcelain -z` record's fields.
 *
 * @returns an attached, unlocked, non-prunable worktree with the branch checked out
 */
export function worktree({
  path,
  branch,
  headSha,
}: {
  path: string;
  branch: string;
  headSha: string;
}): GithubStackWorktree {
  return { bare: false, branch, detached: false, headSha, locked: false, path, prunable: false };
}

export const SHA_TIP_ALPHA = "a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1";
export const SHA_HEAD_ALPHA = "b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2";
export const SHA_WT_ALPHA = "c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3";
export const SHA_TIP_QUEBEC = "d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4";
export const SHA_WT_LISTED = "f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6";
