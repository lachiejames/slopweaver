/**
 * The recent-runs timeline: the owner's clock with no zone and no ISO, a failure flagged with its own error, how long each
 * took, and what each pulled in — a Linear team as "the MX team", a channel by name, never an id, with the kinds and
 * counts behind a hover.
 *
 * Brisbane keeps no daylight saving, so every expected clock below is the instant plus ten hours.
 */
import { describe, expect, it } from "vitest";

import type { FiringOutput } from "../../components/live/readAutomationDetail";
import type { Firing } from "../../components/live/readAutomationsFiring";
import type { CardSyncRun, SyncContainer } from "../../components/live/readAutomationsSyncRun";
import { clockWords, firingBullets, syncRunBullets } from "../../lib/runTimeline";

const ZONE = "Australia/Brisbane";
/** Monday the fifth, at noon in Brisbane. */
const NOW = "2026-10-05T02:00:00.000Z";

const container = ({ label, written }: { label: string; written: number }): SyncContainer => ({
  container: label,
  kinds: {},
  label,
  offered: written,
  written,
});

const syncRun = (over: Partial<CardSyncRun>): CardSyncRun => ({
  committedWritten: 0,
  containers: [],
  elapsedMs: 600_000,
  errors: [],
  finishedAtIso: undefined,
  gaps: 0,
  lastActivityIso: undefined,
  ledgerFailures: 0,
  malformedLines: 0,
  newByKind: {},
  progress: undefined,
  progressRate: undefined,
  quietContainers: [],
  quietForMs: undefined,
  runId: "r",
  said: undefined,
  source: "linear",
  stalled: false,
  startedAtIso: "2026-10-04T23:14:00.000Z",
  state: "finished",
  why: "finished",
  writtenRate: undefined,
  ...over,
});

const firing = (over: Partial<Firing>): Firing => ({
  attempt: 1,
  detail: undefined,
  outcome: "succeeded",
  plainly: undefined,
  reason: undefined,
  runMs: 150_000,
  said: undefined,
  settledAtIso: "2026-10-04T23:16:30.000Z",
  slotIso: "2026-10-04T23:00:00.000Z",
  startedAtIso: "2026-10-04T23:14:00.000Z",
  underWay: false,
  ...over,
});

describe("clockWords", () => {
  it("says today, yesterday, or the weekday and date, then the time — never a zone or an ISO", () => {
    expect([
      clockWords({ iso: "2026-10-04T23:14:00.000Z", nowIso: NOW, timeZone: ZONE }),
      clockWords({ iso: "2026-10-04T13:02:00.000Z", nowIso: NOW, timeZone: ZONE }),
      clockWords({ iso: "2026-10-02T18:00:00.000Z", nowIso: NOW, timeZone: ZONE }),
    ]).toEqual(["today 9:14 am", "yesterday 11:02 pm", "Sat 3 Oct 4:00 am"]);
  });

  it("decides today in the owner's zone, not UTC's: 11 pm UTC on the 4th is the morning of the 5th in Brisbane", () => {
    expect(clockWords({ iso: "2026-10-04T23:00:00.000Z", nowIso: NOW, timeZone: ZONE })).toBe("today 9:00 am");
  });
});

