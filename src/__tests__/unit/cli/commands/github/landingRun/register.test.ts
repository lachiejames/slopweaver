/**
 * `runGithubLanding --register`: the board rows it writes, drops and settles (including a row whose pull request
 * has ended); then the CodeRabbit nudge the press makes itself when a review is stuck on CHANGES_REQUESTED after
 * every thread was resolved.
 */

import { describe, expect, it } from "vitest";
import { runGithubLanding } from "../../../../../../cli/commands/github/landingRun.js";
import { EXIT_OK } from "../../../../../../cli/exitCodes.js";
import type { PrClosure } from "../../../../../../live/github/prClosure.js";
import type { PrLiveState } from "../../../../../../live/github/reviewState.js";
import type { LandingBoardRow } from "../../../../../../review/landingBoard.js";
import { AUTONOMY_FIXTURE_OUTAGE } from "../../../../../autonomyLedgerFixture.js";
import { HEAD, onePage, ownThread, pr } from "./fixtures.js";
import { harness } from "./harness.js";
import type { Harness } from "./harnessTypes.js";

describe("runGithubLanding --register", () => {
  /** A pull request whose required check is failing, so its act is `spawn-ci` and its verdict `rebase-and-fix`. */
  const redPr = () =>
    pr({
      checks: {
        baseRef: "staging",
        checks: [{ kind: "check-run", name: "build", state: "failed", url: undefined }],
        headSha: HEAD,
        mergeable: undefined,
        residue: [],
        rollupState: "FAILURE",
        supersededChecks: [],
        truncated: false,
      },
    });

  it("writes one board row per dispatchable row, declaring the head branch", async () => {
    const h = harness({ pages: onePage({ prs: [redPr()] }) });
    const code = await runGithubLanding({ deps: h.deps, rest: ["--repo", "acme/widgets", "--register"] });
    expect(code).toBe(0);
    expect(h.registered).toHaveLength(1);
    expect(h.registered[0]!).toContain("--branch");
    expect(h.registered[0]!).toContain("feature/one");
  });

  // MEASURED: a read listed 12 rebase-and-fix rows as dispatchable, 10 of them already
  // settled `answered` at their own head, and `cmux spawn` refused every fill attempt as already settled.
  it("drops a row whose own registration at THIS head is settled, and writes nothing for it", async () => {
    const settled: LandingBoardRow = { kind: "row", slug: "land-acme-widgets-16378-1111111", status: "done" };
    const h = harness({ board: new Map([["feature/one", [settled]]]), pages: onePage({ prs: [redPr()] }) });
    await runGithubLanding({ deps: h.deps, rest: ["--repo", "acme/widgets", "--register", "--json"] });
    const document = JSON.parse(h.out[0]!);
    expect(document.dispatchable).toEqual([]);
    expect(document.rows[0].boardRow).toEqual(settled);
    expect(h.registered).toEqual([]);
  });

  it("keeps a row settled at an OLDER head dispatchable, and registers this head", async () => {
    const older: LandingBoardRow = { kind: "row", slug: "land-acme-widgets-16378-0000000", status: "done" };
    const h = harness({ board: new Map([["feature/one", [older]]]), pages: onePage({ prs: [redPr()] }) });
    await runGithubLanding({ deps: h.deps, rest: ["--repo", "acme/widgets", "--register", "--json"] });
    expect(JSON.parse(h.out[0]!).dispatchable).toHaveLength(1);
    expect(h.registered[0]!).toContain("land-acme-widgets-16378-1111111");
  });

  it("drops a row settled at an older head whose witness names the head this read judged", async () => {
    const rebased: LandingBoardRow = {
      kind: "row",
      settlementWitness: "https://github.com/acme/widgets/pull/16378 @ 1111111111111111111111111111111111111111",
      slug: "land-acme-widgets-16378-0000000",
      status: "done",
    };
    const h = harness({ board: new Map([["feature/one", [rebased]]]), pages: onePage({ prs: [redPr()] }) });
    await runGithubLanding({ deps: h.deps, rest: ["--repo", "acme/widgets", "--register", "--json"] });
    expect(JSON.parse(h.out[0]!).dispatchable).toEqual([]);
    expect(h.registered).toEqual([]);
  });

  // `renovate/*` branch names repeat across repositories, and the join is keyed by branch name.
  it("drops a row settled at this head even when another repository's LIVE row declares the same branch", async () => {
    const settled: LandingBoardRow = {
      kind: "row",
      repoSlug: "acme/widgets",
      slug: "land-acme-widgets-16378-1111111",
      status: "done",
    };
    const elsewhere: LandingBoardRow = {
      kind: "row",
      repoSlug: "acme/gadgets",
      slug: "gadgets-fix",
      status: "ready",
    };
    const h = harness({
      board: new Map([["feature/one", [elsewhere, settled]]]),
      pages: onePage({ prs: [redPr()] }),
    });
    await runGithubLanding({ deps: h.deps, rest: ["--repo", "acme/widgets", "--register", "--json"] });
    const document = JSON.parse(h.out[0]!);
    expect(document.rows[0].boardRow).toEqual(settled);
    expect(document.dispatchable).toEqual([]);
    expect(h.registered).toEqual([]);
  });

  it("writes NOTHING when --register was not given", async () => {
    const h = harness({ pages: onePage({ prs: [redPr()] }) });
    await runGithubLanding({ deps: h.deps, rest: ["--repo", "acme/widgets"] });
    expect(h.registered).toEqual([]);
  });

  it("never registers a merge-now row, which is enqueued rather than seated", async () => {
    const h = harness({ pages: onePage({ prs: [pr()] }) });
    await runGithubLanding({ deps: h.deps, rest: ["--repo", "acme/widgets", "--register"] });
    expect(h.registered).toEqual([]);
    expect(h.out.some((line) => line.startsWith("skipped: acme/widgets#16378"))).toBe(true);
  });

  it("writes nothing on --register --dry-run", async () => {
    const h = harness({ pages: onePage({ prs: [redPr()] }) });
    await runGithubLanding({ deps: h.deps, rest: ["--repo", "acme/widgets", "--register", "--dry-run"] });
    expect(h.registered).toEqual([]);
    expect(h.out.some((line) => line.startsWith("would-register: acme/widgets#16378"))).toBe(true);
  });

  it("carries every considered row in the document, so `nothing written` and `nothing to write` differ", async () => {
    const h = harness({ pages: onePage({ prs: [pr()] }) });
    await runGithubLanding({ deps: h.deps, rest: ["--repo", "acme/widgets", "--register", "--json"] });
    expect(JSON.parse(h.out[0]!).registrations).toHaveLength(1);
  });

  it("leaves `registrations` empty on a read that did not register", async () => {
    const h = harness({ pages: onePage({ prs: [pr()] }) });
    await runGithubLanding({ deps: h.deps, rest: ["--repo", "acme/widgets", "--json"] });
    expect(JSON.parse(h.out[0]!).registrations).toEqual([]);
  });
});

