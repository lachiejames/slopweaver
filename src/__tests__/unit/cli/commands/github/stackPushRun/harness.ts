/*
 * The effectful half the `github stack push` run test files share. Each case mints a throwaway home, removed after
 * every case by the `afterEach` that `useTempHomes()` registers, so the create-guard reservation never touches the
 * real state home. `harness()` builds the injectable deps over a Git fake that answers the exact reads one run
 * makes. It moved here when `stackPushRun.test.ts` was split by behaviour.
 */
import { rmSync } from "node:fs";
import { afterEach } from "vitest";

import { clearDescriptionReview } from "../../../../../../cli/commands/github/descriptionReviewCheck.js";
import { type GithubStackPushDeps } from "../../../../../../cli/commands/github/stackPushDeps.js";
import type { GithubWriteApi } from "../../../../../../corpus/github/write.js";
import { err, ok } from "../../../../../../lib/result.js";
import { memoryAutonomyLedgerPort } from "../../../../../autonomyLedgerFixture.js";
import { type MemoryDoorLedger, memoryDoorLedger } from "../../../../../doorLedgerFixture.js";
import { homeDeclaringNoPrivateTerms } from "../../../../../privateTermsFixture.js";
import { AMENDED_SHA, EDITED_TREE, HEAD_TREE, LINEAGE, LOCAL_SHA, PINNED_TREE, RACED_SHA } from "./fixtures.js";

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

/** Register the `afterEach` that removes every home minted since the last case. Call it once per test file. */
export function useTempHomes(): void {
  afterEach(() => {
    for (const dir of fixtureDirs.splice(0)) {
      rmSync(dir, { force: true, recursive: true });
    }
  });
}

/**
 * A fresh, isolated ledger directory — the create-guard reservation must never touch the real state home. Its
 * private-terms file declares none, so the commit-message and description gates run rather than refuse.
 *
 * @returns the new directory's absolute path, recorded for removal after the case
 */
export function tempHome(): string {
  const home = homeDeclaringNoPrivateTerms({ prefix: "github-stack-push-home-" });
  fixtureDirs.push(home);
  return home;
}

/** What one harness takes: every field but `api` defaults to a clean push of `top` onto `main`. */
interface HarnessInput {
  branch?: string;
  defaultBranch?: string;
  writeOk?: boolean;
  postAmendRemoteSha?: string;
  /** Overrides for the creation gates' measurement edges; each defaults to "nothing to report". */
  gates?: Partial<Pick<GithubStackPushDeps, "measureAlreadyLanded" | "measureBaseFreshness">>;
  /** What the real `git add --all` staged — the pinned tree unless the test edits the worktree mid-push. */
  stagedTree?: string;
  /** The amended commit's own tree — the pinned tree unless a commit hook re-staged inside the amend. */
  committedTree?: string;
  /** The checked commit's own tree — unlike the pinned tree unless the test has nothing to amend. */
  headTree?: string;
  /** What `rev-parse HEAD` answers after the fact read — the same commit unless the test moves HEAD. */
  headAfterFacts?: string;
  /** What `rev-parse HEAD` answers after the amend — the checked commit amended, unless the branch raced. */
  amendedHead?: string;
  api: GithubWriteApi;
}

/** What one harness observed: the deps to pass, and every Git write, Git read, printed line and pin they recorded. */
interface HarnessObserved {
  deps: GithubStackPushDeps;
  door: MemoryDoorLedger;
  writes: (readonly string[])[];
  reads: string[];
  lines: string[];
  pins: string[];
}

type ReadGit = GithubStackPushDeps["git"]["readGit"];

