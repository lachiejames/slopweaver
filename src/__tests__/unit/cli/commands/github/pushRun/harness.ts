/**
 * What the `github push` test files share: the fixture SHAs and argv prefix, the deterministic fake of the Git
 * reads the shell performs, the plain fake edges that capture every write, one standing merge hold, the plan the
 * stack verbs build, and the hook that removes every fixture directory a test minted. Moved here when the verb's
 * one test file was split by describe.
 *
 * Filesystem round-trips are what testing.md allows a unit test: each home is a `mkdtempSync` directory a test
 * pushes onto {@link fixtureDirs}, removed in the `afterEach` {@link useFixtureDirCleanup} registers.
 */
import { rmSync } from "node:fs";
import { afterEach } from "vitest";
import type { GithubPushPlan, PrePushGateOutcome } from "../../../../../../admit/githubPush.js";
import type { QueueGate } from "../../../../../../cli/commands/github/baseFreshnessCore.js";
import type { GithubVerbResult } from "../../../../../../cli/commands/github/errors.js";
import type { GithubPushDeps } from "../../../../../../cli/commands/github/pushRun.js";
import { err, ok, type Result } from "../../../../../../lib/result.js";
import { unmeasurable } from "../../../../../../measurement/status.js";
import type { MergeHold } from "../../../../../../outbound/github/mergeHold.js";
import { type MemoryDoorLedger, memoryDoorLedger } from "../../../../../doorLedgerFixture.js";

// Every fixture directory this file has minted, so `afterEach` can remove them.
export const fixtureDirs: string[] = [];

/**
 * Register the `afterEach` that removes every directory pushed onto {@link fixtureDirs}; call it once at module
 * scope.
 */
export function useFixtureDirCleanup(): void {
  afterEach(() => {
    for (const dir of fixtureDirs.splice(0)) {
      rmSync(dir, { force: true, recursive: true });
    }
  });
}

export const LOCAL_SHA = "1111111111111111111111111111111111111111";
/** A real `git patch-id --verbatim` id — the value the anchor line carries. */
export const PATCH_ID = "5e1877358e8c58c6bdc46b92483800474b4b1b32";
export const REMOTE_SHA = "2222222222222222222222222222222222222222";
export const FRESH_DEFAULT_TIP_SHA = "3333333333333333333333333333333333333333";
export const HOOK = "/repo/.git/hooks/pre-push";
/** The write log's spelling of a gate run, so ORDER against the push is one array equality. */
export const GATE_WRITE = "<pre-push gate>";
export const PREFIX: readonly string[] = ["node", "slopweaver", "github", "push", "--cwd", "/repo"];

/** A commit message the publication scan passes. */
const DEFAULT_COMMIT_MESSAGE = "Add the feature\n\nKeeps the retry beside the provider call.";

/** A pushed tree carrying no proof output — the proof-path door's clean answer. */
const CLEAN_TREE: readonly string[] = ["README.md", "src/index.ts", "src/proof/capture.ts"];

/** A deterministic fake of the exact Git reads the shell performs. */
function readGit({
  args,
  defaultBranch = "main",
  branch = "feature",
  afterSha = LOCAL_SHA,
  statusPorcelain = "",
  tree = CLEAN_TREE,
  commitMessage = DEFAULT_COMMIT_MESSAGE,
}: {
  args: readonly string[];
  defaultBranch?: string;
  branch?: string;
  afterSha?: string;
  statusPorcelain?: string;
  /** The pushed commit's `--no-replace-objects ls-tree -r -z --name-only` answer. */
  tree?: readonly string[];
  /** The one unpublished commit's message, which the commit-message scan reads. */
  commitMessage?: string;
}): string {
  const command = args.join(" ");
  if (args[0] === "--no-replace-objects" && args[1] === "log") return `\u001e${LOCAL_SHA}\0${commitMessage}\n`;
  if (command === "status --porcelain") return statusPorcelain;
  if (command === `--no-replace-objects ls-tree -r -z --name-only ${LOCAL_SHA}^{commit}`)
    return tree.map((path) => `${path}\0`).join("");
  if (command === "rev-parse --show-toplevel") return "/repo";
  if (command === "symbolic-ref --quiet --short HEAD") return branch;
  if (command === "rev-parse HEAD") return LOCAL_SHA;
  if (command === "remote get-url origin") return "git@example.test:owner/repo.git";
  if (command === `ls-remote --symref origin HEAD refs/heads/${branch}`) {
    return `ref: refs/heads/${defaultBranch}\tHEAD\n${LOCAL_SHA}\tHEAD\n${REMOTE_SHA}\trefs/heads/${branch}`;
  }
  if (command === `ls-remote origin refs/heads/${branch}`) return `${afterSha}\trefs/heads/${branch}`;
  // The base-freshness gate's own fetched-ref resolution — the harness's `newPrivateRef` fake always names
  // this one fixed ref, so every other test can assert on a real value without predicting a UUID.
  if (command === "rev-parse refs/slopweaver/fetch/test^{commit}") return FRESH_DEFAULT_TIP_SHA;
  throw new Error(`unexpected Git read: ${command}`);
}

