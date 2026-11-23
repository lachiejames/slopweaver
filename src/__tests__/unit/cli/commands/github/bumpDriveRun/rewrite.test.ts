/*
 * The description rewrite of a bot bump red only on dev-gate: what it sends, the head-keyed ledger row that
 * guards it, and the bumps it seats instead.
 */
import { describe, expect, it } from "vitest";

import { AUTONOMY_SLUG_PATTERN } from "../../../../../../autonomy/types.js";
import { bumpBodyActionId } from "../../../../../../cli/commands/github/bumpDriveLedger.js";
import { runGithubBumpDrive } from "../../../../../../cli/commands/github/bumpDriveRun.js";
import { unwrap } from "../../../../../../lib/result.js";
import { safeJsonParse } from "../../../../../../lib/safeJson.js";
import { BUMP_WORST_CASE } from "../../../../../../outbound/github/bumpBodyForm.js";
import { renderPrBody } from "../../../../../../outbound/github/render.js";
import { stampForWrite } from "../../../../../../outbound/github/stamp.js";
import { prFormWriteSchema } from "../../../../../../outbound/github/writeSchema.js";
import { gatePrBody } from "../../../../../../prformat/prBodyGate.js";
import { landingRowFake } from "../../../../../landingRowFake.js";
import { devGateRed, HEAD, heldAct, REWRITE_ID } from "./fixtures.js";
import { harness } from "./harness.js";

