/**
 * What a `runGithubLanding` read prints and records: the table, JSON document and readings ledger; the default and
 * `--pr` drill-down output (job logs, changed files, ended pull requests); and the `--if-due` cadence skip.
 */

import { describe, expect, it } from "vitest";
import { runGithubLanding } from "../../../../../../cli/commands/github/landingRun.js";
import { EXIT_ERROR, EXIT_OK } from "../../../../../../cli/exitCodes.js";
import { ok } from "../../../../../../lib/result.js";
import type { JobLogDocument } from "../../../../../../live/github/jobLogRead.js";
import type { PrClosure } from "../../../../../../live/github/prClosure.js";
import type { PrLiveState } from "../../../../../../live/github/reviewState.js";
import type { ReadRecord } from "../../../../../../review/readJournal.js";
import { HEAD, onePage, PASSING, pr } from "./fixtures.js";
import { harness } from "./harness.js";

describe("runGithubLanding", () => {
  it("prints, under --full, a repository header, the table header, one row per pull request and the tally", async () => {
    const h = harness({ pages: onePage({ prs: [pr()] }) });
    const code = await runGithubLanding({ deps: h.deps, rest: ["--repo", "acme/widgets", "--full"] });
    expect(code).toBe(0);
    expect(h.out[0]).toBe("acme/widgets — 1 open");
    expect(h.out[1]).toContain("ACT");
    expect(h.out[2]).toContain("#16378");
    expect(h.out[2]).toContain("press");
    expect(h.out[3]).toBe(
      "          merge-now: every test passed and it is not queued · cr 0 open (0↤ 0↦ 0↩) 0 done · " +
        "hu 0 open (0↤ 0↦ 0↩) 0 done · base +1/-3 · ask in Slack: unknown, chase unknown",
    );
    expect(h.out[5]).toBe("1 open · 1 ready · press 1");
    expect(h.out[6]).toBe("dispatch: merge-now 1 — 1 to spawn, 0 to card");
  });

  it("reads each distinct base branch's queue ONCE, never once per pull request", async () => {
    const h = harness({ pages: onePage({ prs: [pr(), pr({ number: 16379 }), pr({ number: 16380 })] }) });
    await runGithubLanding({ deps: h.deps, rest: ["--repo", "acme/widgets"] });
    expect(h.queueAsked).toEqual(["acme/widgets#staging"]);
  });

  it("says 0 to spawn on the TERMINAL line too once the row was pressed, not just in --json", async () => {
    const h = harness({ pages: onePage({ prs: [pr()] }) });
    await runGithubLanding({ deps: h.deps, rest: ["--repo", "acme/widgets", "--press"] });
    expect(h.out.filter((line) => line.startsWith("dispatch: "))).toEqual([
      "dispatch: merge-now 1 — 0 to spawn, 0 to card",
    ]);
  });

  it("drops a row it just PRESSED from `dispatchable`, so one document never says both", async () => {
    const h = harness({ pages: onePage({ prs: [pr()] }) });
    await runGithubLanding({ deps: h.deps, rest: ["--repo", "acme/widgets", "--press", "--json"] });
    // The whole point: stdout is ONE document, with the child's own prose on the diagnostic channel.
    expect(h.out.length).toBe(1);
    expect(h.diagnostics.some((line) => line.startsWith("enqueue: "))).toBe(true);
    const document = JSON.parse(h.out[0]!) as {
      dispatchable: { number: number }[];
      presses: { number: number; outcome: string }[];
    };
    expect(h.pressed).toEqual(["--pr 16378 --repo acme/widgets"]);
    expect(document.presses.map((press) => `${String(press.number)} ${press.outcome}`)).toStrictEqual([
      "16378 pressed",
    ]);
    expect(document.dispatchable).toStrictEqual([]);
  });

  it("records what the read was taken over on the document, so the last reading names its own bounds", async () => {
    const h = harness({ pages: onePage({ prs: [pr()] }) });
    await runGithubLanding({
      deps: h.deps,
      rest: ["--repo", "acme/widgets,acme/gadgets", "--author", "@me", "--include-drafts", "--json"],
    });
    const document = JSON.parse(h.out[0]!) as {
      selection: { repos: string[]; author?: string; includeDrafts: boolean };
    };
    expect(document.selection).toStrictEqual({
      author: "@me",
      includeDrafts: true,
      repos: ["acme/widgets", "acme/gadgets"],
    });
  });

  it("records an author-less, draft-less read as exactly that — the tick's own shape under --press", async () => {
    const h = harness({ pages: onePage({ prs: [pr()] }) });
    await runGithubLanding({ deps: h.deps, rest: ["--repo", "acme/widgets", "--press", "--json"] });
    const document = JSON.parse(h.out[0]!) as {
      selection: { repos: string[]; author?: string; includeDrafts: boolean };
    };
    expect(document.selection).toStrictEqual({ includeDrafts: false, repos: ["acme/widgets"] });
  });

  it("carries GitHub's own open census per selected repository, every author and drafts in, beside the @me rows", async () => {
    const h = harness({ pages: onePage({ prs: [pr()] }) });
    await runGithubLanding({
      deps: h.deps,
      rest: ["--repo", "acme/widgets,acme/gadgets", "--author", "@me", "--press", "--json"],
    });
    const document = JSON.parse(h.out[0]!) as {
      census: { kind: string; repo: string; totalCount: number; viewer: string; pullRequests: { number: number }[] }[];
    };
    expect(h.censusAsked).toEqual(["acme/widgets", "acme/gadgets"]);
    expect(document.census.map((one) => `${one.repo} ${String(one.totalCount)} ${one.viewer}`)).toStrictEqual([
      "acme/widgets 2 ada",
      "acme/gadgets 2 ada",
    ]);
    expect(document.census[0]!.pullRequests.map((one) => one.number)).toStrictEqual([16378, 9]);
  });

  it("says the live Slack leg was skipped, so --slack-live cannot silently do nothing", async () => {
    const h = harness({ pages: onePage({ prs: [pr()] }) });
    await runGithubLanding({ deps: h.deps, rest: ["--repo", "acme/widgets", "--slack-live", "--full"] });
    expect(
      h.diagnostics.some((line) =>
        line.includes("the live Slack search leg was skipped (--no-slack-live), so nothing posted since the watermark"),
      ),
    ).toBe(true);
  });

  it("refuses a usage error before touching any seam", async () => {
    const h = harness({ pages: onePage({ prs: [] }) });
    const code = await runGithubLanding({ deps: h.deps, rest: ["--dry-run"] });
    expect(code).toBe(2);
    expect(h.queueAsked).toEqual([]);
  });

  it("holds a pull request back when its base branch has no merge queue to press", async () => {
    const h = harness({ pages: onePage({ prs: [pr()] }), queue: { kind: "none" } });
    await runGithubLanding({ deps: h.deps, rest: ["--repo", "acme/widgets"] });
    expect(h.out[2]).toContain("no-queue");
  });

  it("appends the document --json prints to the readings ledger under --record-reading, byte for byte", async () => {
    const h = harness({ pages: onePage({ prs: [pr()] }) });
    const code = await runGithubLanding({
      deps: h.deps,
      rest: ["--repo", "acme/widgets", "--author", "@me", "--json", "--record-reading", "tick-12"],
    });
    expect(code).toBe(EXIT_OK);
    expect(h.readingsRecorded).toEqual([
      { by: "tick-12", document: h.out[0]!, observedAtIso: "2026-09-09T12:30:00.000Z" },
    ]);
    expect(h.diagnostics).toContain("landing: reading recorded as tick-12 (row-1)");
    expect(h.askAppends).toEqual([{ nowIso: "2026-09-09T12:30:00.000Z", rows: [] }]);
    expect(h.diagnostics).toContain("landing: reviewer register took 0 new ask(s)");
  });

  it("carries each row's fact line as `facts` in the --json document, and on its dispatchable copy", async () => {
    const h = harness({ pages: onePage({ prs: [pr()] }) });
    await runGithubLanding({ deps: h.deps, rest: ["--repo", "acme/widgets", "--json"] });
    const document = JSON.parse(h.out[0]!) as {
      rows: readonly { facts: string }[];
      dispatchable: readonly { facts: string }[];
    };
    const line =
      "acme/widgets#16378 merge-now/press · CI green · rabbit none · approved: none · owners: none named · " +
      'asked: unknown · "a change"';
    expect(document.rows.map((row) => row.facts)).toEqual([line]);
    expect(document.dispatchable.map((row) => row.facts)).toEqual([line]);
  });

  it("records no reading when --record-reading is absent", async () => {
    const h = harness({ pages: onePage({ prs: [pr()] }) });
    await runGithubLanding({ deps: h.deps, rest: ["--repo", "acme/widgets", "--json"] });
    expect(h.readingsRecorded).toEqual([]);
    expect(h.askAppends).toEqual([]);
  });

  it.each([
    ["no --author at all", ["--repo", "acme/widgets", "--json", "--record-reading", "land-seat"]],
    ["a colleague's login", ["--repo", "acme/widgets", "--author", "user1-acme", "--record-reading", "x"]],
  ])("refuses --record-reading over %s before any read, so the Queue never draws someone else's", async (_, rest) => {
    const h = harness({ pages: onePage({ prs: [pr()] }) });
    const code = await runGithubLanding({ deps: h.deps, rest });
    expect(code).toBe(2);
    expect(h.out).toEqual([]);
    expect(h.readingsRecorded).toEqual([]);
    expect(h.askAppends).toEqual([]);
  });

  it("keeps its exit and its document when the readings ledger refuses, saying so on stderr", async () => {
    const h = harness({ pages: onePage({ prs: [pr()] }), readingRefusal: "the readings ledger is busy" });
    const code = await runGithubLanding({
      deps: h.deps,
      rest: ["--repo", "acme/widgets", "--author", "@me", "--json", "--record-reading", "tick-12"],
    });
    expect(code).toBe(EXIT_OK);
    expect(h.out.length).toBe(1);
    expect(h.diagnostics).toContain("landing: the reading was not recorded — the readings ledger is busy");
  });

  it("emits one machine-readable document under --json, carrying every row's six tests", async () => {
    const h = harness({ pages: onePage({ prs: [pr()] }) });
    await runGithubLanding({ deps: h.deps, rest: ["--repo", "acme/widgets", "--json"] });
    const document = JSON.parse(h.out[0]!) as {
      rows: { number: number; action: string; tests: { id: string }[] }[];
      tally: { ready: number };
    };
    expect(document.rows.length).toBe(1);
    expect(document.rows[0]!.action).toBe("press");
    expect(document.rows[0]!.tests.map((test) => test.id)).toEqual([
      "undrafted",
      "ci-green",
      "mergeable",
      "threads-clear",
      "codeowners-satisfied",
      "queue-available",
    ]);
    expect(document.tally.ready).toBe(1);
  });
});