/**
 * Build plain fake edges and capture their writes.
 *
 * @returns the dependency set to hand the verb, the door ledger it records into, and every printed line, Git
 * write and queue-gate read it captured
 */
export function harness({
  defaultBranch = "main",
  branch = "feature",
  afterSha = LOCAL_SHA,
  writeOk = true,
  baseIsFresh = true,
  patchId = ok(PATCH_ID),
  statusPorcelain = "",
  tree = CLEAN_TREE,
  gate,
  holds = [],
  sessionId = "this-session",
  queueGate,
  commitMessage = DEFAULT_COMMIT_MESSAGE,
}: {
  /** The one unpublished commit's message. */
  commitMessage?: string;
  defaultBranch?: string;
  branch?: string;
  afterSha?: string;
  writeOk?: boolean;
  baseIsFresh?: boolean;
  patchId?: Result<string | null, string>;
  /** Exactly what `git status --porcelain` answers; empty is a clean tree. */
  statusPorcelain?: string;
  /** What the pushed commit's tree lists. */
  tree?: readonly string[];
  /** Absent means a driver with no gate edge — git orders the hook itself, exactly as before the edge. */
  gate?: GithubVerbResult<PrePushGateOutcome>;
  holds?: readonly MergeHold[];
  sessionId?: string | undefined;
  /** What the base branch's queue gates on. Absent, the driver carries no queue edge at all. */
  queueGate?: QueueGate | undefined;
} = {}): {
  deps: GithubPushDeps;
  door: MemoryDoorLedger;
  lines: string[];
  writes: readonly string[][];
  queueGateReads: readonly string[];
} {
  const lines: string[] = [];
  const writes: string[][] = [];
  const queueGateReads: string[] = [];
  const door = memoryDoorLedger();
  const readGitFake: GithubPushDeps["readGit"] = ({ args }) =>
    readGit({ afterSha, args, branch, commitMessage, defaultBranch, statusPorcelain, tree });
  const gitDeps = gitDepsFake({ door, gate, lines, patchId, queueGate, queueGateReads, readGitFake, writeOk, writes });
  return {
    deps: {
      ...gitDeps,
      baseFreshness: baseFreshnessFake({ baseIsFresh, git: gitDeps }),
      hold: holdFake({ holds, lines, sessionId }),
    },
    door,
    lines,
    queueGateReads,
    writes,
  };
}

/** The Git-facing edges {@link harness} hands the verb, each capturing into the arrays it is given. */
function gitDepsFake({
  door,
  gate,
  lines,
  patchId,
  queueGate,
  queueGateReads,
  readGitFake,
  writeOk,
  writes,
}: {
  door: MemoryDoorLedger;
  gate: GithubVerbResult<PrePushGateOutcome> | undefined;
  lines: string[];
  patchId: Result<string | null, string>;
  queueGate: QueueGate | undefined;
  queueGateReads: string[];
  readGitFake: GithubPushDeps["readGit"];
  writeOk: boolean;
  writes: string[][];
}): GithubPushDeps {
  return {
    cwd: () => "/unused",
    doorLedger: door.port,
    out: ({ line }) => lines.push(line),
    prePushGate: prePushGateFake({ gate, writes }),
    readGit: readGitFake,
    readPatchId: () => patchId,
    ...queueGateFake({ queueGate, queueGateReads }),
    selfReview: selfReviewFake(),
    writeGit: ({ args }) => {
      writes.push([...args]);
      // `writeOk` governs only the PUSH itself — the freshness gate's own fetch/cleanup writes always
      // succeed here, since a rejected push is a distinct scenario from an unmeasurable base.
      return !writeOk && args[0] === "push" ? err("push rejected") : ok(undefined);
    },
  };
}

