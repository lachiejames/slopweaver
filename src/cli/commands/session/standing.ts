/**
 * `slopweaver session standing` — one call answering the two questions the supervisor must ask about the
 * sessions it keeps alive by contract (`skills/supervisor/SKILL.md`'s "Standing sessions" check): the Slack
 * loop, the credential keep-alive and the supervisor chat are ALIVE, and they are running the code and the
 * prose `main` currently carries. There is no recipe scheduler session.
 *
 * ## Liveness is read from each session's own records, not from the ledger
 *
 * The loop's liveness comes from the arm record and the heartbeat — see `../../../live/standing/sessionLiveness.ts`'s header for
 * the measurement where the ledger's own fold produced a whole-day false negative under a healthy
 * listener. `--loop-session-key` is still accepted and still useful, but it now supplies ATTRIBUTION (which
 * slug, which worktree) rather than deciding whether the bot is dark; omit it and the loop is still measured.
 *
 * ## Why freshness is here rather than in a verb of its own
 *
 * Because the two facts are only useful together. A live session on a two-day-old tree looks perfect on every
 * liveness gauge in this repository and silently applies none of the fixes that landed — that is precisely
 * what a day-long stale tree does — and a supervisor who has to remember to run a second verb to notice
 * is a supervisor who will not. One call, both answers, and a non-zero exit for either.
 *
 * ## The exit code IS the signal
 *
 * `EXIT_EXPECTED_EMPTY` (3) for a session that is not live, is `stale`, or could not be measured — so
 * `slopweaver session standing || <surface it>` is a whole supervision idiom in one line, the same shape
 * `listen status` and `events tail` already keep. An unmeasurable session exits 3
 * deliberately: not knowing which commit the bot is on is a fact to act on, never a clean bill.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";

import { type ClaudeWatchLiveness, type ClaudeWatchLiveSet, watchLivenessLine } from "../../../claude/watchSession.js";
import { publishSupervisorEvent, readSupervisorEventsTail } from "../../../events/store.js";
import { logger } from "../../../lib/logger.js";
import { type StandingFreshnessGrade, standingSessionLines } from "../../../live/standing/freshness.js";
import {
  type ProcessSnapshot,
  productionStandingInspectDeps,
  readProcessSnapshot,
  type StandingInspectDeps,
} from "../../../live/standing/inspect.js";
import { pluginDirAmong } from "../../../live/standing/processes.js";
import { keepAliveLiveness, loopLiveness } from "../../../live/standing/sessionLiveness.js";
import { newestStandingKind, standingStreamEvent } from "../../../live/standing/streamEvents.js";
import { resolveSupervisorBinCheckout, SUPERVISOR_CLI_RELATIVE_PATH } from "../../../live/standing/supervisor.js";
import { mainCheckoutsFromProfile } from "../../../profileStore.js";
import { foldSessions, parseSessionLog } from "../../../sessions/session.js";
import { readSessionLogText } from "../../../sessions/sessionStore.js";
import { type ChairRead, chairViolatesRequirement, judgeChair } from "../../../supervisor/chairGate.js";
import type { ChairRequirement } from "../../../supervisor/chairPolicy.js";
import { readRecordedChairHost } from "../../../supervisor/recordedChairHost.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";
import { boolFlag, parseSessionArgs, sessionUsage, stringFlag, VERB_ARG_OFFSET } from "./core.js";
import {
  productionStandingChairReader,
  type StandingChairReader,
  standingChairLines,
  standingChairRead,
  standingChairRequirement,
} from "./standingChair.js";
import {
  keepAliveFreshness,
  loopFreshness,
  mainCheckoutWords,
  reportProblems,
  type StandingFreshnessResult,
  supervisorFreshness,
} from "./standingFreshness.js";
import { findAnySession } from "./standingLedger.js";
import { type StandingWorkspaceRead, standingWorkspaceRead } from "./standingWorkspaces.js";

/** One standing session's half of the answer. */
export interface StandingHalf {
  readonly live: boolean;
  /** How current it is. `undefined` only when there was nothing at all to measure. */
  readonly grade: StandingFreshnessGrade | undefined;
  readonly freshness: StandingFreshnessResult["freshness"];
}