describe("runGithubBumpDrive", () => {
  it("rewrites a bot bump's description when dev-gate is the only red check, keyed by head on the ledger", async () => {
    const run = harness({ prs: [devGateRed()] });

    const code = await runGithubBumpDrive({ deps: run.deps, rest: ["--repo", "acme/widgets"] });

    expect(code).toBe(0);
    expect(run.rewritten).toHaveLength(1);
    expect(run.rewritten[0]!.slice(0, 5)).toEqual(["node", "slopweaver", "github", "pr", "update"]);
    expect(run.rewritten[0]!.slice(7)).toEqual(["--repo", "acme/widgets", "--number", "661"]);
    expect(run.readied).toEqual([]);
    expect(run.pressed).toEqual([]);
    expect(run.registered).toEqual([]);
    expect(run.autonomyRows.map((row) => row.actionId)).toEqual([REWRITE_ID]);
    expect(run.autonomyRows[0]!.kind).toBe("rewrite-pull-request-body");
    expect(run.autonomyRows[0]!.witness).toBe(
      "slopweaver github bump-drive -> sent the typed bump form as acme/widgets#661's whole description at head " +
        "1111111, through github pr update --form",
    );
  });

  it("sends the composed C3 form itself, seen by an agent on the day the pass observed it, no origin or grade", async () => {
    const run = harness({ prs: [devGateRed()] });

    await runGithubBumpDrive({ deps: run.deps, rest: ["--repo", "acme/widgets"] });

    const raw = safeJsonParse({ label: "the form under test", text: run.rewritten[0]![6]! });
    const sent = prFormWriteSchema.parse(raw);
    expect(["origin", "review", "goldAnchor"].filter((key) => Object.hasOwn(sent, key))).toStrictEqual([]);
    expect(sent.title).toBe("Update dependency typescript to v6");
    expect(sent.draft).toBe(true);
    expect(sent.problemSeen).toStrictEqual({
      by: "agent",
      kind: "seen",
      on: "2026-09-20",
      what: "the resolved version was behind the one Renovate found",
    });
    expect(sent.risk).toStrictEqual({
      items: [
        {
          check: { check: `This repository's own checks ran on ${HEAD.slice(0, 7)}`, kind: "checked" },
          worst: BUMP_WORST_CASE,
          worstKind: "something-working-breaks",
        },
      ],
    });
    const stamped = unwrap(stampForWrite({ draft: sent, today: "2026-09-20" }));
    expect(gatePrBody({ body: unwrap(renderPrBody({ form: stamped })), owned: true })).toStrictEqual({
      errors: [],
      shape: "c3",
    });
  });

  it("refuses to rewrite the same head twice — the ledger row is the guard, and the bump is SEATED instead", async () => {
    const already = bumpBodyActionId({ row: landingRowFake({ headOid: HEAD, number: 661 }) });
    const run = harness({ ledger: [heldAct({ actionId: already })], prs: [devGateRed()] });

    await runGithubBumpDrive({ deps: run.deps, rest: ["--repo", "acme/widgets"] });

    expect(already).toBe(REWRITE_ID);
    expect(run.rewritten).toEqual([]);
    expect(run.autonomyRows).toEqual([]);
    expect(run.registered).toHaveLength(1);
    expect(run.out.some((line) => line.includes(`${already} says this head's description was already`))).toBe(true);
    expect(run.out.some((line) => line.includes("registered land-acme-widgets-661-1111111 on the one board"))).toBe(
      true,
    );
  });

  it("keys that guard by HEAD, so renovate's next force-push composes a fresh body under a legal ledger id", () => {
    const first = bumpBodyActionId({ row: landingRowFake({ headOid: "a".repeat(40), number: 661 }) });
    const second = bumpBodyActionId({ row: landingRowFake({ headOid: "b".repeat(40), number: 661 }) });

    expect(first).toBe(`rewrite-acme.widgets-661-${"a".repeat(40)}`);
    expect(second).toBe(`rewrite-acme.widgets-661-${"b".repeat(40)}`);
    expect(AUTONOMY_SLUG_PATTERN.test(first)).toBe(true);
  });

  it("still honours a row written under the seven-character id, on the same pull request only", async () => {
    const legacy = heldAct({ actionId: "661-bump-body-1111111" });
    const guarded = harness({ ledger: [legacy], prs: [devGateRed()] });
    const elsewhere = harness({
      ledger: [{ ...legacy, subject: "https://github.com/acme/gadgets/pull/661" }],
      prs: [devGateRed()],
    });

    await runGithubBumpDrive({ deps: guarded.deps, rest: ["--repo", "acme/widgets"] });
    await runGithubBumpDrive({ deps: elsewhere.deps, rest: ["--repo", "acme/widgets"] });

    expect(guarded.rewritten).toEqual([]);
    expect(guarded.registered).toHaveLength(1);
    expect(elsewhere.rewritten).toHaveLength(1);
    expect(elsewhere.autonomyRows.map((row) => row.actionId)).toEqual([REWRITE_ID]);
  });

  it("sends nothing when the ledger cannot be read, since the guard is the only bound on the act", async () => {
    const run = harness({ ledgerUnreadable: true, prs: [devGateRed()] });

    await runGithubBumpDrive({ deps: run.deps, rest: ["--repo", "acme/widgets"] });

    expect(run.rewritten).toEqual([]);
    expect(run.autonomyRows).toEqual([]);
    expect(run.registered).toEqual([]);
    expect(
      run.out.some((line) =>
        line.includes(
          "the AUTONOMY ledger could not be read (the autonomy ledger lives in the store, and the store could not be opened), and it is this act's only guard",
        ),
      ),
    ).toBe(true);
  });

  it("writes no ledger row when the rewrite itself refused, because nothing changed", async () => {
    const run = harness({ prs: [devGateRed()], rewriteExit: 1 });

    await runGithubBumpDrive({ deps: run.deps, rest: ["--repo", "acme/widgets"] });

    expect(run.rewritten).toHaveLength(1);
    expect(run.autonomyRows).toEqual([]);
    expect(run.out.some((line) => line.includes("`github pr update --form` refused the rewrite"))).toBe(true);
  });

  it("seats a RENOVATE bump red only on dev-gate, and never writes over renovate's own description", async () => {
    const run = harness({ prs: [devGateRed({ authorLogin: "acme-renovate[bot]" })] });

    await runGithubBumpDrive({ deps: run.deps, rest: ["--repo", "acme/widgets"] });

    expect(run.rewritten).toEqual([]);
    expect(run.autonomyRows).toEqual([]);
    expect(run.registered).toHaveLength(1);
  });

  it("seats a bot bump whose red check is NOT dev-gate, rather than rewriting its description", async () => {
    const run = harness({ prs: [devGateRed({ redName: "build" })] });

    await runGithubBumpDrive({ deps: run.deps, rest: ["--repo", "acme/widgets"] });

    expect(run.rewritten).toEqual([]);
    expect(run.registered).toHaveLength(1);
  });
});
