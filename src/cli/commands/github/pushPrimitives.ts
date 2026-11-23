/**
 * The GitHub verbs' push wiring: the injectable edges they push and measure through, the production wiring of
 * them, and the plan inspection `github push` runs before it sends anything. The ordering every push goes
 * through — gate, push, read back — is `../../../admit/githubPush.ts`'s `pushAndVerify`.
 *
 * Its own module so the carry gate (`./stackCarryRun.ts`) can share the edges without a module cycle:
 * `pushRun.ts` has to CALL the carry gate, and the carry gate has to push, so what both need cannot live in
 * either of them.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { type DoorLedgerPort, doorLedgerPort } from "../../../admit/doorLedgerPort.js";
import {
  type GithubPushEdges,
  type GithubPushFacts,
  type GithubPushPlan,
  gitFailureLine,
  type PrePushGateOutcome,
  type PrePushGateRequest,
} from "../../../admit/githubPush.js";
import { readGit, writeGit } from "../../../admit/gitTransport.js";
import { refuseProofPathHead } from "../../../admit/pushProofPathGate.js";
import { refuseDirtyWorkingTree } from "../../../admit/pushWorkingTreeGate.js";
import { stripGitEnv } from "../../../codex/gitRun.js";
import { githubToken } from "../../../config.js";
import { type GithubWriteApi, makeGithubWriteApi } from "../../../corpus/github/write.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import {
  type InstallationIdentifiersReader,
  readInstallationIdentifiers,
} from "../../../outbound/github/installationIdentifiersRead.js";
import { patchIdFrom } from "../../../outbound/github/proof.js";
import { githubWritePrivacy } from "../../../outbound/github/writePrivacy.js";
import type { BaseFreshnessRunDeps } from "./baseFreshnessRun.js";
import { GithubVerbErrors, type GithubVerbResult } from "./errors.js";
import type { MergeHoldDeps } from "./holdDeps.js";
import { runPrePushGate } from "./prePushGateRun.js";
import {
  githubPushPlan,
  githubRepoFromRemote,
  NO_BASE_FRESHNESS_ACKNOWLEDGEMENT,
  NO_ORPHANS_ACCEPTED,
  parseRemoteSnapshot,
} from "./pushCore.js";
import { type ReadQueueGate, readQueueGate } from "./queueGateRun.js";
import type { StackCarryDeps } from "./stackCarryDeps.js";
import { stackIsAncestor } from "./stackFacts.js";

/** The governed push's Git edges, plus everything a GitHub verb measures and records around a push. */
export interface GithubPushDeps extends GithubPushEdges {
  readonly cwd: () => string;
  /** The door ledger every push-shaped write (the push, a stack verb's push, a self-review round) records through. */
  readonly doorLedger: DoorLedgerPort;
  /**
   * The edge's own `prePushGate`, narrowed so a verb's refusal keeps its typed GitHub-verb `code` rather than
   * the bare `{ message }` the admit layer needs.
   */
  readonly prePushGate?: ((args: PrePushGateRequest) => GithubVerbResult<PrePushGateOutcome>) | undefined;
  /** Optional because push-only test fakes and installations never touch this capability. */
  readonly selfReview?: GithubPushSelfReviewDeps | undefined;
  /**
   * Optional so an existing caller that never checked base freshness is not forced to supply one. Absent in
   * production wiring itself — `runGithubPush` builds the real edges from `this` at the point of use, which
   * keeps `productionGithubPushDeps()`'s own returned shape unchanged for every caller that never reads it.
   */
  readonly baseFreshness?: BaseFreshnessRunDeps | undefined;
  /**
   * The merge hold's own edges, read on a `base-moved` refusal so the remedy names the lap that lands rather
   * than the one that loses. Optional for exactly the reason {@link baseFreshness} is, and built from the real
   * document at the point of use when absent.
   */
  readonly hold?: MergeHoldDeps | undefined;
  /**
   * Measure the patch id of what this branch contributes to its base — the `gold` anchor that survives a
   * rebase. `ok(null)` means the branch contributes no diff at all, which is a real answer rather than a
   * fault; `err` means the measurement itself failed, which is a different thing to tell an author.
   *
   * Optional for the same reason {@link selfReview} is: a fake that never exercised this capability keeps
   * compiling, and a driver without it says so instead of silently printing nothing.
   */
  readonly readPatchId?:
    ((args: { cwd: string; base: string; head: string }) => Result<string | null, string>) | undefined;
  /**
   * Read what the base branch's native merge queue gates on, so a `base-moved` head the queue already tests
   * is permitted rather than sent round another rebase-and-revalidate lap.
   *
   * Called ONLY on a measured `base-moved`, so the ordinary fresh push still reaches no network at all.
   * Optional for the same reason {@link baseFreshness} is; absent, or answering `undefined`, the refusal
   * stands exactly as it did before this edge existed.
   */
  readonly readQueueGate?: ReadQueueGate | undefined;
  /**
   * The GitHub, ancestry and token edges the carry gate reads the native stack through — so a push of a
   * mid-stack entry carries every entry above it or refuses by name (`./stackCarryRun.ts`).
   *
   * Optional for the same reason {@link readQueueGate} is: a push-only test fake keeps compiling. Unlike the
   * others, though, absent means the gate CANNOT RUN AT ALL — there is no in-git fallback for "what is
   * stacked above this branch". {@link DEFAULT_DEPS} always supplies it, so the shipped verb is always gated;
   * a driver that omits it is one that has no stacks to protect, and says so by omitting it.
   */
  readonly stackCarry?: StackCarryDeps | undefined;
  /**
   * The installation's own identifiers for the push target, which the commit-message scan's identifier half
   * forgives (`./pushCommitMessages.ts`). Optional for the same reason {@link readQueueGate} is; absent, nothing
   * is forgiven, which only ever refuses more.
   */
  readonly installationIdentifiers?: InstallationIdentifiersReader | undefined;
}