describe("syncRunBullets", () => {
  it("flags a failed run with its own error, how long it took, and what it stored — kinds most first, teams named", () => {
    const failed = syncRun({
      committedWritten: 194,
      containers: [
        container({ label: "linear/HELP", written: 37 }),
        container({ label: "linear/MX", written: 88 }),
        container({ label: "linear/CHT", written: 13 }),
        container({ label: "linear/GROW", written: 19 }),
      ],
      elapsedMs: 607_324,
      errors: ["linear customerNeeds lane unavailable: Customer requests are not available in this workspace."],
      newByKind: { comment: 96, issue: 95, milestone: 2, project: 1 },
      runId: "failed-run",
      said: "linear customerNeeds lane unavailable: Customer requests are not available in this workspace.",
      state: "failed",
    });

    expect(syncRunBullets({ nowIso: NOW, runs: [failed], timeZone: ZONE })).toEqual([
      {
        atIso: "2026-10-04T23:14:00.000Z",
        // A provider's words are never lifted as the line, since a runtime's message reads as English too.
        error: "It failed with a technical error.",
        errorDetail: "linear customerNeeds lane unavailable: Customer requests are not available in this workspace.",
        headline: "Failed",
        key: "failed-run",
        pulled: "194 new · most in the MX team",
        pulledDetail:
          "96 replies, 95 issues, 2 milestones, 1 project · the MX team 88, the HELP team 37, the GROW team 19, the CHT team 13",
        took: "took 10 minutes",
        tone: "failed",
        when: "today 9:14 am",
      },
    ]);
  });

  it("names no id: a page uuid and the source's own name are left out of where the rows landed", () => {
    const notion = syncRun({
      committedWritten: 400,
      containers: [
        container({ label: "notion", written: 300 }),
        container({ label: "notion/8da1edfc-9313-46e2-b3a3-13fe4fa140ff", written: 59 }),
        container({ label: "notion/Engineering", written: 41 }),
      ],
      newByKind: { page: 400 },
      source: "notion",
    });

    const [bullet] = syncRunBullets({ nowIso: NOW, runs: [notion], timeZone: ZONE });

    expect([bullet.pulled, bullet.pulledDetail]).toEqual([
      "400 new · most in Engineering",
      "400 pages · Engineering 41",
    ]);
  });

  it("calls only an exact linear/<KEY> container a team, and keeps the kinds on hover when no container names", () => {
    const github = syncRun({
      committedWritten: 9,
      containers: [container({ label: "acme/linear", written: 9 })],
      newByKind: { pr: 9 },
      source: "github",
    });
    const unnamed = syncRun({
      committedWritten: 5,
      containers: [container({ label: "linear", written: 5 })],
      newByKind: { project: 5 },
    });

    const bullets = syncRunBullets({ nowIso: NOW, runs: [github, unnamed], timeZone: ZONE });

    expect(bullets.map((bullet) => [bullet.pulled, bullet.pulledDetail])).toEqual([
      ["9 new · most in linear", "9 pull requests · linear 9"],
      ["5 new", "5 projects"],
    ]);
  });

  it("orders newest first, says a quiet run pulled nothing new with nothing to hover, and a running one how long so far", () => {
    const quiet = syncRun({ runId: "quiet", startedAtIso: "2026-10-04T13:02:00.000Z" });
    const running = syncRun({ elapsedMs: 180_000, runId: "running", state: "running" });

    const bullets = syncRunBullets({ nowIso: NOW, runs: [quiet, running], timeZone: ZONE });

    expect(
      bullets.map((bullet) => [bullet.key, bullet.tone, bullet.took, bullet.pulled, bullet.pulledDetail, bullet.error]),
    ).toEqual([
      ["running", "running", "running 3 minutes so far", "nothing new", undefined, undefined],
      ["quiet", "ok", "took 10 minutes", "nothing new", undefined, undefined],
    ]);
  });

  it("reads a run killed partway as a failure, with the verb's plain words for it", () => {
    const killed = syncRun({
      runId: "killed",
      said: "It was stopped or crashed before it finished.",
      state: "ended-unfinished",
    });

    expect(syncRunBullets({ nowIso: NOW, runs: [killed], timeZone: ZONE })[0]).toMatchObject({
      error: "It was stopped or crashed before it finished.",
      headline: "Stopped partway",
      tone: "failed",
    });
  });

  it("never draws the raw error or the run's sentence above the fold, yet never leaves a failure with no line", () => {
    const bare = syncRun({
      errors: ["`slopweaver atlas vanta sync` exited 1"],
      runId: "bare",
      state: "failed",
      why: "finished at 2026-10-04T23:24:00.000Z and failed: `slopweaver atlas vanta sync` exited 1",
    });
    const silent = syncRun({ runId: "silent", state: "failed" });

    expect(
      syncRunBullets({ nowIso: NOW, runs: [bare, silent], timeZone: ZONE }).map((bullet) => [
        bullet.key,
        bullet.error,
        bullet.errorDetail,
      ]),
    ).toEqual([
      ["bare", "Its command stopped with an error and gave no reason.", "`slopweaver atlas vanta sync` exited 1"],
      ["silent", "It failed without giving an error message.", undefined],
    ]);
  });

  it("never leads with a stack trace or a JSON body its words carried: a plain line leads, the stored error folds", () => {
    const stack =
      "TypeError: cannot read properties of undefined\n    at read (/srv/a.js:1:2)\n    at run (/srv/b.js:3:4)";
    // A body carrying only its status and that status's own phrase, so the code is its cause.
    const json = '{"status":503,"error":"service unavailable"}';
    const traced = syncRun({ errors: [stack], runId: "traced", said: stack, state: "failed" });
    const bodied = syncRun({ errors: [`GET /x: ${json}`], runId: "bodied", said: json, state: "failed" });

    expect(
      syncRunBullets({ nowIso: NOW, runs: [traced, bodied], timeZone: ZONE }).map((bullet) => [
        bullet.key,
        bullet.error,
        bullet.errorDetail,
      ]),
    ).toEqual([
      ["traced", "It failed with a technical error.", stack],
      ["bodied", "The service hit an error and could not answer.", `GET /x: ${json}`],
    ]);
  });

  it("never prints a state it has no words for as the headline: a plain one leads in red, the stored state folds", () => {
    const unknown = syncRun({ runId: "unknown", state: "failed-provider-auth", why: "provider sign-in was refused" });

    expect(
      syncRunBullets({ nowIso: NOW, runs: [unknown], timeZone: ZONE }).map((bullet) => [
        bullet.headline,
        bullet.tone,
        bullet.error,
        bullet.errorDetail,
      ]),
    ).toEqual([
      [
        "In a state this page does not know yet",
        "failed",
        undefined,
        "Its recorded state: failed-provider-auth\nprovider sign-in was refused",
      ],
    ]);
  });

  it("keeps an unknown state's only reason under the fold, never saying it gave none", () => {
    const why = "SyntaxError: Unexpected token '<'";
    const unknown = syncRun({ errors: ["GET /x: 502"], state: "failed-provider-auth", why });

    expect(
      syncRunBullets({ nowIso: NOW, runs: [unknown], timeZone: ZONE }).map((bullet) => [
        bullet.error,
        bullet.errorDetail,
      ]),
    ).toEqual([[undefined, `Its recorded state: failed-provider-auth\n${why}\nGET /x: 502`]]);
  });
});

