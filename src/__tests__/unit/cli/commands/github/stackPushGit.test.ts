/**
 * `github stack push`'s Git half (`stackPushGit.ts`), driven directly through plain typed Git functions.
 *
 * No repository is built: every read answers from a fixed table and is logged into ONE event list beside the
 * amend-pin edge, so the ORDER the facts are read in — the pin before the first remote read — is a whole-list
 * comparison rather than an inference.
 */
import { describe, expect, it } from "vitest";

import { clearDescriptionReview } from "../../../../../cli/commands/github/descriptionReviewCheck.js";
import { GithubVerbErrors } from "../../../../../cli/commands/github/errors.js";
import type { GithubPushDeps } from "../../../../../cli/commands/github/pushRun.js";
import type { GithubStackPushPlan } from "../../../../../cli/commands/github/stackPushCore.js";
import type { GithubStackPushDeps } from "../../../../../cli/commands/github/stackPushDeps.js";
import { amendAndPush, resolveStackPushFacts } from "../../../../../cli/commands/github/stackPushGit.js";
import { err, ok, unwrap, unwrapErr } from "../../../../../lib/result.js";
import { EXAMPLE_PR_FORM } from "../../../../../outbound/github/formExample.js";
import { unavailableAutonomyLedgerPort } from "../../../../autonomyLedgerFixture.js";
import { memoryDoorLedger } from "../../../../doorLedgerFixture.js";
import { HOME_WITHOUT_PUSH_ROOTS } from "../../../../pushRootFixture.js";

const HEAD_SHA = "1111111111111111111111111111111111111111";
const MOVED_SHA = "2222222222222222222222222222222222222222";
const PINNED_TREE = "3333333333333333333333333333333333333333";
/** HEAD's own tree when the pinned tree carries a change to amend in. */
const HEAD_TREE = "4444444444444444444444444444444444444444";
const SYMREF_READ = "ls-remote --symref origin HEAD refs/heads/top";
const SYMREF_ANSWER = `ref: refs/heads/main\tHEAD\n${HEAD_SHA}\tHEAD\n${HEAD_SHA}\trefs/heads/top`;

/** Answers every read from `answers`, logging each as `read <argv>` and each pin as `pin <root>`, in order. */
function harness({
  answers,
  capture = () => ok(PINNED_TREE),
}: {
  answers: ReadonlyMap<string, string>;
  capture?: GithubStackPushDeps["captureAmendTree"];
}): { deps: GithubStackPushDeps; events: string[]; lines: string[]; writes: string[] } {
  const events: string[] = [];
  const lines: string[] = [];
  const writes: string[] = [];
  const readGit: GithubPushDeps["readGit"] = ({ args, cwd }) => {
    const command = args.join(" ");
    events.push(`read ${command} @ ${cwd}`);
    const answer = answers.get(command);
    if (answer === undefined) {
      throw new Error(`unexpected Git read: ${command}`);
    }
    return answer;
  };
  const writeGit: GithubPushDeps["writeGit"] = ({ args }) => {
    writes.push(args.join(" "));
    return ok(undefined);
  };
  const captureAmendTree: GithubStackPushDeps["captureAmendTree"] = (input) => {
    events.push(`pin ${input.repoRoot}`);
    return capture(input);
  };
  const unreached = (): never => {
    throw new Error("not reached by the Git half");
  };
  const deps: GithubStackPushDeps = {
    // The Git half never records an act; a ledger that refuses every call keeps a stray one visible.
    autonomy: unavailableAutonomyLedgerPort(),
    captureAmendTree,
    cwd: () => "/work",
    descriptionReview: clearDescriptionReview,
    doorLedger: memoryDoorLedger().port,
    env: () => undefined,
    git: {
      cwd: () => "/work",
      doorLedger: memoryDoorLedger().port,
      out: ({ line }) => lines.push(line),
      readGit,
      writeGit,
    },
    installationIdentifiers: unreached,
    makeApi: unreached,
    measureAlreadyLanded: unreached,
    measureBaseFreshness: unreached,
    now: unreached,
    out: ({ line }) => lines.push(line),
    readFileSource: unreached,
    readForm: unreached,
    sleep: unreached,
    token: unreached,
  };
  return { deps, events, lines, writes };
}

const LOCAL_ANSWERS: readonly (readonly [string, string])[] = [
  ["rev-parse --show-toplevel", "/repo"],
  ["symbolic-ref --quiet --short HEAD", "top"],
  ["rev-parse HEAD", HEAD_SHA],
  ["remote get-url origin", "git@github.com:o/r.git"],
];

const LOCAL_EVENTS: readonly string[] = [
  "read rev-parse --show-toplevel @ /work",
  "read symbolic-ref --quiet --short HEAD @ /repo",
  "read rev-parse HEAD @ /repo",
  "read remote get-url origin @ /repo",
];

