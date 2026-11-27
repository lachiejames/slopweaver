/**
 * A throwaway world for `supervisor hand-off`: a real home holding the pin, the outgoing chair's ledger row and its
 * open run, and plain fake seams for everything the transaction reaches outside the home — the watch, the hold, the
 * app's harness (whose `message` plays the outgoing chair and runs the real `hand-off note` verb), a fake successor
 * spawn that records the successor's ledger row the way `cmux spawn` does, a clock its sleep advances, and the
 * printed lines. No socket, no cmux and no real `$SLOPWEAVER_HOME` is touched. Chair counters sit at 9000 and above,
 * the range the repository reserves for a synthetic chain.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ChairHandOffDeps, HandOffHarness } from "../../../../../cli/commands/supervisor/chairHandOffContext.js";
import { runChairHandOff } from "../../../../../cli/commands/supervisor/chairHandOffRun.js";
import { runStateOf } from "../../../../../handover/ledger.js";
import { appendRunEvent, readRunJournal } from "../../../../../handover/runStore.js";
import { err, ok, type Result, unwrap } from "../../../../../lib/result.js";
import { type SessionHarnessError, SessionHarnessErrors } from "../../../../../sessionHarness/errors.js";
import type { HarnessSession, HarnessTarget } from "../../../../../sessionHarness/sessionHarness.js";
import { appendSessionEvent } from "../../../../../sessions/sessionStore.js";
import { writeSupervisorPin } from "../../../../../sessions/supervisorPinStore.js";
import { stateHomePaths } from "../../../../../stateHome.js";
import type { ChairHandOffEvent } from "../../../../../supervisor/chairHandOff.js";
import { readEpisode } from "../../../../../supervisor/chairHandOffStore.js";
import type { ChairWatchHold, ChairWatchReport, ChairWatchStatus } from "../../../../../supervisor/chairWatch.js";

/** The outgoing chair's app session id. */
export const OLD_CHAIR = "chair-old-1";
/** The outgoing chair's handover slug, a synthetic counter. */
export const OLD_SLUG = "fresh-supervisor-handoff-9007";
/** The slug the successor is seated from: the next counter past the outgoing chair's. */
export const NEXT_SLUG = "fresh-supervisor-handoff-9008";
/** The episode the outgoing chair's hand-off journals under. */
export const EPISODE = `chair-hand-off:${OLD_CHAIR}`;

/** One throwaway world. */
export interface HandOffWorld {
  readonly home: string;
  readonly repo: string;
  readonly chairDir: string;
  /** Every argv the fake spawn was given. */
  readonly spawns: (readonly string[])[];
  /** Every message the fake harness was asked to deliver, with its delivery. */
  readonly messages: { readonly text: string; readonly delivery: string }[];
  /** Every line printed, in order, across every invocation. */
  readonly lines: string[];
  /** The fake clock, in epoch milliseconds. */
  readonly clock: { ms: number };
  /** How the next spawns fail: each `true` makes one spawn exit 1 having recorded nothing. */
  readonly failSpawns: boolean[];
  /**
   * What the fake app's `list` answers: the sessions it runs, each under the slug it was launched from, or a failure
   * when `listFails`. A successful fake spawn adds its session; a test adds one to play a spawn whose ledger row
   * never landed. `resolveFails` makes the app stop answering for the outgoing chair.
   */
  readonly app: {
    listFails: boolean;
    resolveFails: boolean;
    /** Runs while the app answers a `resolve`, before the answer arrives: a world changing under that await. */
    duringResolve: (() => void) | undefined;
    readonly sessions: { readonly slug: string; readonly sessionId: string }[];
  };
}

/** The fake watch's verdict, and what its fake chair-reading says. */
export interface WatchScript {
  status: ChairWatchStatus;
  chair: ChairWatchReport["chair"];
  reasons: readonly string[];
  hold?: ChairWatchHold;
}

const worlds: HandOffWorld[] = [];

/**
 * Remove every world minted.
 */
export function removeWorlds(): void {
  worlds.splice(0).forEach((world) => {
    for (const dir of [world.home, world.repo, world.chairDir]) {
      rmSync(dir, { force: true, recursive: true });
    }
  });
}

/**
 * A home with the outgoing chair pinned, its open ledger row, and its open run.
 *
 * @param pin which host the pin names: the app chair, or a cmux workspace
 * @returns the world
 */
