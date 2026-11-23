/**
 * `slopweaver session close-done` — close every spawned workspace whose work is over and whose screen is
 * idle, close the ledger rows whose workspaces are already gone, and print the count. The mechanism behind
 * the owner's six-times-in-a-day ask; the judgement is all in `../../../sessions/closeDone.ts`, and this file
 * is the socket, the journal reads and the ledger writes around it.
 *
 * THREE logs are read, once each, and handed to the pure planner: the board's docs, the session ledger, and
 * the ask-lifecycle log — that last one because the bot loop's own ask workers and answer reviewers answer to
 * no doc, and the only thing that says their turn is over is the ask's own history.
 *
 * A fourth read is per-child rather than once: `reviewPostureFor` asks `../../../live/turn/reviewPosture.ts`
 * whether the ask a REVIEW child belongs to still has a reviewer mid-verdict. It is the same reader
 * `turn dispatch --sweep` uses, deliberately, because the two verbs judging one state from two readers is
 * the finding that put it there (`../../../sessions/dispatchDoneEvidence.ts`).
 *
 * A second sweep closes what no ledger row names: a finished `fleet resume` tab (`./closeDoneShells.ts`), judged
 * against the fleet recovery journal, the one more log it reads. Before it, the sweep journals each seat the newest
 * attempt refused whose workspace its own listing no longer carries — the one fact `fleet health`, outside cmux,
 * cannot read for itself (`../../../fleet/goneSeats.ts`).
 *
 * A live seat on an open run with no done evidence is a PARK CANDIDATE (no parked seat stays in the fleet). `./closeDonePark.ts` identifies its one Claude Code session
 * from the process tree and the registry, journals its checkpoint — drafts included — when that session holds
 * the run, and closes it; every other case keeps the seat and says why.
 * A seat whose row carries the owner's STANDING-SESSION ruling is never a park candidate at all — it waits for the owner by
 * design (`../../../handover/standingSession.ts`) — and the park half reads that ruling again on its own fresh
 * journal read, so one recorded while the sweep runs still keeps the seat.
 *
 * One connection for the whole sweep: the inventory, every candidate's screen, and every close go over the
 * same client, so a fleet of fifty rows costs one socket rather than fifty.
 */
import { githubToken } from "../../../config.js";
import { type FleetPort, fleetPort } from "../../../fleet/port.js";
import { readProcessStarts } from "../../../fleet/processStarts.js";
import type { HandoverDoc } from "../../../handover/doc.js";
import { runStateOf } from "../../../handover/ledger.js";
import { readRunJournal } from "../../../handover/runStore.js";
import { type StandingSessionRuling, standingSessionRuling } from "../../../handover/standingSession.js";
import { scanBoard } from "../../../handover/store.js";
import { logger } from "../../../lib/logger.js";
import { parseAskLifecycleLog } from "../../../live/ask/lifecycle.js";
import { readAskLifecycleText } from "../../../live/ask/store.js";
import { githubReadGraphql } from "../../../live/github/read.js";
import { readProcessTableWhole } from "../../../live/standing/inspect.js";
import { reviewPostureOf } from "../../../live/turn/reviewPosture.js";
import { codexThreadObserver } from "../../../measurement/codexOpenFiles.js";
import { type CmuxHostSurface, withCmuxSessionHost } from "../../../sessionHarness/cmuxHost.js";
import { doneEvidenceOf, planCloseDone } from "../../../sessions/closeDone.js";
import { type CloseDoneOutcome, countCloseDone } from "../../../sessions/closeDoneOutcome.js";
import type { DoneEvidence } from "../../../sessions/dispatchDoneEvidence.js";
import type { WatchTable } from "../../../sessions/keepAliveSeatClose.js";
import { scanSessions } from "../../../sessions/liveSessionStore.js";
import { foldSessions, parseSessionLog } from "../../../sessions/session.js";
import { readSessionLogText } from "../../../sessions/sessionStore.js";
import { stateHomePaths } from "../../../stateHome.js";
import { claudeHomeDir } from "../../../supervisor/chairRead.js";
import { machineLoadStop } from "../../../worktree/prunePacing.js";
import type { TrashSettled } from "../../../worktree/reclaimTrash.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";
import { productionResidueDeps, type ResidueDeps, reapSeatResidue } from "../cmux/worktreeResidue.js";
import { readRowPullRequests } from "../hand/rowPullRequestsRead.js";
import { resolveHandoverDir } from "../handover/commandSupport.js";
import { type MonitorDeps, productionMonitorDeps } from "../monitor/deps.js";
import { sweepItem } from "./closeDoneCandidate.js";
import { type FleetSweepReads, liveClaudeSessions, runningCmuxApp, sweepFleetUnderLock } from "./closeDoneFleet.js";
import type { KeepAliveSweep } from "./closeDoneKeepAlive.js";
import type { ParkSeatDeps } from "./closeDoneParkLook.js";
import { type CloseDoneSwept, printCloseDoneText } from "./closeDonePrint.js";
import { closedSeats, parkedSeats, type ReclaimReport, reclaimClosedSeats } from "./closeDoneReclaim.js";
import { settleCheckoutTrash } from "./closeDoneTrash.js";
import { boolFlag, parseSessionArgs, sessionUsage, stringFlag, VERB_ARG_OFFSET } from "./core.js";