/** GitHub and form edges needed only when --self-review is supplied. */
export interface GithubPushSelfReviewDeps {
  readonly makeApi: (args: { home: string; token: string }) => GithubWriteApi;
  readonly now: () => Date;
  readonly readForm: (args: { source: string }) => string;
}

/**
 * How much diff the patch-id measurement holds in memory at once.
 *
 * Node's default for a captured child is 1 MiB, and the failure past it is ENOBUFS — a THROW rather than a
 * short read, so a truncated diff can never be hashed as if it were whole. 64 MiB is far above any
 * review-sized diff while staying a bound rather than an invitation.
 */
const PATCH_MAX_BYTES = 64 * 1024 * 1024;

/**
 * How long each half of the patch-id measurement may take. Both are local — a diff of what one branch
 * contributes, then a hash of it — and finish in well under a second on a review-sized change; two minutes,
 * the bound the tree's other local git reads carry, ends one wedged on a held lock rather than blocking the
 * event loop for good. SIGKILL, because a child that traps the default SIGTERM would outlive the bound.
 */
const PATCH_TIMEOUT_MS = 2 * 60_000;

/**
 * `git diff base...head | git patch-id --verbatim`, as two isolated calls rather than a shell pipeline.
 *
 * `stripGitEnv` for the reason `gitAncestry` documents from a live incident: `yarn validate` runs as a
 * `pre-push` hook and exports `GIT_DIR`/`GIT_WORK_TREE` into every child, which override an explicit `cwd`
 * and resolve an entirely different repository's objects. `--no-replace-objects` because a replace ref never
 * travels with a push, so a local one would hash history CI never sees.
 */
function readPatchId({ cwd, base, head }: { cwd: string; base: string; head: string }): Result<string | null, string> {
  const env = stripGitEnv({ env: process.env });
  try {
    const patch = execFileSync("git", ["--no-replace-objects", "diff", `${base}...${head}`], {
      cwd,
      encoding: "utf8",
      env,
      maxBuffer: PATCH_MAX_BYTES,
      stdio: ["ignore", "pipe", "pipe"],
      killSignal: "SIGKILL",
      timeout: PATCH_TIMEOUT_MS,
    });
    return ok(
      patchIdFrom({
        output: execFileSync("git", ["patch-id", "--verbatim"], {
          cwd,
          encoding: "utf8",
          env,
          input: patch,
          maxBuffer: PATCH_MAX_BYTES,
          stdio: ["pipe", "pipe", "pipe"],
          killSignal: "SIGKILL",
          timeout: PATCH_TIMEOUT_MS,
        }),
      }),
    );
  } catch (error: unknown) {
    return err(gitFailureLine({ error }));
  }
}

/** The production edges, as one value so `productionGithubPushDeps` and every default parameter share it. */
export const DEFAULT_DEPS: GithubPushDeps = {
  cwd: () => process.cwd(),
  doorLedger: doorLedgerPort(),
  installationIdentifiers: readInstallationIdentifiers,
  out: logger.out,
  prePushGate: runPrePushGate,
  readGit,
  readPatchId,
  readQueueGate,
  stackCarry: {
    isAncestor: stackIsAncestor,
    makeApi: ({ home, token }) => makeGithubWriteApi({ privacy: githubWritePrivacy({ home }), token }),
    token: ({ home }) => githubToken({ home }),
  },
  selfReview: {
    makeApi: ({ home, token }) => makeGithubWriteApi({ privacy: githubWritePrivacy({ home }), token }),
    now: () => new Date(),
    readForm: ({ source }) => (source === "-" ? readFileSync(0, "utf8") : source),
  },
  writeGit,
};