export function handOffWorld({ pin }: { pin: "app" | "cmux" }): HandOffWorld {
  const home = mkdtempSync(join(tmpdir(), "ho-home-"));
  const repo = mkdtempSync(join(tmpdir(), "ho-repo-"));
  const chairDir = mkdtempSync(join(tmpdir(), "ho-chair-"));
  const world: HandOffWorld = {
    app: { duringResolve: undefined, listFails: false, resolveFails: false, sessions: [] },
    chairDir,
    clock: { ms: Date.parse("2026-11-27T08:00:00.000Z") },
    failSpawns: [],
    home,
    lines: [],
    messages: [],
    repo,
    spawns: [],
  };
  worlds.push(world);
  if (pin === "app") {
    writeSupervisorPin({
      home,
      record: {
        appSessionId: OLD_CHAIR,
        pinnedAtIso: "2026-11-27T07:00:00.000Z",
        session: { host: "claude-code", id: "s-old" },
      },
    });
  } else {
    writeSupervisorPin({
      home,
      record: {
        pinnedAtIso: "2026-11-27T07:00:00.000Z",
        session: { host: "claude-code", id: "s-old" },
        workspaceId: "WS-OLD",
        workspaceRef: "workspace:1",
      },
    });
  }
  appendSessionEvent({
    event: {
      branch: "main",
      cwd: chairDir,
      harness: "app",
      kind: "spawned",
      sessionId: OLD_CHAIR,
      sessionKey: OLD_SLUG,
      slug: OLD_SLUG,
      surfaceRef: `app:${OLD_CHAIR}`,
      tsIso: "2026-11-27T07:00:00.000Z",
      workspaceRef: `app:${OLD_CHAIR}`,
    },
    home,
  });
  const { runs, handovers } = stateHomePaths({ home });
  mkdirSync(handovers, { recursive: true });
  appendRunEvent({
    event: { atIso: "2026-11-27T07:00:00.000Z", branch: "main", docHash: "h", kind: "started" },
    runsDir: runs,
    slug: OLD_SLUG,
  });
  return world;
}

/**
 * A watch report for a script: the successor on `plan-two` (Claude), `plan-four` read as a Codex plan.
 *
 * @param script the verdict and chair
 * @param nowIso the pass's instant
 * @returns the report
 */
export function watchReport({ script, nowIso }: { script: WatchScript; nowIso: string }): ChairWatchReport {
  return {
    chair: script.chair,
    notes: [],
    observedAtIso: nowIso,
    overrides: [],
    readings: [
      { alias: "plan-one", chair: true, reading: "Fable week 97%", state: "measured", vendor: "claude" },
      { alias: "plan-two", chair: false, reading: "Fable week 12%", state: "measured", vendor: "claude" },
      { alias: "plan-four", chair: false, reading: "week 5%", state: "measured", vendor: "codex" },
    ],
    reasons: script.reasons,
    status: script.status,
    successor: { alias: "plan-two", target: { kind: "claude" } },
    usage: { gaps: [], plans: [], sessions: [] },
    ...(script.hold === undefined ? {} : { hold: script.hold }),
  };
}

/** The app chair the watch reads by default. */
export const APP_CHAIR: ChairWatchReport["chair"] = { appSessionId: OLD_CHAIR, kind: "app", sessionIds: ["s-old"] };

/** The watch's verdict for a chair at its bar. */
export const HAND_OFF: WatchScript = { chair: APP_CHAIR, reasons: ["plan-one Fable week 97%"], status: "hand-off" };

/** The owner's hold, as `supervisor hand-off hold` records it. */
export const HOLD = { reason: "mid-demo", sinceIso: "2026-11-27T07:30:00.000Z" };

/**
 * The episode's journal.
 *
 * @returns every event, in order
 */
export function episode({ world }: { world: HandOffWorld }): readonly ChairHandOffEvent[] {
  return unwrap(readEpisode({ episodeId: EPISODE, home: world.home }));
}

/**
 * The outgoing chair's run phase.
 *
 * @returns the phase its run journal folds to
 */
export function predecessorPhase({ world }: { world: HandOffWorld }): string {
  const read = unwrap(readRunJournal({ runsDir: stateHomePaths({ home: world.home }).runs, slug: OLD_SLUG }));
  return runStateOf({ events: read.events }).phase;
}

/** The `--home` tail every invocation in a world carries. */
function homeTail({ world }: { world: HandOffWorld }): readonly string[] {
  return ["--home", world.home];
}

/** The command the note request names, read back out of its text. */
const NOTE_COMMAND = /slopweaver supervisor hand-off note --episode (\S+) --file (\S+) --home (\S+)/u;

/** The world's clock as an ISO instant. */
function clockIso({ world }: { world: HandOffWorld }): string {
  return new Date(world.clock.ms).toISOString();
}

/** A fake successor launch: records its argv, and the successor's ledger row unless the world scripts a failure. */
function fakeSuccessorLaunch({ world }: { world: HandOffWorld }): ChairHandOffDeps["spawn"] {
  return async ({ argv }) => {
    world.spawns.push(argv);
    if (world.failSpawns.shift() === true) {
      return 1;
    }
    const slug = argv[0]!;
    const sessionId = `chair-new-${String(world.spawns.length)}`;
    appendSessionEvent({
      event: {
        branch: slug,
        cwd: world.repo,
        harness: "app",
        kind: "spawned",
        sessionId,
        sessionKey: slug,
        slug,
        surfaceRef: `app:${sessionId}`,
        tsIso: clockIso({ world }),
        workspaceRef: `app:${sessionId}`,
      },
      home: world.home,
    });
    world.app.sessions.push({ sessionId, slug });
    return 0;
  };
}

