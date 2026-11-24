import { describe, expect, it } from "vitest";
import { GithubVerbErrors } from "../../../../../../cli/commands/github/errors.js";
import { type GithubPushDeps, runGithubPush } from "../../../../../../cli/commands/github/pushRun.js";
import { EXIT_ERROR, EXIT_OK } from "../../../../../../cli/exitCodes.js";
import { err, ok } from "../../../../../../lib/result.js";
import { homeDeclaringNoPrivateTerms } from "../../../../../privateTermsFixture.js";
import {
  fixtureDirs,
  GATE_WRITE,
  HOOK,
  harness,
  hold,
  LOCAL_SHA,
  PATCH_ID,
  PREFIX,
  REMOTE_SHA,
  useFixtureDirCleanup,
} from "./harness.js";

// register-class: pre-push-gate-runs-inside-the-open-transport (docs/recurring-failure-register/bindings.md)

useFixtureDirCleanup();

describe("runGithubPush", () => {
  const FRESHNESS_FETCH_AND_CLEANUP: readonly (readonly string[])[] = [
    ["fetch", "origin", "refs/heads/main:refs/slopweaver/fetch/test"],
    ["update-ref", "-d", "refs/slopweaver/fetch/test"],
  ];

  // MEASURED twice: git opens the ssh transport to discover the remote's refs BEFORE it runs
  // the pre-push hook, and GitHub reset the idle session (`Connection reset by peer`, then SIGPIPE) before a
  // nine-minute `yarn validate` finished — with client keepalives in place. The verb therefore runs the hook
  // itself first, with git's own argv and stdin, and only then opens the transport with `--no-verify`.
  it("runs the pre-push gate before the push and sends the push with the hook satisfied", async () => {
    const test = harness({ gate: ok({ hook: HOOK, kind: "ran" }) });
    const home = homeDeclaringNoPrivateTerms({ prefix: "github-push-home-" });
    fixtureDirs.push(home);
    const code = await runGithubPush({ argv: [...PREFIX, "--home", home], deps: test.deps });
    expect(code).toBe(EXIT_OK);
    expect(test.writes).toEqual([
      ...FRESHNESS_FETCH_AND_CLEANUP,
      [GATE_WRITE, "/repo", "origin", `${LOCAL_SHA}^{commit} ${LOCAL_SHA} refs/heads/feature ${REMOTE_SHA}\n`],
      ["push", "--no-verify", "--set-upstream", "origin", `${LOCAL_SHA}^{commit}:refs/heads/feature`],
    ]);
    expect(test.lines).toContain("pre-push gate: running the repository's hook before any transport opens");
    expect(test.lines).toContain(`pre-push gate: ${HOOK} passed before the transport opened; pushing with --no-verify`);
    expect(test.lines).toContain(`pushed and verified ${LOCAL_SHA} at owner/repo:feature`);
  });

  it("refuses the push when the gate refuses, and opens no transport", async () => {
    const test = harness({ gate: err(GithubVerbErrors.hookExited({ hook: HOOK, status: 1 })) });
    const home = homeDeclaringNoPrivateTerms({ prefix: "github-push-home-" });
    fixtureDirs.push(home);
    const code = await runGithubPush({ argv: [...PREFIX, "--home", home], deps: test.deps });
    expect(code).toBe(EXIT_ERROR);
    expect(test.writes.filter((write) => write[0] === "push")).toEqual([]);
    expect(test.lines.at(-1)).toBe(`failed: pre-push gate refused: ${HOOK} exited 1; nothing was sent`);
  });

  // `--no-verify` is earned by a hook that RAN. A repository with no executable hook gets git's plain push,
  // so a hook installed later is never skipped by a flag that outlived its reason.
  it("pushes without --no-verify when there is no executable hook to satisfy", async () => {
    const test = harness({ gate: ok({ hook: HOOK, kind: "no-hook" }) });
    const home = homeDeclaringNoPrivateTerms({ prefix: "github-push-home-" });
    fixtureDirs.push(home);
    const code = await runGithubPush({ argv: [...PREFIX, "--home", home], deps: test.deps });
    expect(code).toBe(EXIT_OK);
    expect(test.writes.at(-1)).toEqual([
      "push",
      "--set-upstream",
      "origin",
      `${LOCAL_SHA}^{commit}:refs/heads/feature`,
    ]);
    expect(test.lines).toContain(`pre-push gate: no executable hook at ${HOOK}; git pushes as it stands`);
  });

  it("refuses an unacknowledged base-moved before self-review, the door, or the push", async () => {
    const test = harness({ baseIsFresh: false });
    const home = homeDeclaringNoPrivateTerms({ prefix: "github-push-home-" });
    fixtureDirs.push(home);
    const code = await runGithubPush({ argv: [...PREFIX, "--home", home], deps: test.deps });
    expect(code).toBe(EXIT_ERROR);
    expect(test.writes).toEqual(FRESHNESS_FETCH_AND_CLEANUP);
    expect(test.lines.some((line) => line.startsWith("refused: base-moved"))).toBe(true);
    expect(test.lines).toContain(
      "remedy: rebase onto the current base ONCE, run the full gate, push, and land with " +
        "`slopweaver github enqueue --pr <n> --repo owner/repo`",
    );
  });

  // A base-moved is the moment a session learns it is in a serial landing. Printing "rebase and retry" there
  // was the losing lap as measured; the remedy now reads the hold and names the lap that lands.
  it("tells a base-moved push whose own session holds the queue that this is the lap that lands", async () => {
    const test = harness({ baseIsFresh: false, holds: [hold({ holder: "this-session" })] });
    const home = homeDeclaringNoPrivateTerms({ prefix: "github-push-home-" });
    fixtureDirs.push(home);
    const code = await runGithubPush({ argv: [...PREFIX, "--home", home], deps: test.deps });
    expect(code).toBe(EXIT_ERROR);
    expect(test.lines).toContain(
      "remedy: you own the merge hold on owner/repo (owner/repo#32, placed 10m ago) — this is the lap that lands: " +
        "rebase onto the current base, run the full gate ONCE, push, and `slopweaver github merge --repo owner/repo " +
        "--base origin/<base> --head <branch> --description - --admin --number 32 < body.md` releases it",
    );
  });

  it("tells a base-moved push behind another session's hold not to rebase until it lands", async () => {
    const test = harness({ baseIsFresh: false, holds: [hold()] });
    const home = homeDeclaringNoPrivateTerms({ prefix: "github-push-home-" });
    fixtureDirs.push(home);
    const code = await runGithubPush({ argv: [...PREFIX, "--home", home], deps: test.deps });
    expect(code).toBe(EXIT_ERROR);
    expect(test.lines).toContain(
      "remedy: owner/repo#32 owns the merge hold on owner/repo (held 10m by another-session: landing first) — do NOT " +
        "rebase yet: every lap you run before it lands is one you lose",
    );
  });

  it("says nothing about the hold on a fresh push, even while one stands", async () => {
    const test = harness({ holds: [hold()] });
    const home = homeDeclaringNoPrivateTerms({ prefix: "github-push-home-" });
    fixtureDirs.push(home);
    const code = await runGithubPush({ argv: [...PREFIX, "--home", home], deps: test.deps });
    expect(code).toBe(EXIT_OK);
    expect(test.lines.some((line) => line.includes("merge queue"))).toBe(false);
  });

  // The finding this closes: under a native merge queue a base-moved push was sent round a rebase and a
  // whole ~18-minute gate lap while main advanced roughly every 10 minutes, so the lap could not win. The
  // queue tests the merged result against the tip, so it is the queue — not the lap — that protects the base.
  it("pushes a base-moved head unacknowledged when the base's queue gates on real contexts", async () => {
    const test = harness({
      baseIsFresh: false,
      queueGate: { branch: "main", contexts: ["build", "integration"], url: "https://q.example/main" },
    });
    const home = homeDeclaringNoPrivateTerms({ prefix: "github-push-home-" });
    fixtureDirs.push(home);
    const code = await runGithubPush({ argv: [...PREFIX, "--home", home], deps: test.deps });
    expect(code).toBe(EXIT_OK);
    expect(test.queueGateReads).toEqual(["owner/repo@main"]);
    expect(test.lines).toContain(
      `base freshness: base-moved ACCEPTED — main is 2 commit(s) past ${LOCAL_SHA} (bound 16), and its merge ` +
        "queue gates on build, integration, so the merged result is tested against the tip before it lands",
    );
    expect(test.lines).toContain(`pushed and verified ${LOCAL_SHA} at owner/repo:feature`);
  });

  it("still refuses a base-moved head when the base's queue requires no status-check context", async () => {
    const test = harness({
      baseIsFresh: false,
      queueGate: { branch: "main", contexts: [], url: "https://q.example/main" },
    });
    const home = homeDeclaringNoPrivateTerms({ prefix: "github-push-home-" });
    fixtureDirs.push(home);
    const code = await runGithubPush({ argv: [...PREFIX, "--home", home], deps: test.deps });
    expect(code).toBe(EXIT_ERROR);
    expect(test.lines).toContain(
      "the merge queue does not excuse this: main's queue requires NO status-check contexts, so it would merge " +
        "an entry on arrival without testing the merged result",
    );
  });

  // The read costs a round trip, so it happens on the one arm that can use its answer.
  it("never reads the queue on a fresh push", async () => {
    const test = harness({
      queueGate: { branch: "main", contexts: ["build"], url: "https://q.example/main" },
    });
    const home = homeDeclaringNoPrivateTerms({ prefix: "github-push-home-" });
    fixtureDirs.push(home);
    const code = await runGithubPush({ argv: [...PREFIX, "--home", home], deps: test.deps });
    expect(code).toBe(EXIT_OK);
    expect(test.queueGateReads).toEqual([]);
  });

  it("proceeds past an acknowledged base-moved and completes the push", async () => {
    const test = harness({ baseIsFresh: false });
    const home = homeDeclaringNoPrivateTerms({ prefix: "github-push-home-" });
    fixtureDirs.push(home);
    const code = await runGithubPush({
      argv: [...PREFIX, "--home", home, "--acknowledge", "base-moved"],
      deps: test.deps,
    });
    expect(code).toBe(EXIT_OK);
    expect(test.lines.some((line) => line.startsWith("ACKNOWLEDGED (base-moved)"))).toBe(true);
    expect(test.lines).toContain(`pushed and verified ${LOCAL_SHA} at owner/repo:feature`);
  });

  // The push is where the author is standing when they need the anchor, and where both halves of it exist:
  // the head that was just sent, and the base freshness measured a moment earlier. Printing them here is
  // what stops the next rebase costing a description rewrite and a whole CI lap.
  it("prints the gold anchor to record beside the proof after a successful push", async () => {
    const test = harness();
    const home = homeDeclaringNoPrivateTerms({ prefix: "github-push-home-" });
    fixtureDirs.push(home);
    const code = await runGithubPush({ argv: [...PREFIX, "--home", home], deps: test.deps });
    expect(code).toBe(EXIT_OK);
    expect(test.lines.slice(-2)).toEqual([
      "gold anchor for this head (record it beside the proof; no description carries it):",
      `  {"goldAnchor":{"commit":"${LOCAL_SHA}","patchId":"${PATCH_ID}"}}`,
    ]);
  });

  it("names the reason rather than printing a blank when the measurement fails", async () => {
    const test = harness({ patchId: err("git patch-id exploded") });
    const home = homeDeclaringNoPrivateTerms({ prefix: "github-push-home-" });
    fixtureDirs.push(home);
    const code = await runGithubPush({ argv: [...PREFIX, "--home", home], deps: test.deps });
    // A push that WORKED is never reported as a failure over an anchor the author can also gather by hand.
    expect(code).toBe(EXIT_OK);
    expect(test.lines.slice(-2)).toEqual([
      `  {"goldAnchor":{"commit":"${LOCAL_SHA}"}}`,
      "  no patchId: git patch-id exploded",
    ]);
  });

  it("distinguishes an empty contribution from a broken measurement", async () => {
    const test = harness({ patchId: ok(null) });
    const home = homeDeclaringNoPrivateTerms({ prefix: "github-push-home-" });
    fixtureDirs.push(home);
    await runGithubPush({ argv: [...PREFIX, "--home", home], deps: test.deps });
    expect(test.lines.at(-1)).toBe("  no patchId: this branch contributes no diff to its base");
  });

  it("fails closed on an unmeasurable base, distinct from a genuine base-moved", async () => {
    const test = harness();
    const failingDeps: GithubPushDeps = {
      ...test.deps,
      baseFreshness: {
        ...test.deps.baseFreshness!,
        git: { ...test.deps.baseFreshness!.git, writeGit: () => err("network unreachable") },
      },
    };
    const home = homeDeclaringNoPrivateTerms({ prefix: "github-push-home-" });
    fixtureDirs.push(home);
    const code = await runGithubPush({ argv: [...PREFIX, "--home", home], deps: failingDeps });
    expect(code).toBe(EXIT_ERROR);
    expect(test.lines.some((line) => line.includes("base-unmeasurable"))).toBe(true);
    expect(test.lines.some((line) => line.includes("network unreachable"))).toBe(true);
  });
});
