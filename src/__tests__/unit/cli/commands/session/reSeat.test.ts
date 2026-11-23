/**
 * `session re-seat` — the parse boundary, and the whole pass over a fake cmux client against a real temp
 * ledger. The socket, the capacity read and the boot are plain fakes that record, in one shared list, the
 * ORDER they were asked to act in — the order is the design (`reSeat.ts`'s header).
 */
import { chmodSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  passExitCode,
  type ReSeatDeps,
  type ReSeatPass,
  reSeatWithClient,
  runSessionReSeat,
} from "../../../../../cli/commands/session/reSeat.js";
import { EXIT_DEFERRED, EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import type { CmuxClient, CmuxWorkspaceSummary } from "../../../../../cmux/client.js";
import { CmuxErrors } from "../../../../../cmux/errors.js";
import { err, ok, unwrap, unwrapErr } from "../../../../../lib/result.js";
import { renderSeatRecoveryOutcome, type SeatRecoveryOutcome } from "../../../../../sessions/seatRecovery.js";
import type { BootModel } from "../../../../../sessions/session.js";
import { foldSessions, parseSessionLog } from "../../../../../sessions/session.js";
import { appendSessionEvent, readSessionLogText, sessionLogPath } from "../../../../../sessions/sessionStore.js";

const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

const NOW = "2026-09-19T11:15:00.000Z";
const LOGGED_OUT = "│ > │\n  Not logged in · Please run /login";
const SIGNED_IN = "│ > │\n  ? for shortcuts";
/** The retry line two bot workers rendered byte for byte, above the prompt box. */
const LIMIT_LINE = "✻ Weekly limit reached · Retrying in 5h (Sep 13 at 8am) · attempt 1/300";
const LIMIT_RETRYING = `${LIMIT_LINE}\n│ > │\n  ? for shortcuts`;

/** A fresh state home. */
function home(): string {
  const dir = mkdtempSync(join(tmpdir(), "re-seat-"));
  fixtureDirs.push(dir);
  return dir;
}

/** One live workspace as `cmux list` reports it after a restart renumbered it. */
function workspace({ slug, id, pinned = false }: { slug: string; id: string; pinned?: boolean }): CmuxWorkspaceSummary {
  return {
    currentDirectory: `/w/.claude/worktrees/${slug}`,
    description: undefined,
    latestConversationMessage: undefined,
    latestSubmittedAtIso: undefined,
    latestSubmittedMessage: undefined,
    pinned,
    selected: false,
    title: slug,
    windowId: "window:1",
    workspaceId: id,
    workspaceRef: `workspace:${id}`,
  };
}

/** Record one spawned row on the ledger, under the ref it had BEFORE the restart. */
function spawned({
  home: stateHome,
  slug,
  bootModel = { kind: "pinned", model: "opus" },
}: {
  home: string;
  slug: string;
  bootModel?: BootModel;
}): void {
  appendSessionEvent({
    event: {
      bootModel,
      branch: slug,
      cwd: `/w/.claude/worktrees/${slug}`,
      kind: "spawned",
      sessionKey: slug,
      slug,
      surfaceRef: "surface:1",
      tsIso: "2026-09-19T08:00:00.000Z",
      workspaceRef: `workspace:old-${slug}`,
    },
    home: stateHome,
  });
}

/** A fake cmux client, capacity read and boot, each appending what it was asked to do to one shared log. */
function fakes({
  workspaces,
  screens,
  capacityClears = true,
  spawnExit = EXIT_OK,
  closeAnswersError = false,
  closeTakesEffect = true,
  relistFails = false,
}: {
  workspaces: readonly CmuxWorkspaceSummary[];
  screens: Readonly<Record<string, string>>;
  capacityClears?: boolean;
  spawnExit?: number;
  /** The close answers an error, as a reply past the socket timeout does. */
  closeAnswersError?: boolean;
  /** Whether cmux really removed the workspace, whatever the close answered. */
  closeTakesEffect?: boolean;
  /** Every inventory read after the first fails, as it does when the socket the close lost stays down. */
  relistFails?: boolean;
}): {
  readonly log: string[];
  readonly client: CmuxClient;
  readonly waitForCapacity: ReSeatDeps["waitForCapacity"];
  readonly boot: ReSeatDeps["boot"];
} {
  const log: string[] = [];
  const gone = new Set<string>();
  const unreachable = (): never => {
    throw new Error("re-seat never calls this");
  };
  const client: CmuxClient = {
    close: () => undefined,
    closeWorkspace: ({ workspaceId }) => {
      log.push(`close ${workspaceId}`);
      if (closeTakesEffect) {
        gone.add(workspaceId);
      }
      return Promise.resolve(
        closeAnswersError
          ? err(CmuxErrors.malformedReply({ detail: "no reply in 15s", method: "workspace.close" }))
          : ok(undefined),
      );
    },
    createWorkspace: unreachable,
    identify: unreachable,
    interruptTurn: unreachable,
    listWorkspaces: () => {
      if (relistFails && log.some((line) => line.startsWith("close "))) {
        return Promise.resolve(err(CmuxErrors.malformedReply({ detail: "socket down", method: "workspace.list" })));
      }
      return Promise.resolve(ok(workspaces.filter((live) => !gone.has(live.workspaceId))));
    },
    pinWorkspace: unreachable,
    processTree: unreachable,
    workspaceTop: unreachable,
    readResumeBinding: unreachable,
    readScreen: ({ target }) => {
      log.push(`read ${target.workspaceId}`);
      const screen = screens[target.workspaceId];
      return Promise.resolve(
        screen === undefined
          ? err(CmuxErrors.malformedReply({ detail: "settling", method: "terminal.text" }))
          : ok(screen),
      );
    },
    readScreenGrid: unreachable,
    renameWorkspace: unreachable,
    resolveWorkspace: unreachable,
    sendLine: unreachable,
    submitComposer: unreachable,
    unpinWorkspace: unreachable,
    listWorkspacesStrict: unreachable,
    topologyStrict: unreachable,
    workspaceSurface: unreachable,
  };
  return {
    client,
    log,
    boot: ({ slug, model }) => {
      log.push(`spawn ${slug} --model ${model}`);
      return Promise.resolve(spawnExit);
    },
    waitForCapacity: () => {
      log.push("capacity");
      return Promise.resolve(capacityClears);
    },
  };
}

/** The pass, throwing when it could not read cmux at all. */
function passOf({ swept }: { swept: Awaited<ReturnType<typeof reSeatWithClient>> }): ReSeatPass {
  return unwrap(swept);
}

/** Every outcome, throwing when the pass could not read cmux at all. */
function outcomesOf({
  swept,
}: {
  swept: Awaited<ReturnType<typeof reSeatWithClient>>;
}): readonly SeatRecoveryOutcome[] {
  return passOf({ swept }).outcomes;
}

/** Every outcome's kind, throwing when the pass could not read cmux at all. */
function kinds({ swept }: { swept: Awaited<ReturnType<typeof reSeatWithClient>> }): readonly string[] {
  return outcomesOf({ swept }).map((outcome) => outcome.kind);
}

/** The deps one pass needs over the fakes. */
function deps({
  stateHome,
  made,
  dryRun = false,
  env = {},
}: {
  stateHome: string;
  made: ReturnType<typeof fakes>;
  dryRun?: boolean;
  env?: Readonly<Record<string, string | undefined>>;
}): ReSeatDeps {
  return {
    client: made.client,
    dryRun,
    env,
    home: stateHome,
    chairWorkspaceId: undefined,
    nowIso: NOW,
    ownWorkspaceId: "mine",
    boot: made.boot,
    waitForCapacity: made.waitForCapacity,
  };
}

describe("reSeatWithClient", () => {
  it("re-seats each logged-out seat one at a time: capacity, then close, then spawn", async () => {
    const stateHome = home();
    spawned({ home: stateHome, slug: "a-doc" });
    spawned({ home: stateHome, slug: "b-doc", bootModel: { kind: "pinned", model: "sonnet" } });
    spawned({ home: stateHome, slug: "c-doc" });
    const made = fakes({
      screens: { "2": LOGGED_OUT, "3": SIGNED_IN, "9": LOGGED_OUT },
      workspaces: [
        workspace({ id: "chair", pinned: true, slug: "supervisor" }),
        workspace({ id: "mine", slug: "me" }),
        workspace({ id: "9", slug: "a-doc" }),
        workspace({ id: "2", slug: "b-doc" }),
        workspace({ id: "3", slug: "c-doc" }),
      ],
    });

    const swept = await reSeatWithClient({ deps: deps({ made, stateHome }) });

    expect(made.log).toEqual([
      "read 9",
      "read 2",
      "read 3",
      "capacity",
      "close 9",
      "spawn a-doc --model opus",
      "capacity",
      "close 2",
      "spawn b-doc --model sonnet",
    ]);
    expect(kinds({ swept })).toEqual(["respawned", "respawned"]);
  });

  it("closes the ledger row under the ref it was spawned with, not the one cmux renumbered it to", async () => {
    const stateHome = home();
    spawned({ home: stateHome, slug: "a-doc" });
    const made = fakes({ screens: { "9": LOGGED_OUT }, workspaces: [workspace({ id: "9", slug: "a-doc" })] });

    await reSeatWithClient({ deps: deps({ made, stateHome }) });

    const rows = foldSessions({ events: parseSessionLog({ text: readSessionLogText({ home: stateHome }) }).events });
    expect(rows.map((row) => [row.slug, row.workspaceRef, row.status])).toEqual([
      ["a-doc", "workspace:old-a-doc", "closed"],
    ]);
  });

  it("stops at a capacity HOLD: closes nothing, every later seat is held too, and the exit is deferred", async () => {
    const stateHome = home();
    spawned({ home: stateHome, slug: "a-doc" });
    spawned({ home: stateHome, slug: "b-doc" });
    const made = fakes({
      capacityClears: false,
      screens: { "2": LOGGED_OUT, "9": LIMIT_RETRYING },
      workspaces: [workspace({ id: "9", slug: "a-doc" }), workspace({ id: "2", slug: "b-doc" })],
    });

    const swept = await reSeatWithClient({ deps: deps({ made, stateHome }) });

    expect(made.log).toEqual(["read 9", "read 2", "capacity"]);
    expect(kinds({ swept })).toEqual(["held", "held"]);
    expect(passExitCode({ pass: passOf({ swept }) })).toBe(EXIT_DEFERRED);
  });

  it("refuses a Fable-pinned seat BEFORE closing it, exactly as cmux spawn would", async () => {
    const stateHome = home();
    spawned({ home: stateHome, slug: "a-doc", bootModel: { kind: "pinned", model: "fable" } });
    const made = fakes({ screens: { "9": LOGGED_OUT }, workspaces: [workspace({ id: "9", slug: "a-doc" })] });

    const swept = await reSeatWithClient({ deps: deps({ made, stateHome }) });

    expect(made.log).toEqual(["read 9"]);
    expect(kinds({ swept })).toEqual(["refused"]);
  });

  it("acts on nothing in a dry run for either wall, and says what it would do", async () => {
    const stateHome = home();
    spawned({ home: stateHome, slug: "a-doc" });
    spawned({ home: stateHome, slug: "b-doc" });
    const made = fakes({
      screens: { "2": LIMIT_RETRYING, "9": LOGGED_OUT },
      workspaces: [workspace({ id: "9", slug: "a-doc" }), workspace({ id: "2", slug: "b-doc" })],
    });

    const swept = await reSeatWithClient({ deps: deps({ dryRun: true, made, stateHome }) });

    expect(made.log).toEqual(["read 9", "read 2"]);
    expect(outcomesOf({ swept }).map((outcome) => [outcome.kind, outcome.item.wall.kind])).toEqual([
      ["would-respawn", "logged-out"],
      ["would-respawn", "limit-retrying"],
    ]);
    const rows = foldSessions({ events: parseSessionLog({ text: readSessionLogText({ home: stateHome }) }).events });
    expect(rows.map((row) => [row.slug, row.status])).toEqual([
      ["b-doc", "open"],
      ["a-doc", "open"],
    ]);
  });

  it("re-seats a limit-walled seat whose hooks read working: capacity, close, ledger close, then spawn", async () => {
    const stateHome = home();
    spawned({ home: stateHome, slug: "a-doc" });
    const made = fakes({ screens: { "9": LIMIT_RETRYING }, workspaces: [workspace({ id: "9", slug: "a-doc" })] });

    const swept = await reSeatWithClient({ deps: deps({ made, stateHome }) });

    expect(made.log).toEqual(["read 9", "capacity", "close 9", "spawn a-doc --model opus"]);
    const [outcome] = outcomesOf({ swept });
    expect(outcome!.item.wall).toStrictEqual({ banner: LIMIT_LINE, kind: "limit-retrying" });
    const rows = foldSessions({ events: parseSessionLog({ text: readSessionLogText({ home: stateHome }) }).events });
    expect(rows.map((row) => [row.slug, row.status])).toEqual([["a-doc", "closed"]]);
    expect(passExitCode({ pass: passOf({ swept }) })).toBe(EXIT_OK);
  });

  it("recovers one logged-out and one limit-walled seat serially, never in parallel", async () => {
    const stateHome = home();
    spawned({ home: stateHome, slug: "a-doc" });
    spawned({ home: stateHome, slug: "b-doc", bootModel: { kind: "pinned", model: "sonnet" } });
    const made = fakes({
      screens: { "2": LIMIT_RETRYING, "9": LOGGED_OUT },
      workspaces: [workspace({ id: "9", slug: "a-doc" }), workspace({ id: "2", slug: "b-doc" })],
    });

    const swept = await reSeatWithClient({ deps: deps({ made, stateHome }) });

    expect(made.log).toEqual([
      "read 9",
      "read 2",
      "capacity",
      "close 9",
      "spawn a-doc --model opus",
      "capacity",
      "close 2",
      "spawn b-doc --model sonnet",
    ]);
    expect(outcomesOf({ swept }).map((outcome) => [outcome.kind, outcome.item.wall.kind])).toEqual([
      ["respawned", "logged-out"],
      ["respawned", "limit-retrying"],
    ]);
  });

  it("never reads, closes or spawns the pinned chair or the caller, walled or not", async () => {
    const stateHome = home();
    spawned({ home: stateHome, slug: "supervisor" });
    spawned({ home: stateHome, slug: "me" });
    const made = fakes({
      screens: { chair: LIMIT_RETRYING, mine: LIMIT_RETRYING },
      workspaces: [workspace({ id: "chair", pinned: true, slug: "supervisor" }), workspace({ id: "mine", slug: "me" })],
    });

    const swept = await reSeatWithClient({ deps: deps({ made, stateHome }) });

    expect(made.log).toEqual([]);
    expect(kinds({ swept })).toEqual([]);
  });

  it("reports an unread screen, still recovers the walled seat beside it, and fails the exit", async () => {
    const stateHome = home();
    spawned({ home: stateHome, slug: "a-doc" });
    const made = fakes({
      screens: { "9": LIMIT_RETRYING },
      workspaces: [workspace({ id: "3", slug: "c-doc" }), workspace({ id: "9", slug: "a-doc" })],
    });

    const swept = await reSeatWithClient({ deps: deps({ made, stateHome }) });

    expect(made.log).toEqual(["read 3", "read 9", "capacity", "close 9", "spawn a-doc --model opus"]);
    const pass = passOf({ swept });
    expect(pass.scanProblems.map((problem) => [problem.kind, problem.workspace.workspaceRef, problem.message])).toEqual(
      [["screen-unreadable", "workspace:3", "cmux terminal.text replied with an unusable shape: settling"]],
    );
    expect(kinds({ swept })).toEqual(["respawned"]);
    expect(passExitCode({ pass })).toBe(EXIT_ERROR);
  });

  it("answers the typed inventory failure when cmux cannot be listed at all", async () => {
    const made = fakes({ screens: {}, workspaces: [] });
    const swept = await reSeatWithClient({
      deps: {
        ...deps({ made, stateHome: home() }),
        client: {
          ...made.client,
          listWorkspaces: () =>
            Promise.resolve(err(CmuxErrors.malformedReply({ detail: "socket down", method: "workspace.list" }))),
        },
      },
    });

    expect(swept.isErr()).toBe(true);
    expect(unwrapErr(swept).code).toBe("CMUX_INVENTORY_READ_FAILED");
    expect(unwrapErr(swept).message).toBe(
      "the live cmux inventory could not be read — cmux workspace.list replied with an unusable shape: socket down",
    );
    expect(made.log).toEqual([]);
  });

  it("still boots a closed seat, and the next one, when the ledger close cannot be written", async () => {
    const stateHome = home();
    spawned({ home: stateHome, slug: "a-doc" });
    spawned({ home: stateHome, slug: "b-doc" });
    chmodSync(sessionLogPath({ home: stateHome }), 0o444);
    const made = fakes({
      screens: { "2": LOGGED_OUT, "9": LOGGED_OUT },
      workspaces: [workspace({ id: "9", slug: "a-doc" }), workspace({ id: "2", slug: "b-doc" })],
    });

    const swept = await reSeatWithClient({ deps: deps({ made, stateHome }) });

    expect(made.log).toEqual([
      "read 9",
      "read 2",
      "capacity",
      "close 9",
      "spawn a-doc --model opus",
      "capacity",
      "close 2",
      "spawn b-doc --model opus",
    ]);
    expect(kinds({ swept })).toEqual(["respawned", "respawned"]);
    const [first] = outcomesOf({ swept });
    expect(renderSeatRecoveryOutcome({ outcome: first! })).toContain("the old ledger row is still open");
  });

  it("boots a seat whose close answered an error after cmux had already closed it", async () => {
    const stateHome = home();
    spawned({ home: stateHome, slug: "a-doc" });
    const made = fakes({
      closeAnswersError: true,
      screens: { "9": LOGGED_OUT },
      workspaces: [workspace({ id: "9", slug: "a-doc" })],
    });

    const swept = await reSeatWithClient({ deps: deps({ made, stateHome }) });

    expect(made.log).toEqual(["read 9", "capacity", "close 9", "spawn a-doc --model opus"]);
    expect(kinds({ swept })).toEqual(["respawned"]);
  });

  it("spawns nothing when the close answered an error and the workspace is still listed", async () => {
    const stateHome = home();
    spawned({ home: stateHome, slug: "a-doc" });
    const made = fakes({
      closeAnswersError: true,
      closeTakesEffect: false,
      screens: { "9": LOGGED_OUT },
      workspaces: [workspace({ id: "9", slug: "a-doc" })],
    });

    const swept = await reSeatWithClient({ deps: deps({ made, stateHome }) });

    expect(made.log).toEqual(["read 9", "capacity", "close 9"]);
    expect(kinds({ swept })).toEqual(["close-failed"]);
  });

  it("boots nothing and says the close may have happened when cmux cannot be re-listed after an erroring close", async () => {
    const stateHome = home();
    spawned({ home: stateHome, slug: "a-doc" });
    const made = fakes({
      closeAnswersError: true,
      relistFails: true,
      screens: { "9": LOGGED_OUT },
      workspaces: [workspace({ id: "9", slug: "a-doc" })],
    });

    const swept = await reSeatWithClient({ deps: deps({ made, stateHome }) });

    expect(made.log).toEqual(["read 9", "capacity", "close 9"]);
    const [outcome] = outcomesOf({ swept });
    expect(renderSeatRecoveryOutcome({ outcome: outcome! })).toBe(
      "close unknown\tworkspace:9 (a-doc)\tlogged-out\tcmux workspace.close replied with an unusable shape: no reply in 15s, and cmux could not be re-listed, so the close may have happened — nothing spawned; if workspace:9 is gone, re-seat: slopweaver cmux spawn a-doc --model opus",
    );
  });

  it("reports a spawn that threw after the close, naming the seat and its re-seat command", async () => {
    const stateHome = home();
    spawned({ home: stateHome, slug: "a-doc" });
    const made = fakes({ screens: { "9": LOGGED_OUT }, workspaces: [workspace({ id: "9", slug: "a-doc" })] });

    const swept = await reSeatWithClient({
      deps: {
        ...deps({ made, stateHome }),
        boot: () => Promise.reject(new Error("EACCES: the doc could not be read")),
      },
    });

    const [outcome] = outcomesOf({ swept });
    expect(renderSeatRecoveryOutcome({ outcome: outcome! })).toBe(
      "spawn failed\tworkspace:9 (a-doc)\tlogged-out\tclosed, but cmux spawn a-doc threw (EACCES: the doc could not be read); re-run: slopweaver cmux spawn a-doc --model opus",
    );
  });

  it("reports a spawn that failed after the close, with its exit code", async () => {
    const stateHome = home();
    spawned({ home: stateHome, slug: "a-doc" });
    const made = fakes({
      screens: { "9": LOGGED_OUT },
      spawnExit: 1,
      workspaces: [workspace({ id: "9", slug: "a-doc" })],
    });

    const swept = await reSeatWithClient({ deps: deps({ made, stateHome }) });

    expect(kinds({ swept })).toEqual(["spawn-failed"]);
  });
});

describe("runSessionReSeat", () => {
  it("prints its usage on --help", async () => {
    expect(await runSessionReSeat(["node", "slopweaver", "session", "re-seat", "--help"])).toBe(EXIT_OK);
  });

  it("refuses a --timeout-seconds that is not a whole number before touching cmux", async () => {
    expect(await runSessionReSeat(["node", "slopweaver", "session", "re-seat", "--timeout-seconds", "soon"])).toBe(
      EXIT_USAGE,
    );
  });
});