const NAMES = "-r --no-renames --name-only -z";
/** Every path the pinned tree holds: what a real push reads, off the tree the amend may commit. */
const PINNED_PATHS_READ = `--no-replace-objects ls-tree -r --name-only -z ${PINNED_TREE}`;
/** A dry run pins no tree, so it lists the worktree's untracked paths instead. */
const UNTRACKED_READ = "--no-replace-objects ls-files --others --exclude-standard -z";
/** Every path the index holds; a staged deletion holds none. */
const HELD_READ = "--no-replace-objects ls-files --cached -z";
const TOUCHED_READ = `--no-replace-objects diff-tree --root --no-commit-id ${NAMES} ${HEAD_SHA}`;
/** Every read the untracked check makes, answered with nothing new: HEAD, the index and the pin hold one file. */
const UNTRACKED_ANSWERS: readonly (readonly [string, string])[] = [
  [PINNED_PATHS_READ, "src/a.ts\0"],
  [UNTRACKED_READ, ""],
  [HELD_READ, "src/a.ts\0"],
  [TOUCHED_READ, "src/a.ts\0"],
];
const PINNED_EVENTS: readonly string[] = [PINNED_PATHS_READ, HELD_READ, TOUCHED_READ].map((c) => `read ${c} @ /repo`);
const DRY_RUN_EVENTS: readonly string[] = [UNTRACKED_READ, HELD_READ, TOUCHED_READ].map((c) => `read ${c} @ /repo`);

