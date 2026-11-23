/**
 * The shared harness of the `session close-done` cases: a temp state home, ledger, run-journal and board
 * writers, the deps one sweep needs, a registry seam and the readers of a sweep's outcome. Every test file that
 * uses it registers `afterEach(removeFixtureDirs)` itself.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ResidueDeps, ResidueReport } from "../../../../../cli/commands/cmux/worktreeResidue.js";
import type { MonitorDeps } from "../../../../../cli/commands/monitor/deps.js";
import type { CloseDoneDeps, closeDoneWithClient } from "../../../../../cli/commands/session/closeDone.js";
import type { FleetSweepReads } from "../../../../../cli/commands/session/closeDoneFleet.js";
import type { ParkSeatDeps } from "../../../../../cli/commands/session/closeDoneParkLook.js";
import type { ReclaimReport } from "../../../../../cli/commands/session/closeDoneReclaim.js";
import type { CmuxClient, CmuxWorkspaceSummary } from "../../../../../cmux/client.js";
import type { LiveSessionStart } from "../../../../../fleet/goneSeats.js";
import type { FleetPort } from "../../../../../fleet/port.js";
import { appendRunEvent } from "../../../../../handover/runStore.js";
import { ok, type Result } from "../../../../../lib/result.js";
import type { CodexThreadObserver } from "../../../../../measurement/codexSessions.js";
import type { CloseDoneOutcome } from "../../../../../sessions/closeDoneOutcome.js";
import type { WatchTable } from "../../../../../sessions/keepAliveSeatClose.js";
import type { SessionRecord } from "../../../../../sessions/liveSessions.js";
import { foldSessions, parseSessionLog } from "../../../../../sessions/session.js";
import { appendSessionEvent, readSessionLogText } from "../../../../../sessions/sessionStore.js";
import { stateHomePaths } from "../../../../../stateHome.js";
import { memoryFleetPort } from "../../../../fleetStoreFixture.js";
import { recordingMonitorDeps } from "../../../../monitorDepsFixture.js";
import { hostOverFake } from "../../../sessionHarness/fakeCmux.js";
import { fakeResidue } from "./closeDoneFakeCmux.js";

/** Every fixture directory the file under test has minted, so its `afterEach(removeFixtureDirs)` can remove them. */
const fixtureDirs: string[] = [];

/** Remove every fixture directory minted since the last call; each test file registers it as its own `afterEach`. */
export function removeFixtureDirs(): void {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
}

/** The instant every sweep is judged at. */
export const NOW = "2026-09-03T10:00:00.000Z";
/** The instant every fixture seat was spawned. */
export const SPAWNED_AT = "2026-09-03T08:00:00.000Z";
/** Claude Code at rest: its input box above its footer — the screen a forced close needs (`sessions/closeForce.ts`). */
export const CLAUDE_IDLE = "❯ \n? for shortcuts";

/**
 * Build an argv the router would hand a verb: `[node, cli, noun, verb, …rest]`.
 *
 * @returns the full argv.
 */
export function argv({ rest }: { rest: readonly string[] }): readonly string[] {
  return ["node", "slopweaver", "session", "close-done", ...rest];
}

/**
 * A fresh state home with an empty `handovers/` board inside it, and the one in-memory fleet store the case shares.
 *
 * @returns the home, its board directory and the fleet store.
 */
export function home(): { readonly home: string; readonly handoverDir: string; readonly fleet: FleetPort } {
  const dir = mkdtempSync(join(tmpdir(), "session-close-done-"));
  fixtureDirs.push(dir);
  const handoverDir = stateHomePaths({ home: dir }).handovers;
  mkdirSync(handoverDir, { recursive: true });
  return { fleet: memoryFleetPort(), handoverDir, home: dir };
}

/**
 * One live workspace as `cmux list` reports it.
 *
 * @returns the workspace summary.
 */
export function workspace(over: Partial<CmuxWorkspaceSummary> = {}): CmuxWorkspaceSummary {
  return {
    currentDirectory: "/w/.claude/worktrees/a-doc",
    description: undefined,
    latestConversationMessage: undefined,
    latestSubmittedAtIso: undefined,
    latestSubmittedMessage: undefined,
    pinned: false,
    selected: false,
    title: "a doc",
    windowId: "window:1",
    workspaceId: "id-1",
    workspaceRef: "workspace:1",
    ...over,
  };
}

/** Record one spawned row on the ledger. */
export function spawnedRow({
  home: stateHome,
  slug,
  workspaceRef,
  cwd = `/w/.claude/worktrees/${slug}`,
}: {
  home: string;
  slug: string;
  workspaceRef: string;
  cwd?: string;
}): void {
  appendSessionEvent({
    event: {
      branch: slug,
      cwd,
      kind: "spawned",
      sessionKey: slug,
      slug,
      surfaceRef: "surface:1",
      tsIso: SPAWNED_AT,
      workspaceRef,
    },
    home: stateHome,
  });
}