// MEASURED: a landing row sat ready ten hours after its pull request merged, and the fill step seated a session
// whose whole run was finding that out.
describe("runGithubLanding --register settles a row whose pull request has ENDED", () => {
  const MERGE = "3c92c09714aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  /** A ready row the register filed for its pull request, which the harness census no longer lists as open. */
  const endedRow: LandingBoardRow = {
    kind: "row",
    run: "never-started",
    slug: "land-acme-widgets-2027-5cf03b1",
    status: "ready",
  };
  const merged: PrClosure = {
    mergeCommitOid: MERGE,
    mergedAt: "2026-10-09T20:34:00Z",
    state: "MERGED",
    url: "https://github.com/acme/widgets/pull/2027",
  };

  it("settles it answered, naming the merge commit as witness", async () => {
    const h = harness({
      board: new Map([["feature/gone", [endedRow]]]),
      closures: new Map([[2027, merged]]),
      pages: onePage({ prs: [pr()] }),
    });
    await runGithubLanding({ deps: h.deps, rest: ["--repo", "acme/widgets", "--register"] });
    expect(h.closuresAsked).toEqual(["acme/widgets#2027"]);
    expect(h.settled).toEqual([
      [
        "node",
        "slopweaver",
        "handover",
        "settle",
        "land-acme-widgets-2027-5cf03b1",
        "--as",
        "answered",
        "--witness",
        `https://github.com/acme/widgets/pull/2027 merged at ${MERGE} (2026-10-09T20:34:00Z)`,
      ],
    ]);
    expect(h.out).toContain(
      `settled: acme/widgets#2027 — settled answered — https://github.com/acme/widgets/pull/2027 merged at ${MERGE} (2026-10-09T20:34:00Z)`,
    );
  });

  it("never reads or settles a row whose pull request the census still lists, even at an older head", async () => {
    const olderHead: LandingBoardRow = {
      kind: "row",
      run: "never-started",
      slug: "land-acme-widgets-16378-0000000",
      status: "ready",
    };
    const h = harness({ board: new Map([["feature/one", [olderHead]]]), pages: onePage({ prs: [pr()] }) });
    await runGithubLanding({ deps: h.deps, rest: ["--repo", "acme/widgets", "--register"] });
    expect(h.closuresAsked).toEqual([]);
    expect(h.settled).toEqual([]);
  });

  it("settles nothing on --dry-run, and says what it would settle", async () => {
    const h = harness({
      board: new Map([["feature/gone", [endedRow]]]),
      closures: new Map([[2027, merged]]),
      pages: onePage({ prs: [pr()] }),
    });
    await runGithubLanding({ deps: h.deps, rest: ["--repo", "acme/widgets", "--register", "--dry-run"] });
    expect(h.settled).toEqual([]);
    expect(h.out).toContain(
      `would-settle: acme/widgets#2027 — https://github.com/acme/widgets/pull/2027 merged at ${MERGE} (2026-10-09T20:34:00Z)`,
    );
  });

  it("settles nothing without --register", async () => {
    const h = harness({
      board: new Map([["feature/gone", [endedRow]]]),
      closures: new Map([[2027, merged]]),
      pages: onePage({ prs: [pr()] }),
    });
    await runGithubLanding({ deps: h.deps, rest: ["--repo", "acme/widgets", "--json"] });
    expect(h.closuresAsked).toEqual([]);
    expect(JSON.parse(h.out[0]!).settlements).toEqual([]);
  });

  it("keeps stdout one parseable document under --json, the settle's receipt on stderr", async () => {
    const h = harness({
      board: new Map([["feature/gone", [endedRow]]]),
      closures: new Map([[2027, merged]]),
      pages: onePage({ prs: [pr()] }),
    });
    await runGithubLanding({ deps: h.deps, rest: ["--repo", "acme/widgets", "--register", "--json"] });
    expect(h.out).toHaveLength(1);
    expect(JSON.parse(h.out[0]!).settlements.map((one: { outcome: string }) => one.outcome)).toEqual(["settled"]);
    expect(h.diagnostics).toContain("handover settle: land-acme-widgets-2027-5cf03b1 is settled answered");
  });

  it("reports a failed settle by its exit code rather than as settled", async () => {
    const h = harness({
      board: new Map([["feature/gone", [endedRow]]]),
      closures: new Map([[2027, merged]]),
      pages: onePage({ prs: [pr()] }),
      settleExit: 1,
    });
    await runGithubLanding({ deps: h.deps, rest: ["--repo", "acme/widgets", "--register"] });
    expect(h.out).toContain(
      "failed: acme/widgets#2027 — `handover settle` exited 1 — its own lines above name the cause, and the row " +
        "may already be settled if it failed after the write",
    );
  });

  it("names the census race and settles nothing when GitHub still reads the pull request open", async () => {
    const h = harness({
      board: new Map([["feature/gone", [endedRow]]]),
      closures: new Map([[2027, { state: "OPEN", url: "https://github.com/acme/widgets/pull/2027" } as const]]),
      pages: onePage({ prs: [pr()] }),
    });
    await runGithubLanding({ deps: h.deps, rest: ["--repo", "acme/widgets", "--register"] });
    expect(h.settled).toEqual([]);
    expect(h.out).toContain(
      "skipped: acme/widgets#2027 — GitHub still reads it OPEN although the census did not list it — left for the next read",
    );
  });

  // Eligibility was judged once, before the network read, and `handover settle` checks no status.
  it("holds a row paused while GitHub was being read, rather than settling it from the stale snapshot", async () => {
    const h = harness({
      board: new Map([["feature/gone", [endedRow]]]),
      closures: new Map([[2027, merged]]),
      pages: onePage({ prs: [pr()] }),
      rowsNow: new Map([["land-acme-widgets-2027-5cf03b1", { run: "never-started", status: "paused" }]]),
    });
    await runGithubLanding({ deps: h.deps, rest: ["--repo", "acme/widgets", "--register"] });
    expect(h.closuresAsked).toEqual(["acme/widgets#2027"]);
    expect(h.settled).toEqual([]);
    expect(h.out).toContain(
      "held: acme/widgets#2027 — re-read once GitHub answered: it is paused on a person, and that is a state rather " +
        "than a countdown",
    );
  });

  it("reads no more than its cap in one invocation, and leaves the rest to the next read", async () => {
    const rows: LandingBoardRow[] = Array.from({ length: 21 }, (_, index) => ({
      kind: "row",
      run: "never-started",
      slug: `land-acme-widgets-${String(3000 + index)}-5cf03b1`,
      status: "ready",
    }));
    const h = harness({ board: new Map([["feature/gone", rows]]), pages: onePage({ prs: [pr()] }) });
    await runGithubLanding({ deps: h.deps, rest: ["--repo", "acme/widgets", "--register"] });
    expect(h.closuresAsked).toHaveLength(20);
    expect(h.out).toContain(
      "skipped: acme/widgets#3020 — this invocation's cap of 20 reads was already reached — the next read takes it",
    );
  });
});

