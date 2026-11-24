import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  FLOOR_BASE_ENV,
  gitGrep,
  gitLines,
  gitNulFields,
  gitShow,
  gitSucceeds,
  grepOutcome,
  readFloorBaseClaim,
  resolveFloorBase,
} from "../../../devLint/gitAtCommit.js";
import { gitInTemp, REAL_GIT_TIMEOUT_MS } from "../../tempGitRepo.js";

const SHA = "f0e52dd6574e8f326c6f13d1cd2521c0ef811e70";

const ZERO_SHA = "0".repeat(40);

/** The reason an all-zeroes base that HEAD does not confirm fails with, around the confirmation's own gap. */
function unconfirmedReason({ why }: { why: string }): string {
  return (
    `${FLOOR_BASE_ENV} is all zeroes, but nothing confirms this ref is new: ${why} — only a root commit or the ` +
    `push that created the ref may skip the comparison; re-run with ` +
    `\`${FLOOR_BASE_ENV}=$(git merge-base origin/main HEAD)\` in front of the command`
  );
}

describe("readFloorBaseClaim", () => {
  it("reports INVALID, naming the command that supplies a base, when nobody supplied one", () => {
    // A branch once reached the lap red on host-wording after a seat's run with no base printed a pass.
    expect(readFloorBaseClaim({ env: {} })).toEqual({
      kind: "invalid",
      reason:
        `no ${FLOOR_BASE_ENV} in the environment, so nothing was compared — run \`git fetch origin main\`, ` +
        `then re-run with \`${FLOOR_BASE_ENV}=$(git merge-base origin/main HEAD)\` in front of the command`,
    });
  });

  it("reports ABSENT for the all-zeroes SHA from the environment alone — a claim resolveFloorBase checks", () => {
    expect(readFloorBaseClaim({ env: { [FLOOR_BASE_ENV]: "0".repeat(40) } })).toEqual({
      kind: "absent",
      reason: `${FLOOR_BASE_ENV} is all zeroes — this ref has no previous commit`,
    });
  });

  it("reports INVALID, never the passing absent, when the variable is set but empty", () => {
    expect(readFloorBaseClaim({ env: { [FLOOR_BASE_ENV]: "   " } })).toEqual({
      kind: "invalid",
      reason: `${FLOOR_BASE_ENV} is set but empty — give it the base commit's full SHA`,
    });
  });

  it("reports INVALID for an abbreviated SHA, and prints the command that expands it", () => {
    expect(readFloorBaseClaim({ env: { [FLOOR_BASE_ENV]: "f0e52dd" } })).toEqual({
      kind: "invalid",
      reason:
        `${FLOOR_BASE_ENV} is not a full 40-character commit SHA: f0e52dd — expand it with ` +
        `\`export ${FLOOR_BASE_ENV}=$(git rev-parse f0e52dd)\``,
    });
  });

  it("reports INVALID without an expand command for a value that is not a SHA prefix at all", () => {
    expect(readFloorBaseClaim({ env: { [FLOOR_BASE_ENV]: "origin/main" } })).toEqual({
      kind: "invalid",
      reason: `${FLOOR_BASE_ENV} is not a full 40-character commit SHA: origin/main`,
    });
  });

  it("reports INVALID for a 40-character value that is not hexadecimal", () => {
    expect(readFloorBaseClaim({ env: { [FLOOR_BASE_ENV]: "z".repeat(40) } })).toEqual({
      kind: "invalid",
      reason: `${FLOOR_BASE_ENV} is not a full 40-character commit SHA: ${"z".repeat(40)}`,
    });
  });

  it("accepts a full SHA and surrounding whitespace", () => {
    expect(readFloorBaseClaim({ env: { [FLOOR_BASE_ENV]: `  ${SHA}\n` } })).toEqual({ kind: "sha", sha: SHA });
  });

  it("accepts an uppercase SHA and normalises it, because git does too", () => {
    expect(readFloorBaseClaim({ env: { [FLOOR_BASE_ENV]: SHA.toUpperCase() } })).toEqual({
      kind: "sha",
      sha: SHA,
    });
  });
});