describe("firingBullets", () => {
  const filed: FiringOutput = {
    finding: { settlement: undefined, slug: "fix-row", status: "draft", summary: undefined },
    findingNote: undefined,
    posting: undefined,
    postingNote: undefined,
    postingUnreadable: undefined,
    slotIso: "2026-10-04T23:00:00.000Z",
  };

  it("flags a failed firing with its plain words — never the runner's framing — and what it left behind, and a deferral as waited and untimed", () => {
    const failed = firing({ outcome: "failed", reason: "exit 1: refresh: no token", said: "refresh: no token" });
    const deferred = firing({
      outcome: "deferred",
      reason: "the Linear token is not set",
      runMs: undefined,
      said: "the Linear token is not set",
      settledAtIso: "2026-10-04T13:02:05.000Z",
      slotIso: "2026-10-04T13:00:00.000Z",
      startedAtIso: "2026-10-04T13:02:00.000Z",
    });

    const bullets = firingBullets({ firings: [deferred, failed], nowIso: NOW, outputs: [filed], timeZone: ZONE });

    expect(bullets).toEqual([
      {
        atIso: "2026-10-04T23:14:00.000Z",
        error: "It failed with a technical error.",
        errorDetail: "exit 1: refresh: no token",
        headline: "Failed",
        key: "2026-10-04T23:00:00.000Z-1",
        pulled: "put a fix on the board",
        pulledDetail: undefined,
        took: "took 3 minutes",
        tone: "failed",
        when: "today 9:14 am",
      },
      {
        atIso: "2026-10-04T13:02:00.000Z",
        // A deferral did not fail, so no failure sentence leads it; its reason folds under "Waited".
        error: undefined,
        errorDetail: "the Linear token is not set",
        headline: "Waited",
        key: "2026-10-04T13:00:00.000Z-1",
        pulled: undefined,
        pulledDetail: undefined,
        took: undefined,
        tone: "waited",
        when: "yesterday 11:02 pm",
      },
    ]);
  });

  it("never leads an unexplained firing with a stack trace or a JSON body: a plain line leads, its record folds", () => {
    const stack = "Error: socket hang up\n    at connect (/srv/net.js:5:6)";
    const json = '{"ok":false,"error":"invalid_grant"}';
    const traced = firing({ detail: `exit 1: ${stack}`, outcome: "failed", reason: "exit 1", said: stack });
    const bodied = firing({
      outcome: "dead",
      reason: `exit 2: ${json}`,
      said: json,
      slotIso: "2026-10-04T22:00:00.000Z",
    });

    expect(
      firingBullets({ firings: [traced, bodied], nowIso: NOW, outputs: [], timeZone: ZONE }).map((bullet) => [
        bullet.error,
        bullet.errorDetail,
      ]),
    ).toEqual([
      ["It failed with a technical error.", `exit 1: ${stack}`],
      ["The service turned down its sign-in.", `exit 2: ${json}`],
    ]);
  });

  it("says a failed firing that left no words off its record, folded whole, never a bare red headline", () => {
    const bare = firing({ outcome: "failed", reason: "slopweaver atlas vanta sync exited 1" });

    expect(
      firingBullets({ firings: [bare], nowIso: NOW, outputs: [], timeZone: ZONE }).map((bullet) => [
        bullet.error,
        bullet.errorDetail,
      ]),
    ).toEqual([["Its command stopped with an error and gave no reason.", "slopweaver atlas vanta sync exited 1"]]);
  });

  it("never prints an outcome it has no words for as the headline: the stored outcome folds above its record", () => {
    const unknown = firing({ detail: "exit 3: gone", outcome: "abandoned-by-host", reason: "exit 3", said: "gone" });

    expect(
      firingBullets({ firings: [unknown], nowIso: NOW, outputs: [], timeZone: ZONE }).map((bullet) => [
        bullet.headline,
        bullet.tone,
        bullet.error,
        bullet.errorDetail,
      ]),
    ).toEqual([
      // Coloured as a failure, but nothing shows it failed, so no failure sentence leads it.
      [
        "In a state this page does not know yet",
        "failed",
        undefined,
        "Its recorded state: abandoned-by-host\nexit 3: gone",
      ],
    ]);
  });

  it("leads a failed firing with its plain cause when one is known, and folds its whole raw record under it", () => {
    const plainly = "The service turned down its sign-in. Reconnecting that service in Setup fixes it.";
    const detail =
      'recipe acme · ran · slopweaver foo · exit 1 · why: GET /x: {"status":401,"message":"bad credentials"}';
    const withDetail = firing({ detail, outcome: "failed", plainly, reason: "GET /x: 401", said: "bad credentials" });
    const reasonOnly = firing({
      outcome: "failed",
      plainly,
      reason: "exit 1: linear read: HTTP 401",
      said: "HTTP 401",
    });

    const bullets = firingBullets({ firings: [withDetail, reasonOnly], nowIso: NOW, outputs: [], timeZone: ZONE });

    expect(bullets.map((bullet) => [bullet.error, bullet.errorDetail])).toEqual([
      [plainly, detail],
      [plainly, "exit 1: linear read: HTTP 401"],
    ]);
  });

  it("says the verb's run time for a firing still open and a finished one, and carries no error for a success", () => {
    const open = firing({
      outcome: "open",
      runMs: 1_800_000,
      settledAtIso: undefined,
      startedAtIso: "2026-10-05T01:30:00.000Z",
      underWay: true,
    });
    const ok = firing({ reason: undefined });

    const bullets = firingBullets({ firings: [ok, open], nowIso: NOW, outputs: [], timeZone: ZONE });

    expect(bullets.map((bullet) => [bullet.tone, bullet.took, bullet.error])).toEqual([
      ["running", "running 30 minutes so far", undefined],
      ["ok", "took 3 minutes", undefined],
    ]);
  });

  it("never calls an open firing Running when a later run has finished, and gives it no time", () => {
    const stranded = firing({
      outcome: "open",
      runMs: undefined,
      settledAtIso: undefined,
      slotIso: "2026-10-04T13:00:00.000Z",
      startedAtIso: "2026-10-04T13:02:00.000Z",
    });
    const later = firing({});

    const bullets = firingBullets({ firings: [later, stranded], nowIso: NOW, outputs: [], timeZone: ZONE });

    expect(bullets.map((bullet) => [bullet.headline, bullet.tone, bullet.took])).toEqual([
      ["Finished", "ok", "took 3 minutes"],
      ["Never finished", "waited", undefined],
    ]);
  });
});