describe("resolveStackPushFacts", () => {
  it("reads the local facts, pins the amend tree, and then asks the remote for its default branch", () => {
    const { deps, events, lines } = harness({
      answers: new Map([...LOCAL_ANSWERS, ...UNTRACKED_ANSWERS, [SYMREF_READ, SYMREF_ANSWER]]),
    });

    const facts = resolveStackPushFacts({ args: { cwd: "/work", dryRun: false, remote: "origin" }, deps });

    expect(facts).toEqual({
      amendPin: { kind: "pinned", tree: PINNED_TREE },
      branch: "top",
      defaultBranch: "main",
      headSha: HEAD_SHA,
      repo: "o/r",
      repoRoot: "/repo",
    });
    expect(events).toEqual([...LOCAL_EVENTS, "pin /repo", ...PINNED_EVENTS, `read ${SYMREF_READ} @ /repo`]);
    expect(lines).toEqual([]);
  });

  it("pins nothing on a dry run, carrying the dry-run marker in place of a tree", () => {
    const { deps, events } = harness({
      answers: new Map([...LOCAL_ANSWERS, ...UNTRACKED_ANSWERS, [SYMREF_READ, SYMREF_ANSWER]]),
    });

    const facts = resolveStackPushFacts({ args: { cwd: "/work", dryRun: true, remote: "origin" }, deps });

    expect(facts).toEqual({
      amendPin: { kind: "dry-run" },
      branch: "top",
      defaultBranch: "main",
      headSha: HEAD_SHA,
      repo: "o/r",
      repoRoot: "/repo",
    });
    expect(events).toEqual([...LOCAL_EVENTS, ...DRY_RUN_EVENTS, `read ${SYMREF_READ} @ /repo`]);
  });

  it("prints one refusal and reads no remote when the worktree cannot be pinned", () => {
    const { deps, events, lines } = harness({
      answers: new Map([...LOCAL_ANSWERS, ...UNTRACKED_ANSWERS, [SYMREF_READ, SYMREF_ANSWER]]),
      capture: () => err("git add (scratch index) failed"),
    });

    const facts = resolveStackPushFacts({ args: { cwd: "/work", dryRun: false, remote: "origin" }, deps });

    expect(facts).toBe(undefined);
    expect(lines).toEqual(["refused: could not pin the worktree for stack push: git add (scratch index) failed"]);
    expect(events).toEqual([...LOCAL_EVENTS, "pin /repo"]);
  });

  it("refuses a path the pinned tree adds even when the worktree lists nothing untracked by then", () => {
    const { deps, events, lines } = harness({
      answers: new Map([...LOCAL_ANSWERS, ...UNTRACKED_ANSWERS, [PINNED_PATHS_READ, "src/a.ts\0node_modules\0"]]),
    });

    const facts = resolveStackPushFacts({ args: { cwd: "/work", dryRun: false, remote: "origin" }, deps });

    expect(facts).toBe(undefined);
    expect(lines).toEqual([
      "refused: the amend would add untracked path the pull request never touched (node_modules) — nothing was " +
        "staged, committed or sent. Stage one you mean to send with `git add -- <path>`; remove or ignore the " +
        "rest, then run stack push again",
    ]);
    expect(events).toEqual([...LOCAL_EVENTS, "pin /repo", ...PINNED_EVENTS]);
  });

  it("refuses a pinned path HEAD carries unchanged once the index stops holding it", () => {
    const { deps, events, lines } = harness({
      answers: new Map([...LOCAL_ANSWERS, ...UNTRACKED_ANSWERS, [PINNED_PATHS_READ, "src/a.ts\0victim.txt\0"]]),
    });

    const facts = resolveStackPushFacts({ args: { cwd: "/work", dryRun: false, remote: "origin" }, deps });

    expect(facts).toBe(undefined);
    expect(lines.length).toBe(1);
    expect(lines[0]).toContain("never touched (victim.txt)");
    expect(events).toEqual([...LOCAL_EVENTS, "pin /repo", ...PINNED_EVENTS]);
  });

  it("refuses the same untracked path on a dry run, so the preview shows what the real push would refuse", () => {
    const { deps, events, lines } = harness({
      answers: new Map([...LOCAL_ANSWERS, ...UNTRACKED_ANSWERS, [UNTRACKED_READ, "stray.log\0"]]),
    });

    const facts = resolveStackPushFacts({ args: { cwd: "/work", dryRun: true, remote: "origin" }, deps });

    expect(facts).toBe(undefined);
    expect(lines.length).toBe(1);
    expect(lines[0]).toContain("(stray.log)");
    expect(events).toEqual([...LOCAL_EVENTS, ...DRY_RUN_EVENTS]);
  });

  it("prints a failed git read's command and stderr as one refusal line", () => {
    const { deps, lines } = harness({ answers: new Map([...LOCAL_ANSWERS, ...UNTRACKED_ANSWERS]) });
    // The shape `execFileSync` throws on a failed git: the command, then git's own stderr, each on its line.
    const failing: GithubStackPushDeps = {
      ...deps,
      git: {
        ...deps.git,
        readGit: ({ args, cwd }) => {
          if (args.join(" ") === HELD_READ) {
            throw new Error("Command failed: git diff-index\nfatal: bad object HEAD\n");
          }
          return deps.git.readGit({ args, cwd });
        },
      },
    };

    const facts = resolveStackPushFacts({ args: { cwd: "/work", dryRun: false, remote: "origin" }, deps: failing });

    expect(facts).toBe(undefined);
    expect(lines).toEqual(["refused: Command failed: git diff-index | fatal: bad object HEAD"]);
  });

  it("refuses with the remote's own error when it does not report a default branch", () => {
    const { deps, lines } = harness({
      answers: new Map([...LOCAL_ANSWERS, ...UNTRACKED_ANSWERS, [SYMREF_READ, `${HEAD_SHA}\trefs/heads/top`]]),
    });

    const facts = resolveStackPushFacts({ args: { cwd: "/work", dryRun: false, remote: "origin" }, deps });

    expect(facts).toBe(undefined);
    expect(lines).toEqual(["refused: the remote did not report its default branch"]);
    expect(lines).toEqual([`refused: ${GithubVerbErrors.remoteDefaultUnreported().message}`]);
  });

  it("refuses a remote whose URL names no owner/name repository, before pinning anything", () => {
    const { deps, events, lines } = harness({
      answers: new Map([...LOCAL_ANSWERS.slice(0, 3), ["remote get-url origin", "/srv/git/plain"]]),
    });

    const facts = resolveStackPushFacts({ args: { cwd: "/work", dryRun: false, remote: "origin" }, deps });

    expect(facts).toBe(undefined);
    expect(lines).toEqual(["refused: remote origin is not an owner/name Git repository URL"]);
    expect(events).toEqual(LOCAL_EVENTS);
  });
});

function plan({ amendPin }: { amendPin: GithubStackPushPlan["facts"]["amendPin"] }): GithubStackPushPlan {
  return {
    addArgs: ["add", "--all"],
    amendArgs: ["commit", "--amend", "--no-edit"],
    facts: { amendPin, branch: "top", defaultBranch: "main", headSha: HEAD_SHA, repo: "o/r", repoRoot: "/repo" },
    form: EXAMPLE_PR_FORM,
  };
}

