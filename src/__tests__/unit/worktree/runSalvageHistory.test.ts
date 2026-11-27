/**
 * `runSalvage`'s history check, driven through the scripted git world `./salvageGitWorld.ts` answers: a tree reaching
 * a root the remote's live trunk does not, a trunk that cannot be asked, and a HEAD moved before the first write are
 * all KEPT with nothing written. Split out of `./runSalvage.test.ts` by scenario; `./salvageTrunkHistory.test.ts`
 * proves the same refusals against real git.
 */
import { describe, expect, it } from "vitest";

import { runSalvage, type SalvageOutcome } from "../../../worktree/pruneSalvage.js";
import { SalvageTreeErrors } from "../../../worktree/salvageTreeErrors.js";
import { HOME_WITHOUT_PUSH_ROOTS } from "../../pushRootFixture.js";
import {
  ABSENT,
  COMMITTED,
  fakeDeps,
  type GitWorld,
  HEAD,
  NO_SECRETS,
  TRUNK,
  URL,
  verdict,
} from "./salvageGitWorld.js";

describe("runSalvage's history check", () => {
  it("KEEPS a tree of ANOTHER history and writes nothing, so an archive branch is never pushed to the public remote", () => {
    // The old-history case: a checkout carrying the pre-cut history on an `archive` remote, whose commits reach a
    // root `origin`'s trunk does not. Salvaged, that whole history would land on origin as one `salvage/…` branch.
    const { deps, ran } = fakeDeps({ world: { foreignRoot: true, staged: ["a"] } });
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
        "its history reaches 1 root commit(s) origin's live trunk does not, so it carries another history — nothing was pushed",
    });
    expect(ran.filter((line) => line.startsWith("write:"))).toEqual([]);
    // It refused before probing a single branch name, on the remote or locally.
    expect(ran.filter((line) => line.startsWith("read:ls-remote --heads"))).toEqual([]);
    expect(ran.filter((line) => line.includes("--verify"))).toEqual([]);
  });

  it("KEEPS a tree of another history WITH a hidden index bit, refusing before clearing the bit is even tried", () => {
    // Clearing an `--assume-unchanged` bit is a WRITE (`update-index`), so the history refusal has to come first.
    const { deps, ran } = fakeDeps({
      world: { foreignRoot: true, lsFiles: "h hidden.txt\0H visible.txt\0", staged: ["visible.txt"] },
    });
    const outcome = runSalvage({
      deps,
      denylist: ABSENT,
      home: HOME_WITHOUT_PUSH_ROOTS,
      remote: "origin",
      scan: NO_SECRETS,
      verdict,
    });

    expect(outcome.declined).toContain("origin's live trunk does not, so it carries another history");
    expect(ran.filter((line) => line.startsWith("write:"))).toEqual([]);
  });

  it("KEEPS a tree whose remote's live trunk cannot be asked, failing closed before any write", () => {
    const { deps, ran } = fakeDeps({ world: { staged: ["a"], trunkUnreadable: true } });
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
        "origin's live trunk could not be read (fatal: could not read from remote repository); `git fetch origin` and prune again — nothing was pushed",
    });
    expect(ran.filter((line) => line.startsWith("write:"))).toEqual([]);
  });

  it("KEEPS a hidden-bit tree whose HEAD moved after the check, with its bits untouched", () => {
    // The second HEAD read is the one `readTreeNow` takes before `update-index`, so a move there must refuse first.
    const { deps, ran } = fakeDeps({ world: { headMovesAfter: 1, lsFiles: "h hidden.txt\0", staged: ["hidden.txt"] } });
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
      declined: "its HEAD moved after its history was checked against the trunk — nothing was pushed",
    });
    expect(ran.filter((line) => line.startsWith("write:"))).toEqual([]);
  });

  it("judges the EXACT sha it read against the url's live trunk by root set, before any other step", () => {
    const { deps, ran } = fakeDeps({ world: { staged: ["a"] } });
    runSalvage({ deps, denylist: ABSENT, home: HOME_WITHOUT_PUSH_ROOTS, remote: "origin", scan: NO_SECRETS, verdict });

    const roots = "read:--no-replace-objects -c core.commitGraph=false rev-list --max-parents=0";
    expect(ran.slice(0, 9)).toEqual([
      "read:rev-parse HEAD",
      "read:remote get-url origin",
      "read:remote get-url --push --all origin",
      "read:remote",
      "read:config --list",
      `read:ls-remote -- ${URL} HEAD`,
      "read:rev-parse --git-path info/grafts",
      `${roots} ${TRUNK}`,
      `${roots} ${HEAD}`,
    ]);
  });

  it("judges the commit it PUSHES by root set too, so a merge of another history after the capture is caught", () => {
    const { deps, ran } = fakeDeps({ world: { staged: ["a"] } });
    runSalvage({ deps, denylist: ABSENT, home: HOME_WITHOUT_PUSH_ROOTS, remote: "origin", scan: NO_SECRETS, verdict });

    const ancestry = "read:--no-replace-objects -c core.commitGraph=false";
    expect(ran).toContain(`${ancestry} merge-base --is-ancestor ${HEAD} ${COMMITTED}`);
    expect(ran).toContain(`${ancestry} rev-list --max-parents=0 ${COMMITTED}`);
  });
});