/** One standing-session liveness AND freshness answer, folded into a single question the supervisor asks once. */
export interface SessionStandingSnapshot {
  readonly loop: StandingHalf & {
    readonly sessionKey: string | undefined;
    readonly cwd: string | undefined;
    readonly armId: string | undefined;
    readonly grade: StandingFreshnessGrade | undefined;
  };
  /**
   * The credential keep-alive loop. Its liveness comes from the record `claude watch` stamps about
   * itself each tick — there is no listener and no registration to read, and `claude/watchSession.ts`
   * carries the six-day outage that is the reason it now writes one.
   */
  readonly keepAlive: StandingHalf &
    ClaudeWatchLiveSet & {
      /** The reconciled verdict's state — `claude/watchSession.ts` carries the precedence. */
      readonly state: ClaudeWatchLiveness["state"];
      /** The run the record names, for attribution. */
      readonly watchId: string | undefined;
      /** The checkout the record names, for attribution. Freshness measures every running candidate's. */
      readonly cwd: string | undefined;
      /** Why it reads as it does, in one sentence — the state name alone does not say what it costs. */
      readonly why: string;
    };
  readonly supervisor: SupervisorStanding;
  readonly problems: readonly string[];
}

/**
 * The supervisor's half — freshness ONLY, with no liveness term.
 *
 * Deliberately not a {@link StandingHalf}. Whether the owner's single intake chat is open is the owner's call rather than a
 * fault this gauge reports, and the session running `session standing` is usually the supervisor itself, so a
 * liveness answer here would be either self-evident or a false alarm. What is NOT self-evident, and what the
 * finding this closes actually measured, is which commit the main checkout and the supervisor's own prose are
 * on.
 */
export interface SupervisorStanding {
  /** How current it is, folded over whichever of its two trees resolved. */
  readonly grade: StandingFreshnessGrade | undefined;
  readonly freshness: StandingFreshnessResult["freshness"];
  /** The declared main checkout its absolute-path CLI runs out of, or `undefined` when that did not resolve. */
  readonly binPath: string | undefined;
  /** The pinned supervisor workspace's working directory, or `undefined` when no supervisor chat is open. */
  readonly workspaceCwd: string | undefined;
  /**
   * Which model each Claude session in the pinned workspace is REALLY on, read from its transcript every call —
   * the per-turn chair check, which exists because a safeguard fallback once reseated the chair on Opus
   * with nothing noticing. `unresolved` when no supervisor chat is open, which stays the owner's call and not a fault.
   */
  readonly chair: ChairRead;
  /** What the chair must be on, from the plan lanes (`../../../supervisor/chairPolicy.ts`) — the bar `chair` is judged against. */
  readonly chairRequirement: ChairRequirement;
}

/**
 * Build the standing snapshot: liveness from each session's own records, freshness from its live process tree.
 *
 * @param home the resolved state home
 * @param loopSessionKey the ledger key the caller resolved as the Slack loop's own — attribution only; the
 *   loop's liveness and freshness are measured whether or not it is passed
 * @param nowMs the current instant, epoch milliseconds
 * @param readWorkspaces the cmux listing seam, injected so a unit test measures no live fleet — the loop's
 *   half used to reach cmux only when a session key named a cwd, and the supervisor's half asks
 *   unconditionally, so without a seam this function would open a socket on every call
 * @param readKeepAliveProcessSnapshot the keep-alive's one FALLIBLE process-table read, taken exactly once
 *   and shared by its verdict and its freshness, so the two describe the same instant
 * @param inspectDeps the git/process seams every tree measurement reads, injected so a test runs no git
 * @param readChair judges the Claude sessions among the pinned workspace's pids, injected so a test reads a
 *   frozen transcript rather than the operator's live registry
 * @param chairRequirement what the chair must be on, from the plan lanes the shell read once
 * @returns the folded snapshot, carrying every read that could not be taken
 */