describe("amendAndPush", () => {
  it("refuses when HEAD moved since the facts were read, before staging, committing or pushing", () => {
    const { deps, events, writes } = harness({
      answers: new Map([
        ["symbolic-ref --quiet --short HEAD", "top"],
        ["rev-parse HEAD", MOVED_SHA],
      ]),
    });

    const result = amendAndPush({
      git: deps.git,
      home: HOME_WITHOUT_PUSH_ROOTS,
      locus: "o/r#main...top",
      plan: plan({ amendPin: { kind: "pinned", tree: PINNED_TREE } }),
      remote: "origin",
    });

    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result)).toEqual({
      kind: "refused",
      reason: `HEAD moved while stack push ran (top@${HEAD_SHA} → top@${MOVED_SHA}); nothing was staged, committed or sent`,
    });
    expect(events).toEqual(["read symbolic-ref --quiet --short HEAD @ /repo", "read rev-parse HEAD @ /repo"]);
    expect(writes).toEqual([]);
  });

  it("pushes HEAD unchanged when the staged tree is already HEAD's, committing nothing and printing nothing", () => {
    const { deps, lines, writes } = harness({
      answers: new Map([
        ["symbolic-ref --quiet --short HEAD", "top"],
        ["rev-parse HEAD", HEAD_SHA],
        ["add --all", ""],
        ["write-tree", PINNED_TREE],
        [`--no-replace-objects rev-parse ${HEAD_SHA}^{tree}`, PINNED_TREE],
        ["ls-remote origin refs/heads/top", `${HEAD_SHA}\trefs/heads/top`],
        ["status --porcelain", ""],
        [`--no-replace-objects ls-tree -r -z --name-only ${HEAD_SHA}^{commit}`, ""],
      ]),
    });

    const result = amendAndPush({
      git: deps.git,
      home: HOME_WITHOUT_PUSH_ROOTS,
      locus: "o/r#main...top",
      plan: plan({ amendPin: { kind: "pinned", tree: PINNED_TREE } }),
      remote: "origin",
    });

    expect(unwrap(result)).toBe(HEAD_SHA);
    expect(writes).toEqual([
      `push --set-upstream --force-with-lease=refs/heads/top:${HEAD_SHA} origin ${HEAD_SHA}^{commit}:refs/heads/top`,
    ]);
    expect(lines).toEqual([]);
  });

  it("amends a staged change into HEAD and prints the old and new sha", () => {
    const lineage =
      "--no-replace-objects show -s --no-show-signature --encoding=UTF-8 " +
      "--format=%P%x00%an%x00%ae%x00%ai%x00%B%x00.";
    const heads = [HEAD_SHA, MOVED_SHA];
    const { deps, lines, writes } = harness({
      answers: new Map([
        ["symbolic-ref --quiet --short HEAD", "top"],
        ["add --all", ""],
        ["write-tree", PINNED_TREE],
        [`--no-replace-objects rev-parse ${HEAD_SHA}^{tree}`, HEAD_TREE],
        [`--no-replace-objects rev-parse ${MOVED_SHA}^{tree}`, PINNED_TREE],
        [`${lineage} ${HEAD_SHA}`, "parent\0Test\0test@example.test\0"],
        [`${lineage} ${MOVED_SHA}`, "parent\0Test\0test@example.test\0"],
        ["ls-remote origin refs/heads/top", `${MOVED_SHA}\trefs/heads/top`],
        ["status --porcelain", ""],
        [`--no-replace-objects ls-tree -r -z --name-only ${MOVED_SHA}^{commit}`, ""],
      ]),
    });
    // HEAD is the checked commit until the amend writes, and the amended one after it.
    const git: GithubPushDeps = {
      ...deps.git,
      readGit: ({ args, cwd }) =>
        args.join(" ") === "rev-parse HEAD" ? heads[writes.length === 0 ? 0 : 1]! : deps.git.readGit({ args, cwd }),
    };

    const result = amendAndPush({
      git,
      home: HOME_WITHOUT_PUSH_ROOTS,
      locus: "o/r#main...top",
      plan: plan({ amendPin: { kind: "pinned", tree: PINNED_TREE } }),
      remote: "origin",
    });

    expect(unwrap(result)).toBe(MOVED_SHA);
    expect(writes).toEqual([
      "commit --amend --no-edit",
      `push --set-upstream --force-with-lease=refs/heads/top:${MOVED_SHA} origin ${MOVED_SHA}^{commit}:refs/heads/top`,
    ]);
    expect(lines).toEqual([`amended ${HEAD_SHA} → ${MOVED_SHA}`]);
  });

  it("refuses a dry-run plan outright, reading and writing no Git", () => {
    const { deps, events, writes } = harness({ answers: new Map() });

    const result = amendAndPush({
      git: deps.git,
      home: HOME_WITHOUT_PUSH_ROOTS,
      locus: "o/r#main...top",
      plan: plan({ amendPin: { kind: "dry-run" } }),
      remote: "origin",
    });

    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result)).toEqual({
      kind: "refused",
      reason: "a dry run has no pinned tree to amend; nothing was committed",
    });
    expect(events).toEqual([]);
    expect(writes).toEqual([]);
  });
});