/** Start a run for a slug, and finish it when asked. */
export function run({ home: stateHome, slug, finished }: { home: string; slug: string; finished: boolean }): void {
  const runsDir = stateHomePaths({ home: stateHome }).runs;
  appendRunEvent({ event: { atIso: SPAWNED_AT, branch: slug, docHash: "h", kind: "started" }, runsDir, slug });
  if (finished) {
    appendRunEvent({ event: { atIso: "2026-09-03T09:00:00.000Z", kind: "finished", residue: [] }, runsDir, slug });
  }
}

/** Write one doc onto the board. */
export function writeDoc({
  handoverDir,
  slug,
  lines,
}: {
  handoverDir: string;
  slug: string;
  lines: readonly string[];
}): void {
  const text = ["---", `slug: ${slug}`, "summary: a thing", ...lines, "---", "", "body"].join("\n");
  writeFileSync(join(handoverDir, `${slug}.md`), text, "utf8");
}

/** The fake cmux app read: unknown without a start, and a new process after the first read when it restarts. */
function appReader({
  appRestartsMidSweep,
  appStartedMs,
}: {
  appRestartsMidSweep: boolean;
  appStartedMs: number | undefined;
}): FleetSweepReads["readApp"] {
  let appReads = 0;
  return () => {
    appReads += 1;
    if (appStartedMs === undefined) {
      return undefined;
    }
    const restarted = appRestartsMidSweep && appReads > 1;
    return restarted ? { pid: 901, startedMs: appStartedMs + 60_000 } : { pid: 900, startedMs: appStartedMs };
  };
}

/** The fake process-table read: `processes` first, then `laterProcesses` on every read after when a case sets it. */
function tableReader({
  laterProcesses,
  processes,
}: {
  laterProcesses: WatchTable | undefined;
  processes: WatchTable;
}): () => WatchTable {
  let tableReads = 0;
  return () => {
    tableReads += 1;
    if (tableReads > 1 && laterProcesses !== undefined) {
      return laterProcesses;
    }
    return processes;
  };
}

/**
 * The deps one sweep needs, over a fake client handed in as the cmux host surface production builds.
 *
 * `keepWorktrees` defaults to TRUE here and nowhere else: these cases are about which chats close, and a
 * reclaim pass reading a real repository through them would make every one of them depend on git. The
 * wiring has its own case, which passes `false`.
 *
 * @returns the sweep's deps.
 */
export function deps({
  client,
  fixture,
  appStartedMs,
  appRestartsMidSweep = false,
  dryRun = false,
  keepWorktrees = true,
  liveSessions = ok([]),
  monitor = recordingMonitorDeps({ nowIso: NOW }).deps,
  ownWorkspaceId,
  parkSeat = registry({ records: [] }),
  processes = ok([]),
  laterProcesses,
  residue = fakeResidue().residue,
}: {
  client: CmuxClient;
  fixture: { readonly home: string; readonly handoverDir: string; readonly fleet: FleetPort };
  /** When the fake cmux app started; absent reads as unknown, so no recovery seat is ever judged gone. */
  appStartedMs?: number;
  /** Every read after the first sees a different app process, as if cmux restarted while the sweep listed it. */
  appRestartsMidSweep?: boolean;
  dryRun?: boolean;
  keepWorktrees?: boolean;
  /** What the Claude session registry answers: none live by default. */
  liveSessions?: Result<readonly LiveSessionStart[], string>;
  /**
   * The idle park's monitor seams. Absent records into nothing: a seat that parks on an UNSTEERED row runs no pass,
   * and a steered one is its own case, which passes recording seams to read.
   */
  monitor?: MonitorDeps;
  ownWorkspaceId?: string;
  parkSeat?: ParkSeatDeps;
  /** What every read of the process table answers: an empty table unless a case runs a keep-alive. */
  processes?: WatchTable;
  /** What every read of the process table after the first answers, when it differs — a process reparented between. */
  laterProcesses?: WatchTable;
  residue?: ResidueDeps;
}): CloseDoneDeps {
  return {
    client: hostOverFake({ client }),
    dryRun,
    fleet: fixture.fleet,
    fleetReads: { readApp: appReader({ appRestartsMidSweep, appStartedMs }), readLiveSessions: () => liveSessions },
    handoverDir: fixture.handoverDir,
    home: fixture.home,
    keepWorktrees,
    loadStop: () => null,
    monitor,
    nowIso: NOW,
    ownWorkspaceId,
    parkSeat,
    processTable: tableReader({ laterProcesses, processes }),
    residue,
  };
}

