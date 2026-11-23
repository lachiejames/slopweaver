/**
 * `github stack push` against a checkout that moved under it: a worktree edited while it ran, a commit hook that
 * re-staged inside the amend, a branch raced to a same-tree commit, and HEAD moved before staging. Each refuses
 * and sends nothing. Split from `stackPushRun.test.ts` by behaviour.
 */
import { describe, expect, it } from "vitest";

import { runGithubStackPush } from "../../../../../../cli/commands/github/stackPushRun.js";
import { EXIT_ERROR } from "../../../../../../cli/exitCodes.js";
import type { GithubWriteApi } from "../../../../../../corpus/github/write.js";
import { AMENDED_SHA, baseForm, EDITED_TREE, LOCAL_SHA, PREFIX, RACED_SHA } from "./fixtures.js";
import { harness, tempHome, useTempHomes } from "./harness.js";

useTempHomes();

describe("runGithubStackPush", () => {
  it("refuses to amend a tree that changed while it ran, committing and sending nothing", async () => {
    // An empty object: the create preflight is the first API call, so reaching none is the witness.
    const api = {} as GithubWriteApi;
    const { deps, lines, pins, writes } = harness({ api, stagedTree: EDITED_TREE });
    const code = await runGithubStackPush({
      argv: [...PREFIX, "--form", baseForm({ base: "main" }), "--home", tempHome()],
      deps,
    });
    expect(code).toBe(EXIT_ERROR);
    expect(pins).toEqual(["/repo"]);
    expect(writes).toEqual([]);
    const refusal = lines.find((line) => line.includes("the working tree changed while stack push ran"))!;
    expect(refusal).toContain("(src/edited mid-push.ts)");
    expect(refusal).toContain("nothing was committed or sent");
    expect(refusal).toContain("`git add --all` has left the current tree staged");
  });

  it("refuses to push a commit a hook changed inside the amend, sending nothing", async () => {
    const api = {} as GithubWriteApi;
    const { deps, lines, writes } = harness({ api, committedTree: EDITED_TREE });
    const code = await runGithubStackPush({
      argv: [...PREFIX, "--form", baseForm({ base: "main" }), "--home", tempHome()],
      deps,
    });
    expect(code).toBe(EXIT_ERROR);
    // The amend ran — the hook fired inside it — and nothing after it did.
    expect(writes).toEqual([["commit", "--amend", "--no-edit"]]);
    // HEAD has moved locally even though nothing was sent, so the move is said before the refusal.
    expect(lines).toContain(`amended ${LOCAL_SHA} → ${AMENDED_SHA}`);
    const refusal = lines.find((line) => line.includes("a commit hook changed the tree inside the amend"))!;
    expect(refusal).toContain("(src/edited mid-push.ts)");
    expect(refusal).toContain("nothing was sent");
  });

  it("refuses to push when the branch moved inside the amend to a same-tree commit, sending nothing", async () => {
    const api = {} as GithubWriteApi;
    const { deps, lines, writes } = harness({ amendedHead: RACED_SHA, api });
    const code = await runGithubStackPush({
      argv: [...PREFIX, "--form", baseForm({ base: "main" }), "--home", tempHome()],
      deps,
    });
    expect(code).toBe(EXIT_ERROR);
    // The tree check passes — the raced commit holds the pinned tree — so only the lineage check refuses.
    expect(writes).toEqual([["commit", "--amend", "--no-edit"]]);
    expect(lines.find((line) => line.includes("the branch moved inside the amend"))).toContain(
      `so ${RACED_SHA} rewrote a commit other than ${LOCAL_SHA} — nothing was sent`,
    );
  });

  it("refuses to amend when HEAD moved while it ran, before staging anything", async () => {
    const api = {} as GithubWriteApi;
    const { deps, lines, reads, writes } = harness({ api, headAfterFacts: AMENDED_SHA });
    const code = await runGithubStackPush({
      argv: [...PREFIX, "--form", baseForm({ base: "main" }), "--home", tempHome()],
      deps,
    });
    expect(code).toBe(EXIT_ERROR);
    expect(writes).toEqual([]);
    expect(reads).not.toContain("add --all");
    expect(
      lines.some((line) => line.includes(`HEAD moved while stack push ran (top@${LOCAL_SHA} → top@${AMENDED_SHA})`)),
    ).toBe(true);
  });
});