export async function buildSessionStandingSnapshot({
  home,
  loopSessionKey,
  nowMs,
  readWorkspaces = standingWorkspaceRead,
  readKeepAliveProcessSnapshot = readProcessSnapshot,
  inspectDeps: deps = productionStandingInspectDeps(),
  readChair = productionStandingChairReader,
  chairRequirement,
}: {
  readonly home: string;
  readonly loopSessionKey: string | undefined;
  readonly nowMs: number;
  readonly chairRequirement: ChairRequirement;
  readonly readWorkspaces?: (options: { readonly loopCwd: string | undefined }) => Promise<StandingWorkspaceRead>;
  readonly readKeepAliveProcessSnapshot?: () => ProcessSnapshot;
  readonly inspectDeps?: StandingInspectDeps;
  readonly readChair?: StandingChairReader;
}): Promise<SessionStandingSnapshot> {
  const ledger =
    loopSessionKey === undefined
      ? undefined
      : findAnySession({
          items: foldSessions({ events: parseSessionLog({ text: readSessionLogText({ home }) }).events }),
          sessionKey: loopSessionKey,
        });
  const liveness = loopLiveness({ home, nowMs });
  const workspaces = await readWorkspaces({ loopCwd: ledger?.cwd });
  const loop = loopFreshness({
    deps,
    fallbackBin: ledger?.cwd,
    pid: liveness.pid,
    pluginDirPids: workspaces.loopPids,
  });
  const supervisor = supervisorStanding({ chairRequirement, deps, home, readChair, workspaces });
  const keepAlive = keepAliveStanding({ deps, home, nowMs, snapshot: readKeepAliveProcessSnapshot() });
  return {
    keepAlive: keepAlive.half,
    loop: {
      armId: liveness.armId,
      cwd: ledger?.cwd,
      freshness: loop.freshness,
      grade: loop.freshness?.grade,
      live: liveness.live,
      // `findAnySession` matched the ledger row ON this key, so the row can never name a different one.
      sessionKey: loopSessionKey,
    },
    problems: [
      ...liveness.problems,
      ...loop.problems,
      ...workspaces.problems,
      ...keepAlive.problems,
      ...supervisor.problems,
    ],
    supervisor: supervisor.half,
  };
}

/**
 * The keep-alive loop's half: whether `claude watch` is running and still beginning ticks, whether a SECOND
 * one is running beside it, and how far every running one's checkout has drifted.
 *
 * It has no cmux read and no provider call — the whole answer is one file and one process-table snapshot,
 * which is what makes it cheap enough for the supervisor's every-tick sweep to ask. The snapshot is taken by
 * the caller and read here twice, by the verdict and by the freshness, never re-read.
 *
 * @param deps the git read seams for the freshness measurement
 * @param home the resolved state home, holding the loop's own record
 * @param nowMs the current instant, epoch milliseconds
 * @param snapshot the one process-table reading the keep-alive half is judged against
 * @returns the half a caller folds into the snapshot, plus every read that could not be taken
 */
function keepAliveStanding({
  deps,
  home,
  nowMs,
  snapshot,
}: {
  readonly deps: StandingInspectDeps;
  readonly home: string;
  readonly nowMs: number;
  readonly snapshot: ProcessSnapshot;
}): { readonly half: SessionStandingSnapshot["keepAlive"]; readonly problems: readonly string[] } {
  const liveness = keepAliveLiveness({ home, nowMs, snapshot });
  const { candidates, duplicates, queued, state } = liveness.liveness;
  const measured = keepAliveFreshness({ candidates, deps });
  return {
    half: {
      candidates,
      cwd: liveness.cwd,
      duplicates,
      freshness: measured.freshness,
      grade: measured.freshness?.grade,
      live: liveness.live,
      queued,
      state,
      watchId: liveness.watchId,
      why: watchLivenessLine({ liveness: liveness.liveness }),
    },
    problems: [...(liveness.liveness.state === "unmeasured" ? [liveness.liveness.problem] : []), ...measured.problems],
  };
}