/** The process start every fake seat's registry record and `ps` listing agree on — before {@link NOW}. */
const PROC_START = "Thu Sep  3 08:00:00 2026";

/** A Codex observer that sees no thread held — the seat a case does not run on Codex. */
const NO_CODEX_THREAD: CodexThreadObserver = () => ({ kind: "not-observed", why: "no Codex process holds it" });

/**
 * A whole GitHub read finding no pull request on the run's branches — the seat a case does not land.
 *
 * @returns a read of `parked-doc` at `acme/widget` holding no pull request
 */
export const NO_OWN_PULL_REQUEST: ParkSeatDeps["ownPullRequests"] = async () => ({
  branches: ["parked-doc"],
  kind: "read",
  pulls: [],
  repo: "acme/widget",
});

/**
 * A registry and a `ps` listing over hand-built records, each pid listed as started at {@link PROC_START}.
 *
 * @param codexThread what Codex's open files say about a thread on every look; none held unless a case names one
 * @param codexThreads a fresh observer per look, for a case whose holder moves between looks
 * @param starts extra pids the `ps` listing names, a Codex seat's own among them
 * @param ownPullRequests what GitHub says of the run's own pull requests; a whole read finding none unless a case names one
 * @returns the park seat's registry deps.
 */
export function registry({
  codexThread = NO_CODEX_THREAD,
  codexThreads,
  ownPullRequests = NO_OWN_PULL_REQUEST,
  records,
  refused = [],
  starts = [],
}: {
  codexThread?: CodexThreadObserver;
  codexThreads?: () => CodexThreadObserver;
  ownPullRequests?: ParkSeatDeps["ownPullRequests"];
  records: readonly SessionRecord[];
  refused?: readonly string[];
  starts?: readonly (readonly [number, string])[];
}): ParkSeatDeps {
  let perLook = (): CodexThreadObserver => codexThread;
  if (codexThreads !== undefined) {
    perLook = codexThreads;
  }
  return {
    codexThreads: perLook,
    ownPullRequests,
    registry: () => ({ records, refused, unreadable: undefined }),
    starts: () => ({
      starts: new Map([...records.map((record) => [record.pid, PROC_START] as const), ...starts]),
    }),
  };
}

/**
 * One interactive Claude Code session's registry record.
 *
 * @returns the session record.
 */
export function sessionRecord(over: Partial<SessionRecord> = {}): SessionRecord {
  return {
    cwd: "/w/.claude/worktrees/parked-doc",
    entrypoint: "cli",
    kind: "interactive",
    name: "parked-doc",
    pid: 4242,
    procStart: PROC_START,
    sessionId: "session-parked",
    startedAtMs: 0,
    status: "idle",
    ...over,
  };
}

/**
 * The outcomes of a sweep that must have succeeded — throws, rather than branching, when it did not.
 *
 * @returns the sweep's outcomes.
 */
export function outcomesOf(swept: Awaited<ReturnType<typeof closeDoneWithClient>>): readonly CloseDoneOutcome[] {
  if (!("outcomes" in swept)) {
    throw new Error(`sweep failed: ${swept.error}`);
  }
  return swept.outcomes;
}

/**
 * The reclaim report of a sweep that must have succeeded — throws, rather than branching, when it did not.
 *
 * @returns the sweep's reclaim report.
 */
export function reclaimOf(swept: Awaited<ReturnType<typeof closeDoneWithClient>>): ReclaimReport {
  if (!("reclaimed" in swept)) {
    throw new Error(`sweep failed: ${swept.error}`);
  }
  return swept.reclaimed;
}

/**
 * The residue report of a sweep that must have succeeded — throws, rather than branching, when it did not.
 *
 * @returns the sweep's residue report.
 */
export function residueOf(swept: Awaited<ReturnType<typeof closeDoneWithClient>>): ResidueReport {
  if (!("residue" in swept)) {
    throw new Error(`sweep failed: ${swept.error}`);
  }
  return swept.residue;
}

/**
 * The error of a sweep that must have failed — throws, rather than branching, when it did not.
 *
 * @returns the sweep's error message.
 */
export function errorOf(swept: Awaited<ReturnType<typeof closeDoneWithClient>>): string {
  if (!("error" in swept)) {
    throw new Error("sweep unexpectedly succeeded");
  }
  return swept.error;
}

/**
 * The ledger's open rows after a sweep, by session key.
 *
 * @returns the open session keys.
 */
export function openKeys({ home: stateHome }: { home: string }): readonly string[] {
  const { events } = parseSessionLog({ text: readSessionLogText({ home: stateHome }) });
  return foldSessions({ events })
    .filter((item) => item.status === "open")
    .map((item) => item.sessionKey);
}