/** A failing Actions check whose details URL names run 11, job 22 — the shape `--pr` reads a log for. */
const RED_UNIT = {
  kind: "check-run",
  name: "unit",
  runId: "11",
  state: "failed",
  url: "https://github.com/acme/widgets/actions/runs/11/job/22",
} as const;

/** The job log GitHub serves for {@link RED_UNIT}: one failing test file named. */
const RED_UNIT_LOG: JobLogDocument = {
  jobs: [
    {
      conclusion: "failure",
      failedStep: { conclusion: "failure", name: "Unit", number: 6 },
      htmlUrl: undefined,
      jobId: 22,
      log: {
        annotations: [],
        annotationsDropped: 0,
        closed: true,
        linesTruncated: 0,
        regionLines: 40,
        tail: [],
        testFilePaths: ["src/__tests__/unit/new.test.ts", "src/__tests__/unit/old.test.ts"],
        testFilePathsDropped: 0,
      },
      name: "unit",
    },
  ],
  readAtIso: "2026-09-09T12:30:00.000Z",
  repo: "acme/widgets",
  residue: [],
  run: {
    conclusion: "failure",
    headBranch: "feature/one",
    headSha: HEAD,
    htmlUrl: undefined,
    id: 11,
    name: "CI",
  },
  tailLines: 0,
};

