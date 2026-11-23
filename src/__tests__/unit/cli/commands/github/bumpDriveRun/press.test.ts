/*
 * The undraft and the press, and what the autonomy ledger records of each.
 *
 * The case that matters most is the one a review found by reading the code: an undraft that succeeds
 * and an enqueue that then refuses. That pass has CHANGED the repository, and the autonomy ledger is the only
 * surface where the owner sees an act the fleet took unasked, so a silent arm there is the defect.
 */
import { describe, expect, it } from "vitest";

import { runGithubBumpDrive } from "../../../../../../cli/commands/github/bumpDriveRun.js";
import { bump, heldAct, PRESS_ID, UNDRAFT_ID } from "./fixtures.js";
import { harness } from "./harness.js";

describe("runGithubBumpDrive", () => {
  it("undrafts a draft bump and then enqueues it, writing ONE ledger row that names both", async () => {
    const run = harness({ prs: [bump({ isDraft: true })] });

    const code = await runGithubBumpDrive({ deps: run.deps, rest: ["--repo", "acme/widgets"] });

    expect(code).toBe(0);
    expect(run.readied).toEqual(["--repo acme/widgets --number 661"]);
    expect(run.pressed[0]!.startsWith("--pr 661 --repo acme/widgets --acknowledge codex-loop-incomplete")).toBe(true);
    expect(run.pressed).toHaveLength(1);
    expect(run.autonomyRows.map((row) => row.actionId)).toEqual([PRESS_ID]);
    expect(run.autonomyRows[0]!.witness).toBe(
      "slopweaver github bump-drive -> undrafted it and enqueued acme/widgets#661 at head 1111111",
    );
  });

  it("records the UNDRAFT on its own when the enqueue after it refuses, so the act is not invisible", async () => {
    const run = harness({ prs: [bump({ isDraft: true })], pressExit: 1 });

    const code = await runGithubBumpDrive({ deps: run.deps, rest: ["--repo", "acme/widgets"] });

    expect(code).toBe(0);
    expect(run.readied).toEqual(["--repo acme/widgets --number 661"]);
    expect(run.autonomyRows.map((row) => row.actionId)).toEqual([UNDRAFT_ID]);
    expect(run.autonomyRows[0]!.kind).toBe("undraft-pull-request");
    expect(run.autonomyRows[0]!.witness).toBe(
      "slopweaver github bump-drive -> marked acme/widgets#661 ready at head 1111111, and it did NOT queue",
    );
  });

  it("writes NOTHING to the ledger when the undraft itself refused, because nothing changed", async () => {
    const run = harness({ prs: [bump({ isDraft: true })], readyExit: 1 });

    await runGithubBumpDrive({ deps: run.deps, rest: ["--repo", "acme/widgets"] });

    expect(run.pressed).toEqual([]);
    expect(run.autonomyRows).toEqual([]);
    expect(run.out.some((line) => line.includes("`github ready` refused the undraft"))).toBe(true);
  });

  it("enqueues an already-open bump without touching the undraft seam at all", async () => {
    const run = harness({ prs: [bump()] });

    await runGithubBumpDrive({ deps: run.deps, rest: ["--repo", "acme/widgets"] });

    expect(run.readied).toEqual([]);
    expect(run.pressed[0]!.startsWith("--pr 661 --repo acme/widgets --acknowledge codex-loop-incomplete")).toBe(true);
    expect(run.pressed).toHaveLength(1);
    expect(run.autonomyRows.map((row) => row.actionId)).toEqual([PRESS_ID]);
  });

  it("records a SECOND press at a head already pressed as its own occurrence, never a refused row", async () => {
    // The finding: a `<number>-bump-drive` id was refused for every press after the first, so a bump the queue
    // let go of and this verb pressed again never reached the owner's briefing. Landing's press shares the id.
    const earlier = heldAct({ actionId: PRESS_ID, kind: "press-merge-when-ready", witness: "github landing --press" });
    const run = harness({ ledger: [earlier], prs: [bump()] });

    await runGithubBumpDrive({ deps: run.deps, rest: ["--repo", "acme/widgets"] });

    expect(run.pressed).toHaveLength(1);
    expect(run.autonomyRows.map((row) => row.actionId)).toEqual([`${PRESS_ID}-2`]);
  });

  it("makes NO press when the ledger cannot take its row, so no unasked act goes unseen", async () => {
    const run = harness({ ledgerUnreadable: true, prs: [bump()] });

    await runGithubBumpDrive({ deps: run.deps, rest: ["--repo", "acme/widgets"] });

    expect(run.pressed).toEqual([]);
    expect(run.autonomyRows).toEqual([]);
    expect(
      run.out.some((line) =>
        line.includes(
          "not pressed: the autonomy ledger could not be read (the autonomy ledger lives in the store, and the store could not be opened)",
        ),
      ),
    ).toBe(true);
  });

  it("makes neither the undraft nor the press of a draft bump when the ledger cannot take a row", async () => {
    const run = harness({ ledgerUnreadable: true, prs: [bump({ isDraft: true })] });

    await runGithubBumpDrive({ deps: run.deps, rest: ["--repo", "acme/widgets"] });

    expect(run.readied).toEqual([]);
    expect(run.pressed).toEqual([]);
    expect(run.out.some((line) => line.includes("not undrafted: the autonomy ledger could not be read"))).toBe(true);
  });

  it("says in a DRY run that the press would be refused, rather than promising one", async () => {
    const run = harness({ ledgerUnreadable: true, prs: [bump()] });

    await runGithubBumpDrive({ deps: run.deps, rest: ["--repo", "acme/widgets", "--dry-run"] });

    expect(run.pressed).toEqual([]);
    expect(run.out.some((line) => line.includes("not pressed: the autonomy ledger could not be read"))).toBe(true);
    expect(run.out.some((line) => line.includes("would enqueue"))).toBe(false);
  });

  it("presses a bump carrying an open code-owner request when GitHub itself answers CLEAN", async () => {
    // Owner ask 291-9x: eleven bumps sat outside the pressable set solely because GitHub still held a
    // code-owner request out. Where branch protection is already satisfied, GitHub offers the queue button
    // and so does this pass. Repro: slopweaver github bump-drive --repo acme/acme-admin --dry-run
    const run = harness({
      prs: [bump({ codeownerRequests: [{ asCodeOwner: true, kind: "team", name: "acme/eng" }] })],
    });

    await runGithubBumpDrive({ deps: run.deps, rest: ["--repo", "acme/widgets"] });

    expect(run.pressed[0]!.startsWith("--pr 661 --repo acme/widgets")).toBe(true);
    expect(run.pressed).toHaveLength(1);
  });

  it("holds the same bump when GitHub answers BLOCKED, because then the request IS a requirement", async () => {
    const run = harness({
      prs: [
        bump({
          codeownerRequests: [{ asCodeOwner: true, kind: "team", name: "acme/eng" }],
          githubMergeStatus: { kind: "blocked", status: "BLOCKED" },
        }),
      ],
    });

    await runGithubBumpDrive({ deps: run.deps, rest: ["--repo", "acme/widgets"] });

    expect(run.pressed).toEqual([]);
    expect(run.autonomyRows).toEqual([]);
  });
});