/** The pre-push gate edge: absent with no `gate`, else one that logs its run into `writes` and answers `gate`. */
function prePushGateFake({
  gate,
  writes,
}: {
  gate: GithubVerbResult<PrePushGateOutcome> | undefined;
  writes: string[][];
}): GithubPushDeps["prePushGate"] {
  return gate === undefined
    ? undefined
    : ({ cwd, remote, stdin }) => {
        writes.push([GATE_WRITE, cwd, remote, stdin]);
        return gate;
      };
}

/** The queue-gate edge, present only when a `queueGate` is given, logging each read into `queueGateReads`. */
function queueGateFake({
  queueGate,
  queueGateReads,
}: {
  queueGate: QueueGate | undefined;
  queueGateReads: string[];
}): Pick<GithubPushDeps, "readQueueGate"> {
  return queueGate === undefined
    ? {}
    : {
        readQueueGate: ({ repo, branch: base }: { repo: string; branch: string; home: string }) => {
          queueGateReads.push(`${repo}@${base}`);
          return Promise.resolve(queueGate);
        },
      };
}

/** The self-review edges a dry run must never reach for a GitHub client through. */
function selfReviewFake(): GithubPushDeps["selfReview"] {
  return {
    makeApi: () => {
      throw new Error("dry-run must not construct a GitHub client");
    },
    now: () => new Date("2026-08-14T00:00:00Z"),
    readForm: ({ source }) => source,
  };
}

/** The base-freshness edges: two commits ahead, an ancestry answer of `baseIsFresh`, one fixed private ref. */
function baseFreshnessFake({
  baseIsFresh,
  git,
}: {
  baseIsFresh: boolean;
  git: GithubPushDeps;
}): GithubPushDeps["baseFreshness"] {
  return {
    countCommitsAhead: () => ok(2),
    git,
    isAncestor: () => ok(baseIsFresh),
    measureReverted: () => [],
    newPrivateRef: () => "refs/slopweaver/fetch/test",
  };
}

/** The merge-hold edges: the standing `holds`, the harness clock, and printed lines into `lines`. */
function holdFake({
  holds,
  lines,
  sessionId,
}: {
  holds: readonly MergeHold[];
  lines: string[];
  sessionId: string | undefined;
}): GithubPushDeps["hold"] {
  return {
    appendLedgerRow: () => ok(undefined),
    holderLive: () => unmeasurable<boolean>({ why: "this fake asks no registry" }),
    nowIso: () => "2026-09-03T00:10:00.000Z",
    out: ({ line }) => lines.push(line),
    publish: () => undefined,
    readHolds: () => holds,
    readLedgerRows: () => [],
    sessionId: () => sessionId,
    writeHolds: () => ok(undefined),
  };
}

/**
 * One standing hold over the fixture repository, placed ten minutes before the harness clock.
 *
 * @returns the hold, with any field `over` names replaced
 */
export function hold(over: Partial<MergeHold> = {}): MergeHold {
  return {
    atIso: "2026-09-03T00:00:00.000Z",
    holder: "another-session",
    pr: 32,
    repo: "owner/repo",
    staleMinutes: 30,
    staleWarnedAtIso: undefined,
    why: "landing first",
    ...over,
  };
}

/**
 * The plan every stack verb builds too, so `pushAndVerify` can be exercised directly — that function, not
 * `runGithubPush`, is the choke point `stack push`/`adopt`/`sync` reach the transport through.
 */
export const PLAN: GithubPushPlan = {
  branch: "feature",
  defaultBranch: "main",
  forceWithLease: false,
  gitArgs: ["push", "--set-upstream", "origin", `${LOCAL_SHA}^{commit}:refs/heads/feature`],
  localSha: LOCAL_SHA,
  purpose: "pull-request-head",
  remote: "origin",
  remoteBranchSha: REMOTE_SHA,
  repo: "owner/repo",
  repoRoot: "/repo",
};