/** A red pull request: {@link RED_UNIT} failed and the rollup says so. */
const redPr = (): PrLiveState =>
  pr({
    checks: { ...pr().checks, checks: [PASSING, RED_UNIT], rollupState: "FAILURE" },
    number: 16379,
    url: "https://github.com/acme/widgets/pull/16379",
  });

const PR_16379_URL = "https://github.com/acme/widgets/pull/16379";
/** GitHub reading the pull request open, which is what lets --pr go on to build its row. */
const OPEN_16379 = new Map<number, PrClosure>([[16379, { state: "OPEN", url: PR_16379_URL }]]);
const MERGED_16379: PrClosure = {
  mergeCommitOid: "4b10e610d0aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  mergedAt: "2026-09-09T12:20:00Z",
  state: "MERGED",
  url: PR_16379_URL,
};

describe("runGithubLanding default and --pr output", () => {
  it("prints one fact line per pull request under its group header by default, and reads no job log", async () => {
    const h = harness({ jobLogs: ok(RED_UNIT_LOG), pages: onePage({ prs: [pr(), redPr()] }) });
    const code = await runGithubLanding({ deps: h.deps, rest: ["--repo", "acme/widgets"] });

    expect(code).toBe(EXIT_OK);
    expect(h.out).toEqual([
      "merge-now — 2",
      "  acme/widgets#16378 merge-now/press · CI green · rabbit none · approved: none · owners: none named · " +
        'asked: unknown · "a change"',
      "  acme/widgets#16379 merge-now/press · required CI clear; advisory red: unit · rabbit none · " +
        'approved: none · owners: none named · asked: unknown · "a change"',
      "2 open · 2 ready · press 2 · advisory-only red, not holding 1",
      "dispatch: merge-now 2 — 2 to spawn, 0 to card",
    ]);
    expect(h.logsAsked).toEqual([]);
    expect(h.filesAsked).toEqual([]);
  });

  it("reads the failing job's log and the file list under --pr, and says which failing file the PR added", async () => {
    const h = harness({
      closures: OPEN_16379,
      jobLogs: ok(RED_UNIT_LOG),
      pages: onePage({ prs: [redPr()] }),
      prFiles: ok({
        complete: true,
        statuses: new Map([
          ["src/__tests__/unit/new.test.ts", "added"],
          ["src/app.ts", "modified"],
        ]),
      }),
    });
    const code = await runGithubLanding({ deps: h.deps, rest: ["--repo", "acme/widgets", "--pr", "16379"] });

    expect(code).toBe(EXIT_OK);
    expect(h.logsAsked).toEqual(["acme/widgets run 11 jobs 22"]);
    expect(h.filesAsked).toEqual(["acme/widgets#16379"]);
    expect(h.out).toContain("    failing test file src/__tests__/unit/new.test.ts — ADDED in this pull request");
    expect(h.out).toContain("    failing test file src/__tests__/unit/old.test.ts — not touched by this pull request");
    expect(h.pressed).toEqual([]);
    expect(h.registered).toEqual([]);
    expect(h.readsRecorded).toEqual([]);
  });

  it("says whether the PR added a failing file is unknown when its file list cannot be read", async () => {
    const h = harness({ closures: OPEN_16379, jobLogs: ok(RED_UNIT_LOG), pages: onePage({ prs: [redPr()] }) });
    await runGithubLanding({ deps: h.deps, rest: ["--repo", "acme/widgets", "--pr", "16379"] });

    expect(h.out).toContain(
      "    failing test file src/__tests__/unit/new.test.ts — whether this pull request touches it is unknown — its " +
        "file list was not read to the end",
    );
    expect(h.out).toContain(
      "  could not read #16379's changed files (this fixture carries no file list), so whether it added each " +
        "failing test file is unknown",
    );
  });

  it("carries only the log bound that touches the path search, never the read's tail-depth note", async () => {
    const [job] = RED_UNIT_LOG.jobs;
    const h = harness({
      closures: OPEN_16379,
      jobLogs: ok({
        ...RED_UNIT_LOG,
        jobs: [{ ...job!, log: { ...job!.log, linesTruncated: 2 } }],
        residue: ["each job reports every annotation it raised in full, and only the last 0 lines of its failing step"],
      }),
      pages: onePage({ prs: [redPr()] }),
      prFiles: ok({ complete: true, statuses: new Map([["src/__tests__/unit/new.test.ts", "added"]]) }),
    });
    await runGithubLanding({ deps: h.deps, rest: ["--repo", "acme/widgets", "--pr", "16379"] });

    expect(h.out).toContain(
      "  2 line(s) of unit's log were longer than 8192 characters, and only their start was searched for failing " +
        "test files",
    );
    expect(h.out.filter((line) => line.includes("only the last 0 lines"))).toEqual([]);
  });

  it("never reads a log for an external CI's URL that only LOOKS like an Actions job", async () => {
    const external = { ...RED_UNIT, url: "https://ci.example.com/acme/widgets/actions/runs/11/job/22" };
    const h = harness({
      closures: OPEN_16379,
      jobLogs: ok(RED_UNIT_LOG),
      pages: onePage({
        prs: [pr({ checks: { ...pr().checks, checks: [PASSING, external], rollupState: "FAILURE" }, number: 16379 })],
      }),
    });
    await runGithubLanding({ deps: h.deps, rest: ["--repo", "acme/widgets", "--pr", "16379"] });

    expect(h.logsAsked).toEqual([]);
    expect(h.out).toContain(
      "    log not read: its details URL is not one of this repository's Actions jobs, so GitHub serves no log for it",
    );
  });

  it("names a check whose log could not be read rather than reporting it clean", async () => {
    const h = harness({ closures: OPEN_16379, pages: onePage({ prs: [redPr()] }) });
    await runGithubLanding({ deps: h.deps, rest: ["--repo", "acme/widgets", "--pr", "16379"] });

    expect(h.out).toContain("    log not read: no workflow run 0 in this repository, or this token cannot see it");
    expect(h.filesAsked).toEqual([]);
  });

  // The defect this pins, MEASURED: a pull request this machine pressed, merged off the queue, read
  // `waiting/pressed-not-queued` under --pr for over an hour, because --pr reads one pull request by number
  // whatever its state and the landing ladder has no ended arm.
  it("reads a pressed pull request GitHub reads MERGED as ended, naming its merge commit, and builds no row", async () => {
    const h = harness({
      closures: new Map([[16379, MERGED_16379]]),
      pages: onePage({ prs: [redPr()] }),
      presses: new Map([["acme/widgets#16379", { atIso: "2026-09-09T12:10:00.000Z", headOid: HEAD }]]),
    });
    const code = await runGithubLanding({ deps: h.deps, rest: ["--repo", "acme/widgets", "--pr", "16379"] });

    expect(code).toBe(EXIT_OK);
    expect(h.out).toEqual([
      "acme/widgets#16379 has ended — https://github.com/acme/widgets/pull/16379 merged at " +
        "4b10e610d0aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa (2026-09-09T12:20:00Z) — so there is nothing to land",
    ]);
    expect(h.closuresAsked).toEqual(["acme/widgets#16379"]);
    expect(h.queueAsked).toEqual([]);
  });

  it("reads a pull request GitHub reads CLOSED as ended, naming when it closed", async () => {
    const closed = { closedAt: "2026-09-09T12:20:00Z", state: "CLOSED", url: PR_16379_URL } as const;
    const h = harness({ closures: new Map([[16379, closed]]), pages: onePage({ prs: [redPr()] }) });
    const code = await runGithubLanding({ deps: h.deps, rest: ["--repo", "acme/widgets", "--pr", "16379"] });

    expect(code).toBe(EXIT_OK);
    expect(h.out).toEqual([
      `acme/widgets#16379 has ended — ${PR_16379_URL} closed unmerged at 2026-09-09T12:20:00Z — so there is nothing to land`,
    ]);
  });

  it("still builds the row when GitHub reads the pull request OPEN", async () => {
    const h = harness({ closures: OPEN_16379, pages: onePage({ prs: [redPr()] }) });
    const code = await runGithubLanding({ deps: h.deps, rest: ["--repo", "acme/widgets", "--pr", "16379"] });

    expect(code).toBe(EXIT_OK);
    expect(h.queueAsked).toEqual(["acme/widgets#staging"]);
    expect(h.out[1]).toBe(PR_16379_URL);
  });

  it("refuses to print a row when whether the pull request is still open could not be read", async () => {
    const h = harness({ pages: onePage({ prs: [redPr()] }) });
    const code = await runGithubLanding({ deps: h.deps, rest: ["--repo", "acme/widgets", "--pr", "16379"] });

    expect(code).toBe(EXIT_ERROR);
    expect(h.out).toEqual([]);
    expect(h.diagnostics).toContain(
      "landing: could not read whether acme/widgets#16379 is still open, so no landing row is printed for it: " +
        "GitHub answered 502",
    );
  });

  it("refuses --pr beside a write flag before touching any seam", async () => {
    const h = harness({ pages: onePage({ prs: [redPr()] }) });
    const code = await runGithubLanding({
      deps: h.deps,
      rest: ["--repo", "acme/widgets", "--pr", "16379", "--press"],
    });

    expect(code).toBe(2);
    expect(h.diagnostics[0]).toBe("--pr cannot be combined with --press: --pr is a read-only drill-down into one row");
    expect(h.logsAsked).toEqual([]);
  });
});

