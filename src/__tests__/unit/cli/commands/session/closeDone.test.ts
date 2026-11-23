/**
 * `session close-done` — the parse boundary, and the whole sweep run over a fake cmux client against a real
 * temp ledger, a real temp run journal and a real temp board: the socket is the only thing faked, and it is a
 * plain object that records what it was asked to close, never a mock.
 */
import { appendFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";

import { closeDoneWithClient, runSessionCloseDone } from "../../../../../cli/commands/session/closeDone.js";
import { renderGoneSeat } from "../../../../../cli/commands/session/closeDoneFleet.js";
import { parkCandidate } from "../../../../../cli/commands/session/closeDonePark.js";
import type { ParkSeatDeps } from "../../../../../cli/commands/session/closeDoneParkLook.js";
import { type CloseDoneSwept, closeDoneSummary } from "../../../../../cli/commands/session/closeDonePrint.js";
import {
  bareShellReason,
  type CloseDoneShellOutcome,
  renderShellOutcome,
} from "../../../../../cli/commands/session/closeDoneShells.js";
import { EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import type { CmuxClient, CmuxProcess, CmuxWorkspaceSummary } from "../../../../../cmux/client.js";
import { CmuxErrors } from "../../../../../cmux/errors.js";
import { dispatchSessionName, dispatchWorkspaceName } from "../../../../../cmux/planNames.js";
import type { LiveSessionStart } from "../../../../../fleet/goneSeats.js";
import { acquireFleetLock } from "../../../../../fleet/locks.js";
import type { FleetPort } from "../../../../../fleet/port.js";
import type { FleetAttemptOutcome } from "../../../../../fleet/resumePlan.js";
import { resumeFinishLine } from "../../../../../fleet/resumeShell.js";
import { appendRunEvent, readRunJournal, runJournalPath } from "../../../../../handover/runStore.js";
import { err, ok, type Result, unwrap } from "../../../../../lib/result.js";
import { appendAskLifecycleEvent } from "../../../../../live/ask/store.js";
import { type CloseDoneOutcome, renderCloseDoneSummary } from "../../../../../sessions/closeDoneOutcome.js";
import type { SessionRecord } from "../../../../../sessions/liveSessions.js";
import { appendSessionEvent, readSessionLogText } from "../../../../../sessions/sessionStore.js";
import { fakeClient, fakeResidue, LAUNCHD } from "./closeDoneFakeCmux.js";
import {
  argv,
  CLAUDE_IDLE,
  deps,
  errorOf,
  home,
  NOW,
  openKeys,
  outcomesOf,
  reclaimOf,
  registry,
  removeFixtureDirs,
  residueOf,
  run,
  SPAWNED_AT,
  sessionRecord,
  spawnedRow,
  workspace,
  writeDoc,
} from "./closeDoneHarness.js";
import {
  AT_REST,
  changing,
  PARKED_DIR,
  parkedFixture,
  predecessorPark,
  SEAT,
  SEAT_TREE,
} from "./closeDoneParkFixture.js";

afterEach(removeFixtureDirs);

describe("session close-done (parse)", () => {
  it("prints usage on --help without opening a socket", async () => {
    expect(await runSessionCloseDone(argv({ rest: ["--help"] }))).toBe(EXIT_OK);
  });

  it("rejects a flag it does not accept before its act phase", async () => {
    expect(await runSessionCloseDone(argv({ rest: ["--workspace", "workspace:1"] }))).toBe(EXIT_USAGE);
  });
});

describe("closeDoneWithClient", () => {
  it("closes a finished, idle workspace and its ledger row, and leaves an open one alone", async () => {
    const fixture = home();
    spawnedRow({ home: fixture.home, slug: "finished-doc", workspaceRef: "workspace:1" });
    spawnedRow({ home: fixture.home, slug: "working-doc", workspaceRef: "workspace:2" });
    run({ finished: true, home: fixture.home, slug: "finished-doc" });
    run({ finished: false, home: fixture.home, slug: "working-doc" });
    const fake = fakeClient({
      screens: { "id-1": CLAUDE_IDLE, "id-2": "esc to interrupt" },
      workspaces: [
        workspace({ currentDirectory: "/w/.claude/worktrees/finished-doc" }),
        workspace({
          currentDirectory: "/w/.claude/worktrees/working-doc",
          workspaceId: "id-2",
          workspaceRef: "workspace:2",
        }),
      ],
    });
    const swept = await closeDoneWithClient({ deps: deps({ client: fake.client, fixture }) });
    const outcomes = outcomesOf(swept);
    expect(outcomes.map((outcome) => outcome.kind)).toEqual(["park-kept", "closed"]);
    expect(fake.closed).toEqual(["id-1"]);
    expect(openKeys({ home: fixture.home })).toEqual(["working-doc"]);
  });

  it("reclaims nothing at all under --keep-worktrees, however many seats it closed", async () => {
    const fixture = home();
    spawnedRow({ home: fixture.home, slug: "finished-doc", workspaceRef: "workspace:1" });
    run({ finished: true, home: fixture.home, slug: "finished-doc" });
    const fake = fakeClient({
      screens: { "id-1": CLAUDE_IDLE },
      workspaces: [workspace({ currentDirectory: "/w/.claude/worktrees/finished-doc" })],
    });
    const swept = await closeDoneWithClient({
      deps: deps({ client: fake.client, fixture, keepWorktrees: true }),
    });
    expect(outcomesOf(swept).map((outcome) => outcome.kind)).toEqual(["closed"]);
    expect(reclaimOf(swept)).toEqual({ outcomes: [], refusal: null });
  });

  it("never forces a finished seat whose idle-looking screen shows no Claude prompt (clear; sleep 1000)", async () => {
    const fixture = home();
    spawnedRow({ home: fixture.home, slug: "finished-doc", workspaceRef: "workspace:1" });
    run({ finished: true, home: fixture.home, slug: "finished-doc" });
    const fake = fakeClient({
      screens: { "id-1": "" },
      workspaces: [workspace({ currentDirectory: "/w/.claude/worktrees/finished-doc" })],
    });
    const swept = await closeDoneWithClient({ deps: deps({ client: fake.client, fixture }) });
    expect(outcomesOf(swept).map((outcome) => outcome.kind)).toEqual(["close-failed"]);
    expect(fake.closed).toEqual([]);
  });

  it("judges each closed seat's worktree, and touches nothing outside a declared main checkout", async () => {
    const fixture = home();
    spawnedRow({ home: fixture.home, slug: "finished-doc", workspaceRef: "workspace:1" });
    run({ finished: true, home: fixture.home, slug: "finished-doc" });
    const fake = fakeClient({
      screens: { "id-1": CLAUDE_IDLE },
      workspaces: [workspace({ currentDirectory: "/w/.claude/worktrees/finished-doc" })],
    });
    const swept = await closeDoneWithClient({
      deps: deps({ client: fake.client, fixture, keepWorktrees: false }),
    });
    const reclaimed = reclaimOf(swept);
    expect(reclaimed.refusal).toBeNull();
    expect(reclaimed.outcomes).toEqual([
      {
        name: "finished-doc",
        path: "/w/.claude/worktrees/finished-doc",
        reason: "it is not a worktree of any declared main checkout — nothing here touches it",
        removed: false,
      },
    ]);
  });

  it("reclaims NOTHING when the live workspace list cannot be re-read after the closes", async () => {
    const fixture = home();
    spawnedRow({ home: fixture.home, slug: "finished-doc", workspaceRef: "workspace:1" });
    run({ finished: true, home: fixture.home, slug: "finished-doc" });
    const fake = fakeClient({
      listFailsAfter: 2,
      screens: { "id-1": CLAUDE_IDLE },
      workspaces: [workspace({ currentDirectory: "/w/.claude/worktrees/finished-doc" })],
    });
    const swept = await closeDoneWithClient({
      deps: deps({ client: fake.client, fixture, keepWorktrees: false }),
    });
    const reclaimed = reclaimOf(swept);
    expect(reclaimed.outcomes).toEqual([]);
    expect(reclaimed.refusal).toContain("the live workspace list could not be re-read");
    expect(reclaimed.refusal).toContain("no worktree was reclaimed");
  });

  // A closed seat's nx daemon, detached to launchd, is reaped with the close — under
  // --keep-worktrees too, because the daemon is a process and the flag is about the tree.
  it("reaps an orphaned nx daemon rooted in a closed seat's worktree, even keeping the worktree", async () => {
    const fixture = home();
    spawnedRow({ home: fixture.home, slug: "finished-doc", workspaceRef: "workspace:1" });
    run({ finished: true, home: fixture.home, slug: "finished-doc" });
    const fake = fakeClient({
      screens: { "id-1": CLAUDE_IDLE },
      workspaces: [workspace({ currentDirectory: "/w/.claude/worktrees/finished-doc" })],
    });
    const residue = fakeResidue({
      mainCheckouts: ["/w"],
      processes: [
        LAUNCHD,
        {
          argv: "node /w/.claude/worktrees/finished-doc/node_modules/nx/src/daemon/server/start.js",
          pid: 500,
          ppid: 1,
        },
      ],
    });
    const swept = await closeDoneWithClient({
      deps: deps({ client: fake.client, fixture, keepWorktrees: true, residue: residue.residue }),
    });
    expect(residue.signalled).toEqual([500]);
    expect(residueOf(swept).seats.map((seat) => seat.killed)).toEqual([[500]]);
  });

  it("leaves a closed seat's daemon alone while another live workspace still holds the tree, from a subdirectory", async () => {
    const fixture = home();
    spawnedRow({ home: fixture.home, slug: "finished-doc", workspaceRef: "workspace:1" });
    run({ finished: true, home: fixture.home, slug: "finished-doc" });
    const fake = fakeClient({
      screens: { "id-1": CLAUDE_IDLE },
      workspaces: [
        workspace({ currentDirectory: "/w/.claude/worktrees/finished-doc" }),
        workspace({
          currentDirectory: "/w/.claude/worktrees/finished-doc/apps/web",
          workspaceId: "id-2",
          workspaceRef: "workspace:2",
        }),
      ],
    });
    const residue = fakeResidue({
      mainCheckouts: ["/w"],
      processes: [
        LAUNCHD,
        {
          argv: "node /w/.claude/worktrees/finished-doc/node_modules/nx/src/daemon/server/start.js",
          pid: 500,
          ppid: 1,
        },
      ],
    });
    const swept = await closeDoneWithClient({ deps: deps({ client: fake.client, fixture, residue: residue.residue }) });
    expect(fake.closed).toEqual(["id-1"]);
    expect(residue.signalled).toEqual([]);
    expect(residueOf(swept).seats.map((seat) => seat.judged)).toEqual([
      { kind: "left-alone", why: "still held by live workspace workspace:2" },
    ]);
  });

  it("plans the reap on a dry run and signals nothing", async () => {
    const fixture = home();
    spawnedRow({ home: fixture.home, slug: "finished-doc", workspaceRef: "workspace:1" });
    run({ finished: true, home: fixture.home, slug: "finished-doc" });
    const fake = fakeClient({
      screens: { "id-1": CLAUDE_IDLE },
      workspaces: [workspace({ currentDirectory: "/w/.claude/worktrees/finished-doc" })],
    });
    const residue = fakeResidue({
      mainCheckouts: ["/w"],
      processes: [
        LAUNCHD,
        {
          argv: "node /w/.claude/worktrees/finished-doc/node_modules/nx/src/daemon/server/start.js",
          pid: 500,
          ppid: 1,
        },
      ],
    });
    const swept = await closeDoneWithClient({
      deps: deps({ client: fake.client, dryRun: true, fixture, residue: residue.residue }),
    });
    expect(residue.signalled).toEqual([]);
    const [seat] = residueOf(swept).seats;
    expect(seat!.judged.kind).toBe("planned");
    expect(seat!.killed).toEqual([]);
  });

  it("holds a finished workspace whose screen is mid-turn, and one whose screen cannot be read", async () => {
    const fixture = home();
    spawnedRow({ home: fixture.home, slug: "busy-doc", workspaceRef: "workspace:1" });
    spawnedRow({ home: fixture.home, slug: "dark-doc", workspaceRef: "workspace:2" });
    run({ finished: true, home: fixture.home, slug: "busy-doc" });
    run({ finished: true, home: fixture.home, slug: "dark-doc" });
    const fake = fakeClient({
      screens: { "id-1": "Working… (esc to interrupt)" },
      workspaces: [
        workspace({ currentDirectory: "/w/.claude/worktrees/busy-doc" }),
        workspace({
          currentDirectory: "/w/.claude/worktrees/dark-doc",
          workspaceId: "id-2",
          workspaceRef: "workspace:2",
        }),
      ],
    });
    const swept = await closeDoneWithClient({ deps: deps({ client: fake.client, fixture }) });
    const outcomes = outcomesOf(swept);
    expect(outcomes.map((outcome) => (outcome.kind === "held" ? outcome.verdict : outcome.kind))).toEqual([
      "unreadable",
      "busy",
    ]);
    expect(fake.closed).toEqual([]);
    expect(openKeys({ home: fixture.home })).toEqual(["dark-doc", "busy-doc"]);
  });

  it("closes a workspace whose ask was settled and never opened a run, and keeps one whose run is open", async () => {
    const fixture = home();
    spawnedRow({ home: fixture.home, slug: "settled-ask", workspaceRef: "workspace:1" });
    spawnedRow({ home: fixture.home, slug: "settled-but-running", workspaceRef: "workspace:2" });
    run({ finished: false, home: fixture.home, slug: "settled-but-running" });
    writeDoc({
      handoverDir: fixture.handoverDir,
      lines: ["kind: ask", "status: ready", "settlement: answered", "settlementWitness: https://x/p"],
      slug: "settled-but-running",
    });
    writeDoc({
      handoverDir: fixture.handoverDir,
      lines: ["kind: ask", "status: ready", "settlement: answered", "settlementWitness: https://x/p"],
      slug: "settled-ask",
    });
    const fake = fakeClient({
      screens: { "id-1": CLAUDE_IDLE, "id-2": "> " },
      workspaces: [
        workspace({ currentDirectory: "/w/.claude/worktrees/settled-ask" }),
        workspace({
          currentDirectory: "/w/.claude/worktrees/settled-but-running",
          workspaceId: "id-2",
          workspaceRef: "workspace:2",
        }),
      ],
    });
    const swept = await closeDoneWithClient({ deps: deps({ client: fake.client, fixture }) });
    const outcomes = outcomesOf(swept);
    expect(outcomes.map((outcome) => (outcome.kind === "park-kept" ? outcome.reason : outcome.kind))).toEqual([
      "screen-unreadable",
      "closed",
    ]);
    expect(fake.closed).toEqual(["id-1"]);
  });

  it("closes only the ledger row of a session whose workspace is already gone", async () => {
    const fixture = home();
    spawnedRow({ home: fixture.home, slug: "gone-doc", workspaceRef: "workspace:1010" });
    const fake = fakeClient({ workspaces: [] });
    const swept = await closeDoneWithClient({ deps: deps({ client: fake.client, fixture }) });
    const outcomes = outcomesOf(swept);
    expect(outcomes.map((outcome) => outcome.kind)).toEqual(["drift-closed"]);
    expect(fake.closed).toEqual([]);
    expect(openKeys({ home: fixture.home })).toEqual([]);
  });

  it("closes the row under its OWN ref when cmux re-numbered the live workspace", async () => {
    const fixture = home();
    spawnedRow({ home: fixture.home, slug: "renumbered-doc", workspaceRef: "workspace:1010" });
    run({ finished: true, home: fixture.home, slug: "renumbered-doc" });
    const fake = fakeClient({
      screens: { "id-19": CLAUDE_IDLE },
      workspaces: [
        workspace({
          currentDirectory: "/w/.claude/worktrees/renumbered-doc",
          workspaceId: "id-19",
          workspaceRef: "workspace:19",
        }),
      ],
    });
    const swept = await closeDoneWithClient({ deps: deps({ client: fake.client, fixture }) });
    const outcomes = outcomesOf(swept);
    expect(outcomes.map((outcome) => outcome.kind)).toEqual(["closed"]);
    expect(fake.closed).toEqual(["id-19"]);
    expect(openKeys({ home: fixture.home })).toEqual([]);
  });

  it("on a dry run, closes nothing and writes nothing, but reports the same plan", async () => {
    const fixture = home();
    spawnedRow({ home: fixture.home, slug: "finished-doc", workspaceRef: "workspace:1" });
    spawnedRow({ home: fixture.home, slug: "gone-doc", workspaceRef: "workspace:1010" });
    run({ finished: true, home: fixture.home, slug: "finished-doc" });
    const fake = fakeClient({
      screens: { "id-1": CLAUDE_IDLE },
      workspaces: [workspace({ currentDirectory: "/w/.claude/worktrees/finished-doc" })],
    });
    const swept = await closeDoneWithClient({ deps: deps({ client: fake.client, dryRun: true, fixture }) });
    const outcomes = outcomesOf(swept);
    expect(outcomes.map((outcome) => outcome.kind)).toEqual(["drift-closed", "closed"]);
    expect(fake.closed).toEqual([]);
    expect(openKeys({ home: fixture.home })).toEqual(["gone-doc", "finished-doc"]);
  });

  it("reports a close cmux refused, keeps the row open, and carries on with the rest", async () => {
    const fixture = home();
    spawnedRow({ home: fixture.home, slug: "refused-doc", workspaceRef: "workspace:1" });
    spawnedRow({ home: fixture.home, slug: "gone-doc", workspaceRef: "workspace:1010" });
    run({ finished: true, home: fixture.home, slug: "refused-doc" });
    const fake = fakeClient({
      closeFails: true,
      screens: { "id-1": CLAUDE_IDLE },
      workspaces: [workspace({ currentDirectory: "/w/.claude/worktrees/refused-doc" })],
    });
    const swept = await closeDoneWithClient({ deps: deps({ client: fake.client, fixture }) });
    const outcomes = outcomesOf(swept);
    expect(outcomes.map((outcome) => outcome.kind)).toEqual(["drift-closed", "close-failed"]);
    expect(openKeys({ home: fixture.home })).toEqual(["refused-doc"]);
  });

  it("never closes the caller's own workspace, even with a finished journal", async () => {
    const fixture = home();
    spawnedRow({ home: fixture.home, slug: "own-doc", workspaceRef: "workspace:1" });
    run({ finished: true, home: fixture.home, slug: "own-doc" });
    const fake = fakeClient({
      screens: { "id-1": CLAUDE_IDLE },
      workspaces: [workspace({ currentDirectory: "/w/.claude/worktrees/own-doc" })],
    });
    const swept = await closeDoneWithClient({ deps: deps({ client: fake.client, fixture, ownWorkspaceId: "id-1" }) });
    const outcomes = outcomesOf(swept);
    expect(outcomes.map((outcome) => (outcome.kind === "kept" ? outcome.item.reason : outcome.kind))).toEqual([
      "own-workspace",
    ]);
    expect(fake.closed).toEqual([]);
  });

  it("refuses the whole sweep when the live inventory cannot be read", async () => {
    const fixture = home();
    const client: CmuxClient = {
      ...fakeClient({ workspaces: [] }).client,
      listWorkspaces: () =>
        Promise.resolve(err(CmuxErrors.malformedReply({ detail: "socket gone", method: "workspace.list" }))),
    };
    const swept = await closeDoneWithClient({ deps: deps({ client, fixture }) });
    expect(errorOf(swept)).toContain("the live cmux inventory could not be read");
  });
});

/**
 * The bot loop's dispatch children, over the real ask-lifecycle log — the class the owner watched pile up:
 * reviewer workspaces of a turn that ended hours before, some of them under a ledger row a ref-less close had
 * already retired.
 */
const ASK = { channel: "C0AAA", messageTs: "1789046247.801199", threadTs: "1789046247.801199" } as const;
const REVIEW_KEY = dispatchSessionName({ askChannel: ASK.channel, askMessageTs: ASK.messageTs, role: "review" });
const WORKER_KEY = dispatchSessionName({ askChannel: ASK.channel, askMessageTs: ASK.messageTs, role: "ask" });
const LOOP_CWD = "/w/.claude/worktrees/live-loop";

/** Record the ask as captured and then answered — the turn is over on the lifecycle log. */
function answeredAsk({ home: stateHome }: { home: string }): void {
  appendAskLifecycleEvent({
    event: { ...ASK, kind: "captured", surface: "channel", tsIso: SPAWNED_AT, userId: "U0AAA" },
    home: stateHome,
  });
  appendAskLifecycleEvent({
    event: { ...ASK, answerTs: "1789046999.1", kind: "answered", tsIso: "2026-09-03T09:00:00.000Z" },
    home: stateHome,
  });
}

/** Record one dispatch child's spawned row — no slug, the loop's own checkout, keyed by its dispatch name. */
function spawnChild({
  home: stateHome,
  sessionKey,
  workspaceRef,
}: {
  home: string;
  sessionKey: string;
  workspaceRef: string;
}): void {
  appendSessionEvent({
    event: {
      branch: "live-loop",
      cwd: LOOP_CWD,
      kind: "spawned",
      sessionKey,
      surfaceRef: "surface:1",
      tsIso: SPAWNED_AT,
      workspaceRef,
    },
    home: stateHome,
  });
}

/** One dispatch child's live workspace, carrying the description cmux was given at spawn. */
function childWorkspace({
  role,
  workspaceId,
  workspaceRef,
}: {
  role: "ask" | "review";
  workspaceId: string;
  workspaceRef: string;
}): CmuxWorkspaceSummary {
  return workspace({
    currentDirectory: LOOP_CWD,
    description: `spawned session · ${dispatchWorkspaceName({ askChannel: ASK.channel, askMessageTs: ASK.messageTs, role })}`,
    title: `${role}: why did staging exhaust`,
    workspaceId,
    workspaceRef,
  });
}

describe("closeDoneWithClient over the bot loop's dispatch children", () => {
  it("reaps an idle reviewer and worker of an answered ask, and says so in the summary", async () => {
    const fixture = home();
    answeredAsk({ home: fixture.home });
    spawnChild({ home: fixture.home, sessionKey: REVIEW_KEY, workspaceRef: "workspace:71" });
    spawnChild({ home: fixture.home, sessionKey: WORKER_KEY, workspaceRef: "workspace:78" });
    const workspaces = [
      childWorkspace({ role: "review", workspaceId: "id-71", workspaceRef: "workspace:71" }),
      childWorkspace({ role: "ask", workspaceId: "id-78", workspaceRef: "workspace:78" }),
    ];
    const fake = fakeClient({
      screens: { "id-71": CLAUDE_IDLE, "id-78": CLAUDE_IDLE },
      workspaces,
    });
    const swept = await closeDoneWithClient({ deps: deps({ client: fake.client, fixture }) });
    expect(fake.closed.toSorted()).toEqual(["id-71", "id-78"]);
    expect(openKeys({ home: fixture.home })).toEqual([]);
    expect(renderCloseDoneSummary({ dryRun: false, outcomes: outcomesOf(swept) })).toBe(
      `session close-done: closed 2 done chat(s), parked 0 at-rest seat(s), 0 drifted ledger row(s), held 0 done-but-busy, kept 0 row(s) — reaped 2 dispatch child(ren): workspace:78 ${WORKER_KEY} [ask child, answer posted]; workspace:71 ${REVIEW_KEY} [review child, answer posted]`,
    );
  });

  it("reaps a superseded review round whose ledger row a ref-less close had already retired", async () => {
    const fixture = home();
    answeredAsk({ home: fixture.home });
    spawnChild({ home: fixture.home, sessionKey: REVIEW_KEY, workspaceRef: "workspace:71" });
    spawnChild({ home: fixture.home, sessionKey: REVIEW_KEY, workspaceRef: "workspace:77" });
    // The defect this lane exists for: one ref-less `closed` event retires BOTH rows, while :71 runs on.
    appendSessionEvent({
      event: { kind: "closed", sessionKey: REVIEW_KEY, tsIso: "2026-09-03T09:30:00.000Z" },
      home: fixture.home,
    });
    expect(openKeys({ home: fixture.home })).toEqual([]);
    const fake = fakeClient({
      screens: { "id-71": CLAUDE_IDLE },
      workspaces: [childWorkspace({ role: "review", workspaceId: "id-71", workspaceRef: "workspace:71" })],
    });
    const swept = await closeDoneWithClient({ deps: deps({ client: fake.client, fixture }) });
    expect(fake.closed).toEqual(["id-71"]);
    expect(outcomesOf(swept).map((outcome) => outcome.kind)).toEqual(["closed"]);
  });

  it("holds a reviewer whose turn is over but whose screen is still running one", async () => {
    const fixture = home();
    answeredAsk({ home: fixture.home });
    spawnChild({ home: fixture.home, sessionKey: REVIEW_KEY, workspaceRef: "workspace:71" });
    const fake = fakeClient({
      screens: { "id-71": "writing the verdict… (esc to interrupt)" },
      workspaces: [childWorkspace({ role: "review", workspaceId: "id-71", workspaceRef: "workspace:71" })],
    });
    const swept = await closeDoneWithClient({ deps: deps({ client: fake.client, fixture }) });
    expect(fake.closed).toEqual([]);
    expect(outcomesOf(swept).map((outcome) => outcome.kind)).toEqual(["held"]);
    expect(openKeys({ home: fixture.home })).toEqual([REVIEW_KEY]);
  });

  it("holds a reviewer whose screen could not be read at all", async () => {
    const fixture = home();
    answeredAsk({ home: fixture.home });
    spawnChild({ home: fixture.home, sessionKey: REVIEW_KEY, workspaceRef: "workspace:71" });
    const fake = fakeClient({
      workspaces: [childWorkspace({ role: "review", workspaceId: "id-71", workspaceRef: "workspace:71" })],
    });
    const swept = await closeDoneWithClient({ deps: deps({ client: fake.client, fixture }) });
    expect(fake.closed).toEqual([]);
    expect(outcomesOf(swept).map((outcome) => outcome.kind)).toEqual(["held"]);
  });

  it("keeps a reviewer whose ask has not ended", async () => {
    const fixture = home();
    appendAskLifecycleEvent({
      event: { ...ASK, kind: "captured", surface: "channel", tsIso: SPAWNED_AT, userId: "U0AAA" },
      home: fixture.home,
    });
    spawnChild({ home: fixture.home, sessionKey: REVIEW_KEY, workspaceRef: "workspace:71" });
    spawnChild({ home: fixture.home, sessionKey: WORKER_KEY, workspaceRef: "workspace:78" });
    const fake = fakeClient({
      screens: { "id-71": CLAUDE_IDLE, "id-78": CLAUDE_IDLE },
      workspaces: [
        childWorkspace({ role: "review", workspaceId: "id-71", workspaceRef: "workspace:71" }),
        childWorkspace({ role: "ask", workspaceId: "id-78", workspaceRef: "workspace:78" }),
      ],
    });
    const swept = await closeDoneWithClient({ deps: deps({ client: fake.client, fixture }) });
    expect(fake.closed).toEqual([]);
    expect(outcomesOf(swept).map((outcome) => outcome.kind)).toEqual(["kept", "kept"]);
  });

  it("reports a dry run's reaps without closing a workspace or touching the ledger", async () => {
    const fixture = home();
    answeredAsk({ home: fixture.home });
    spawnChild({ home: fixture.home, sessionKey: REVIEW_KEY, workspaceRef: "workspace:71" });
    const fake = fakeClient({
      screens: { "id-71": CLAUDE_IDLE },
      workspaces: [childWorkspace({ role: "review", workspaceId: "id-71", workspaceRef: "workspace:71" })],
    });
    const swept = await closeDoneWithClient({ deps: deps({ client: fake.client, dryRun: true, fixture }) });
    expect(fake.closed).toEqual([]);
    expect(openKeys({ home: fixture.home })).toEqual([REVIEW_KEY]);
    expect(renderCloseDoneSummary({ dryRun: true, outcomes: outcomesOf(swept) })).toBe(
      `session close-done: would close 1 done chat(s), would park 0 at-rest seat(s), 0 drifted ledger row(s), held 0 done-but-busy, kept 0 row(s) — would reap 1 dispatch child(ren): workspace:71 ${REVIEW_KEY} [review child, answer posted]`,
    );
  });
});

const ATTEMPT = "1db70ded-0000-4000-8000-000000000001";
const LATER = "1db70ded-0000-4000-8000-000000000002";
const BARE: readonly CmuxProcess[] = [
  { children: [], name: "-zsh", pid: 10 },
  { children: [], name: "sleep", pid: 11 },
];
const BUSY: readonly CmuxProcess[] = [{ children: [{ children: [], name: "node", pid: 12 }], name: "-zsh", pid: 10 }];

/** A finished resume tab's screen: its finish line, then the prompt. */
function resumeScreen({ attemptId, outcome }: { attemptId: string; outcome: FleetAttemptOutcome }): string {
  return ["console\talready serving on :4000", resumeFinishLine({ finish: { attemptId, outcome } }), "% "].join("\n");
}

/** One finished attempt on the fleet journal. */
async function finishedAttempt({
  fleet,
  home: stateHome,
  attemptId,
}: {
  fleet: FleetPort;
  home: string;
  attemptId: string;
}): Promise<void> {
  unwrap(
    await fleet.appendResumeEvent({
      event: { atIso: NOW, attemptId, kind: "attempt-finished", outcome: "failed", schemaVersion: 1 },
      home: stateHome,
    }),
  );
}

/** A main-checkout tab the desktop opened, unpaired to any ledger row. */
function resumeTab({ workspaceId, workspaceRef }: { workspaceId: string; workspaceRef: string }): CmuxWorkspaceSummary {
  return workspace({ currentDirectory: "/w", title: "/w", workspaceId, workspaceRef });
}

/** What a sweep that must have succeeded did, throwing when it failed. */
function sweptOf(swept: Awaited<ReturnType<typeof closeDoneWithClient>>): CloseDoneSwept {
  if (!("shells" in swept)) {
    throw new Error(`sweep failed: ${swept.error}`);
  }
  return swept;
}

/** The finished resume tabs one sweep met, throwing when the sweep itself failed. */
function shellsOf(swept: Awaited<ReturnType<typeof closeDoneWithClient>>): readonly CloseDoneShellOutcome[] {
  return sweptOf(swept).shells;
}

// Measured on a fleet resume that misread live seats as bare shells:
// "something is still running" over a tab cmux attributed nothing to sent the chair to read an empty screen.
describe("bareShellReason", () => {
  it("says cmux attributed nothing, rather than that something runs", () => {
    expect(bareShellReason({ processes: [] })).toBe(
      "cmux attributes no process to it, so it could not be proven a bare shell",
    );
  });

  it("says something runs when the tree holds more than a shell", () => {
    expect(
      bareShellReason({ processes: [{ children: [{ children: [], name: "vim", pid: 7 }], name: "zsh", pid: 3 }] }),
    ).toBe("something is still running in it");
  });

  it("is undefined for a bare shell", () => {
    expect(bareShellReason({ processes: [{ children: [], name: "zsh", pid: 3 }] })).toBeUndefined();
  });
});

describe("closeDoneWithClient over finished fleet resume tabs", () => {
  it("closes a healthy one with no ledger row, writing nothing to the ledger, and ignores a tab that is no resume", async () => {
    const fixture = home();
    const fake = fakeClient({
      screens: { "id-9": resumeScreen({ attemptId: ATTEMPT, outcome: "healthy" }), "id-10": "% ls\nREADME.md\n% " },
      trees: { "id-9": [BARE], "id-10": [BARE] },
      workspaces: [
        resumeTab({ workspaceId: "id-9", workspaceRef: "workspace:9" }),
        resumeTab({ workspaceId: "id-10", workspaceRef: "workspace:10" }),
      ],
    });
    const swept = await closeDoneWithClient({ deps: deps({ client: fake.client, fixture }) });
    expect(fake.closed).toEqual(["id-9"]);
    expect(shellsOf(swept)).toEqual([
      {
        finish: { attemptId: ATTEMPT, outcome: "healthy" },
        kind: "closed",
        reason: "healthy",
        workspaceRef: "workspace:9",
      },
    ]);
    expect(readSessionLogText({ home: fixture.home })).toBe("");
  });

  it("holds a healthy one the owner typed a command into after it finished, though that command is done", async () => {
    const fixture = home();
    const reused = [resumeScreen({ attemptId: ATTEMPT, outcome: "healthy" }) + "pwd", "/Users/ada", "% "].join("\n");
    const fake = fakeClient({
      screens: { "id-9": reused },
      trees: { "id-9": [BARE] },
      workspaces: [resumeTab({ workspaceId: "id-9", workspaceRef: "workspace:9" })],
    });
    const swept = await closeDoneWithClient({ deps: deps({ client: fake.client, fixture }) });
    expect(fake.closed).toEqual([]);
    expect(shellsOf(swept)).toEqual([]);
  });

  it("holds one where a draft was typed after its screen was first read, the tree still bare", async () => {
    const fixture = home();
    const finished = resumeScreen({ attemptId: ATTEMPT, outcome: "healthy" });
    const fake = fakeClient({
      screens: { "id-9": [finished, `${finished}pwd`] },
      trees: { "id-9": [BARE] },
      workspaces: [resumeTab({ workspaceId: "id-9", workspaceRef: "workspace:9" })],
    });
    const swept = await closeDoneWithClient({ deps: deps({ client: fake.client, fixture }) });
    expect(fake.closed).toEqual([]);
    expect(shellsOf(swept)).toEqual([
      {
        finish: { attemptId: ATTEMPT, outcome: "healthy" },
        kind: "held",
        reason: "its screen changed since it was read",
        workspaceRef: "workspace:9",
      },
    ]);
  });

  it("closes a failed one a later attempt superseded, and holds the newest failed one", async () => {
    const fixture = home();
    await finishedAttempt({ attemptId: ATTEMPT, fleet: fixture.fleet, home: fixture.home });
    await finishedAttempt({ attemptId: LATER, fleet: fixture.fleet, home: fixture.home });
    const fake = fakeClient({
      screens: {
        "id-9": resumeScreen({ attemptId: ATTEMPT, outcome: "failed" }),
        "id-10": resumeScreen({ attemptId: LATER, outcome: "failed" }),
      },
      trees: { "id-9": [BARE], "id-10": [BARE] },
      workspaces: [
        resumeTab({ workspaceId: "id-9", workspaceRef: "workspace:9" }),
        resumeTab({ workspaceId: "id-10", workspaceRef: "workspace:10" }),
      ],
    });
    const swept = await closeDoneWithClient({ deps: deps({ client: fake.client, fixture }) });
    expect(fake.closed).toEqual(["id-9"]);
    expect(shellsOf(swept).map((shell) => [shell.workspaceRef, shell.kind, shell.reason])).toEqual([
      ["workspace:9", "closed", "superseded"],
      ["workspace:10", "held", "failed, and no later attempt has finished"],
    ]);
    const report = sweptOf(swept);
    expect(closeDoneSummary({ dryRun: false, swept: report })).toBe(
      `${renderCloseDoneSummary({ dryRun: false, outcomes: report.outcomes })}; closed 1 of 2 finished fleet resume tab(s) — left workspace:10 held: failed, and no later attempt has finished`,
    );
    expect(closeDoneSummary({ dryRun: false, swept: { ...report, shells: [] } })).toBe(
      renderCloseDoneSummary({ dryRun: false, outcomes: report.outcomes }),
    );
  });

  it("holds one with something running in it, one whose tree will not read, and one that started running between reads", async () => {
    const fixture = home();
    const healthy = resumeScreen({ attemptId: ATTEMPT, outcome: "healthy" });
    const fake = fakeClient({
      screens: { "id-9": healthy, "id-10": healthy, "id-11": healthy },
      trees: { "id-9": [BUSY], "id-11": [BARE, BUSY] },
      workspaces: [
        resumeTab({ workspaceId: "id-9", workspaceRef: "workspace:9" }),
        resumeTab({ workspaceId: "id-10", workspaceRef: "workspace:10" }),
        resumeTab({ workspaceId: "id-11", workspaceRef: "workspace:11" }),
      ],
    });
    const swept = await closeDoneWithClient({ deps: deps({ client: fake.client, fixture }) });
    expect(fake.closed).toEqual([]);
    expect(shellsOf(swept).map((shell) => [shell.kind, shell.reason])).toEqual([
      ["held", "something is still running in it"],
      ["held", "its process tree did not read: cmux system.top replied with an unusable shape: no tree"],
      ["held", "something is still running in it"],
    ]);
  });

  it("never closes the pinned tab or the caller's own, and on a dry run closes nothing", async () => {
    const fixture = home();
    const healthy = resumeScreen({ attemptId: ATTEMPT, outcome: "healthy" });
    const fake = fakeClient({
      screens: { "id-9": healthy, "id-10": healthy, "id-11": healthy },
      trees: { "id-9": [BARE], "id-10": [BARE], "id-11": [BARE] },
      workspaces: [
        { ...resumeTab({ workspaceId: "id-9", workspaceRef: "workspace:9" }), pinned: true },
        resumeTab({ workspaceId: "id-10", workspaceRef: "workspace:10" }),
        resumeTab({ workspaceId: "id-11", workspaceRef: "workspace:11" }),
      ],
    });
    const swept = await closeDoneWithClient({
      deps: deps({ client: fake.client, dryRun: true, fixture, ownWorkspaceId: "id-10" }),
    });
    expect(fake.closed).toEqual([]);
    expect(shellsOf(swept).map((shell) => [shell.workspaceRef, shell.kind])).toEqual([["workspace:11", "closed"]]);
    expect(renderShellOutcome({ dryRun: true, outcome: shellsOf(swept)[0]! })).toBe(
      `would close workspace:11 finished fleet resume tab — attempt ${ATTEMPT} healthy`,
    );
  });

  it("reports a close cmux refused", async () => {
    const fixture = home();
    const fake = fakeClient({
      closeFails: true,
      screens: { "id-9": resumeScreen({ attemptId: ATTEMPT, outcome: "healthy" }) },
      trees: { "id-9": [BARE] },
      workspaces: [resumeTab({ workspaceId: "id-9", workspaceRef: "workspace:9" })],
    });
    const swept = await closeDoneWithClient({ deps: deps({ client: fake.client, fixture }) });
    expect(shellsOf(swept).map((shell) => shell.kind)).toEqual(["close-failed"]);
    expect(renderShellOutcome({ dryRun: false, outcome: shellsOf(swept)[0]! })).toBe(
      `FAILED to close workspace:9 finished fleet resume tab — attempt ${ATTEMPT} healthy: cmux workspace.close replied with an unusable shape: cmux said no`,
    );
  });

  describe("a seat the newest attempt refused whose workspace is gone", () => {
    const STARTED = "2026-09-03T09:00:00.000Z";

    /** The attempt: started, refused `workspace:5` on a kill timeout, ended failed with no refusal of its own. */
    async function refusedAttempt({ fleet, home: stateHome }: { fleet: FleetPort; home: string }): Promise<void> {
      const base = { attemptId: ATTEMPT, schemaVersion: 1 as const };
      const lines = [
        { ...base, atIso: STARTED, episodeId: "ep", kind: "attempt-started" as const, pid: 42 },
        {
          ...base,
          atIso: "2026-09-03T09:01:00.000Z",
          kind: "seat" as const,
          phase: "refused" as const,
          refusal: { code: "KILL_TIMEOUT" as const, message: "still running 15s after SIGTERM" },
          role: "worker" as const,
          workspaceRef: "workspace:5",
        },
        { ...base, atIso: "2026-09-03T09:02:00.000Z", kind: "attempt-finished" as const, outcome: "failed" as const },
      ];
      for (const event of lines) {
        unwrap(await fleet.appendResumeEvent({ event, home: stateHome }));
      }
    }

    const TAB = resumeTab({ workspaceId: "id-16", workspaceRef: "workspace:16" });

    /** The attempt's own tab, still showing its failed finish over a bare shell. */
    function heldTab({
      topology = "same",
      surfacePids = [],
      onClose = () => undefined,
    }: {
      topology?: "same" | "fails" | readonly CmuxWorkspaceSummary[];
      surfacePids?: readonly number[];
      onClose?: () => void;
    } = {}): ReturnType<typeof fakeClient> {
      return fakeClient({
        onClose,
        screens: { "id-16": resumeScreen({ attemptId: ATTEMPT, outcome: "failed" }) },
        surfacePids,
        topology,
        trees: { "id-16": [BARE] },
        workspaces: [TAB],
      });
    }

    /** One sweep over the attempt with the app started well before it, and what the journal then holds. */
    async function sweepOver({
      fake,
      appRestartsMidSweep = false,
      liveSessions = ok([]),
    }: {
      fake: ReturnType<typeof fakeClient>;
      appRestartsMidSweep?: boolean;
      liveSessions?: Result<readonly LiveSessionStart[], string>;
    }): Promise<{
      readonly swept: CloseDoneSwept;
      readonly kinds: readonly string[];
    }> {
      const fixture = home();
      await refusedAttempt({ fleet: fixture.fleet, home: fixture.home });
      const swept = sweptOf(
        await closeDoneWithClient({
          deps: deps({
            appRestartsMidSweep,
            appStartedMs: Date.parse("2026-09-03T08:30:00.000Z"),
            client: fake.client,
            fixture,
            liveSessions,
          }),
        }),
      );
      const kinds = unwrap(await fixture.fleet.readResumeJournal({ home: fixture.home })).events.map(
        (event) => event.kind,
      );
      return { kinds, swept };
    }

    /** A live Claude session on the refused seat's pid, started before the attempt finished. */
    const ORPHAN: LiveSessionStart = { pid: 33532, startedIso: "2026-09-03T08:50:00.000Z" };

    it("judges nothing gone while a live session outside every surface could be the refused seat's orphan (p3)", async () => {
      const fake = heldTab();
      const { swept, kinds } = await sweepOver({ fake, liveSessions: ok([ORPHAN]) });
      expect(swept.goneSeats).toEqual([]);
      expect(kinds).toEqual(["attempt-started", "seat", "attempt-finished"]);
      expect(fake.closed).toEqual([]);
    });

    it("judges nothing gone when the live sessions cannot be read, since a missed one could be that orphan (p3)", async () => {
      const fake = heldTab();
      const { swept, kinds } = await sweepOver({ fake, liveSessions: err("a registry file would not read") });
      expect(swept.goneSeats).toEqual([]);
      expect(kinds).toEqual(["attempt-started", "seat", "attempt-finished"]);
      expect(fake.closed).toEqual([]);
    });

    it("journals the seat when every live session sits in a surface, or started after the attempt finished (p3)", async () => {
      const inside = heldTab({ surfacePids: [ORPHAN.pid] });
      const later = heldTab();
      const startedLater: LiveSessionStart = { pid: 777, startedIso: "2026-09-03T09:02:01.000Z" };
      const sweeps = [
        await sweepOver({ fake: inside, liveSessions: ok([ORPHAN]) }),
        await sweepOver({ fake: later, liveSessions: ok([startedLater]) }),
      ];
      expect(sweeps.map(({ swept }) => swept.goneSeats.map((gone) => gone.workspaceRef))).toEqual([
        ["workspace:5"],
        ["workspace:5"],
      ]);
      expect([inside.closed, later.closed]).toEqual([["id-16"], ["id-16"]]);
    });

    it("judges absence on ONE whole topology read: one that fails, or still holds the seat, journals nothing", async () => {
      const failed = heldTab({ topology: "fails" });
      const listed = heldTab({ topology: [TAB, resumeTab({ workspaceId: "id-5", workspaceRef: "workspace:5" })] });
      for (const fake of [failed, listed]) {
        const { swept, kinds } = await sweepOver({ fake });
        expect(swept.goneSeats).toEqual([]);
        expect(kinds).toEqual(["attempt-started", "seat", "attempt-finished"]);
        expect(fake.closed).toEqual([]);
      }
    });

    it("journals nothing and holds the tab when cmux restarted between the app read and the listing", async () => {
      const fake = heldTab();
      const { swept, kinds } = await sweepOver({ appRestartsMidSweep: true, fake });
      expect(swept.goneSeats).toEqual([]);
      expect(kinds).toEqual(["attempt-started", "seat", "attempt-finished"]);
      expect(fake.closed).toEqual([]);
    });

    it("closes the attempt's tab while still holding the recovery lock, so no attempt can start before the close", async () => {
      const fixture = home();
      await refusedAttempt({ fleet: fixture.fleet, home: fixture.home });
      const lockFreeAtClose: boolean[] = [];
      const fake = heldTab({
        onClose: () => {
          const probe = acquireFleetLock({ home: fixture.home, nowIso: NOW });
          lockFreeAtClose.push(probe.isOk());
          if (probe.isOk()) {
            probe.value.release();
          }
        },
      });
      await closeDoneWithClient({
        deps: deps({ appStartedMs: Date.parse("2026-09-03T08:30:00.000Z"), client: fake.client, fixture }),
      });
      expect(fake.closed).toEqual(["id-16"]);
      expect(lockFreeAtClose).toEqual([false]);
    });

    it("journals nothing and closes no tab while a recovery pass holds its lock, and releases its own", async () => {
      const fixture = home();
      await refusedAttempt({ fleet: fixture.fleet, home: fixture.home });
      const pass = unwrap(acquireFleetLock({ home: fixture.home, nowIso: NOW }));
      const held = heldTab();
      const blocked = sweptOf(
        await closeDoneWithClient({
          deps: deps({ appStartedMs: Date.parse("2026-09-03T08:30:00.000Z"), client: held.client, fixture }),
        }),
      );
      expect(blocked.goneSeats).toEqual([]);
      expect(blocked.shells).toEqual([]);
      expect(unwrap(await fixture.fleet.readResumeJournal({ home: fixture.home })).events.length).toBe(3);
      expect(held.closed).toEqual([]);
      pass.release();
      const free = heldTab();
      const swept = sweptOf(
        await closeDoneWithClient({
          deps: deps({ appStartedMs: Date.parse("2026-09-03T08:30:00.000Z"), client: free.client, fixture }),
        }),
      );
      expect(swept.goneSeats.map((gone) => gone.workspaceRef)).toEqual(["workspace:5"]);
      expect(acquireFleetLock({ home: fixture.home, nowIso: NOW }).isOk()).toBe(true);
    });

    it("journals the seat gone and releases the attempt's tab on that same fact", async () => {
      const fixture = home();
      await refusedAttempt({ fleet: fixture.fleet, home: fixture.home });
      const fake = heldTab();
      const swept = sweptOf(
        await closeDoneWithClient({
          deps: deps({ appStartedMs: Date.parse("2026-09-03T08:30:00.000Z"), client: fake.client, fixture }),
        }),
      );
      expect(swept.goneSeats.map((gone) => [gone.attemptId, gone.workspaceRef])).toEqual([[ATTEMPT, "workspace:5"]]);
      const journal = unwrap(await fixture.fleet.readResumeJournal({ home: fixture.home })).events;
      expect(journal.at(-1)).toEqual({
        atIso: NOW,
        attemptId: ATTEMPT,
        kind: "seat-gone",
        schemaVersion: 1,
        workspaceRef: "workspace:5",
      });
      expect(fake.closed).toEqual(["id-16"]);
      expect(swept.shells.map((shell) => [shell.workspaceRef, shell.kind, shell.reason])).toEqual([
        ["workspace:16", "closed", "seats-gone"],
      ]);
      expect(renderShellOutcome({ dryRun: false, outcome: swept.shells[0]! })).toBe(
        `closed workspace:16 finished fleet resume tab — attempt ${ATTEMPT} failed, every seat it refused is gone`,
      );
    });

    it("journals nothing and holds the tab when cmux restarted after the attempt, since every ref was renumbered", async () => {
      const fixture = home();
      await refusedAttempt({ fleet: fixture.fleet, home: fixture.home });
      const fake = heldTab();
      const swept = sweptOf(
        await closeDoneWithClient({
          deps: deps({ appStartedMs: Date.parse("2026-09-03T09:30:00.000Z"), client: fake.client, fixture }),
        }),
      );
      expect(swept.goneSeats).toEqual([]);
      const journalled = unwrap(await fixture.fleet.readResumeJournal({ home: fixture.home }));
      expect(journalled.events.map((event) => event.kind)).toEqual(["attempt-started", "seat", "attempt-finished"]);
      expect(fake.closed).toEqual([]);
      expect(swept.shells.map((shell) => [shell.kind, shell.reason])).toEqual([
        ["held", "failed, and no later attempt has finished"],
      ]);
    });

    it("on a dry run reports the line and the release, writing and closing nothing", async () => {
      const fixture = home();
      await refusedAttempt({ fleet: fixture.fleet, home: fixture.home });
      const fake = heldTab();
      const swept = sweptOf(
        await closeDoneWithClient({
          deps: deps({
            appStartedMs: Date.parse("2026-09-03T08:30:00.000Z"),
            client: fake.client,
            dryRun: true,
            fixture,
          }),
        }),
      );
      expect(swept.goneSeats.map((gone) => gone.workspaceRef)).toEqual(["workspace:5"]);
      expect(renderGoneSeat({ dryRun: true, gone: swept.goneSeats[0]! })).toBe(
        `would journal workspace:5 gone — fleet resume attempt ${ATTEMPT} refused a seat that no longer exists`,
      );
      expect(unwrap(await fixture.fleet.readResumeJournal({ home: fixture.home })).events.length).toBe(3);
      expect(fake.closed).toEqual([]);
      expect(swept.shells.map((shell) => [shell.kind, shell.reason])).toEqual([["closed", "seats-gone"]]);
    });
  });
});

/**
 * Owner steer: a parked seat leaves the fleet. A run seat with no done evidence is
 * closed when it proves at rest, its checkpoint journalled first with its drafts — and kept when anything says it
 * is working or cannot say whose it is.
 */
describe("closeDoneWithClient — parking an at-rest seat", () => {
  it("journals the checkpoint with its draft, closes the seat and its ledger row, and leaves its tree", async () => {
    const { fixture, runsDir } = parkedFixture({ heldDraft: true });
    const fake = fakeClient({ screens: { "id-1": AT_REST }, trees: { "id-1": [SEAT_TREE] }, workspaces: [SEAT] });
    const swept = await closeDoneWithClient({
      deps: deps({ client: fake.client, fixture, parkSeat: registry({ records: [sessionRecord()] }) }),
    });
    expect(outcomesOf(swept)).toEqual([
      {
        drafts: 1,
        how: "recorded",
        item: { kind: "park-candidate", row: expect.anything(), workspace: SEAT },
        kind: "parked",
      },
    ]);
    expect(fake.closed).toEqual(["id-1"]);
    expect(openKeys({ home: fixture.home })).toEqual([]);
    const parked = unwrap(readRunJournal({ runsDir, slug: "parked-doc" })).events.at(-1)!;
    expect(parked).toEqual({
      atIso: NOW,
      branch: "parked-doc",
      drafts: [{ id: "sd-11111111", kind: "slack-draft", text: "the reply the owner has not sent" }],
      kind: "parked",
      screenTail: "⏺ Done for now.\n\n❯ \n  ⏵⏵ bypass permissions on (shift+tab to cycle)",
      sessionId: "session-parked",
      workspaceRef: "workspace:1",
      worktree: PARKED_DIR,
    });
  });

  it("closes the seat a park already journalled and left open, writing nothing new", async () => {
    const { fixture, runsDir } = parkedFixture();
    appendRunEvent({
      event: {
        atIso: "2026-09-03T09:00:00.000Z",
        branch: "parked-doc",
        kind: "parked",
        screenTail: "❯ ",
        sessionId: "session-parked",
        workspaceRef: "workspace:1",
        worktree: PARKED_DIR,
      },
      runsDir,
      slug: "parked-doc",
    });
    const fake = fakeClient({ screens: { "id-1": AT_REST }, trees: { "id-1": [SEAT_TREE] }, workspaces: [SEAT] });
    const swept = await closeDoneWithClient({
      deps: deps({ client: fake.client, fixture, parkSeat: registry({ records: [sessionRecord()] }) }),
    });
    expect(outcomesOf(swept).map((outcome) => (outcome.kind === "parked" ? outcome.how : outcome.kind))).toEqual([
      "predecessor",
    ]);
    expect(fake.closed).toEqual(["id-1"]);
    expect(unwrap(readRunJournal({ runsDir, slug: "parked-doc" })).events).toHaveLength(3);
  });

  it("parks the candidate a dry run named when handed it directly, journalling and closing only then", async () => {
    const { fixture, runsDir } = parkedFixture();
    const fake = fakeClient({ screens: { "id-1": AT_REST }, trees: { "id-1": [SEAT_TREE] }, workspaces: [SEAT] });
    const parkSeat = registry({ records: [sessionRecord()] });
    const dry = await closeDoneWithClient({ deps: deps({ client: fake.client, dryRun: true, fixture, parkSeat }) });
    const [named] = outcomesOf(dry);
    expect(named!.kind).toBe("parked");
    expect(fake.closed).toEqual([]);
    const item = (named as CloseDoneOutcome & { readonly kind: "parked" }).item;
    const outcome = await parkCandidate({
      deps: { ...deps({ client: fake.client, fixture, parkSeat }), runsDir },
      item,
    });
    expect(outcome).toEqual({ drafts: 0, how: "recorded", item, kind: "parked" });
    expect(fake.closed).toEqual(["id-1"]);
    expect(unwrap(readRunJournal({ runsDir, slug: "parked-doc" })).events.at(-1)!.kind).toBe("parked");
  });

  it("keeps a predecessor seat whose park does not carry a draft it still holds, closing nothing", async () => {
    const { fixture, runsDir } = parkedFixture({ heldDraft: true });
    predecessorPark({ runsDir });
    const fake = fakeClient({ screens: { "id-1": AT_REST }, trees: { "id-1": [SEAT_TREE] }, workspaces: [SEAT] });
    const swept = await closeDoneWithClient({
      deps: deps({ client: fake.client, fixture, parkSeat: registry({ records: [sessionRecord()] }) }),
    });
    expect(outcomesOf(swept)).toEqual([
      {
        item: { kind: "park-candidate", row: expect.anything(), workspace: SEAT },
        kind: "park-kept",
        reason: "drafts-unrecorded",
        why: "its park's checkpoint does not carry sd-11111111, so closing it would leave the parked entry without them",
      },
    ]);
    expect(fake.closed).toEqual([]);
  });

  it("closes a predecessor seat whose park carries every draft it holds, counting them", async () => {
    const { fixture, runsDir } = parkedFixture({ heldDraft: true });
    predecessorPark({
      drafts: [{ id: "sd-11111111", kind: "slack-draft", text: "the reply the owner has not sent" }],
      runsDir,
    });
    const fake = fakeClient({ screens: { "id-1": AT_REST }, trees: { "id-1": [SEAT_TREE] }, workspaces: [SEAT] });
    const swept = await closeDoneWithClient({
      deps: deps({ client: fake.client, fixture, parkSeat: registry({ records: [sessionRecord()] }) }),
    });
    expect(outcomesOf(swept)).toEqual([
      {
        drafts: 1,
        how: "predecessor",
        item: { kind: "park-candidate", row: expect.anything(), workspace: SEAT },
        kind: "parked",
      },
    ]);
    expect(fake.closed).toEqual(["id-1"]);
  });

  it("keeps a predecessor seat whose turn started between the first look and the last, closing nothing", async () => {
    const { fixture, runsDir } = parkedFixture();
    appendRunEvent({
      event: {
        atIso: "2026-09-03T09:00:00.000Z",
        branch: "parked-doc",
        kind: "parked",
        screenTail: "❯ ",
        sessionId: "session-parked",
        workspaceRef: "workspace:1",
        worktree: PARKED_DIR,
      },
      runsDir,
      slug: "parked-doc",
    });
    const fake = fakeClient({ screens: { "id-1": AT_REST }, trees: { "id-1": [SEAT_TREE] }, workspaces: [SEAT] });
    const parkSeat = changing({ after: sessionRecord({ status: "busy" }), first: sessionRecord() });
    const swept = await closeDoneWithClient({ deps: deps({ client: fake.client, fixture, parkSeat }) });
    expect(outcomesOf(swept)).toEqual([
      {
        item: { kind: "park-candidate", row: expect.anything(), workspace: SEAT },
        kind: "park-kept",
        reason: "seat-moved",
        why: "first claude-code session-parked pid 4242 → close-only, last claude-code session-parked pid 4242 → keep",
      },
    ]);
    expect(fake.closed).toEqual([]);
    expect(unwrap(readRunJournal({ runsDir, slug: "parked-doc" })).events).toHaveLength(3);
  });

  it("leaves a holder's seat open when its turn starts after the checkpoint landed, right before the close", async () => {
    const { fixture, runsDir } = parkedFixture();
    const fake = fakeClient({ screens: { "id-1": AT_REST }, trees: { "id-1": [SEAT_TREE] }, workspaces: [SEAT] });
    const parkSeat = changing({ after: sessionRecord({ status: "busy" }), first: sessionRecord(), looks: 2 });
    const swept = await closeDoneWithClient({ deps: deps({ client: fake.client, fixture, parkSeat }) });
    expect(outcomesOf(swept)).toEqual([
      {
        item: { kind: "park-candidate", row: expect.anything(), workspace: SEAT },
        journalled: true,
        kind: "park-failed",
        reason: "its session changed right before the close (pid 4242 reads busy), so the seat is left open",
      },
    ]);
    expect(fake.closed).toEqual([]);
    expect(unwrap(readRunJournal({ runsDir, slug: "parked-doc" })).events.map((event) => event.kind)).toEqual([
      "started",
      "launched",
      "parked",
    ]);
  });

  it("leaves a holder's seat open when a Monitor starts after the checkpoint landed, its registry still idle", async () => {
    const { fixture, runsDir } = parkedFixture();
    const fake = fakeClient({ screens: { "id-1": AT_REST }, trees: { "id-1": [SEAT_TREE] }, workspaces: [SEAT] });
    const monitor = AT_REST.replace("(shift+tab to cycle)", "· 1 monitor");
    const parkedYet = (): boolean =>
      unwrap(readRunJournal({ runsDir, slug: "parked-doc" })).events.some((event) => event.kind === "parked");
    const client: CmuxClient = {
      ...fake.client,
      readScreen: (args) => (parkedYet() ? Promise.resolve(ok(monitor)) : fake.client.readScreen(args)),
    };
    const swept = await closeDoneWithClient({
      deps: deps({ client, fixture, parkSeat: registry({ records: [sessionRecord()] }) }),
    });
    expect(outcomesOf(swept)).toEqual([
      {
        item: { kind: "park-candidate", row: expect.anything(), workspace: SEAT },
        journalled: true,
        kind: "park-failed",
        reason: "its screen read screen-working right before the close, so the seat is left open",
      },
    ]);
    expect(fake.closed).toEqual([]);
  });

  it("leaves a holder's seat open when a line nothing can decode lands after the checkpoint", async () => {
    const { fixture, runsDir } = parkedFixture();
    const fake = fakeClient({ screens: { "id-1": AT_REST }, trees: { "id-1": [SEAT_TREE] }, workspaces: [SEAT] });
    const journal = runJournalPath({ runsDir, slug: "parked-doc" });
    const parkedYet = (): boolean =>
      unwrap(readRunJournal({ runsDir, slug: "parked-doc" })).events.some((event) => event.kind === "parked");
    let garbled = false;
    const client: CmuxClient = {
      ...fake.client,
      readScreen: (args) => {
        if (parkedYet() && !garbled) {
          garbled = true;
          appendFileSync(journal, "{not json\n");
        }
        return fake.client.readScreen(args);
      },
    };
    const swept = await closeDoneWithClient({
      deps: deps({ client, fixture, parkSeat: registry({ records: [sessionRecord()] }) }),
    });
    expect(outcomesOf(swept)).toEqual([
      {
        item: { kind: "park-candidate", row: expect.anything(), workspace: SEAT },
        journalled: true,
        kind: "park-failed",
        reason:
          "journal line(s) 4 do not decode, so whose run it is cannot be proven before the close; the seat is left open",
      },
    ]);
    expect(fake.closed).toEqual([]);
  });
});

describe("closeDoneWithClient — keeping a changing seat", () => {
  it("keeps a predecessor seat whose turn starts right before the close, closing nothing", async () => {
    const { fixture, runsDir } = parkedFixture();
    predecessorPark({ runsDir });
    const fake = fakeClient({ screens: { "id-1": AT_REST }, trees: { "id-1": [SEAT_TREE] }, workspaces: [SEAT] });
    const parkSeat = changing({ after: sessionRecord({ status: "shell" }), first: sessionRecord(), looks: 2 });
    const swept = await closeDoneWithClient({ deps: deps({ client: fake.client, fixture, parkSeat }) });
    expect(outcomesOf(swept)).toEqual([
      {
        item: { kind: "park-candidate", row: expect.anything(), workspace: SEAT },
        kind: "park-kept",
        reason: "seat-moved",
        why: "its session changed right before the close (pid 4242 reads shell), so the seat is left open",
      },
    ]);
    expect(fake.closed).toEqual([]);
  });

  it("keeps a holder's seat relaunched under the same session between the first look and the last, journalling nothing", async () => {
    const { fixture, runsDir } = parkedFixture();
    const fake = fakeClient({ screens: { "id-1": AT_REST }, trees: { "id-1": [SEAT_TREE] }, workspaces: [SEAT] });
    const relaunched = sessionRecord({ procStart: "Thu Sep  3 08:30:00 2026" });
    const parkSeat = changing({ after: relaunched, first: sessionRecord() });
    const swept = await closeDoneWithClient({ deps: deps({ client: fake.client, fixture, parkSeat }) });
    expect(outcomesOf(swept)).toEqual([
      {
        item: { kind: "park-candidate", row: expect.anything(), workspace: SEAT },
        kind: "park-kept",
        reason: "seat-moved",
        why: "first claude-code session-parked pid 4242 → record, last claude-code session-parked pid 4242 → record",
      },
    ]);
    expect(fake.closed).toEqual([]);
    expect(unwrap(readRunJournal({ runsDir, slug: "parked-doc" })).events.map((event) => event.kind)).toEqual([
      "started",
      "launched",
    ]);
  });

  it("keeps a holder's seat when the same session re-claims the run between the first look and the last", async () => {
    const { fixture, runsDir } = parkedFixture();
    const fake = fakeClient({ screens: { "id-1": AT_REST }, trees: { "id-1": [SEAT_TREE] }, workspaces: [SEAT] });
    const base = registry({ records: [sessionRecord()] });
    let reads = 0;
    const parkSeat: ParkSeatDeps = {
      ...base,
      registry: () => {
        reads += 1;
        // The first look reads its journal before its registry, so a claim landing here is after that read.
        if (reads === 1) {
          appendRunEvent({
            event: {
              atIso: "2026-09-03T09:30:00.000Z",
              host: "claude-code",
              kind: "claimed",
              pid: 4343,
              sessionId: "session-parked",
              why: "taken up in another seat",
              worktree: PARKED_DIR,
            },
            runsDir,
            slug: "parked-doc",
          });
        }
        return base.registry();
      },
    };
    const swept = await closeDoneWithClient({ deps: deps({ client: fake.client, fixture, parkSeat }) });
    expect(outcomesOf(swept)).toEqual([
      {
        item: { kind: "park-candidate", row: expect.anything(), workspace: SEAT },
        kind: "park-kept",
        reason: "seat-moved",
        why: `the run moved between looks: 2 journal lines, holder session-parked 4242 ${SPAWNED_AT} ${PARKED_DIR} undefined → 3 journal lines, holder session-parked 4343 2026-09-03T09:30:00.000Z ${PARKED_DIR} claude-code`,
      },
    ]);
    expect(fake.closed).toEqual([]);
    expect(unwrap(readRunJournal({ runsDir, slug: "parked-doc" })).events.map((event) => event.kind)).toEqual([
      "started",
      "launched",
      "claimed",
    ]);
  });

  it("keeps, writing nothing, a seat whose registry reads a background shell, whose footer counts one, or whose session is not the holder", async () => {
    const cases: readonly { readonly screen: string; readonly record: SessionRecord }[] = [
      { record: sessionRecord({ status: "shell" }), screen: AT_REST },
      { record: sessionRecord(), screen: AT_REST.replace("(shift+tab to cycle)", "· 1 monitor") },
      { record: sessionRecord({ sessionId: "a-stranger" }), screen: AT_REST },
    ];
    expect(cases.length).toBe(3);
    const reasons: string[] = [];
    for (const { record, screen } of cases) {
      const { fixture, runsDir } = parkedFixture();
      const fake = fakeClient({ screens: { "id-1": screen }, trees: { "id-1": [SEAT_TREE] }, workspaces: [SEAT] });
      const swept = await closeDoneWithClient({
        deps: deps({ client: fake.client, fixture, parkSeat: registry({ records: [record] }) }),
      });
      reasons.push(
        ...outcomesOf(swept).map((outcome) => (outcome.kind === "park-kept" ? outcome.reason : outcome.kind)),
      );
      expect(fake.closed).toEqual([]);
      expect(unwrap(readRunJournal({ runsDir, slug: "parked-doc" })).events).toHaveLength(2);
    }
    expect(reasons).toEqual(["seat-working", "screen-working", "seat-not-holder"]);
  });

  it("keeps a seat whose session cannot be named, saying why", async () => {
    const { fixture } = parkedFixture();
    const fake = fakeClient({ screens: { "id-1": AT_REST }, trees: { "id-1": [SEAT_TREE] }, workspaces: [SEAT] });
    const swept = await closeDoneWithClient({
      deps: deps({
        client: fake.client,
        fixture,
        parkSeat: registry({ records: [sessionRecord()], refused: ["4200.json: not JSON"] }),
      }),
    });
    expect(outcomesOf(swept)).toEqual([
      {
        item: { kind: "park-candidate", row: expect.anything(), workspace: SEAT },
        kind: "park-kept",
        reason: "seat-unidentified",
        why: "a registry file this build could not read may be its session (4200.json: not JSON)",
      },
    ]);
    expect(fake.closed).toEqual([]);
  });

  it("on a dry run, reports the park and journals and closes nothing", async () => {
    const { fixture, runsDir } = parkedFixture();
    const fake = fakeClient({ screens: { "id-1": AT_REST }, trees: { "id-1": [SEAT_TREE] }, workspaces: [SEAT] });
    const swept = await closeDoneWithClient({
      deps: deps({ client: fake.client, dryRun: true, fixture, parkSeat: registry({ records: [sessionRecord()] }) }),
    });
    expect(outcomesOf(swept).map((outcome) => outcome.kind)).toEqual(["parked"]);
    expect(fake.closed).toEqual([]);
    expect(openKeys({ home: fixture.home })).toEqual(["parked-doc"]);
    expect(unwrap(readRunJournal({ runsDir, slug: "parked-doc" })).events).toHaveLength(2);
  });

  it("reports a close cmux refused AFTER the checkpoint was journalled, and keeps the ledger row open", async () => {
    const { fixture, runsDir } = parkedFixture();
    const fake = fakeClient({
      closeFails: true,
      screens: { "id-1": AT_REST },
      trees: { "id-1": [SEAT_TREE] },
      workspaces: [SEAT],
    });
    const swept = await closeDoneWithClient({
      deps: deps({ client: fake.client, fixture, parkSeat: registry({ records: [sessionRecord()] }) }),
    });
    expect(
      outcomesOf(swept).map((outcome) => (outcome.kind === "park-failed" ? outcome.journalled : outcome.kind)),
    ).toEqual([true]);
    expect(openKeys({ home: fixture.home })).toEqual(["parked-doc"]);
    expect(unwrap(readRunJournal({ runsDir, slug: "parked-doc" })).events.at(-1)!.kind).toBe("parked");
  });
});