/** Every read whose answer never changes within one run; the two counted reads stay in `readGitFor`. */
function fixedReadsFor({
  branch,
  committedTree,
  defaultBranch,
  headTree,
  stagedTree,
}: {
  branch: string;
  committedTree: string;
  defaultBranch: string;
  headTree: string;
  stagedTree: string;
}): ReadonlyMap<string, string> {
  return new Map<string, string>([
    ["rev-parse --show-toplevel", "/repo"],
    ["symbolic-ref --quiet --short HEAD", branch],
    ["remote get-url origin", "git@example.test:o/r.git"],
    // Nothing untracked: the amend adds no path the pull request never touched.
    [`--no-replace-objects ls-tree -r --name-only -z ${PINNED_TREE}`, ""],
    ["--no-replace-objects ls-files --others --exclude-standard -z", ""],
    [`--no-replace-objects ls-files --cached -z`, ""],
    [`--no-replace-objects diff-tree --root --no-commit-id -r --no-renames --name-only -z ${LOCAL_SHA}`, ""],
    ["add --all", ""],
    ["write-tree", stagedTree],
    [`--no-replace-objects rev-parse ${LOCAL_SHA}^{tree}`, headTree],
    [`--no-replace-objects rev-parse ${AMENDED_SHA}^{tree}`, committedTree],
    [`--no-replace-objects rev-parse ${RACED_SHA}^{tree}`, PINNED_TREE],
    // An amend keeps the parents, author and message of the commit it rewrote, so the two lineages match.
    [`${LINEAGE} ${LOCAL_SHA}`, `${LOCAL_SHA}\0Test\0test@example.test\0`],
    [`${LINEAGE} ${AMENDED_SHA}`, `${LOCAL_SHA}\0Test\0test@example.test\0`],
    [`${LINEAGE} ${RACED_SHA}`, `${EDITED_TREE}\0Test\0test@example.test\0`],
    [`diff --name-only -z --no-renames ${PINNED_TREE} ${EDITED_TREE}`, "src/edited mid-push.ts\0"],
    ["status --porcelain", ""],
    [
      `ls-remote --symref origin HEAD refs/heads/${branch}`,
      `ref: refs/heads/${defaultBranch}\tHEAD\n${LOCAL_SHA}\tHEAD\n${LOCAL_SHA}\trefs/heads/${branch}`,
    ],
  ]);
}

/** The Git read fake for one run, recording every command onto `reads`; both counters are minted per call. */
function readGitFor({
  amendedHead,
  branch,
  fixedReads,
  headAfterFacts,
  postAmendRemoteSha,
  reads,
  writes,
}: {
  amendedHead: string;
  branch: string;
  fixedReads: ReadonlyMap<string, string>;
  headAfterFacts: string;
  postAmendRemoteSha: string;
  reads: string[];
  /** Every Git write so far: HEAD answers the amended commit once a commit is among them. */
  writes: readonly (readonly string[])[];
}): ReadGit {
  let bareLsRemoteCalls = 0;
  let headReads = 0;
  return ({ args }) => {
    const command = args.join(" ");
    reads.push(command);
    const fixed = fixedReads.get(command);
    if (fixed !== undefined) return fixed;
    if (command === "rev-parse HEAD") {
      // Keyed on the amend having run, never on a read count: `sendStackPush` over a ready plan skips the
      // fact read, so its first HEAD read is the pre-amend re-check.
      if (writes.some((write) => write[0] === "commit")) return amendedHead;
      headReads += 1;
      return headReads === 1 ? LOCAL_SHA : headAfterFacts;
    }
    if (command === `ls-remote origin refs/heads/${branch}`) {
      bareLsRemoteCalls += 1;
      const sha = bareLsRemoteCalls === 1 ? LOCAL_SHA : postAmendRemoteSha;
      return `${sha}\trefs/heads/${branch}`;
    }
    // The head carries no proof output, so the push door passes it.
    if (args.includes("ls-tree")) return "";
    // The commit-message scan's read: one unpublished commit whose message the publication scan passes.
    if (args[0] === "--no-replace-objects" && args[1] === "log") return `\u001e${AMENDED_SHA}\0Add the feature\n`;
    throw new Error(`unexpected Git read: ${command}`);
  };
}