/**
 * The supervisor's half: the declared main checkout its absolute-path CLI runs out of, and the pinned chat's
 * own plugin-dir, measured and graded together.
 *
 * @param deps the git/process read seams
 * @param home the resolved state home, holding the `mainCheckouts` declaration
 * @param workspaces the one cmux listing this report took
 * @param readChair judges the Claude sessions among the pinned workspace's pids
 * @param chairRequirement what the chair must be on
 * @returns the half a caller folds into the snapshot, plus every read that could not be taken
 */
function supervisorStanding({
  deps,
  home,
  workspaces,
  readChair,
  chairRequirement,
}: {
  readonly deps: StandingInspectDeps;
  readonly home: string;
  readonly workspaces: StandingWorkspaceRead;
  readonly readChair: StandingChairReader;
  readonly chairRequirement: ChairRequirement;
}): { readonly half: SupervisorStanding; readonly problems: readonly string[] } {
  const chair = standingChairRead({ pinHost: readRecordedChairHost({ home }), readChair, workspaces });
  const chairVerdict = judgeChair({ read: chair, requirement: chairRequirement });
  // No pinned chat is reported by the workspace half already; a chair read that failed is this half's to say.
  const chairWasRead = chair.kind === "resolved" || chair.cause !== "no-chair";
  const chairProblems =
    chairWasRead && chairVerdict.kind === "refused"
      ? [`supervisor chair: ${chairVerdict.detail}`, ...chairVerdict.lines.map((line) => line.trim())]
      : [];
  const binCheckout = resolveSupervisorBinCheckout({
    carriesCli: ({ path }) => existsSync(join(path, SUPERVISOR_CLI_RELATIVE_PATH)),
    checkoutPaths: mainCheckoutsFromProfile({ home }).map((checkout) => checkout.path),
  });
  const measured = supervisorFreshness({
    binPath: binCheckout.value,
    deps,
    pluginDir: pluginDirAmong({ pids: workspaces.supervisorPids, processes: deps.processes() }),
  });
  return {
    half: {
      binPath: binCheckout.value,
      chair,
      chairRequirement,
      freshness: measured.freshness,
      grade: measured.freshness?.grade,
      workspaceCwd: workspaces.supervisorCwd,
    },
    problems: [...binCheckout.problems, ...measured.problems, ...chairProblems],
  };
}

/**
 * Publish each session's freshness onto the supervisor stream, but only where the answer has CHANGED.
 *
 * Best-effort by the stream's own contract (`events/store.ts`): a failure to publish is narrated and never
 * sinks the reading the caller actually asked for.
 *
 * @param home the resolved state home
 * @param nowMs the current instant, epoch milliseconds
 * @param snapshot the freshly-built snapshot
 */
function publishTransitions({
  home,
  nowMs,
  snapshot,
}: {
  readonly home: string;
  readonly nowMs: number;
  readonly snapshot: SessionStandingSnapshot;
}): void {
  const tail = readSupervisorEventsTail({ home });
  const events = tail.isOk() ? tail.value : [];
  for (const freshness of [snapshot.loop.freshness, snapshot.keepAlive.freshness, snapshot.supervisor.freshness]) {
    if (freshness === undefined) {
      continue;
    }
    const event = standingStreamEvent({
      atIso: new Date(nowMs).toISOString(),
      freshness,
      previousKind: newestStandingKind({ events, session: freshness.session }),
    });
    if (event === undefined) {
      continue;
    }
    const failure = publishSupervisorEvent({ event, home });
    logger.error({
      msg:
        failure === undefined
          ? `session standing: published ${event.kind} — ${event.why}`
          : `session standing: ${failure}`,
    });
  }
}

