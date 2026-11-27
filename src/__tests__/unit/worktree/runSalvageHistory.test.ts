/**
 * `runSalvage`'s history check, driven through the scripted git world `./salvageGitWorld.ts` answers: a tree reaching
 * a root the remote's live trunk does not, a trunk that cannot be asked, and a HEAD moved before the first write are
 * all KEPT with nothing written. Split out of `./runSalvage.test.ts` by scenario; `./salvageTrunkHistory.test.ts`
 * proves the same refusals against real git.
 */
import { describe, expect, it } from "vitest";

import { runSalvage } from "../../../worktree/pruneSalvage.js";
import { HOME_WITHOUT_PUSH_ROOTS } from "../../pushRootFixture.js";
import { ABSENT, COMMITTED, fakeDeps, HEAD, NO_SECRETS, TRUNK, URL, verdict } from "./salvageGitWorld.js";

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
    expect(ran.filter((line) => line.startsWith("read:ls-remote --heads") || line.includes("--verify"))).toEqual([]);
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
    expect(ran.slice(0, 5)).toEqual([
      "read:rev-parse HEAD",
      "read:remote get-url origin",
      `read:ls-remote ${URL} HEAD`,
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