describe("reading a real repository at a commit", () => {
  let root = "";
  let baseSha = "";
  let headSha = "";

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "git-at-commit-"));
    const git = (...args: readonly string[]): string => gitInTemp({ cwd: root, args });
    git("init", "--initial-branch=main", ".");
    git("config", "user.email", "fixture@example.invalid");
    git("config", "user.name", "Fixture");
    writeFileSync(join(root, "kept.txt"), "base\n");
    git("add", ".");
    git("commit", "-m", "base");
    baseSha = git("rev-parse", "HEAD");
    writeFileSync(join(root, "kept.txt"), "head\n");
    writeFileSync(join(root, "added.txt"), "new\n");
    git("add", ".");
    git("commit", "-m", "head");
    headSha = git("rev-parse", "HEAD");
  }, REAL_GIT_TIMEOUT_MS);

  afterAll(() => {
    rmSync(root, { force: true, recursive: true });
  });

  /** Write a push payload under `.git`, outside the work tree, and return the runner variables naming it. */
  const pushEvent = ({ after, created }: { after: string; created: boolean }): NodeJS.ProcessEnv => {
    const path = join(root, ".git", `event-${String(created)}-${after}.json`);
    writeFileSync(path, `{"after":"${after}","before":"${ZERO_SHA}","created":${String(created)}}`);
    return { GITHUB_EVENT_NAME: "push", GITHUB_EVENT_PATH: path };
  };

  it("resolveFloorBase FAILS forty zeroes exported by hand on a HEAD with a parent — the closed hole", () => {
    expect(resolveFloorBase({ env: { [FLOOR_BASE_ENV]: ZERO_SHA }, root })).toEqual({
      kind: "invalid",
      reason: unconfirmedReason({ why: "HEAD has a parent, and no GitHub event is in the environment" }),
    });
  });

  it("resolveFloorBase keeps forty zeroes when the runner's push event created this ref at HEAD", () => {
    const env = { ...pushEvent({ after: headSha, created: true }), [FLOOR_BASE_ENV]: ZERO_SHA };
    expect(resolveFloorBase({ env, root })).toEqual({
      kind: "absent",
      reason: `${FLOOR_BASE_ENV} is all zeroes — this ref has no previous commit (the push event created this ref at HEAD)`,
    });
  });

  it("resolveFloorBase fails forty zeroes when the push event says the ref already existed", () => {
    const env = { ...pushEvent({ after: headSha, created: false }), [FLOOR_BASE_ENV]: ZERO_SHA };
    expect(resolveFloorBase({ env, root })).toEqual({
      kind: "invalid",
      reason: unconfirmedReason({
        why:
          "HEAD has a parent, and the push event does not record a created ref (`created: true`, `before` all " +
          "zeroes, `after` a full SHA)",
      }),
    });
  });

  it("resolveFloorBase fails forty zeroes when the named event file is not there", () => {
    const missing = join(root, ".git", "no-such-event.json");
    const env = { [FLOOR_BASE_ENV]: ZERO_SHA, GITHUB_EVENT_NAME: "push", GITHUB_EVENT_PATH: missing };
    expect(resolveFloorBase({ env, root })).toEqual({
      kind: "invalid",
      reason: unconfirmedReason({
        why:
          "HEAD has a parent, and the GitHub event file could not be read " +
          `(ENOENT: no such file or directory, open '${missing}')`,
      }),
    });
  });

  it("resolveFloorBase fails forty zeroes when the event file is there but is not JSON", () => {
    const path = join(root, ".git", "event-not-json.json");
    writeFileSync(path, "not json at all");
    const env = { [FLOOR_BASE_ENV]: ZERO_SHA, GITHUB_EVENT_NAME: "push", GITHUB_EVENT_PATH: path };
    expect(resolveFloorBase({ env, root })).toEqual({
      kind: "invalid",
      reason: unconfirmedReason({ why: "HEAD has a parent, and the GitHub event file is not JSON" }),
    });
  });

  it.each([
    { file: "event-null.json", shape: "null", text: "null" },
    { file: "event-array.json", shape: "an array", text: `["${ZERO_SHA}"]` },
  ])("resolveFloorBase fails forty zeroes when the event file parses to $shape", ({ file, text }) => {
    const path = join(root, ".git", file);
    writeFileSync(path, text);
    const env = { [FLOOR_BASE_ENV]: ZERO_SHA, GITHUB_EVENT_NAME: "push", GITHUB_EVENT_PATH: path };
    expect(resolveFloorBase({ env, root })).toEqual({
      kind: "invalid",
      reason: unconfirmedReason({
        why:
          "HEAD has a parent, and the push event does not record a created ref (`created: true`, `before` all " +
          "zeroes, `after` a full SHA)",
      }),
    });
  });

  it("resolveFloorBase passes a full SHA through without reading HEAD", () => {
    expect(resolveFloorBase({ env: { [FLOOR_BASE_ENV]: baseSha }, root })).toEqual({ kind: "sha", sha: baseSha });
  });

  it("gitSucceeds is true for a commit that is present", () => {
    expect(gitSucceeds({ root, args: ["cat-file", "-e", `${baseSha}^{commit}`] })).toBe(true);
  });

  it("gitSucceeds is false for a commit that is not, rather than throwing", () => {
    expect(gitSucceeds({ root, args: ["cat-file", "-e", `${"b".repeat(40)}^{commit}`] })).toBe(false);
  });

  it("gitShow reads a file's contents AT the base commit, not from the working tree", () => {
    expect(gitShow({ root, spec: `${baseSha}:kept.txt` })).toBe("base\n");
  });

  it("gitShow answers undefined for a path absent at that commit", () => {
    expect(gitShow({ root, spec: `${baseSha}:added.txt` })).toBeUndefined();
  });

  it("gitLines reports a two-dot name-status diff from the base to HEAD", () => {
    expect(gitLines({ root, args: ["diff", "--name-status", "-M", baseSha, "HEAD"] })).toEqual([
      "A\tadded.txt",
      "M\tkept.txt",
    ]);
  });

  it("gitLines answers undefined when git refuses, rather than an empty diff", () => {
    expect(gitLines({ root, args: ["diff", "--name-status", `${"c".repeat(40)}`, "HEAD"] })).toBeUndefined();
  });

  it("gitGrep answers match for a word git finds", () => {
    expect(gitGrep({ root, args: ["grep", "-q", "-w", "-e", "head", "--", "kept.txt"] })).toBe("match");
  });

  it("gitGrep answers none for a word git searched for and did not find", () => {
    expect(gitGrep({ root, args: ["grep", "-q", "-w", "-e", "absentword", "--", "kept.txt"] })).toBe("none");
  });

  it("gitGrep answers error when git could not search at all, never none", () => {
    expect(gitGrep({ root, args: ["grep", "-q", "-w", "-e", "head", "c".repeat(40), "--", "kept.txt"] })).toBe("error");
  });
});

