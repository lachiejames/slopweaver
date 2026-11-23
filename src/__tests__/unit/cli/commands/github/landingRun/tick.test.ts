/**
 * The tick invocation of `runGithubLanding` (`--if-due --press --register`): the same-pass enqueue, its autonomy
 * and press-register rows, the store-outage refusals, and the order of the last two acts; then the two findings
 * the press answers for itself, the Codex pairing floor waiver and the superseded rollup waiver.
 */

import { describe, expect, it } from "vitest";
import { AutonomyErrors } from "../../../../../../autonomy/errors.js";
import { runGithubLanding } from "../../../../../../cli/commands/github/landingRun.js";
import { EXIT_ERROR } from "../../../../../../cli/exitCodes.js";
import { err, ok } from "../../../../../../lib/result.js";
import type { SupersededGithubCheck } from "../../../../../../live/github/checksDedupe.js";
import type { PrLiveState } from "../../../../../../live/github/reviewState.js";
import { AUTONOMY_FIXTURE_OUTAGE } from "../../../../../autonomyLedgerFixture.js";
import { HEAD, onePage, PASSING, pr, STORE_OUTAGE } from "./fixtures.js";
import { harness } from "./harness.js";

describe("the TICK invocation — the owner's green-PR steer", () => {
  // The owner's rule: a green, approved, mergeable pull request that only needs merging is merged under
  // graduated autonomy, because the standing steer is that their pull requests auto-merge once all that is left
  // is pressing the button. The tick invocation is what answers it, so it is asserted as one thing.
  const TICK = ["--repo", "acme/widgets", "--if-due", "--press", "--register"];

  it("ENQUEUES a green mergeable pull request in the same pass, with nobody seated for it", async () => {
    const h = harness({ pages: onePage({ prs: [pr()] }) });
    const code = await runGithubLanding({ deps: h.deps, rest: TICK });
    expect(code).toBe(0);
    expect(h.pressed).toEqual(["--pr 16378 --repo acme/widgets"]);
    expect(h.registered).toEqual([]);
  });

  it("records the press on the AUTONOMY ledger, so the owner's briefing shows what was done unasked", async () => {
    const h = harness({ pages: onePage({ prs: [pr()] }) });
    await runGithubLanding({ deps: h.deps, rest: TICK });
    expect(h.autonomyRows).toEqual([
      {
        actionId: `enqueue-acme.widgets-16378-${HEAD}`,
        bySession: "workspace:137",
        doneIso: "2026-09-09T12:30:00.000Z",
        kind: "press-merge-when-ready",
        subject: "https://github.com/acme/widgets/pull/16378",
        why: "every one of the six landing tests passed and nothing needing the owner's judgment was on it at press time",
        witness: `slopweaver github landing --press -> enqueued acme/widgets#16378 at head ${HEAD}`,
      },
    ]);
  });

  // The ledger refuses a second row under a held id with different fields, so an id without the head lost the
  // row for a re-press after the queue evicted a pull request and a rebase moved its head.
  it("keys the ledger row by HEAD, so a re-press at a new head is a new row rather than a refused one", async () => {
    const moved = "2222222222222222222222222222222222222222";
    const first = harness({ pages: onePage({ prs: [pr()] }) });
    await runGithubLanding({ deps: first.deps, rest: TICK });
    const second = harness({
      pages: onePage({ prs: [pr({ checks: { ...pr().checks, headSha: moved }, headOid: moved })] }),
    });
    await runGithubLanding({ deps: second.deps, rest: TICK });
    expect([...first.autonomyRows, ...second.autonomyRows].map((row) => row.actionId)).toEqual([
      `enqueue-acme.widgets-16378-${HEAD}`,
      `enqueue-acme.widgets-16378-${moved}`,
    ]);
  });

  it("writes ONE row for one press however GitHub cased it", async () => {
    const head = "abcdef0123456789abcdef0123456789abcdef01";
    const shouted = head.toUpperCase();
    const first = harness({
      pages: onePage({ prs: [pr({ checks: { ...pr().checks, headSha: head }, headOid: head })] }),
    });
    await runGithubLanding({ deps: first.deps, rest: TICK });
    const second = harness({
      pages: onePage({
        prs: [
          pr({
            checks: { ...pr().checks, headSha: shouted },
            headOid: shouted,
            repoSlug: "Acme/Widgets",
            url: "https://github.com/Acme/Widgets/pull/16378",
          }),
        ],
      }),
    });
    await runGithubLanding({ deps: second.deps, rest: TICK });
    expect(second.autonomyRows).toEqual(first.autonomyRows);
    expect(first.autonomyRows.map((row) => row.witness)).toEqual([
      `slopweaver github landing --press -> enqueued acme/widgets#16378 at head ${head}`,
    ]);
  });

  // MEASURED: one pull request was pressed twice, minutes apart, at ONE
  // head, after the queue let go of the first entry, and the ledger refused the second press's row.
  it("writes a re-press at the SAME head under its own occurrence id rather than losing it", async () => {
    const first = harness({ pages: onePage({ prs: [pr()] }) });
    await runGithubLanding({ deps: first.deps, rest: TICK });
    const earlier = { ...first.autonomyRows[0]!, doneIso: "2026-09-09T12:20:00.000Z" };
    const second = harness({ ledger: [ok([earlier])], pages: onePage({ prs: [pr()] }) });
    await runGithubLanding({ deps: second.deps, rest: TICK });
    expect(second.pressed).toEqual(["--pr 16378 --repo acme/widgets"]);
    expect(second.autonomyRows.map((row) => row.actionId)).toEqual([`enqueue-acme.widgets-16378-${HEAD}-2`]);
  });

  it("resolves the occurrence id against the ledger as it stands AFTER the press, not before it", async () => {
    const first = harness({ pages: onePage({ prs: [pr()] }) });
    await runGithubLanding({ deps: first.deps, rest: TICK });
    // Another session's press of the same head lands between this run's check and its write.
    const racing = { ...first.autonomyRows[0]!, bySession: "workspace:99", doneIso: "2026-09-09T12:29:59.000Z" };
    const second = harness({ ledger: [ok([]), ok([racing])], pages: onePage({ prs: [pr()] }) });
    await runGithubLanding({ deps: second.deps, rest: TICK });
    expect(second.autonomyRows.map((row) => row.actionId)).toEqual([`enqueue-acme.widgets-16378-${HEAD}-2`]);
  });

  // The store is compare-and-set: a racing session that took this ordinal between the re-read and the write
  // leaves the write an ACTION_ID_CONFLICT. That is reported on the outcome; the write is never retried under
  // a guessed next ordinal.
  it("writes ONCE and names the ACTION_ID_CONFLICT when a racing press of the same head took this ordinal", async () => {
    const conflict = AutonomyErrors.actionIdConflict({
      actionId: `enqueue-acme.widgets-16378-${HEAD}`,
      field: "bySession",
    });
    const h = harness({
      autonomyRefusal: conflict.message,
      ledger: [ok([]), ok([])],
      pages: onePage({ prs: [pr()] }),
    });
    await runGithubLanding({ deps: h.deps, rest: [...TICK, "--json"] });
    expect(h.pressed).toEqual(["--pr 16378 --repo acme/widgets"]);
    expect(h.autonomyRows.map((row) => row.actionId)).toEqual([`enqueue-acme.widgets-16378-${HEAD}`]);
    expect(h.slept).toEqual([]);
    const press = JSON.parse(h.out[0]!).presses[0];
    expect(press.outcome).toBe("pressed");
    expect(press.detail).toBe(
      `pressed 'Merge when ready' at head ${HEAD.slice(0, 7)}, but the AUTONOMY ledger row could not be written ` +
        `(${conflict.message}) — the press happened and the owner's briefing will not show it`,
    );
  });

  it("makes ONE attempt at a write the store refuses, never waits, and says the row was lost", async () => {
    const h = harness({ autonomyRefusal: AUTONOMY_FIXTURE_OUTAGE.message, pages: onePage({ prs: [pr()] }) });
    await runGithubLanding({ deps: h.deps, rest: [...TICK, "--json"] });
    expect(h.autonomyRows.map((row) => row.actionId)).toEqual([`enqueue-acme.widgets-16378-${HEAD}`]);
    expect(h.slept).toEqual([]);
    expect(JSON.parse(h.out[0]!).presses[0].detail).toBe(
      `pressed 'Merge when ready' at head ${HEAD.slice(0, 7)}, but the AUTONOMY ledger row could not be written ` +
        `(${AUTONOMY_FIXTURE_OUTAGE.message}) — the press happened and the owner's briefing will not show it`,
    );
  });

  it("presses NOTHING when the autonomy ledger cannot be read, and says why — the ledger is the rail", async () => {
    const h = harness({ ledger: [err(AUTONOMY_FIXTURE_OUTAGE.message)], pages: onePage({ prs: [pr()] }) });
    await runGithubLanding({ deps: h.deps, rest: [...TICK, "--json"] });
    expect(h.pressed).toEqual([]);
    expect(h.judged.count).toBe(0);
    expect(JSON.parse(h.out[0]!).presses).toEqual([
      {
        detail:
          `not pressed: the autonomy ledger could not be read (${AUTONOMY_FIXTURE_OUTAGE.message}), ` +
          "and a press the owner's briefing could not show is not made",
        number: 16378,
        outcome: "failed",
        repoSlug: "acme/widgets",
        url: "https://github.com/acme/widgets/pull/16378",
      },
    ]);
  });

  it("answers a dry run with the same refusal, never would-press, when the ledger cannot be read", async () => {
    const h = harness({ ledger: [err("the register could not be reached")], pages: onePage({ prs: [pr()] }) });
    await runGithubLanding({ deps: h.deps, rest: [...TICK, "--dry-run", "--json"] });
    expect(JSON.parse(h.out[0]!).presses.map((press: { outcome: string }) => press.outcome)).toEqual(["failed"]);
  });

  it("SAYS the press happened when the ledger stops reading between the check and the write", async () => {
    const h = harness({ ledger: [ok([]), err("the register could not be reached")], pages: onePage({ prs: [pr()] }) });
    await runGithubLanding({ deps: h.deps, rest: [...TICK, "--json"] });
    expect(h.pressed).toHaveLength(1);
    expect(h.autonomyRows).toEqual([]);
    expect(JSON.parse(h.out[0]!).presses[0].detail).toBe(
      `pressed 'Merge when ready' at head ${HEAD.slice(0, 7)}, but the AUTONOMY ledger row could not be written ` +
        "(the register could not be reached) — the press happened and the owner's briefing will not show it",
    );
  });

  it("never writes a ledger row for a press `github enqueue` refused", async () => {
    const h = harness({ pages: onePage({ prs: [pr()] }), pressExit: 1 });
    await runGithubLanding({ deps: h.deps, rest: TICK });
    expect(h.autonomyRows).toEqual([]);
  });

  it("SAYS the press happened when the ledger row could not be written, rather than hiding either fact", async () => {
    const h = harness({ autonomyRefusal: AUTONOMY_FIXTURE_OUTAGE.message, pages: onePage({ prs: [pr()] }) });
    await runGithubLanding({ deps: h.deps, rest: TICK });
    expect(h.pressed).toHaveLength(1);
    expect(
      h.out.some(
        (line) =>
          line.startsWith("pressed: acme/widgets#16378") && line.includes("the owner's briefing will not show it"),
      ),
    ).toBe(true);
  });

  it("never both presses a row and registers it as work to send somebody", async () => {
    const h = harness({ pages: onePage({ prs: [pr()] }) });
    await runGithubLanding({ deps: h.deps, rest: [...TICK, "--json"] });
    const document = JSON.parse(h.out[0]!);
    expect(document.dispatchable).toEqual([]);
    expect(document.registrations).toEqual([]);
    expect(document.presses).toHaveLength(1);
  });

  it("presses the green one AND boards the red one in the same pass", async () => {
    const red = pr({
      checks: {
        baseRef: "staging",
        checks: [{ kind: "check-run", name: "build", state: "failed", url: undefined }],
        headSha: "2222222222222222222222222222222222222222",
        mergeable: undefined,
        residue: [],
        rollupState: "FAILURE",
        supersededChecks: [],
        truncated: false,
      },
      headOid: "2222222222222222222222222222222222222222",
      headRefName: "feature/two",
      number: 16379,
      url: "https://github.com/acme/widgets/pull/16379",
    });
    const h = harness({ pages: onePage({ prs: [pr(), red] }) });
    await runGithubLanding({ deps: h.deps, rest: TICK });
    expect(h.pressed).toEqual(["--pr 16378 --repo acme/widgets"]);
    expect(h.registered).toHaveLength(1);
    expect(h.registered[0]!).toContain("feature/two");
  });

  it("makes NO GitHub request and presses nothing on a tick inside the cadence", async () => {
    const h = harness({
      pages: onePage({ prs: [pr()] }),
      reads: new Map([
        [
          "acme/widgets@*",
          { atIso: "2026-09-09T12:20:00.000Z", dispatchable: 0, rows: 1, selection: "acme/widgets@*" },
        ],
      ]),
    });
    await runGithubLanding({ deps: h.deps, rest: TICK });
    expect(h.pressed).toEqual([]);
    expect(h.queueAsked).toEqual([]);
    expect(h.autonomyRows).toEqual([]);
  });
});