describe("a stuck CodeRabbit review is re-requested by the press itself — the owner's standing rule", () => {
  // The owner's rule: once every comment is resolved and a good twenty seconds have passed with the review still
  // on requested changes, it is probably stuck, and forcing a re-review is the desired behaviour under graduated
  // autonomy.
  const TICK = ["--repo", "acme/widgets", "--author", "@me", "--press", "--register", "--json"];

  const CODERABBIT_CHANGES = {
    commitOid: HEAD,
    login: "coderabbitai",
    onBehalfOf: [],
    state: "CHANGES_REQUESTED",
    submittedAtIso: "2026-09-09T11:00:00Z",
  } as const;

  /** A CodeRabbit thread, resolved unless a case says otherwise. */
  const rabbitThread = ({ isResolved = true }: { isResolved?: boolean }): PrLiveState["threads"][number] => ({
    ...ownThread({ id: "PRRT_rabbit1" }),
    isResolved,
    lastCommentLogin: "coderabbitai",
    openedByLogin: "coderabbitai",
  });

  /** Every CodeRabbit thread resolved and its CHANGES_REQUESTED still standing. */
  const stuck = (over: Partial<PrLiveState> = {}): PrLiveState =>
    pr({ reviews: [CODERABBIT_CHANGES], threadCount: 1, threads: [rabbitThread({})], ...over });

  const COMMENT_ARGV =
    '--repo acme/widgets --number 16378 --form {"summary":[{"kind":"text","text":"@coderabbitai review"}]}';

  /** The `--json` document one run printed. */
  const documentOf = ({
    h,
  }: {
    h: Harness;
  }): {
    dispatchable: { number: number }[];
    presses: { outcome: string; detail: string }[];
    registrations: unknown[];
    rows: { action: string; codeRabbit: string }[];
  } => JSON.parse(h.out[0]!);

  it("waits the twenty seconds, re-reads once, posts @coderabbitai review, ledgers it, and seats nobody", async () => {
    const h = harness({ pages: onePage({ prs: [stuck()] }) });
    expect(await runGithubLanding({ deps: h.deps, rest: TICK })).toBe(EXIT_OK);
    const document = documentOf({ h });
    expect(document.rows[0]!).toMatchObject({ action: "spawn-coderabbit", codeRabbit: "stuck" });
    expect(h.slept).toEqual([20_000]);
    expect(h.judged.count).toBe(1);
    expect(h.reserved).toEqual([`acme/widgets#16378@${HEAD}`]);
    expect(h.commented).toEqual([COMMENT_ARGV]);
    expect(h.pressed).toEqual([]);
    expect(document.presses.map((press) => press.outcome)).toEqual(["nudged"]);
    expect(document.dispatchable).toEqual([]);
    expect(document.registrations).toEqual([]);
    expect(h.autonomyRows).toEqual([
      {
        actionId: "16378-1111111-coderabbit-nudge",
        bySession: "workspace:137",
        doneIso: "2026-09-09T12:30:00.000Z",
        kind: "nudge-coderabbit",
        subject: "https://github.com/acme/widgets/pull/16378",
        why:
          "every CodeRabbit thread, outdated included, was resolved; twenty seconds after the read that saw it, its " +
          "latest opinion was still CHANGES_REQUESTED — the owner's standing rule",
        witness:
          "slopweaver github landing --press -> posted @coderabbitai review on acme/widgets#16378 at head 1111111",
      },
    ]);
  });

  it("anchors the twenty seconds after the WHOLE read, so time the read itself spent never shortens the wait", async () => {
    const h = harness({ pages: onePage({ prs: [stuck()] }), queueReadMs: 6_500 });
    await runGithubLanding({ deps: h.deps, rest: TICK });
    expect(h.slept).toEqual([20_000]);
    expect(h.commented).toEqual([COMMENT_ARGV]);
  });

  it("posts nothing and seats nobody when CodeRabbit approved the head by itself during the wait", async () => {
    const approved = { ...CODERABBIT_CHANGES, state: "APPROVED", submittedAtIso: "2026-09-09T12:30:10Z" } as const;
    const h = harness({
      judgmentNow: stuck({ reviews: [CODERABBIT_CHANGES, approved] }),
      pages: onePage({ prs: [stuck()] }),
    });
    await runGithubLanding({ deps: h.deps, rest: TICK });
    const document = documentOf({ h });
    expect(h.commented).toEqual([]);
    expect(h.reserved).toEqual([]);
    expect(h.autonomyRows).toEqual([]);
    expect(document.presses.map((press) => press.outcome)).toEqual(["flipped-by-itself"]);
    expect(document.dispatchable).toEqual([]);
  });

  it("posts nothing and leaves the row for a session when a CodeRabbit thread REOPENED during the wait", async () => {
    const h = harness({
      judgmentNow: stuck({ threads: [rabbitThread({ isResolved: false })] }),
      pages: onePage({ prs: [stuck()] }),
    });
    await runGithubLanding({ deps: h.deps, rest: TICK });
    const document = documentOf({ h });
    expect(h.commented).toEqual([]);
    expect(document.presses).toEqual([
      expect.objectContaining({
        detail: "not re-requested: the read after the wait says 1 unresolved CodeRabbit comment(s) still open",
        outcome: "failed",
      }),
    ]);
    expect(document.dispatchable.map((row) => row.number)).toEqual([16378]);
  });

  it("posts nothing when the head moved during the wait, since a new push starts a new review", async () => {
    const h = harness({
      judgmentNow: stuck({ headOid: "2222222222222222222222222222222222222222" }),
      pages: onePage({ prs: [stuck()] }),
    });
    await runGithubLanding({ deps: h.deps, rest: TICK });
    expect(h.commented).toEqual([]);
    expect(documentOf({ h }).presses[0]!.detail).toBe(
      "not re-requested: its head moved from 1111111 to 2222222 during the wait, and a new push starts a new review",
    );
  });

  it("never re-requests the same head twice — no wait, no read, no post, and the row stays for a session", async () => {
    const h = harness({ nudgedHeads: new Set([`acme/widgets#16378@${HEAD}`]), pages: onePage({ prs: [stuck()] }) });
    await runGithubLanding({ deps: h.deps, rest: TICK });
    expect(h.slept).toEqual([]);
    expect(h.judged.count).toBe(0);
    expect(h.commented).toEqual([]);
    expect(documentOf({ h }).dispatchable.map((row) => row.number)).toEqual([16378]);
  });

  it("posts nothing when another pass reserved the head during this one's wait", async () => {
    const h = harness({ pages: onePage({ prs: [stuck()] }), reserveAnswer: "already-recorded" });
    await runGithubLanding({ deps: h.deps, rest: TICK });
    expect(h.commented).toEqual([]);
    expect(documentOf({ h }).presses[0]!.detail).toBe(
      "not re-requested: another pass already re-requested this head during the wait",
    );
  });

  it("re-requests nothing when the register cannot be read, rather than reading it as empty", async () => {
    const h = harness({ nudgedHeadsUnreadable: true, pages: onePage({ prs: [stuck()] }) });
    await runGithubLanding({ deps: h.deps, rest: TICK });
    expect(h.slept).toEqual([]);
    expect(h.commented).toEqual([]);
    expect(documentOf({ h }).presses[0]!.detail).toBe(
      "not re-requested: the CodeRabbit nudge register /home/nudges could not be read: EACCES",
    );
  });

  it("says would-nudge under --dry-run and writes nothing, leaving the row for a session", async () => {
    const h = harness({ pages: onePage({ prs: [stuck()] }) });
    await runGithubLanding({ deps: h.deps, rest: [...TICK, "--dry-run"] });
    const document = documentOf({ h });
    expect(h.slept).toEqual([20_000]);
    expect(h.reserved).toEqual([]);
    expect(h.commented).toEqual([]);
    expect(h.autonomyRows).toEqual([]);
    expect(document.presses.map((press) => press.outcome)).toEqual(["would-nudge"]);
    expect(document.dispatchable.map((row) => row.number)).toEqual([16378]);
  });

  it("writes no ledger row and leaves the row for a session when `github comment create` fails", async () => {
    const h = harness({ commentExit: 1, pages: onePage({ prs: [stuck()] }) });
    await runGithubLanding({ deps: h.deps, rest: TICK });
    expect(h.reserved).toEqual([`acme/widgets#16378@${HEAD}`]);
    expect(h.autonomyRows).toEqual([]);
    expect(documentOf({ h }).dispatchable.map((row) => row.number)).toEqual([16378]);
  });

  it("SAYS the re-request happened when its ledger row could not be written", async () => {
    const h = harness({ autonomyRefusal: AUTONOMY_FIXTURE_OUTAGE.message, pages: onePage({ prs: [stuck()] }) });
    await runGithubLanding({ deps: h.deps, rest: TICK });
    const press = documentOf({ h }).presses[0]!;
    expect(press.outcome).toBe("nudged");
    expect(
      press.detail.endsWith(
        `could not be written (${AUTONOMY_FIXTURE_OUTAGE.message}) — the owner's briefing will not show it`,
      ),
    ).toBe(true);
  });

  it("re-requests nobody else's pull request — a literal --author login is not the owner's", async () => {
    const h = harness({ pages: onePage({ prs: [stuck()] }) });
    await runGithubLanding({
      deps: h.deps,
      rest: ["--repo", "acme/widgets", "--author", "a-colleague", "--press", "--json"],
    });
    expect(h.commented).toEqual([]);
    expect(documentOf({ h }).presses).toEqual([]);
  });

  it("never re-requests over an opt-out label, which wins the ladder first", async () => {
    const h = harness({ pages: onePage({ prs: [stuck({ labels: ["no-auto-merge"] })] }) });
    await runGithubLanding({ deps: h.deps, rest: TICK });
    expect(h.commented).toEqual([]);
  });

  it("caps one invocation at three re-requests, waiting once, and says which it did not make", async () => {
    const prs = [16378, 16379, 16380, 16381].map((number) =>
      stuck({ number, url: `https://github.com/acme/widgets/pull/${String(number)}` }),
    );
    const h = harness({ pages: onePage({ prs }) });
    await runGithubLanding({ deps: h.deps, rest: TICK });
    expect(h.slept).toEqual([20_000]);
    expect(h.commented).toHaveLength(3);
    expect(documentOf({ h }).presses.map((press) => press.outcome)).toEqual(["nudged", "nudged", "nudged", "failed"]);
  });
});