/**
 * The production Git and output edges.
 *
 * @returns the real argv-array Git readers, streaming writer and stdout sink
 */
export function productionGithubPushDeps(): GithubPushDeps {
  return DEFAULT_DEPS;
}

/**
 * Resolve one owner/name repo slug already validated from the Git remote.
 *
 * @param slug the `owner/name` string every push plan already carries
 * @returns its two halves
 */
export function ownerRepoOf({ slug }: { slug: string }): { readonly owner: string; readonly repo: string } {
  const separator = slug.indexOf("/");
  if (separator <= 0 || separator === slug.length - 1) {
    throw new Error(`repository is not owner/name: ${slug}`);
  }
  return { owner: slug.slice(0, separator), repo: slug.slice(separator + 1) };
}

/** Read every local fact without invoking the network. */
function localFacts({
  cwd,
  remote,
  deps,
}: {
  cwd: string;
  remote: string;
  deps: GithubPushDeps;
}): Omit<GithubPushFacts, "defaultBranch" | "remoteBranchSha"> {
  const repoRoot = deps.readGit({ args: ["rev-parse", "--show-toplevel"], cwd });
  const branch = deps.readGit({ args: ["symbolic-ref", "--quiet", "--short", "HEAD"], cwd: repoRoot });
  const localSha = deps.readGit({ args: ["rev-parse", "HEAD"], cwd: repoRoot });
  const remoteUrl = deps.readGit({ args: ["remote", "get-url", remote], cwd: repoRoot });
  const repo = githubRepoFromRemote({ url: remoteUrl });
  if (repo === undefined) {
    throw new Error(`remote ${remote} is not an owner/name Git repository URL`);
  }
  return { branch, localSha, repo, repoRoot };
}

/** Read the remote default and target branch in one race-bounded call. */
function remoteFacts({
  branch,
  remote,
  repoRoot,
  deps,
}: {
  branch: string;
  remote: string;
  repoRoot: string;
  deps: GithubPushDeps;
}): { readonly defaultBranch: string; readonly remoteBranchSha: string | undefined } {
  const text = deps.readGit({ args: ["ls-remote", "--symref", remote, "HEAD", `refs/heads/${branch}`], cwd: repoRoot });
  const snapshot = parseRemoteSnapshot({ branch, text });
  if (!snapshot.isOk()) {
    throw new Error(snapshot.error.message);
  }
  return { defaultBranch: snapshot.value.defaultBranch, remoteBranchSha: snapshot.value.branchSha };
}

/**
 * Inspect the repository and remote for `github push`, returning a complete safe plan or one refusal.
 *
 * @param cwd where the invocation stands
 * @param remote the remote the branch goes to
 * @param forceWithLease whether the push may replace the remote branch, leased on the SHA read here
 * @param deps the Git edges
 * @returns the plan, or the one refusal a dry run discloses too
 */
export function inspectGithubPushPlan({
  cwd,
  remote,
  forceWithLease,
  deps,
}: {
  cwd: string;
  remote: string;
  forceWithLease: boolean;
  deps: GithubPushDeps;
}): GithubVerbResult<GithubPushPlan> {
  try {
    const local = localFacts({ cwd, deps, remote });
    // Before anything else this plan could claim: a gate reads the files on disk while the push sends the
    // commit, so over a tree that differs from HEAD a green gate is about code that stays behind. Refused
    // HERE so a `--dry-run` discloses it too, rather than printing "would push" over the wrong subject.
    const subject = refuseDirtyWorkingTree({ readGit: deps.readGit, repoRoot: local.repoRoot });
    if (subject.isErr()) {
      return err(subject.error);
    }
    // The same refusal `pushAndVerify` makes, raised here too so a `--dry-run` discloses it.
    const proof = refuseProofPathHead({
      env: process.env,
      localSha: local.localSha,
      readGit: deps.readGit,
      repoRoot: local.repoRoot,
    });
    if (proof.isErr()) {
      return err(proof.error);
    }
    const remoteState = remoteFacts({ branch: local.branch, deps, remote, repoRoot: local.repoRoot });
    return githubPushPlan({
      args: {
        baseFreshnessAcknowledgement: NO_BASE_FRESHNESS_ACKNOWLEDGEMENT,
        cwd,
        dryRun: false,
        forceWithLease,
        home: undefined,
        orphanAbove: NO_ORPHANS_ACCEPTED,
        remote,
        selfReviewSource: undefined,
      },
      facts: { ...local, defaultBranch: remoteState.defaultBranch, remoteBranchSha: remoteState.remoteBranchSha },
    });
  } catch (error: unknown) {
    return err(GithubVerbErrors.upstreamRefused({ operation: "git", reasons: [gitFailureLine({ error })] }));
  }
}
