/**
 * One seat's relaunch inside a recovery pass: the wall each screen shows, and a reseat refused before anything is
 * stopped — journalled as recovering and then as refused, with the plan named when the guard refused a sign-in — and
 * which refusals halt the later workers.
 */
import { rmSync } from "node:fs";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readWalls, refusalHalts, resumeSeat } from "../../../../../cli/commands/fleet/resumeSeat.js";
import type { FleetPort } from "../../../../../fleet/port.js";
import { unwrap } from "../../../../../lib/result.js";
import { ReseatErrors } from "../../../../../sessions/reseatErrors.js";
import { memoryFleetPort } from "../../../../fleetStoreFixture.js";
import { fakeClient, fakeDeps, makeHome, memoryReseatLock, passState, workspace } from "./fleetKit.js";

/** The banner measured on a walled seat, under Claude Code's prompt box. */
const LOGGED_OUT_SCREEN = [
  "╭────────────────────────────────────────╮",
  "│ >                                      │",
  "╰────────────────────────────────────────╯",
  "  Not logged in · Please run /login",
].join("\n");

let home = "";
/** The one in-memory fleet store of the running test: the pass journals into it and the test reads it back. */
let fleet: FleetPort = memoryFleetPort();

beforeEach(() => {
  home = makeHome();
  fleet = memoryFleetPort();
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

describe("readWalls", () => {
  it("keys each walled workspace by id and leaves a healthy one and an unreadable one out", async () => {
    const client = fakeClient({
      screens: { walled: LOGGED_OUT_SCREEN, healthy: "⏺ Reading a file\n│ > │" },
    });
    const walls = await readWalls({
      deps: fakeDeps({ client, ownWorkspaceId: undefined }),
      workspaces: [workspace({ id: "walled" }), workspace({ id: "healthy" }), workspace({ id: "unreadable" })],
    });
    expect([...walls]).toEqual([["walled", { kind: "logged-out" }]]);
  });

  it("answers no walls for no workspaces", async () => {
    const deps = fakeDeps({ client: fakeClient({}), ownWorkspaceId: undefined });
    expect([...(await readWalls({ deps, workspaces: [] }))]).toEqual([]);
  });
});

describe("resumeSeat", () => {
  it("refuses the seat the pass itself runs in, journalling recovering then refused, and halts nothing", async () => {
    const own = workspace({ id: "own" });
    const client = fakeClient({});
    const state = passState({ fleet, home });
    const outcome = await resumeSeat({
      accounts: [],
      client,
      deps: fakeDeps({ client, ownWorkspaceId: "own" }),
      role: "worker",
      sessionId: "sess-own",
      signedOut: new Map(),
      state,
      entry: { kind: "walled", wall: { kind: "logged-out" } },
      workspace: own,
    });
    expect(outcome.kind).toBe("refused");
    expect(outcome).toMatchObject({ error: { code: "OWN_WORKSPACE" }, workspaceRef: "workspace:own" });
    expect(state.deferred).toBe(false);
    expect(state.refusals.map((refusal) => refusal.code)).toEqual(["OWN_WORKSPACE"]);
    expect(state.lines).toHaveLength(1);
    expect(state.lines[0]).toContain("workspace:own\trefused OWN_WORKSPACE — ");
    const events = unwrap(await fleet.readResumeJournal({ home })).events;
    expect(events).toMatchObject([
      { kind: "seat", phase: "recovering", workspaceRef: "workspace:own" },
      { kind: "seat", phase: "refused", refusal: { code: "OWN_WORKSPACE" } },
    ]);
  });

  it("refuses with the cmux read failure when the seat's process tree cannot be read", async () => {
    const seat = workspace({ id: "seat-a" });
    const client = fakeClient({});
    const state = passState({ fleet, home });
    const outcome = await resumeSeat({
      accounts: [],
      client,
      deps: fakeDeps({ client, ownWorkspaceId: undefined }),
      role: "supervisor",
      sessionId: undefined,
      signedOut: new Map(),
      state,
      entry: { kind: "walled", wall: undefined },
      workspace: seat,
    });
    expect(outcome).toMatchObject({ error: { code: "CMUX_READ_FAILED" }, kind: "refused" });
    expect(state.refusals[0]).toMatchObject({ code: "CMUX_READ_FAILED", workspaceRef: "workspace:seat-a" });
    expect(state.deferred).toBe(false);
  });

  it("names the plan the sign-in guard refused on the seat's refusal", async () => {
    const seat = workspace({ id: "seat-b" });
    const client = fakeClient({});
    const state = passState({ fleet, home });
    await resumeSeat({
      accounts: [],
      client,
      deps: fakeDeps({ client, ownWorkspaceId: "seat-b" }),
      role: "worker",
      sessionId: undefined,
      signedOut: new Map([["seat-b", "plan-one"]]),
      state,
      entry: { kind: "walled", wall: undefined },
      workspace: seat,
    });
    expect(state.refusals[0]).toMatchObject({ alias: "plan-one", code: "OWN_WORKSPACE" });
  });
});

describe("resumeSeat on a cold worker", () => {
  const SAVED = "a0000096-0000-4000-8000-000000000103";

  it("types the session cmux saved, on the model its saved argv names, into the bare shell", async () => {
    const sent: string[] = [];
    const client = fakeClient({
      bindings: {
        cold: { argv: `--model opus --resume ${SAVED}`, checkpointId: SAVED, cwd: "/w/cold", source: "resume_binding" },
      },
      screens: { cold: LOGGED_OUT_SCREEN },
      sent,
      trees: { cold: [{ children: [], name: "zsh", pid: 1 }] },
    });
    const state = passState({ fleet, home });

    await resumeSeat({
      accounts: [],
      client,
      deps: fakeDeps({ client, ownWorkspaceId: undefined }),
      entry: { kind: "cold", pinnedSessionId: undefined },
      role: "worker",
      sessionId: SAVED,
      signedOut: new Map(),
      state,
      workspace: workspace({ id: "cold" }),
    });

    expect(sent).toEqual([`cold: claude --model opus --effort high --resume ${SAVED}`]);
  });

  it("refuses RESEAT_CONTENDED, typing nothing and halting nobody, while another reseat holds the tab", async () => {
    const sent: string[] = [];
    const client = fakeClient({
      bindings: {
        cold: { argv: `--model opus --resume ${SAVED}`, checkpointId: SAVED, cwd: "/w/cold", source: "resume_binding" },
      },
      screens: { cold: LOGGED_OUT_SCREEN },
      sent,
      trees: { cold: [{ children: [], name: "zsh", pid: 1 }] },
    });
    const state = passState({ fleet, home });

    const outcome = await resumeSeat({
      accounts: [],
      client,
      deps: {
        ...fakeDeps({ client, ownWorkspaceId: undefined }),
        acquireReseatLock: memoryReseatLock({ heldBy: new Set(["cold"]), journal: [] }),
      },
      entry: { kind: "cold", pinnedSessionId: undefined },
      role: "worker",
      sessionId: SAVED,
      signedOut: new Map(),
      state,
      workspace: workspace({ id: "cold" }),
    });

    expect(sent).toEqual([]);
    expect(outcome).toMatchObject({ error: { code: "RESEAT_CONTENDED" }, kind: "refused" });
    expect(state.refusals.map((refusal) => refusal.code)).toEqual(["RESEAT_CONTENDED"]);
    expect(state.deferred).toBe(false);
    const phases = unwrap(await fleet.readResumeJournal({ home })).events.flatMap((event) =>
      event.kind === "seat" ? [event.phase] : [],
    );
    expect(phases).toEqual(["recovering", "refused"]);
  });

  it("refuses NOT_COLD, typing nothing, for a bare shell nothing saved a session for", async () => {
    const sent: string[] = [];
    const client = fakeClient({ sent, trees: { cold: [{ children: [], name: "zsh", pid: 1 }] } });
    const state = passState({ fleet, home });

    const outcome = await resumeSeat({
      accounts: [],
      client,
      deps: fakeDeps({ client, ownWorkspaceId: undefined }),
      entry: { kind: "cold", pinnedSessionId: undefined },
      role: "worker",
      sessionId: undefined,
      signedOut: new Map(),
      state,
      workspace: workspace({ id: "cold" }),
    });

    expect(sent).toEqual([]);
    expect(outcome).toMatchObject({ error: { code: "NOT_COLD" }, kind: "refused" });
    expect(state.refusals.map((refusal) => refusal.code)).toEqual(["NOT_COLD"]);
  });
});

describe("refusalHalts", () => {
  const walled = { kind: "walled", wall: { kind: "logged-out" } } as const;
  const cold = { kind: "cold", pinnedSessionId: undefined } as const;

  const typedAfterStop = ReseatErrors.relaunchFailed({
    afterStop: true,
    cause: "x",
    step: "typing the relaunch line",
    workspaceRef: "workspace:1",
  });
  const neverComposed = ReseatErrors.relaunchFailed({
    afterStop: false,
    cause: "x",
    step: "composing the line",
    workspaceRef: "workspace:1",
  });
  const unconfirmed = ReseatErrors.unconfirmed({ seconds: 1, sessionId: "s", workspaceRef: "workspace:1" });

  it("halts later workers on a walled seat whose stop or relaunch failed, chair or worker", () => {
    expect([
      refusalHalts({ entry: walled, error: typedAfterStop, role: "supervisor" }),
      refusalHalts({ entry: walled, error: typedAfterStop, role: "worker" }),
      refusalHalts({ entry: walled, error: unconfirmed, role: "worker" }),
      refusalHalts({ entry: walled, error: ReseatErrors.killTimeout({ pid: 7, seconds: 15 }), role: "worker" }),
    ]).toEqual([true, true, true, true]);
  });

  it("halts nobody on a cold relaunch's failure, since nothing was stopped", () => {
    expect([
      refusalHalts({ entry: cold, error: typedAfterStop, role: "supervisor" }),
      refusalHalts({ entry: cold, error: unconfirmed, role: "worker" }),
    ]).toEqual([false, false]);
  });

  it("halts nobody on a walled refusal raised before the stop, a line too long to compose included", () => {
    expect([
      refusalHalts({ entry: walled, error: neverComposed, role: "worker" }),
      refusalHalts({ entry: walled, error: ReseatErrors.noLiveSession({ workspaceRef: "w" }), role: "worker" }),
    ]).toEqual([false, false]);
  });

  it("halts nobody on a walled seat another reseat held, or whose lock could not be taken", () => {
    expect([
      refusalHalts({
        entry: walled,
        error: ReseatErrors.contended({ holder: "pid 1", workspaceRef: "w" }),
        role: "worker",
      }),
      refusalHalts({
        entry: walled,
        error: ReseatErrors.lockFailed({ cause: "x", workspaceRef: "w" }),
        role: "worker",
      }),
    ]).toEqual([false, false]);
  });
});