/** What one sweep needs from its environment, so a test can hand it a fake client and a temp home. */
export interface CloseDoneDeps {
  readonly client: CmuxHostSurface;
  /** The state home holding the session ledger and the run journals. */
  readonly home: string;
  /** The board directory holding the docs. */
  readonly handoverDir: string;
  /** The caller's own workspace id (`CMUX_WORKSPACE_ID`), or `undefined` outside cmux. */
  readonly ownWorkspaceId: string | undefined;
  readonly nowIso: string;
  readonly dryRun: boolean;
  /**
   * Leave every closed seat's worktree on disk.
   *
   * A narrowing switch for an operator who wants the close without the reclaim — not a policy refusal, so
   * it carries no escape-hatch row. The default is to reclaim, because a seat that is over is the cheapest
   * moment its tree will ever be: the daily `worktree prune` row clears roughly fifteen trees in its
   * budget, which a busy day outruns.
   */
  readonly keepWorktrees: boolean;
  /**
   * The process, cwd, kill and checkout seams the residue reap runs through (`../cmux/worktreeResidue.ts`).
   * REQUIRED rather than defaulted, so no caller — a unit test least of all — can reach the real process
   * table and `process.kill` by leaving it out.
   */
  readonly residue: ResidueDeps;
  /**
   * Why no further tree may be deleted right now, or null: the machine's load gate in production
   * (`../../../worktree/prunePacing.ts`), injected so a test does not depend on how busy its machine is.
   */
  readonly loadStop: () => string | null;
  /** The registry and process reads that name a parking seat's session (`./closeDonePark.ts`). */
  readonly parkSeat: ParkSeatDeps;
  /**
   * The running cmux app and the live Claude sessions — a ref is only comparable inside one run of the app, and a
   * session outside cmux could be a refused seat's orphan, so an unreadable either finds no recovery seat gone
   * (`../../../fleet/goneSeats.ts`).
   */
  readonly fleetReads: FleetSweepReads;
  /** The fleet recovery journal the gone seats are judged on and appended to. */
  readonly fleet: FleetPort;
  /**
   * One fresh whole read of the process table, each row with its state, taken per keep-alive seat right before it
   * is judged (`./closeDoneKeepAlive.ts`). REQUIRED, so no test reaches the real `ps` by leaving it out.
   */
  readonly processTable: () => WatchTable;
  /**
   * The seams the idle park's `steer-at-risk` pass runs through (`./closeDonePark.ts`). REQUIRED, like
   * {@link CloseDoneDeps.residue}, so no test reaches the real note launcher or Chrome by leaving it out.
   */
  readonly monitor: MonitorDeps;
}

/**
 * The done evidence for one slug, read from its run journal and its board doc.
 *
 * A journal that cannot be read is treated as no evidence — the safe direction — and said so on stderr,
 * because a read failure that silently kept a row every tick would be a done chat this verb never closes.
 */
function evidenceReader({
  runsDir,
  docsBySlug,
}: {
  runsDir: string;
  docsBySlug: ReadonlyMap<string, HandoverDoc>;
}): (args: { readonly slug: string }) => DoneEvidence | undefined {
  return ({ slug }) => {
    const journal = readRunJournal({ runsDir, slug });
    if (journal.isErr()) {
      logger.error({ msg: `session close-done: could not read ${slug}'s run journal — ${journal.error.message}` });
      return doneEvidenceOf({ doc: docsBySlug.get(slug), events: [], run: undefined });
    }
    return doneEvidenceOf({
      doc: docsBySlug.get(slug),
      events: journal.value.events,
      run: runStateOf({ events: journal.value.events }),
    });
  };
}