describe("grepOutcome — a failed grep is never read as an absence", () => {
  it("reads exit 0 as a match", () => {
    expect(grepOutcome({ end: { error: undefined, status: 0 } })).toBe("match");
  });

  it("reads exit 1 as no match", () => {
    expect(grepOutcome({ end: { error: undefined, status: 1 } })).toBe("none");
  });

  it("reads git's fatal 128 as an error", () => {
    expect(grepOutcome({ end: { error: undefined, status: 128 } })).toBe("error");
  });

  it("reads a kill with no exit status as an error", () => {
    expect(grepOutcome({ end: { error: undefined, status: null } })).toBe("error");
  });

  it("reads a timeout as an error even if a status arrived", () => {
    expect(grepOutcome({ end: { error: new Error("spawnSync git ETIMEDOUT"), status: 1 } })).toBe("error");
  });
});

/**
 * The regression witness for a past CI red: `test-enshittification` reported "git diff against
 * <base> failed — no comparison made" in CI while passing on every full-history clone, including a local
 * `yarn lint` lap over all 67 gates.
 *
 * CI never fetches a merge-base. `ci.yml` brings the base in with
 * `git fetch --no-tags --depth=1 origin "$SLOPWEAVER_COVERAGE_BASE_SHA"`, which grafts a PARENTLESS commit,
 * so a three-dot `base...HEAD` has no common ancestor to compute and git exits non-zero. Two-dot compares
 * the two TREES and needs no ancestry at all. Both halves are asserted here: the test is evidence only
 * because the three-dot arm really does fail on this fixture.
 */