describe("the order of the last two acts", () => {
  it("REPORTS the press before recording the cadence, so a refused cadence write cannot swallow it", async () => {
    const h = harness({ pages: onePage({ prs: [pr()] }), recordReadFails: true });
    const exit = await runGithubLanding({ deps: h.deps, rest: ["--repo", "acme/widgets", "--if-due", "--press"] });
    expect(exit).toBe(EXIT_ERROR);
    expect(h.pressed).toHaveLength(1);
    expect(h.out.some((line) => line.startsWith("pressed: acme/widgets#16378"))).toBe(true);
    expect(h.diagnostics).toContain(
      `github landing: the read completed and was reported, but ${STORE_OUTAGE.reads.message}`,
    );
  });
});

describe("the landing registers live in the store, and an outage is a refusal", () => {
  it("refuses an --if-due tick when the cadence cannot be read, rather than calling every selection due", async () => {
    const h = harness({ pages: onePage({ prs: [pr()] }), readsUnreadable: true });
    const exit = await runGithubLanding({ deps: h.deps, rest: ["--repo", "acme/widgets", "--if-due", "--press"] });
    expect(exit).toBe(EXIT_ERROR);
    expect(h.diagnostics).toEqual([`github landing: --if-due refused — ${STORE_OUTAGE.reads.message}`]);
    expect(h.queueAsked).toEqual([]);
    expect(h.pressed).toEqual([]);
  });

  it("refuses the whole read when the press register cannot be read, rather than calling nothing pressed", async () => {
    const h = harness({ pages: onePage({ prs: [pr()] }), pressesUnreadable: true });
    const exit = await runGithubLanding({ deps: h.deps, rest: ["--repo", "acme/widgets", "--press"] });
    expect(exit).toBe(EXIT_ERROR);
    expect(h.pressed).toEqual([]);
    expect(h.diagnostics.join("\n")).toContain(STORE_OUTAGE.presses.message);
  });

  it("SAYS the press happened when its press row could not be written", async () => {
    const h = harness({ pages: onePage({ prs: [pr()] }), recordPressFails: true });
    await runGithubLanding({ deps: h.deps, rest: ["--repo", "acme/widgets", "--press", "--json"] });
    expect(h.pressed).toHaveLength(1);
    expect(JSON.parse(h.out[0]!).presses[0].detail).toBe(
      `pressed 'Merge when ready' at head ${HEAD.slice(0, 7)}, but the press register row could not be written ` +
        `(${STORE_OUTAGE.presses.message}) — the press happened and an eviction from the queue will not read as one`,
    );
  });

  it("names BOTH lost rows when neither the autonomy row nor the press row could be written", async () => {
    const h = harness({
      autonomyRefusal: AUTONOMY_FIXTURE_OUTAGE.message,
      pages: onePage({ prs: [pr()] }),
      recordPressFails: true,
    });
    await runGithubLanding({ deps: h.deps, rest: ["--repo", "acme/widgets", "--press", "--json"] });
    expect(JSON.parse(h.out[0]!).presses[0].detail).toBe(
      `pressed 'Merge when ready' at head ${HEAD.slice(0, 7)}, but the AUTONOMY ledger row could not be written ` +
        `(${AUTONOMY_FIXTURE_OUTAGE.message}), and the press register row could not be written (${STORE_OUTAGE.presses.message}) ` +
        "— the press happened and the owner's briefing will not show it, and an eviction from the queue will not read as one",
    );
  });
});