describe("runGithubLanding --if-due", () => {
  /** The key `readJournal.ts` files this test's selection under. */
  const SELECTION = "acme/widgets@*";

  const recorded = ({ atIso }: { atIso: string }): ReadonlyMap<string, ReadRecord> =>
    new Map([[SELECTION, { atIso, dispatchable: 1, rows: 1, selection: SELECTION }]]);

  it("reads when nothing is recorded, and records the read it made", async () => {
    const h = harness({ pages: onePage({ prs: [pr()] }) });
    const code = await runGithubLanding({ deps: h.deps, rest: ["--repo", "acme/widgets", "--if-due"] });
    expect(code).toBe(0);
    expect(h.readsRecorded).toEqual([
      { atIso: "2026-09-09T12:30:00.000Z", dispatchable: 1, rows: 1, selection: SELECTION },
    ]);
  });

  it("makes NO fleet read at all inside the cadence, which is what lets a sweep run it every tick", async () => {
    const h = harness({
      pages: onePage({ prs: [pr()] }),
      reads: recorded({ atIso: "2026-09-09T12:20:00.000Z" }),
    });
    const code = await runGithubLanding({ deps: h.deps, rest: ["--repo", "acme/widgets", "--if-due"] });
    expect(code).toBe(0);
    expect(h.queueAsked).toEqual([]);
    expect(h.out).toEqual([
      "landing: not due — acme/widgets@* was read 10 minute(s) ago and the cadence is 30 minute(s), so this " +
        "tick makes no GitHub request. Next due 2026-09-09T12:50:00.000Z",
    ]);
  });

  it("records NOTHING on a skipped tick, so a skip cannot extend its own window", async () => {
    const h = harness({
      pages: onePage({ prs: [pr()] }),
      reads: recorded({ atIso: "2026-09-09T12:20:00.000Z" }),
    });
    await runGithubLanding({ deps: h.deps, rest: ["--repo", "acme/widgets", "--if-due"] });
    expect(h.readsRecorded).toEqual([]);
    expect(h.censusAsked).toEqual([]);
  });

  it("emits a `skipped` document under --json, never an empty read a consumer would read as `all clear`", async () => {
    const h = harness({
      pages: onePage({ prs: [pr()] }),
      reads: recorded({ atIso: "2026-09-09T12:20:00.000Z" }),
    });
    await runGithubLanding({ deps: h.deps, rest: ["--repo", "acme/widgets", "--if-due", "--json"] });
    expect(JSON.parse(h.out[0]!)).toEqual({
      cadenceMinutes: 30,
      kind: "skipped",
      lastReadAtIso: "2026-09-09T12:20:00.000Z",
      nextDueAtIso: "2026-09-09T12:50:00.000Z",
      selection: SELECTION,
      why:
        "acme/widgets@* was read 10 minute(s) ago and the cadence is 30 minute(s), so this tick makes no " +
        "GitHub request",
    });
  });

  it("marks a real read `read`, so the two documents are told apart by a field rather than by shape", async () => {
    const h = harness({ pages: onePage({ prs: [pr()] }) });
    await runGithubLanding({ deps: h.deps, rest: ["--repo", "acme/widgets", "--if-due", "--json"] });
    expect(JSON.parse(h.out[0]!).kind).toBe("read");
  });

  it("reads once the cadence the caller chose has elapsed", async () => {
    const h = harness({
      pages: onePage({ prs: [pr()] }),
      reads: recorded({ atIso: "2026-09-09T12:20:00.000Z" }),
    });
    await runGithubLanding({
      deps: h.deps,
      rest: ["--repo", "acme/widgets", "--if-due", "--cadence-minutes", "5"],
    });
    expect(h.readsRecorded).toHaveLength(1);
  });

  it("records nothing when the fleet read FAILED, so the next tick retries rather than inheriting the window", async () => {
    const h = harness({ pages: [] });
    const code = await runGithubLanding({ deps: h.deps, rest: ["--repo", "acme/widgets", "--if-due"] });
    expect(code).toBe(1);
    expect(h.readsRecorded).toEqual([]);
  });

  it("REFUSES --cadence-minutes without --if-due, which would otherwise read as a cadence nobody applied", async () => {
    const h = harness({ pages: onePage({ prs: [pr()] }) });
    const code = await runGithubLanding({
      deps: h.deps,
      rest: ["--repo", "acme/widgets", "--cadence-minutes", "5"],
    });
    expect(code).toBe(2);
    expect(h.diagnostics[0]).toBe("--cadence-minutes sets how long a --if-due read holds, so it needs --if-due");
  });

  it("REFUSES a cadence past seven days by name, rather than crashing on an unrenderable next-due", async () => {
    const h = harness({ pages: onePage({ prs: [pr()] }) });
    const code = await runGithubLanding({
      deps: h.deps,
      rest: ["--repo", "acme/widgets", "--if-due", "--cadence-minutes", "999999999999"],
    });
    expect(code).toBe(2);
    expect(h.diagnostics[0]).toBe(
      "--cadence-minutes 999999999999 is longer than the 10080-minute maximum (seven days) — past that the " +
        "cadence stops rationing the read and starts suppressing it",
    );
    expect(h.readsRecorded).toEqual([]);
  });

  it("ACCEPTS the seven-day maximum itself, so the refusal bounds rather than forbids a long window", async () => {
    const h = harness({
      pages: onePage({ prs: [pr()] }),
      reads: recorded({ atIso: "2026-09-09T12:20:00.000Z" }),
    });
    const code = await runGithubLanding({
      deps: h.deps,
      rest: ["--repo", "acme/widgets", "--if-due", "--cadence-minutes", "10080"],
    });
    expect(code).toBe(0);
    expect(h.out).toEqual([
      "landing: not due — acme/widgets@* was read 10 minute(s) ago and the cadence is 10080 minute(s), so " +
        "this tick makes no GitHub request. Next due 2026-09-16T12:20:00.000Z",
    ]);
  });
});