describe("a shallow base with no merge-base — the shape CI actually builds", () => {
  let shallow = "";
  let baseSha = "";

  beforeAll(() => {
    const origin = mkdtempSync(join(tmpdir(), "git-origin-"));
    const git = (...args: readonly string[]): string => gitInTemp({ cwd: origin, args });
    git("init", "--initial-branch=main", ".");
    git("config", "user.email", "fixture@example.invalid");
    git("config", "user.name", "Fixture");
    writeFileSync(join(origin, "kept.txt"), "base\n");
    git("add", ".");
    git("commit", "-m", "base");
    baseSha = git("rev-parse", "HEAD");
    writeFileSync(join(origin, "kept.txt"), "head\n");
    git("add", ".");
    git("commit", "-m", "head");

    shallow = mkdtempSync(join(tmpdir(), "git-shallow-"));
    gitInTemp({ cwd: shallow, args: ["clone", "--depth=1", `file://${origin}`, "."] });
    gitInTemp({ cwd: shallow, args: ["fetch", "--no-tags", "--depth=1", "origin", baseSha] });
    rmSync(origin, { force: true, recursive: true });
  }, REAL_GIT_TIMEOUT_MS);

  afterAll(() => {
    rmSync(shallow, { force: true, recursive: true });
  });

  it("has the base commit present but with no ancestry to HEAD", () => {
    expect(gitSucceeds({ root: shallow, args: ["cat-file", "-e", `${baseSha}^{commit}`] })).toBe(true);
    expect(gitSucceeds({ root: shallow, args: ["merge-base", baseSha, "HEAD"] })).toBe(false);
  });

  it("THREE-dot fails on it — the exact CI red this gate hit", () => {
    expect(gitLines({ root: shallow, args: ["diff", "--name-status", "-M", `${baseSha}...HEAD`] })).toBeUndefined();
  });

  it("TWO-dot still reports the change, which is why the gate uses it", () => {
    expect(gitLines({ root: shallow, args: ["diff", "--name-status", "-M", baseSha, "HEAD"] })).toEqual([
      "M\tkept.txt",
    ]);
  });

  it("grafts HEAD parentless for a history walk, yet its raw commit keeps the parent the new-ref check reads", () => {
    expect(
      gitLines({ root: shallow, args: ["rev-list", "--parents", "-n", "1", "HEAD"] })![0]!.split(" "),
    ).toHaveLength(1);
    expect(resolveFloorBase({ env: { [FLOOR_BASE_ENV]: ZERO_SHA }, root: shallow })).toEqual({
      kind: "invalid",
      reason: unconfirmedReason({ why: "HEAD has a parent, and no GitHub event is in the environment" }),
    });
  });
});

describe("resolveFloorBase on a root commit — the brand-new ref that keeps passing", () => {
  let root = "";

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "git-root-"));
    const git = (...args: readonly string[]): string => gitInTemp({ cwd: root, args });
    git("init", "--initial-branch=main", ".");
    git("config", "user.email", "fixture@example.invalid");
    git("config", "user.name", "Fixture");
    writeFileSync(join(root, "kept.txt"), "only\n");
    git("add", ".");
    git("commit", "-m", "only");
  }, REAL_GIT_TIMEOUT_MS);

  afterAll(() => {
    rmSync(root, { force: true, recursive: true });
  });

  it("keeps forty zeroes as absent, naming the root commit as the evidence", () => {
    expect(resolveFloorBase({ env: { [FLOOR_BASE_ENV]: ZERO_SHA }, root })).toEqual({
      kind: "absent",
      reason: `${FLOOR_BASE_ENV} is all zeroes — this ref has no previous commit (HEAD is a root commit)`,
    });
  });
});

/**
 * The end-to-end half of Codex review pass r1's counterexample, over a real repository rather than a
 * hand-built field list: git itself quotes the path, and the two readers disagree about whether the file
 * is in the diff at all. Both arms are asserted, so this is evidence rather than an assertion of silence.
 */
describe("a non-ASCII path, which git quotes by default", () => {
  let root = "";
  let baseSha = "";
  const named = "src/__tests__/unit/café.test.ts";

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "git-quotepath-"));
    const git = (...args: readonly string[]): string => gitInTemp({ cwd: root, args });
    git("init", "--initial-branch=main", ".");
    git("config", "user.email", "fixture@example.invalid");
    git("config", "user.name", "Fixture");
    mkdirSync(join(root, "src/__tests__/unit"), { recursive: true });
    writeFileSync(join(root, named), "expect(1).toBe(1);\nexpect(2).toBe(2);\n");
    git("add", ".");
    git("commit", "-m", "base");
    baseSha = git("rev-parse", "HEAD");
    writeFileSync(join(root, named), "expect(1).toBe(1);\n");
    git("add", ".");
    git("commit", "-m", "weaken");
  }, REAL_GIT_TIMEOUT_MS);

  afterAll(() => {
    rmSync(root, { force: true, recursive: true });
  });

  it("WITHOUT -z git quotes the path, which is what hid the weakening", () => {
    expect(gitLines({ root, args: ["diff", "--name-status", "-M", baseSha, "HEAD"] })).toEqual([
      'M\t"src/__tests__/unit/caf\\303\\251.test.ts"',
    ]);
  });

  it("WITH -z the path arrives raw, so the gate's prefix test matches it", () => {
    expect(gitNulFields({ root, args: ["diff", "--name-status", "-M", "-z", baseSha, "HEAD"] })).toEqual(["M", named]);
  });

  it("gitNulFields answers undefined when git refuses", () => {
    expect(gitNulFields({ root, args: ["diff", "--name-status", "-z", "d".repeat(40), "HEAD"] })).toBeUndefined();
  });
});