describe("the Codex pairing floor, the first finding the press answers for itself — the green-PR steer's other half", () => {
  const TICK = ["--repo", "acme/widgets", "--if-due", "--press", "--register"];
  const REASON =
    "a human reviewer's standing approval is what this pull request was paired against — " +
    "the Codex pairing floor cannot be examined for a head no checkout on this machine holds, and a green, " +
    "approved, mergeable pull request of the owner's is enqueued the same pass it becomes so rather than refused to a chair";

  /** One submitted review, in the shape GitHub reports and `approvingLogins` reads. */
  const review = ({ login, state }: { login: string; state: string }) => ({
    commitOid: HEAD,
    login,
    onBehalfOf: [],
    state,
    submittedAtIso: "2026-09-09T11:00:00Z",
  });

  const approved = () => pr({ reviews: [review({ login: "a-colleague", state: "APPROVED" })] });

  // The two argv assertions below are one pair on purpose: the SAME fixture with one field changed produces
  // two exact argvs, so a criterion that stopped reading the approval reddens BOTH rather than quietly
  // passing a `not.toContain`.
  it("names codex-loop-incomplete with the one constant reason when a human approval stands", async () => {
    const h = harness({ pages: onePage({ prs: [approved()] }) });
    const code = await runGithubLanding({ deps: h.deps, rest: TICK });
    expect(code).toBe(0);
    expect(h.pressed).toEqual([
      `--pr 16378 --repo acme/widgets --acknowledge codex-loop-incomplete --reason ${REASON}`,
    ]);
  });

  it("names NOTHING on a pressable pull request nobody approved, so the floor is not waived every time", async () => {
    const h = harness({ pages: onePage({ prs: [pr()] }) });
    await runGithubLanding({ deps: h.deps, rest: TICK });
    expect(h.pressed).toEqual(["--pr 16378 --repo acme/widgets"]);
  });

  it("does not read CodeRabbit's approval as a human's", async () => {
    const h = harness({
      pages: onePage({ prs: [pr({ reviews: [review({ login: "coderabbitai", state: "APPROVED" })] })] }),
    });
    await runGithubLanding({ deps: h.deps, rest: TICK });
    expect(h.pressed).toEqual(["--pr 16378 --repo acme/widgets"]);
  });

  it("does not read the AUTHOR's own approval as a reviewer's", async () => {
    const h = harness({
      pages: onePage({ prs: [pr({ reviews: [review({ login: "the-owner", state: "APPROVED" })] })] }),
    });
    await runGithubLanding({ deps: h.deps, rest: TICK });
    expect(h.pressed).toEqual(["--pr 16378 --repo acme/widgets"]);
  });

  it("reads the approval from the PRESS-time conversation, not from the read that judged the row", async () => {
    const h = harness({
      judgmentNow: pr({ reviews: [] }),
      pages: onePage({ prs: [approved()] }),
    });
    await runGithubLanding({ deps: h.deps, rest: TICK });
    expect(h.pressed).toEqual(["--pr 16378 --repo acme/widgets"]);
  });

  it("says on the AUTONOMY row that the press waived the pairing floor", async () => {
    const h = harness({ pages: onePage({ prs: [approved()] }) });
    await runGithubLanding({ deps: h.deps, rest: TICK });
    expect(h.autonomyRows).toEqual([
      {
        actionId: `enqueue-acme.widgets-16378-${HEAD}`,
        bySession: "workspace:137",
        doneIso: "2026-09-09T12:30:00.000Z",
        kind: "press-merge-when-ready",
        subject: "https://github.com/acme/widgets/pull/16378",
        why:
          "every one of the six landing tests passed and nothing needing the owner's judgment was on it at press " +
          "time, acknowledging the Codex pairing floor on a standing human approval",
        witness: `slopweaver github landing --press -> enqueued acme/widgets#16378 at head ${HEAD}`,
      },
    ]);
  });

  it("tells a DRY RUN that the waiver would be made, rather than hiding it until the ledger", async () => {
    const h = harness({ pages: onePage({ prs: [approved()] }) });
    await runGithubLanding({ deps: h.deps, rest: ["--repo", "acme/widgets", "--press", "--dry-run"] });
    expect(h.pressed).toEqual([]);
    expect(
      h.out.some(
        (line) =>
          line.startsWith("would-press: acme/widgets#16378") &&
          line.endsWith("a standing human approval would acknowledge the Codex pairing floor"),
      ),
    ).toBe(true);
  });

  it("refuses the press outright when the reviews did not fit one page, so no waiver is reached", async () => {
    const h = harness({
      judgmentNow: pr({ reviews: [review({ login: "a-colleague", state: "APPROVED" })], reviewsTruncated: true }),
      pages: onePage({ prs: [approved()] }),
    });
    await runGithubLanding({ deps: h.deps, rest: TICK });
    expect(h.pressed).toEqual([]);
    expect(h.out.some((line) => line.includes("its reviews did not fit one page"))).toBe(true);
  });
});