/** The deps object over the harness's fakes, in the old in-file harness's key order. */
function depsFor({
  api,
  door,
  gates,
  lines,
  pins,
  readGit,
  writeOk,
  writes,
}: {
  api: GithubWriteApi;
  door: MemoryDoorLedger;
  gates: Pick<GithubStackPushDeps, "measureAlreadyLanded" | "measureBaseFreshness">;
  lines: string[];
  pins: string[];
  readGit: ReadGit;
  writeOk: boolean;
  writes: (readonly string[])[];
}): GithubStackPushDeps {
  const { measureAlreadyLanded, measureBaseFreshness } = gates;
  return {
    autonomy: memoryAutonomyLedgerPort(),
    captureAmendTree: ({ repoRoot }) => {
      pins.push(repoRoot);
      return ok(PINNED_TREE);
    },
    cwd: () => "/repo",
    descriptionReview: clearDescriptionReview,
    doorLedger: door.port,
    env: () => undefined,
    git: {
      cwd: () => "/repo",
      doorLedger: door.port,
      out: ({ line }) => lines.push(line),
      readGit,
      writeGit: ({ args }) => {
        writes.push(args);
        return writeOk ? ok(undefined) : err("git exited 1");
      },
    },
    installationIdentifiers: () => Promise.resolve({ identifiers: undefined, unread: [] }),
    makeApi: () => api,
    measureAlreadyLanded,
    measureBaseFreshness,
    now: () => new Date("2026-08-10T00:00:00Z"),
    out: ({ line }) => lines.push(line),
    readFileSource: () => {
      throw new Error("unexpected --file read");
    },
    readForm: ({ source }) => source,
    sleep: () => Promise.resolve(),
    token: () => "fake-test-token",
  };
}

/**
 * Build the injectable deps, capturing every write call and every printed line.
 *
 * `ls-remote origin refs/heads/<branch>` (no `--symref`) is read TWICE in one real run — once before the
 * push, to build the exact lease against whatever the remote currently reports, and once after, to confirm
 * the push landed. A counter distinguishes them: the pre-push read always reports the ORIGINAL remote SHA
 * (unchanged since amend is local-only), and the post-push read reports what `postAmendRemoteSha` says
 * actually happened — `AMENDED_SHA` by default (a clean push), or a different value to simulate a lost push.
 *
 * @returns the deps, the door ledger they record through, and every Git write, Git read, line and pin recorded
 */
export function harness({
  branch = "top",
  defaultBranch = "main",
  writeOk = true,
  postAmendRemoteSha = AMENDED_SHA,
  gates = {},
  stagedTree = PINNED_TREE,
  committedTree = PINNED_TREE,
  headTree = HEAD_TREE,
  headAfterFacts = LOCAL_SHA,
  amendedHead = AMENDED_SHA,
  api,
}: HarnessInput): HarnessObserved {
  const writes: (readonly string[])[] = [];
  const reads: string[] = [];
  const lines: string[] = [];
  const pins: string[] = [];
  // Each creation gate defaults to "unavailable", which is the SKIP arm every one of them fails open on —
  // so a test that is not about a gate never has to describe one. `gates` overrides the one it is about.
  const {
    measureAlreadyLanded = () => ok({ kind: "skipped", why: "no checkout" }),
    measureBaseFreshness = () => ok({ kind: "skipped", why: "no checkout" }),
  } = gates;
  const fixedReads = fixedReadsFor({ branch, committedTree, defaultBranch, headTree, stagedTree });
  const readGit = readGitFor({ amendedHead, branch, fixedReads, headAfterFacts, postAmendRemoteSha, reads, writes });
  const door = memoryDoorLedger();
  const gateDeps = { measureAlreadyLanded, measureBaseFreshness };
  const deps = depsFor({ api, door, gates: gateDeps, lines, pins, readGit, writeOk, writes });
  return { deps, door, lines, pins, reads, writes };
}