/** Render the snapshot as the lines a human reads — liveness first, then each session's trees. */
function renderSnapshot({ snapshot }: { readonly snapshot: SessionStandingSnapshot }): void {
  const { keepAlive, loop, supervisor } = snapshot;
  logger.out({
    line:
      `loop: ${loop.live ? "live" : "NOT live"}` +
      `${loop.armId === undefined ? " (unarmed)" : ` (arm ${loop.armId})`}` +
      `${loop.sessionKey === undefined ? "" : ` ${loop.sessionKey}`}`,
  });
  logger.out({ line: keepAlive.why });
  logger.out({
    line:
      `supervisor: main checkout ${mainCheckoutWords({ supervisor })}` +
      `${supervisor.workspaceCwd === undefined ? " — no supervisor chat open, so its plugin-dir is not measured" : ` (chat in ${supervisor.workspaceCwd})`}`,
  });
  standingChairLines({ chair: supervisor.chair, requirement: supervisor.chairRequirement }).forEach((line) => {
    logger.out({ line });
  });
  for (const freshness of [loop.freshness, keepAlive.freshness, supervisor.freshness]) {
    if (freshness !== undefined) {
      standingSessionLines({ freshness }).forEach((line) => {
        logger.out({ line });
      });
    }
  }
}

/**
 * Whether the snapshot is the all-clear that exits 0 — every session live, none stale or unmeasured, and
 * exactly one keep-alive writing.
 *
 * A duplicate keep-alive is NOT clear however healthy each copy is: two watches double the credential
 * writers and fight over the one record. A watch queued with `--wait` is not a writer, so it alone does not
 * break the all-clear. This is where a second start the admission check could not stop becomes visible —
 * it is exposed on the next sweep, not prevented.
 *
 * @param snapshot the folded snapshot
 * @returns true when nothing needs anyone's attention
 */
export function standingIsClear({ snapshot }: { readonly snapshot: SessionStandingSnapshot }): boolean {
  const gradeIsClear = ({ grade }: { readonly grade: StandingFreshnessGrade | undefined }): boolean =>
    grade === "current" || grade === "behind";
  return (
    [snapshot.loop, snapshot.keepAlive].every((half) => half.live && gradeIsClear({ grade: half.grade })) &&
    snapshot.keepAlive.duplicates.length === 0 &&
    gradeIsClear({ grade: snapshot.supervisor.grade }) &&
    !chairViolatesRequirement({ read: snapshot.supervisor.chair, requirement: snapshot.supervisor.chairRequirement })
  );
}

/**
 * Run the `session standing` verb.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runSessionStanding(argv: readonly string[]): Promise<number> {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: sessionUsage({ verb: "standing" }) });
    return EXIT_OK;
  }
  const parsed = parseSessionArgs({ rest, verb: "standing" });
  if (parsed.isErr()) {
    parsed.error.forEach((error) => {
      logger.error({ msg: error });
    });
    logger.error({ msg: sessionUsage({ verb: "standing" }) });
    return EXIT_USAGE;
  }
  const home = resolveHome({ named: stringFlag({ name: "home", parsed: parsed.value }) });
  const nowMs = Date.now();
  const snapshot = await buildSessionStandingSnapshot({
    chairRequirement: await standingChairRequirement({ home, nowMs }),
    home,
    loopSessionKey: stringFlag({ name: "loop-session-key", parsed: parsed.value }),
    nowMs,
  });
  if (boolFlag({ name: "json", parsed: parsed.value })) {
    logger.out({ line: JSON.stringify(snapshot) });
  } else {
    renderSnapshot({ snapshot });
  }
  reportProblems({ prefix: "session standing", problems: snapshot.problems });
  publishTransitions({ home, nowMs, snapshot });
  return standingIsClear({ snapshot }) ? EXIT_OK : EXIT_EXPECTED_EMPTY;
}

export const sessionStandingCommand = defineCommand({ run: runSessionStanding });
