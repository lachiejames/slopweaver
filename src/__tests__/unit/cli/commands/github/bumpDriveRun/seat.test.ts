/*
 * Which bumps a pass seats on the one board, which it leaves for a named review, and how the seat stays
 * idempotent over the rows already declaring a bump's branch.
 */
import { describe, expect, it } from "vitest";

import { runGithubBumpDrive } from "../../../../../../cli/commands/github/bumpDriveRun.js";
import type { LandingBoardRow } from "../../../../../../review/landingBoard.js";
import { bump } from "./fixtures.js";
import { harness } from "./harness.js";

describe("runGithubBumpDrive", () => {
  // The owner's rulings: a Renovate bump held only by a code owner is the OWNER's to review, never a colleague's, and
  // the owner is withholding that review — so nothing is filed for it at all.
  it("files no row and presses nothing for a Renovate bump GitHub holds for a code owner, naming the withheld review", async () => {
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
    expect(run.registered).toEqual([]);
    expect(run.out.some((line) => line.includes("the owner's review is withheld on Renovate pull requests"))).toBe(
      true,
    );
  });

  it("files nothing for a Dependabot bump GitHub holds for a code owner — it waits on the named review", async () => {
    const run = harness({
      prs: [
        bump({
          authorLogin: "dependabot[bot]",
          codeownerRequests: [{ asCodeOwner: true, kind: "team", name: "acme/eng" }],
          githubMergeStatus: { kind: "blocked", status: "BLOCKED" },
        }),
      ],
    });

    await runGithubBumpDrive({ deps: run.deps, rest: ["--repo", "acme/widgets"] });

    expect(run.registered).toEqual([]);
    expect(run.out.some((line) => line.includes("waiting on a human review from"))).toBe(true);
  });

  it("seats a conflicted bump on the board and neither undrafts nor presses it", async () => {
    const run = harness({ prs: [bump({ mergeable: "CONFLICTING" })] });

    await runGithubBumpDrive({ deps: run.deps, rest: ["--repo", "acme/widgets"] });

    expect(run.readied).toEqual([]);
    expect(run.pressed).toEqual([]);
    expect(run.registered[0]!).toContain("--branch");
    expect(run.registered[0]!.includes("renovate/typescript-6.x")).toBe(true);
    expect(run.autonomyRows).toEqual([]);
  });

  // A renovate title — or an owner — naming a state-home directory had the register refuse
  // the whole row, so the seam is asked about the FULL ask the register would otherwise receive.
  it("asks the seam about the full ask with the seat's checkout, and registers the URL-led ask it would refuse", async () => {
    const run = harness({ askRefused: true, prs: [bump({ mergeable: "CONFLICTING" })] });

    await runGithubBumpDrive({ deps: run.deps, rest: ["--repo", "acme/widgets"] });

    expect(run.seamAsks).toHaveLength(1);
    expect(run.seamAsks[0]!.checkout).toBe("/checkouts/widgets");
    expect(run.seamAsks[0]!.ask.startsWith("acme/widgets#661 is a dependency bump that needs a session (")).toBe(true);
    expect(run.seamAsks[0]!.ask.endsWith("behind): Update dependency typescript to v6")).toBe(true);
    const ask = run.registered[0]![run.registered[0]!.indexOf("--ask") + 1]!;
    expect(ask.startsWith("https://github.com/acme/widgets/pull/661 is a dependency bump that needs a session (")).toBe(
      true,
    );
    expect(ask.endsWith("behind): its name and title are withheld, as they read as a state-home path")).toBe(true);
  });

  it("keeps the name and title when the seam would let the full ask through", async () => {
    const run = harness({ prs: [bump({ mergeable: "CONFLICTING" })] });

    await runGithubBumpDrive({ deps: run.deps, rest: ["--repo", "acme/widgets"] });

    const ask = run.registered[0]![run.registered[0]!.indexOf("--ask") + 1]!;
    expect(ask).toBe(run.seamAsks[0]!.ask);
  });

  // Handover 291-9x: the seat once read ANY row declaring the branch as holding it, so a row that settled at an
  // older head kept a bump renovate had since force-pushed from ever reaching the board again.
  it("seats a conflicted bump whose branch a SETTLED row at an older head declares — the head moved", async () => {
    const settled: LandingBoardRow = { kind: "row", slug: "land-acme-widgets-661-2222222", status: "done" };
    const run = harness({
      board: new Map([["renovate/typescript-6.x", [settled]]]),
      prs: [bump({ mergeable: "CONFLICTING" })],
    });

    await runGithubBumpDrive({ deps: run.deps, rest: ["--repo", "acme/widgets"] });

    expect(run.registered).toHaveLength(1);
    expect(run.registered[0]![run.registered[0]!.indexOf("--slug") + 1]).toBe("land-acme-widgets-661-1111111");
  });

  it("reads the organisation ONCE for the repositories, the bots and the seat, so no act mixes two revisions", async () => {
    const run = harness({ prs: [bump({ mergeable: "CONFLICTING" })] });

    await runGithubBumpDrive({ deps: run.deps, rest: ["--home", "/h/acme"] });

    expect(run.registered).toHaveLength(1);
    expect(run.organisationReads).toEqual(["/h/acme"]);
  });

  it("does not seat a bump a row that already ENDED at this head declares", async () => {
    const settled: LandingBoardRow = { kind: "row", slug: "land-acme-widgets-661-1111111", status: "done" };
    const run = harness({
      board: new Map([["renovate/typescript-6.x", [settled]]]),
      prs: [bump({ mergeable: "CONFLICTING" })],
    });

    await runGithubBumpDrive({ deps: run.deps, rest: ["--repo", "acme/widgets"] });

    expect(run.registered).toEqual([]);
    expect(
      run.out.some((line) => line.includes("land-acme-widgets-661-1111111 already ended at this head and is done")),
    ).toBe(true);
  });

  it("does not seat a bump a LIVE row declares, which is what keeps the seat idempotent", async () => {
    const live: LandingBoardRow = { kind: "row", slug: "fix-the-bump", status: "in-progress" };
    const run = harness({
      board: new Map([["renovate/typescript-6.x", [live]]]),
      prs: [bump({ mergeable: "CONFLICTING" })],
    });

    await runGithubBumpDrive({ deps: run.deps, rest: ["--repo", "acme/widgets"] });

    expect(run.registered).toEqual([]);
    expect(run.out.some((line) => line.includes("fix-the-bump already holds this branch and is in-progress"))).toBe(
      true,
    );
  });
});