/**
 * One salvage over a scripted world, every write it issued beside its outcome.
 *
 * @param world the scripted git world
 * @returns the outcome and the writes, in order
 */
function salvageIn({ world }: { world: GitWorld }): { outcome: SalvageOutcome; writes: readonly string[] } {
  const { deps, ran } = fakeDeps({ world });
  const outcome = runSalvage({
    deps,
    denylist: ABSENT,
    home: HOME_WITHOUT_PUSH_ROOTS,
    remote: "origin",
    scan: NO_SECRETS,
    verdict,
  });
  return { outcome, writes: ran.filter((line) => line.startsWith("write:")) };
}

/** The decline for a live trunk that could not be read, for the given cause. */
const trunkUnread = ({ why }: { why: string }): string =>
  `origin's live trunk could not be read (${why}); \`git fetch origin\` and prune again — nothing was pushed`;

describe("runSalvage's live trunk read", () => {
  it.each([
    { tips: 0, why: "ls-remote named 0 HEAD commit(s)" },
    { tips: 2, why: "ls-remote named 2 HEAD commit(s)" },
  ])("KEEPS a tree whose url answers $tips HEAD line(s), writing nothing", ({ tips, why }) => {
    const { outcome, writes } = salvageIn({ world: { staged: ["a"], trunkTips: tips } });

    expect(outcome).toEqual({ branch: null, declined: trunkUnread({ why }) });
    expect(writes).toEqual([]);
  });

  it("KEEPS a tree whose live trunk commit is not fetched here, as a read failure rather than a verdict", () => {
    const { outcome, writes } = salvageIn({ world: { staged: ["a"], trunkAbsent: true } });

    expect(outcome).toEqual({ branch: null, declined: trunkUnread({ why: `fatal: bad object ${TRUNK}` }) });
    expect(writes).toEqual([]);
  });

  it("KEEPS a tree when git lists no root of the trunk, which no real trunk has", () => {
    const { outcome, writes } = salvageIn({ world: { noRoots: "trunk", staged: ["a"] } });

    expect(outcome).toEqual({ branch: null, declined: trunkUnread({ why: "git listed no root commit" }) });
    expect(writes).toEqual([]);
  });

  it("KEEPS a tree when git lists no root of its own HEAD, rather than reading an empty set as within the trunk", () => {
    const { outcome, writes } = salvageIn({ world: { noRoots: "head", staged: ["a"] } });

    expect(outcome).toEqual({
      branch: null,
      declined: `the root commits of ${HEAD.slice(0, 8)} could not be listed (git listed no root commit) — nothing was pushed`,
    });
    expect(writes).toEqual([]);
  });
});

describe("runSalvage's checks between the capture and the push", () => {
  it("KEEPS a tree whose HEAD moved between clearing its bits and measuring it, capturing nothing", () => {
    // The third HEAD read is `readTreeNow`'s second compare, after `update-index` and before any count or commit.
    const { outcome, writes } = salvageIn({
      world: { headMovesAfter: 2, lsFiles: "h hidden.txt\0", staged: ["hidden.txt"] },
    });

    expect(outcome).toEqual({ branch: null, declined: SalvageTreeErrors.headMoved().message });
    expect(writes).toEqual([
      "write:update-index --no-assume-unchanged -- hidden.txt",
      "write:update-index --no-skip-worktree -- hidden.txt",
    ]);
  });

  it("pushes NOTHING when origin's url changed after its live trunk was read", () => {
    // One fetch-url read binds the trunk's url; the push's own resolution is the second, and answers another repository.
    const { outcome, writes } = salvageIn({ world: { staged: ["a"], urlChangesAfter: 1 } });

    expect(outcome.declined).toBe("origin's url changed after its live trunk was read — nothing was pushed");
    expect(writes.filter((line) => line.startsWith("write:push"))).toEqual([]);
  });

  it("pushes NOTHING when the capture does not descend from the checked HEAD, git's exit-1 verdict", () => {
    const { outcome, writes } = salvageIn({ world: { mergeBaseStatus: 1, staged: ["a"] } });

    expect(outcome.declined).toBe(
      "the commit to push does not descend from the HEAD checked against the trunk — nothing was pushed",
    );
    expect(writes.filter((line) => line.startsWith("write:push"))).toEqual([]);
  });

  it("pushes NOTHING when merge-base FAILS (exit 128), naming a read failure rather than a descent verdict", () => {
    const { outcome, writes } = salvageIn({ world: { mergeBaseStatus: 128, staged: ["a"] } });

    expect(outcome.declined).toBe(
      `whether ${COMMITTED.slice(0, 8)} descends from the checked HEAD could not be read (git exited 128) — nothing was pushed`,
    );
    expect(writes.filter((line) => line.startsWith("write:push"))).toEqual([]);
  });
});