describe("the superseded rollup, the second finding the press answers for itself", () => {
  const TICK = ["--repo", "acme/widgets", "--if-due", "--press", "--register"];

  /** The failing `dev-gate` run still folded into the rollup, replaced on the same head by a later one. */
  const PINNING: SupersededGithubCheck = {
    completedAt: "2026-09-20T05:11:44Z",
    kind: "check-run",
    name: "dev-gate",
    replacedBy: { completedAt: "2026-09-20T05:31:00Z", runId: "33717812345", state: "passed" },
    runId: "33717795965",
    state: "failed",
  };

  /** The `pr-body-gate` re-run shape: a green head whose rollup a replaced `dev-gate` run still pins. */
  const pinned = (over: Partial<SupersededGithubCheck> = {}): PrLiveState =>
    pr({
      checks: {
        baseRef: "staging",
        checks: [PASSING],
        headSha: HEAD,
        mergeable: undefined,
        residue: [],
        rollupState: "FAILURE",
        supersededChecks: [{ ...PINNING, ...over }],
        truncated: false,
      },
    });

  const PROVEN_REASON =
    `GitHub's rollup on ${HEAD} reads FAILURE and all 1 checks in the latest-per-name view on that head ` +
    "PASSED; every run pinning it was replaced on the same head by a later run of its own name — " +
    "dev-gate 33717795965 completed 05:11:44Z superseded by run 33717812345 completed 05:31:00Z";

  it("names ci-rollup-superseded with the run this read PROVED replaced the failure", async () => {
    const h = harness({ pages: onePage({ prs: [pinned()] }) });
    const code = await runGithubLanding({ deps: h.deps, rest: TICK });
    expect(code).toBe(0);
    expect(h.pressed).toEqual([
      `--pr 16378 --repo acme/widgets --acknowledge ci-rollup-superseded --reason ${PROVEN_REASON}`,
    ]);
  });

  it("names NOTHING when the superseded failure carries no later run of its own name", async () => {
    const h = harness({ pages: onePage({ prs: [pinned({ replacedBy: undefined })] }) });
    await runGithubLanding({ deps: h.deps, rest: TICK });
    expect(h.pressed).toEqual(["--pr 16378 --repo acme/widgets"]);
  });

  it("prints WHY it could not acknowledge beside `github enqueue`'s own refusal, rather than only refusing", async () => {
    const h = harness({ pages: onePage({ prs: [pinned({ replacedBy: undefined })] }), pressExit: 1 });
    await runGithubLanding({ deps: h.deps, rest: TICK });
    expect(
      h.out.some((line) =>
        line.includes(
          "the superseded rollup was NOT acknowledged — 1 of 1 superseded failure(s) on " +
            `${HEAD} carry no LATER run of the same name this read can name: dev-gate 33717795965 ` +
            "completed 05:11:44Z",
        ),
      ),
    ).toBe(true);
  });

  it("reads the rollup from the PRESS-time conversation, not from the read that judged the row", async () => {
    const h = harness({ judgmentNow: pr(), pages: onePage({ prs: [pinned()] }) });
    await runGithubLanding({ deps: h.deps, rest: TICK });
    expect(h.pressed).toEqual(["--pr 16378 --repo acme/widgets"]);
  });

  it("joins BOTH subjects and BOTH reasons onto one --acknowledge/--reason pair — the measured two-at-once case", async () => {
    const approving = {
      commitOid: HEAD,
      login: "a-colleague",
      onBehalfOf: [],
      state: "APPROVED",
      submittedAtIso: "2026-09-20T11:00:00Z",
    };
    const state = pinned();
    const h = harness({ pages: onePage({ prs: [{ ...state, reviews: [approving] }] }) });
    await runGithubLanding({ deps: h.deps, rest: TICK });
    expect(h.pressed).toHaveLength(1);
    expect(h.pressed[0]!).toContain("--acknowledge codex-loop-incomplete,ci-rollup-superseded --reason ");
    expect(h.pressed[0]!.endsWith(`; ${PROVEN_REASON}`)).toBe(true);
  });

  it("tells a DRY RUN the rollup waiver would be made", async () => {
    const h = harness({ pages: onePage({ prs: [pinned()] }) });
    await runGithubLanding({ deps: h.deps, rest: ["--repo", "acme/widgets", "--press", "--dry-run"] });
    expect(h.pressed).toEqual([]);
    expect(
      h.out.some(
        (line) =>
          line.startsWith("would-press: acme/widgets#16378") &&
          line.endsWith("a proven replacement would acknowledge the superseded rollup"),
      ),
    ).toBe(true);
  });

  it("says on the AUTONOMY row that the press waived the superseded rollup", async () => {
    const h = harness({ pages: onePage({ prs: [pinned()] }) });
    await runGithubLanding({ deps: h.deps, rest: TICK });
    expect(h.autonomyRows[0]!.why).toBe(
      "every one of the six landing tests passed and nothing needing the owner's judgment was on it at press time, " +
        "acknowledging the superseded rollup on a replacement this read proved",
    );
  });
});
