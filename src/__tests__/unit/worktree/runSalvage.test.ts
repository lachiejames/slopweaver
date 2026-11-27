/**
 * `runSalvage` driven end to end through its injected git edges.
 *
 * Not a mock: `GithubPushEdges` is a seam the production code already takes, and the fake below is a plain
 * function answering a table of git invocations. That is what makes the interesting paths reachable at all —
 * a tree whose name is taken on the remote, a step git refuses, a push the remote never confirms — none of
 * which can be staged against a real checkout without a real remote.
 *
 * The property every case here serves is the one this class exists for: a worktree holding the only copy of
 * some work is removed ONLY once a remote has confirmed that work, so every failure answers a `declined`
 * with a null branch, and the caller keeps the tree.
 *
 * The ignored-file declines left with the read they tested; one capture case replaces them.
 */
import { describe, expect, it } from "vitest";

import { GithubPushDoorErrors } from "../../../admit/githubPushErrors.js";
import { err } from "../../../lib/result.js";
import { runSalvage } from "../../../worktree/pruneSalvage.js";
import { HOME_WITHOUT_PUSH_ROOTS } from "../../pushRootFixture.js";
import { ABSENT, BASE_BRANCH, COMMITTED, fakeDeps, HEAD, NO_SECRETS, PATH, URL, verdict } from "./salvageGitWorld.js";