/**
 * One session the fake app lists, as the app harness reports it: its ledger key in `description`.
 *
 * @param world the world whose main checkout the session runs in
 * @param slug the slug it was launched from
 * @param sessionId its app session id
 * @returns the harness session
 */
function listedSession({
  world,
  slug,
  sessionId,
}: {
  world: HandOffWorld;
  slug: string;
  sessionId: string;
}): HarnessSession {
  return {
    description: slug,
    directory: world.repo,
    groupId: "g",
    handle: `app:${sessionId}`,
    id: sessionId,
    latestConversationMessage: undefined,
    latestSubmittedAtIso: undefined,
    latestSubmittedMessage: undefined,
    pinned: false,
    selected: false,
    title: undefined,
  };
}

/** The fake app harness: its `message` plays the outgoing chair, writing the note and running the real note verb. */
function fakeHarness({
  world,
  note,
  runNote,
}: {
  world: HandOffWorld;
  note: string | undefined;
  runNote: (input: { rest: readonly string[] }) => Promise<number>;
}): HandOffHarness {
  return {
    list: async () =>
      world.app.listFails
        ? err(
            SessionHarnessErrors.unavailable({
              causeCode: "ENOENT",
              message: "the desktop app did not answer (ENOENT)",
              operation: "list",
            }),
          )
        : ok(world.app.sessions.map((one) => listedSession({ ...one, world }))),
    message: async ({ text, delivery }) => {
      world.messages.push({ delivery, text });
      const named = NOTE_COMMAND.exec(text);
      if (note !== undefined && named !== null) {
        writeFileSync(named[2]!, note);
        await runNote({ rest: ["note", "--episode", named[1]!, "--file", named[2]!, "--home", named[3]!] });
      }
      return ok({ disposition: "queued" as const, interrupted: false });
    },
    resolve: async ({ handle }): Promise<Result<HarnessTarget, SessionHarnessError>> => {
      world.app.duringResolve?.();
      return world.app.resolveFails
        ? err(
            SessionHarnessErrors.unavailable({
              causeCode: "ENOENT",
              message: "the desktop app did not answer (ENOENT)",
              operation: "resolve",
            }),
          )
        : ok({
            session: {
              description: undefined,
              directory: world.chairDir,
              groupId: "g",
              handle,
              id: OLD_CHAIR,
              latestConversationMessage: undefined,
              latestSubmittedAtIso: undefined,
              latestSubmittedMessage: undefined,
              pinned: true,
              selected: false,
              title: undefined,
            },
          });
    },
  };
}

/**
 * The seams over a world.
 *
 * @param world the throwaway home whose clock, spawns, messages and lines the seams read and record
 * @param script what the fake watch says
 * @param note what the outgoing chair writes when asked, or undefined for a chair that never answers
 * @returns the deps
 */
export function handOffDeps({
  world,
  script,
  note,
}: {
  world: HandOffWorld;
  script: WatchScript;
  note: string | undefined;
}): ChairHandOffDeps {
  const deps: ChairHandOffDeps = {
    hold: ({ rest }) => {
      world.lines.push(`hold ${rest.join(" ")}`);
      return 0;
    },
    nowIso: () => clockIso({ world }),
    out: ({ line }) => {
      world.lines.push(line);
    },
    readHold: () => ok(script.hold),
    release: ({ rest }) => {
      world.lines.push(`release ${rest.join(" ")}`);
      return 0;
    },
    repo: () => ok(world.repo),
    sleep: async ({ ms }) => {
      world.clock.ms += ms;
    },
    spawn: fakeSuccessorLaunch({ world }),
    watch: async () => watchReport({ nowIso: clockIso({ world }), script }),
    withHarness: async ({ body }) =>
      body({ harness: fakeHarness({ note, runNote: async ({ rest }) => runChairHandOff({ deps, rest }), world }) }),
  };
  return deps;
}

/**
 * Run `supervisor hand-off` in a world, `--home` appended.
 *
 * @param world the throwaway home the run is pointed at
 * @param deps its seams
 * @param args the flags before `--home`
 * @returns the exit code
 */
export async function handOff({
  world,
  deps,
  args,
}: {
  world: HandOffWorld;
  deps: ChairHandOffDeps;
  args: readonly string[];
}): Promise<number> {
  return runChairHandOff({ deps, rest: [...args, ...homeTail({ world })] });
}

/**
 * A seam that fails the test if anything reaches it.
 *
 * @returns never: it throws
 */
export function untouchable(): never {
  throw new Error("a seam the parse must never reach was reached");
}