/**
 * One slug's latest live standing-session ruling, read from its run journal. A journal that cannot be read answers
 * none here — `evidenceReader` has already said so on stderr — and the park half then keeps the seat on its own
 * unreadable journal, so the unread direction never parks a standing seat.
 */
function standingReader({
  runsDir,
}: {
  runsDir: string;
}): (args: { readonly slug: string }) => StandingSessionRuling | undefined {
  return ({ slug }) => {
    const journal = readRunJournal({ runsDir, slug });
    if (journal.isErr()) {
      return undefined;
    }
    return standingSessionRuling({ events: journal.value.events });
  };
}

/**
 * Run the whole sweep over an already-connected client: plan from the ledger and the live inventory, read
 * each candidate's screen, close what is idle, and return every row's outcome in ledger order.
 *
 * Exported so the sweep is provable against a fake client, a temp ledger and a temp board without a live
 * `cmux` — the socket is the only thing a unit test cannot own.
 *
 * @param deps the client, the state home, the board directory, the caller's own workspace and the clock
 * @returns every open row's outcome, or the message when the live inventory could not be read at all
 */
export async function closeDoneWithClient({
  deps,
}: {
  deps: CloseDoneDeps;
}): Promise<CloseDoneSwept | { readonly error: string }> {
  const workspaces = await deps.client.listWorkspaces();
  if (workspaces.isErr()) {
    return { error: `the live cmux inventory could not be read — ${workspaces.error.message}` };
  }
  const board = scanBoard({ handoverDir: deps.handoverDir });
  if (board.isErr()) {
    return { error: `the board at ${deps.handoverDir} could not be read — ${board.error.message}` };
  }
  const docsBySlug = new Map(board.value.docs.map((doc) => [doc.slug, doc] as const));
  const { events, unreadable } = parseSessionLog({ text: readSessionLogText({ home: deps.home }) });
  if (unreadable.length > 0) {
    logger.error({
      msg: `session close-done: ${String(unreadable.length)} line(s) of the session ledger could not be read`,
    });
  }
  const asks = parseAskLifecycleLog({ text: readAskLifecycleText({ home: deps.home }) });
  if (asks.unreadable.length > 0) {
    logger.error({
      msg: `session close-done: ${String(asks.unreadable.length)} line(s) of the ask-lifecycle log could not be read`,
    });
  }
  const rows = foldSessions({ events });
  const plan = planCloseDone({
    askEvents: asks.events,
    evidenceFor: evidenceReader({ docsBySlug, runsDir: stateHomePaths({ home: deps.home }).runs }),
    nowIso: deps.nowIso,
    ownWorkspaceId: deps.ownWorkspaceId,
    reviewPostureFor: ({ child }) =>
      reviewPostureOf({
        askIdentity: child.lifecycle,
        home: deps.home,
        postedDigest: child.lifecycle.firstAnswer?.answerDigest,
      }),
    rows,
    standingFor: standingReader({ runsDir: stateHomePaths({ home: deps.home }).runs }),
    workspaces: workspaces.value,
  });
  const outcomes: CloseDoneOutcome[] = [];
  const sweep: KeepAliveSweep = { blind: false, retiring: new Set() };
  for (const item of plan) {
    outcomes.push(await sweepItem({ deps, item, sweep }));
  }
  const fleet = await sweepFleetUnderLock({
    client: deps.client,
    dryRun: deps.dryRun,
    fleet: deps.fleet,
    home: deps.home,
    nowIso: deps.nowIso,
    ownWorkspaceId: deps.ownWorkspaceId,
    reads: deps.fleetReads,
    rows,
    workspaces: workspaces.value,
  });
  return { ...(await reapThenReclaim({ deps, outcomes })), goneSeats: fleet.gone, shells: fleet.shells };
}

/**
 * The closed seats' residue reap, then their tree reclaim — the reap BEFORE, and whatever `--keep-worktrees`
 * says: a daemon is a process, not the tree, and a removed directory is one whose processes no `lsof` cwd read
 * can place any more.
 *
 * The trash is SETTLED last and never deleted here (`./closeDoneTrash.ts`): a batch is a seat's whole
 * `node_modules`, which this sweep's reading budget cannot finish, so the delete is `worktree prune --apply`'s.
 */