describe("runSalvage", () => {
  it("captures a dirty tree onto a FRESH branch and confirms it, never touching the tree's own branch", () => {
    const { deps, ran } = fakeDeps({ world: { staged: ["a", "b"], untracked: ["c"] } });
    const outcome = runSalvage({
      deps,
      denylist: ABSENT,
      home: HOME_WITHOUT_PUSH_ROOTS,
      remote: "origin",
      scan: NO_SECRETS,
      verdict,
    });

    expect(outcome.declined).toBe(null);
    expect(outcome.branch).toBe(BASE_BRANCH);
    // The branch the tree arrived on is never an argument to any write.
    expect(ran.filter((line) => line.startsWith("write:") && line.includes("feature-x"))).toEqual([]);
    // "M a\nM b\n?? c" is two INDEX changes and one untracked file, so the index is committed first and
    // the working tree second — see `planSalvage`, and the review that found a staged version being lost.
    const writes = ran.filter((line) => line.startsWith("write:"));
    expect(writes.slice(0, 2)).toEqual([`write:branch ${BASE_BRANCH} ${HEAD}`, `write:switch ${BASE_BRANCH}`]);
    expect(writes[2]).toContain("the staged index");
    expect(writes[3]).toBe("write:add -A");
    expect(writes[4]).toContain("the working tree");
    expect(writes[5]).toContain("write:push");
    expect(writes.length).toBe(6);
  });

  it("pushes the commit it just MADE, not the sha the tree was on before the commit", () => {
    const { deps, ran } = fakeDeps({ world: { staged: ["a"] } });
    runSalvage({ deps, denylist: ABSENT, home: HOME_WITHOUT_PUSH_ROOTS, remote: "origin", scan: NO_SECRETS, verdict });

    const push = ran.find((line) => line.startsWith("write:push"))!;
    expect(push).toContain(`--force-with-lease=refs/heads/${BASE_BRANCH}:`);
    // By sha, never by name: the scan read exactly this commit, and a name could move before the transport opens.
    expect(push).toContain(`${COMMITTED}^{commit}:refs/heads/${BASE_BRANCH}`);
    expect(push).toContain(` ${URL} `);
    expect(push).toContain("--recurse-submodules=no");
    expect(push).toContain("--no-follow-tags");
    // The read-back asks the same literal url the push went to, and the world answers the COMMITTED sha.
    expect(ran).toContain(`read:ls-remote ${URL} refs/heads/${BASE_BRANCH}`);
  });

  it("steps over a name the REMOTE already carries, rather than fast-forwarding somebody else's branch", () => {
    const { deps, ran } = fakeDeps({ world: { staged: ["a"], remoteBranches: [BASE_BRANCH] } });
    const outcome = runSalvage({
      deps,
      denylist: ABSENT,
      home: HOME_WITHOUT_PUSH_ROOTS,
      remote: "origin",
      scan: NO_SECRETS,
      verdict,
    });

    expect(outcome.branch).toBe(`${BASE_BRANCH}-2`);
    expect(ran).toContain(`read:ls-remote --heads origin ${BASE_BRANCH}`);
    expect(ran.filter((line) => line === `write:branch ${BASE_BRANCH} ${HEAD}`)).toEqual([]);
  });

  it("steps over a name only the LOCAL repository has, which git branch would have refused anyway", () => {
    const { deps } = fakeDeps({ world: { staged: ["a"], localBranches: [BASE_BRANCH] } });
    expect(
      runSalvage({ deps, denylist: ABSENT, home: HOME_WITHOUT_PUSH_ROOTS, remote: "origin", scan: NO_SECRETS, verdict })
        .branch,
    ).toBe(`${BASE_BRANCH}-2`);
  });

  it("KEEPS the tree when the remote cannot be probed, because an unreadable remote is not a free name", () => {
    const { deps, ran } = fakeDeps({ world: { staged: ["a"], remoteUnreachable: true } });
    const outcome = runSalvage({
      deps,
      denylist: ABSENT,
      home: HOME_WITHOUT_PUSH_ROOTS,
      remote: "origin",
      scan: NO_SECRETS,
      verdict,
    });

    expect(outcome.branch).toBe(null);
    expect(outcome.declined).toContain("already taken locally or on origin");
    expect(ran.filter((line) => line.startsWith("write:"))).toEqual([]);
  });

  it("KEEPS a tree of ANOTHER history and writes nothing, so an archive branch is never pushed to the public remote", () => {
    // The old-history case: a checkout carrying the pre-cut history on an `archive` remote, whose commits share no
    // merge base with `origin`'s trunk. Salvaged, that whole history would land on origin as one `salvage/…` branch.
    const { deps, ran } = fakeDeps({ world: { staged: ["a"], unrelatedHistory: true } });
    const outcome = runSalvage({
      deps,
      denylist: ABSENT,
      home: HOME_WITHOUT_PUSH_ROOTS,
      remote: "origin",
      scan: NO_SECRETS,
      verdict,
    });

    expect(outcome).toEqual({
      branch: null,
      declined:
        "its HEAD shares no history with origin's trunk (refs/remotes/origin/HEAD), or that trunk could not be read — nothing was pushed",
    });
    expect(ran.filter((line) => line.startsWith("write:"))).toEqual([]);
    // It refused before probing a single branch name, on the remote or locally.
    expect(ran.filter((line) => line.startsWith("read:ls-remote") || line.includes("rev-parse --verify"))).toEqual([]);
  });

  it("KEEPS a tree of another history WITH a hidden index bit, refusing before clearing the bit is even tried", () => {
    // Clearing an `--assume-unchanged` bit is a WRITE (`update-index`), so the ancestry refusal has to come first.
    const { deps, ran } = fakeDeps({
      world: { lsFiles: "h hidden.txt\0H visible.txt\0", staged: ["visible.txt"], unrelatedHistory: true },
    });
    const outcome = runSalvage({
      deps,
      denylist: ABSENT,
      home: HOME_WITHOUT_PUSH_ROOTS,
      remote: "origin",
      scan: NO_SECRETS,
      verdict,
    });

    expect(outcome.declined).toContain("its HEAD shares no history with origin's trunk");
    expect(ran.filter((line) => line.startsWith("write:"))).toEqual([]);
  });

  it("asks the trunk about the EXACT sha it read, with replace refs and the commit graph off, before any other step", () => {
    const { deps, ran } = fakeDeps({ world: { staged: ["a"] } });
    runSalvage({ deps, denylist: ABSENT, home: HOME_WITHOUT_PUSH_ROOTS, remote: "origin", scan: NO_SECRETS, verdict });

    const ask = `read:--no-replace-objects -c core.commitGraph=false merge-base ${HEAD} refs/remotes/origin/HEAD`;
    expect(ran.slice(0, 2)).toEqual(["read:rev-parse HEAD", ask]);
  });

  it("KEEPS the tree when git refuses a step, naming which step it was", () => {
    const { deps, ran } = fakeDeps({ world: { staged: ["a"], failWrite: "commit" } });
    const outcome = runSalvage({
      deps,
      denylist: ABSENT,
      home: HOME_WITHOUT_PUSH_ROOTS,
      remote: "origin",
      scan: NO_SECRETS,
      verdict,
    });

    expect(outcome.branch).toBe(null);
    expect(outcome.declined).toBe(
      "could not commit what was already staged, before anything is staged over it — git commit refused",
    );
    expect(ran.filter((line) => line.startsWith("write:push"))).toEqual([]);
  });

  it("KEEPS the tree when the remote reports a DIFFERENT sha than the one that was sent", () => {
    const { deps } = fakeDeps({ world: { staged: ["a"], remoteReports: "0000000000000000000000000000000000000000" } });
    const outcome = runSalvage({
      deps,
      denylist: ABSENT,
      home: HOME_WITHOUT_PUSH_ROOTS,
      remote: "origin",
      scan: NO_SECRETS,
      verdict,
    });

    expect(outcome.branch).toBe(null);
    expect(outcome.declined).toContain("the remote did not confirm the work");
  });

  it("KEEPS the tree when the remote reports NO sha at all, which an exit code alone would have called success", () => {
    const { deps } = fakeDeps({ world: { staged: ["a"], remoteReports: "" } });
    const outcome = runSalvage({
      deps,
      denylist: ABSENT,
      home: HOME_WITHOUT_PUSH_ROOTS,
      remote: "origin",
      scan: NO_SECRETS,
      verdict,
    });

    expect(outcome.branch).toBe(null);
    expect(outcome.declined).toContain("the remote did not confirm the work");
  });

  it("KEEPS the tree when its working tree cannot be read at apply time", () => {
    const { deps, ran } = fakeDeps({ world: { headUnreadable: true } });
    const outcome = runSalvage({
      deps,
      denylist: ABSENT,
      home: HOME_WITHOUT_PUSH_ROOTS,
      remote: "origin",
      scan: NO_SECRETS,
      verdict,
    });

    expect(outcome.branch).toBe(null);
    expect(outcome.declined).toBe("its working tree could not be read at apply time, so nothing was captured");
    expect(ran.filter((line) => line.startsWith("write:"))).toEqual([]);
  });

  it("CAPTURES a tree holding ignored content — a dist/, an .env.local, a patch — and never asks git to list it", () => {
    const { deps, ran } = fakeDeps({
      world: {
        ignored: ["node_modules/", "dist/", "packages/app/.env.local", ".yarn/", ".yarn/patches/local.patch"],
        unstaged: ["a"],
      },
    });
    const outcome = runSalvage({
      deps,
      denylist: ABSENT,
      home: HOME_WITHOUT_PUSH_ROOTS,
      remote: "origin",
      scan: NO_SECRETS,
      verdict,
    });

    expect(outcome.declined).toBe(null);
    expect(outcome.branch).toBe(BASE_BRANCH);
    expect(ran.filter((line) => line.includes("--ignored"))).toEqual([]);
  });

  it("runs EVERY git command with hooks off — reads included, not just the writes", () => {
    // Two hooks, two windows. `git switch` fires `post-checkout` between the switch and the commit that
    // captures the index; `git status --porcelain` fires `post-index-change` before the capture has even
    // measured it. A hook running `git add` in either one destroys the staged version, and nothing
    // downstream notices: both commits succeed, the leased push succeeds, the remote confirms the exact sha.
    // Arming only the writes armoured nothing, because the status read is the FIRST thing a salvage does.
    const { armoured, bare, deps } = fakeDeps({ world: { staged: ["f", "g"], unstaged: ["f"] } });
    const outcome = runSalvage({
      deps,
      denylist: ABSENT,
      home: HOME_WITHOUT_PUSH_ROOTS,
      remote: "origin",
      scan: NO_SECRETS,
      verdict,
    });

    expect(outcome.declined).toBe(null);
    expect(armoured.length).toBeGreaterThan(0);
    // `pushAndVerify`'s own status read and read-back included: that status read runs AFTER the scan, and a
    // bare one would run a configured `core.fsmonitor` able to write a `pushInsteadOf` in between.
    expect(bare).toEqual([]);
    expect(armoured).toContain("status --porcelain");
  });

  it("CLEARS the assume-unchanged bit before measuring, so a hidden edit is not deleted uncaptured", () => {
    // Reproduced against real git by a review pass: `hidden.txt` is tracked, marked --assume-unchanged and
    // then edited. Porcelain reports only the staged file, so the capture plans nothing for the hidden one,
    // the push verifies, and `git worktree remove` takes the only copy of those bytes with it.
    const { deps, ran } = fakeDeps({
      world: { staged: ["visible.txt"], lsFiles: "h hidden.txt\0H visible.txt\0" },
    });
    const outcome = runSalvage({
      deps,
      denylist: ABSENT,
      home: HOME_WITHOUT_PUSH_ROOTS,
      remote: "origin",
      scan: NO_SECRETS,
      verdict,
    });

    expect(outcome.declined).toBe(null);
    const clear = "write:update-index --no-assume-unchanged -- hidden.txt";
    expect(ran).toContain(clear);
    expect(ran).toContain("write:update-index --no-skip-worktree -- hidden.txt");
    // Before the measurement, not after it — the whole point.
    expect(ran.indexOf(clear) < ran.indexOf("read:status --porcelain")).toBe(true);
  });

  it("clears a hidden entry that is not the FIRST one, which a wrong NUL escape still passed", () => {
    // A real `ls-files -v -z` lists the whole index, so the hidden entry is almost never first. Every
    // other case here happens to put it first, which is exactly what let a fake matching a literal
    // backslash-zero instead of a NUL go green: the `^` alternation alone covered them.
    const { deps, ran } = fakeDeps({
      world: { lsFiles: "H a.txt\0H b.txt\0h late.txt\0", unstaged: ["late.txt"] },
    });
    const outcome = runSalvage({
      deps,
      denylist: ABSENT,
      home: HOME_WITHOUT_PUSH_ROOTS,
      remote: "origin",
      scan: NO_SECRETS,
      verdict,
    });

    expect(outcome.declined).toBe(null);
    expect(ran).toContain("write:update-index --no-assume-unchanged -- late.txt");
  });
  it("writes no update-index at all when git is watching the whole tree", () => {
    const { deps, ran } = fakeDeps({ world: { staged: ["a"], lsFiles: "H a\0H b\0" } });
    runSalvage({ deps, denylist: ABSENT, home: HOME_WITHOUT_PUSH_ROOTS, remote: "origin", scan: NO_SECRETS, verdict });

    expect(ran).toContain("read:ls-files -v -z");
    expect(ran.filter((line) => line.startsWith("write:update-index"))).toEqual([]);
  });

  it("hands a NON-ASCII path back to update-index as git spelled it, not as git would have QUOTED it", () => {
    // Reproduced against real git by a review pass. With `core.quotePath` — on by default — the newline
    // listing renders `é.txt` as the literal characters `"\303\251.txt"`, which matches no index entry, so
    // `update-index` answers "Unable to mark file" and the bit never clears. `-z` is what turns that off.
    const { deps, ran } = fakeDeps({ world: { staged: ["visible.txt"], lsFiles: "h é.txt\0H visible.txt\0" } });
    const outcome = runSalvage({
      deps,
      denylist: ABSENT,
      home: HOME_WITHOUT_PUSH_ROOTS,
      remote: "origin",
      scan: NO_SECRETS,
      verdict,
    });

    expect(outcome.declined).toBe(null);
    expect(ran).toContain("write:update-index --no-assume-unchanged -- é.txt");
    expect(ran).toContain("write:update-index --no-skip-worktree -- é.txt");
  });

  it("clears the two bits in SEPARATE commands, because one command silently leaves skip-worktree set", () => {
    // MEASURED against real git: `update-index --no-assume-unchanged --no-skip-worktree -- f` clears the
    // first bit, leaves the second, and exits 0. The capture then measured a tree it still could not see,
    // pushed the file's OLD bytes, verified that push, and the caller removed the worktree.
    const { deps, ran } = fakeDeps({ world: { lsFiles: "S sparse.txt\0", unstaged: ["sparse.txt"] } });
    const outcome = runSalvage({
      deps,
      denylist: ABSENT,
      home: HOME_WITHOUT_PUSH_ROOTS,
      remote: "origin",
      scan: NO_SECRETS,
      verdict,
    });

    expect(outcome.declined).toBe(null);
    expect(ran.filter((line) => line.startsWith("write:update-index"))).toEqual([
      "write:update-index --no-assume-unchanged -- sparse.txt",
      "write:update-index --no-skip-worktree -- sparse.txt",
    ]);
  });

  it("RE-READS after clearing and declines on residue, rather than believing update-index exited zero", () => {
    // The same measured bug from the other side: a zero exit that changed nothing. Only git's own second
    // opinion is evidence, so the capture asks again and keeps the tree when anything is still hidden.
    const { deps, ran } = fakeDeps({
      world: { bitsStick: true, lsFiles: "S sparse.txt\0", unstaged: ["sparse.txt"] },
    });
    const outcome = runSalvage({
      deps,
      denylist: ABSENT,
      home: HOME_WITHOUT_PUSH_ROOTS,
      remote: "origin",
      scan: NO_SECRETS,
      verdict,
    });

    expect(outcome.branch).toBe(null);
    expect(outcome.declined).toContain("sparse.txt");
    expect(outcome.declined).toContain("would not stop ignoring");
    expect(ran.filter((line) => line.startsWith("write:push"))).toEqual([]);
  });

  it("DECLINES and keeps the tree when a bit will not clear, rather than measuring a tree it cannot see", () => {
    // The other half of the same review pass: the clearing failed and the failure was discarded, so the
    // capture went on to read a porcelain that could not report `hidden.txt`, pushed what it could see,
    // verified, and removed the worktree. The hidden bytes existed only there.
    const { deps, ran } = fakeDeps({
      world: { staged: ["visible.txt"], failWrite: "update-index", lsFiles: "h hidden.txt\0H visible.txt\0" },
    });
    const outcome = runSalvage({
      deps,
      denylist: ABSENT,
      home: HOME_WITHOUT_PUSH_ROOTS,
      remote: "origin",
      scan: NO_SECRETS,
      verdict,
    });

    expect(outcome.branch).toBe(null);
    expect(outcome.declined).toContain("hidden.txt");
    expect(outcome.declined).toContain("would not stop ignoring");
    // It stopped BEFORE measuring, so nothing downstream ran on a tree whose state was unknown.
    expect(ran.filter((line) => line.startsWith("read:status"))).toEqual([]);
    expect(ran.filter((line) => line.startsWith("write:push"))).toEqual([]);
  });

  it("captures an UNSTAGED-ONLY tree, the commonest shape, which a column-parsed status got backwards", () => {
    // The regression this case exists for: the shared `readGit` ends in `.trim()`, so a porcelain whose
    // FIRST line is a worktree-only edit arrived as `M file` rather than ` M file` and counted as STAGED.
    // The capture then planned a commit of an empty index, git exited 1, and every ordinary dirty tree
    // declined. Counting paths from `diff --name-only -z` has no column to lose. Reproduced against real git.
    const { deps, ran } = fakeDeps({ world: { unstaged: ["edited.txt"] } });
    const outcome = runSalvage({
      deps,
      denylist: ABSENT,
      home: HOME_WITHOUT_PUSH_ROOTS,
      remote: "origin",
      scan: NO_SECRETS,
      verdict,
    });

    expect(outcome.declined).toBe(null);
    expect(outcome.branch).toBe(BASE_BRANCH);
    // It staged and committed the working tree, and planned NO commit of the index, which holds nothing.
    expect(ran.filter((line) => line.startsWith("write:commit")).length).toBe(1);
    expect(ran).toContain("write:add -A");
    expect(ran.filter((line) => line.includes("the staged index"))).toEqual([]);
  });

  it("captures work staged but never edited on disk, which committing only the working tree would have lost", () => {
    // "M  file.txt" is an index change over a clean working tree. A capture that ran `add -A` and committed
    // would have had nothing to record, and the staged version would have gone with the worktree.
    const { deps, ran } = fakeDeps({ world: { staged: ["file.txt"] } });
    const outcome = runSalvage({
      deps,
      denylist: ABSENT,
      home: HOME_WITHOUT_PUSH_ROOTS,
      remote: "origin",
      scan: NO_SECRETS,
      verdict,
    });

    expect(outcome.declined).toBe(null);
    const writes = ran.filter((line) => line.startsWith("write:"));
    expect(writes[2]).toContain("the staged index");
    expect(writes.filter((line) => line.startsWith("write:add"))).toEqual([]);
  });

  it("captures a CLEAN detached tree with no commit step, because there is nothing to stage", () => {
    const { deps, ran } = fakeDeps({ world: {} });
    const outcome = runSalvage({
      deps,
      denylist: ABSENT,
      home: HOME_WITHOUT_PUSH_ROOTS,
      remote: "origin",
      scan: NO_SECRETS,
      verdict,
    });

    expect(outcome.branch).toBe(BASE_BRANCH);
    expect(ran.filter((line) => line.startsWith("write:add") || line.startsWith("write:commit"))).toEqual([]);
  });

  it("KEEPS the tree and pushes nothing when the secrets scan declines, handing the scan the tree, the url, the sha and the branch it pushes", () => {
    const { deps, ran } = fakeDeps({ world: { staged: ["a"] } });
    const asked: string[] = [];
    const decline =
      "the work it would push carries 1 secret-class line(s) (github-oauth-token) in a — nothing was pushed";
    const outcome = runSalvage({
      deps,
      denylist: ABSENT,
      home: HOME_WITHOUT_PUSH_ROOTS,
      remote: "origin",
      scan: ({ path, sha, target, url }) => {
        asked.push(`${path} ${url} ${sha} ${target}`);
        return decline;
      },
      verdict,
    });

    expect(outcome).toEqual({ branch: null, declined: decline });
    expect(asked).toEqual([`${PATH} ${URL} ${COMMITTED} ${BASE_BRANCH}`]);
    expect(ran.filter((line) => line.startsWith("write:push"))).toEqual([]);
  });

  it("KEEPS the tree and scans nothing when the remote pushes somewhere its fetch url is not", () => {
    // `git push <remote>` reaches EVERY push url while the scan could ask only one, so a remote with a
    // second push url, or one other than its fetch url, has no single destination to bind the scan to.
    const { deps, ran } = fakeDeps({ world: { pushUrls: `${URL}\ngit@mirror:owner/repo.git\n`, staged: ["a"] } });
    let scans = 0;
    const outcome = runSalvage({
      deps,
      denylist: ABSENT,
      home: HOME_WITHOUT_PUSH_ROOTS,
      remote: "origin",
      scan: () => {
        scans += 1;
        return null;
      },
      verdict,
    });

    expect(outcome).toEqual({
      branch: null,
      declined:
        "origin pushes to 2 url(s) that are not exactly its fetch url, so no one destination binds the scan to the push — nothing was pushed",
    });
    expect(scans).toBe(0);
    expect(ran.filter((line) => line.startsWith("write:push"))).toEqual([]);
  });

  it("prints no credential a git failure quoted, whichever step's message carried it", () => {
    // A url with a token in it reaches the decline through git's own argv and stderr.
    const token = "ghp_" + "a".repeat(36);
    const { deps } = fakeDeps({ world: { staged: ["a"] } });
    const outcome = runSalvage({
      deps,
      denylist: ABSENT,
      home: HOME_WITHOUT_PUSH_ROOTS,
      remote: "origin",
      scan: () => `could not be listed — Command failed: git ls-remote https://u:${token}@h/r.git HEAD`,
      verdict,
    });

    expect(outcome).toEqual({
      branch: null,
      declined: "could not be listed — Command failed: git ls-remote https://<url withheld> HEAD",
    });
  });

  it("captures NOTHING when the private denylist cannot be read, since no decline it prints could be checked", () => {
    const { deps, ran } = fakeDeps({ world: { staged: ["a"] } });
    const outcome = runSalvage({
      deps,
      denylist: { kind: "unreadable", path: "/home/hygiene-denylist.txt", reason: "EACCES" },
      home: HOME_WITHOUT_PUSH_ROOTS,
      remote: "origin",
      scan: NO_SECRETS,
      verdict,
    });

    expect(outcome).toEqual({
      branch: null,
      declined:
        "the private denylist at /home/hygiene-denylist.txt could not be read (EACCES), so nothing a salvage prints or pushes could be checked — nothing was captured",
    });
    expect(ran).toEqual([]);
  });

  it("withholds the unreadable-denylist decline too, when its own path matches a secret pattern", () => {
    const token = "ghp_" + "a".repeat(36);
    const { deps } = fakeDeps({ world: { staged: ["a"] } });
    const outcome = runSalvage({
      deps,
      denylist: { kind: "unreadable", path: `/tmp/${token}/hygiene-denylist.txt`, reason: "EACCES" },
      home: HOME_WITHOUT_PUSH_ROOTS,
      remote: "origin",
      scan: NO_SECRETS,
      verdict,
    });

    expect(outcome).toEqual({
      branch: null,
      declined: "its reason is withheld because it matches a secret pattern — nothing was pushed",
    });
  });

  it("withholds a decline naming a PRIVATE denylist string, which no built-in pattern knows", () => {
    const { deps } = fakeDeps({ world: { staged: ["a"] } });
    const outcome = runSalvage({
      deps,
      denylist: { kind: "loaded", lines: ["correct-horse-battery-staple"] },
      home: HOME_WITHOUT_PUSH_ROOTS,
      remote: "origin",
      scan: () => "could not read correct-horse-battery-staple.txt",
      verdict,
    });

    expect(outcome).toEqual({
      branch: null,
      declined: "its reason is withheld because it matches a secret pattern — nothing was pushed",
    });
  });

  it("never runs the tree's own pre-push hook — the scan replaces it, and a week-old hook ran a stale lane", () => {
    // Measured: one salvage spent 7m45s in its tree's stale `validate:local` and went red on its own
    // `.oxlintrc.jsonc`; every salvage behind it would have done the same (`worktree/salvageScan.ts`).
    const { deps } = fakeDeps({ world: { staged: ["a"] } });
    let gateRuns = 0;
    const outcome = runSalvage({
      deps: {
        ...deps,
        prePushGate: () => {
          gateRuns += 1;
          return err(GithubPushDoorErrors.pushGateRefused({ cause: "stale lane red" }));
        },
      },
      denylist: ABSENT,
      home: HOME_WITHOUT_PUSH_ROOTS,
      remote: "origin",
      scan: NO_SECRETS,
      verdict,
    });

    expect(outcome.declined).toBe(null);
    expect(outcome.branch).toBe(BASE_BRANCH);
    expect(gateRuns).toBe(0);
  });
});