async function reapThenReclaim({
  deps,
  outcomes,
}: {
  deps: CloseDoneDeps;
  outcomes: readonly CloseDoneOutcome[];
}): Promise<Omit<CloseDoneSwept, "goneSeats" | "shells">> {
  const seats = closedSeats({ outcomes });
  const residue = await reapSeatResidue({
    client: deps.client,
    deps: deps.residue,
    dryRun: deps.dryRun,
    home: deps.home,
    seats: [...seats, ...parkedSeats({ outcomes })],
  });
  let reclaimed: ReclaimReport = { outcomes: [], refusal: null };
  if (!deps.keepWorktrees) {
    const { client, dryRun, home, loadStop } = deps;
    reclaimed = await reclaimClosedSeats({
      deps: { client, dryRun, home, loadStop, nowMs: Date.parse(deps.nowIso) },
      seats,
    });
  }
  let trash: TrashSettled | null = null;
  if (!deps.dryRun) {
    trash = settleCheckoutTrash({ home: deps.home });
  }
  return { outcomes, reclaimed, residue, trash };
}

/**
 * The park half's live reads: the Claude Code session registry, process starts, Codex's open files and GitHub.
 *
 * @returns the reads `closeDoneWithClient` proves a seat parked with
 */
function productionParkSeat({ home }: { home: string }): ParkSeatDeps {
  return {
    registry: () => scanSessions({ sessionsDir: `${claudeHomeDir()}/sessions` }),
    starts: readProcessStarts,
    // A FRESH lazy scan per look, so the last look before a close re-proves who holds the thread;
    // `lsof` runs only for a seat with no Claude Code session in its tree.
    codexThreads: codexThreadObserver,
    // The token resolves only when a seat proved parked asks, so a sweep with nothing to park reads nothing.
    ownPullRequests: ({ slug }) =>
      readRowPullRequests({ graphql: githubReadGraphql({ token: githubToken({ home }) }), home, row: slug }),
  };
}

/**
 * `session close-done` — the done-chat sweep, over a live cmux.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runSessionCloseDone(argv: readonly string[]): Promise<number> {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: sessionUsage({ verb: "close-done" }) });
    return EXIT_OK;
  }
  const parsed = parseSessionArgs({ rest, verb: "close-done" });
  if (parsed.isErr()) {
    parsed.error.forEach((error) => {
      logger.error({ msg: error });
    });
    logger.error({ msg: sessionUsage({ verb: "close-done" }) });
    return EXIT_USAGE;
  }
  const home = resolveHome({ named: stringFlag({ name: "home", parsed: parsed.value }) });
  const dryRun = boolFlag({ name: "dry-run", parsed: parsed.value });
  const own = process.env["CMUX_WORKSPACE_ID"]?.trim();
  const swept = await withCmuxSessionHost({
    body: ({ host }) =>
      closeDoneWithClient({
        deps: {
          client: host,
          dryRun,
          fleet: fleetPort(),
          fleetReads: { readApp: runningCmuxApp, readLiveSessions: liveClaudeSessions },
          handoverDir: resolveHandoverDir({ dir: stringFlag({ name: "dir", parsed: parsed.value }), home }),
          home,
          keepWorktrees: boolFlag({ name: "keep-worktrees", parsed: parsed.value }),
          // Routine always: the sweep takes one tree inside a tick's reading budget, and the disk-pressure drain
          // is the hourly prune's (`worktree/prunePacing.ts`).
          loadStop: () => machineLoadStop({ diskPressure: false }),
          monitor: productionMonitorDeps(),
          nowIso: new Date().toISOString(),
          ownWorkspaceId: own === undefined || own.length === 0 ? undefined : own,
          parkSeat: productionParkSeat({ home }),
          processTable: readProcessTableWhole,
          residue: productionResidueDeps({ home }),
        },
      }),
  });
  if ("error" in swept) {
    logger.error({ msg: `session close-done: ${swept.error}` });
    return EXIT_ERROR;
  }
  const counts = countCloseDone({ outcomes: swept.outcomes });
  const shellsFailed = swept.shells.filter((shell) => shell.kind === "close-failed").length;
  if (boolFlag({ name: "json", parsed: parsed.value })) {
    // Every field of the sweep, by name: `CloseDoneSwept` is exactly the report.
    logger.out({ line: JSON.stringify({ counts, dryRun, ...swept }) });
  } else {
    printCloseDoneText({ dryRun, swept });
  }
  return counts.failed > 0 || shellsFailed > 0 ? EXIT_ERROR : EXIT_OK;
}

export const sessionCloseDoneCommand = defineCommand({ run: runSessionCloseDone });
