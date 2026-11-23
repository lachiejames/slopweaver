import { describe, expect, it } from "vitest";

import {
  type AttachStreamEvent,
  type GithubHoldStreamEvent,
  type ListenerStreamEvent,
  type MachineStreamEvent,
  type MergeStreamEvent,
  meetsSeverity,
  parseSupervisorEvent,
  type RecipeStreamEvent,
  renderSupervisorEventLine,
  severityOf,
  supervisorEventLine,
} from "../../../events/event.js";

const listener = (over: Partial<ListenerStreamEvent> = {}): ListenerStreamEvent => ({
  armId: "a1b2c3d4",
  atIso: "2026-08-23T03:00:00.000Z",
  kind: "armed",
  pid: 4242,
  source: "listener",
  why: "the Slack listener is up",
  ...over,
});

const attach = (over: Partial<AttachStreamEvent> = {}): AttachStreamEvent => ({
  atIso: "2026-08-26T14:30:00.000Z",
  kind: "needs-owner-login",
  sessionPath: "state-home/github-web-session.json",
  source: "github-attach",
  why: "the saved GitHub web session has expired",
  ...over,
});

const mergeAlert = (over: Partial<MergeStreamEvent> = {}): MergeStreamEvent => ({
  atIso: "2026-08-26T15:00:00.000Z",
  kind: "main-gate-failed",
  repo: "owner/name",
  source: "github-merge",
  why: "main crossed the skill-body cap right after this merge landed",
  ...over,
});

const holdEvent = (over: Partial<GithubHoldStreamEvent> = {}): GithubHoldStreamEvent => ({
  atIso: "2026-08-28T02:00:00.000Z",
  kind: "stale",
  pr: 32,
  repo: "owner/name",
  source: "github-hold",
  why: "owner/name#32 has held the merge queue for 87m",
  ...over,
});

const machineAlert = (over: Partial<MachineStreamEvent> = {}): MachineStreamEvent => ({
  atIso: "2026-08-31T00:19:00.000Z",
  culpritKill: undefined,
  culpritSubject: undefined,
  fleetChildLabel: undefined,
  fleetChildSessionId: undefined,
  holdOn: undefined,
  kind: "capacity-alert",
  load1: 5.4,
  segmentsPct: 15,
  source: "machine",
  swapUsedGb: 6.2,
  swapfileCount: 3,
  topForeignGb: 19.7,
  topForeignLabel: "mds",
  why: "machine capacity: ALERT (foreign footprint over 8 GB, swap over 4 GB) — top foreign hog 'mds' at 19.7 GB · swap 6.2/8 GB",
  ...over,
});

/** The panic's own readings, as the hold the sweep would have read had the gauge existed. */
const machineHold = (over: Partial<MachineStreamEvent> = {}): MachineStreamEvent => ({
  atIso: "2026-09-02T11:20:00.000Z",
  culpritKill: undefined,
  culpritSubject: undefined,
  fleetChildLabel: undefined,
  fleetChildSessionId: undefined,
  holdOn: "memory",
  kind: "capacity-hold",
  load1: 20,
  segmentsPct: 100,
  source: "machine",
  swapUsedGb: 48,
  swapfileCount: 49,
  topForeignGb: undefined,
  topForeignLabel: undefined,
  why: "machine capacity: HOLD (compressor at 100% of its segments limit, hold at 40%; 49 swapfiles, hold at 12) — no foreign process observed · swap 48/49 GB · compressor 100% of segments limit · 49 swapfiles",
  ...over,
});

const recipe = (over: Partial<RecipeStreamEvent> = {}): RecipeStreamEvent => ({
  atIso: "2026-08-23T03:00:00.000Z",
  kind: "slot-started",
  runId: "run-9",
  slotHash: "slot-7",
  source: "recipe-scheduler",
  why: "a recipe slot started investigating",
  ...over,
});

describe("severity", () => {
  it("grades a death as an alert", () => {
    expect(severityOf({ event: listener({ kind: "died" }) })).toBe("alert");
  });

  it("grades an escalation as an alert, separately from the death that caused it", () => {
    expect(severityOf({ event: listener({ kind: "escalated" }) })).toBe("alert");
  });

  it("grades a stalled recovery watermark as an alert — its only other symptom is silence", () => {
    expect(severityOf({ event: listener({ kind: "recovery-stalled" }) })).toBe("alert");
  });

  it("grades a degraded heartbeat as a warning", () => {
    expect(severityOf({ event: listener({ kind: "heartbeat-degraded" }) })).toBe("warn");
  });

  it("grades a re-arm as a warning", () => {
    expect(severityOf({ event: listener({ kind: "re-armed" }) })).toBe("warn");
  });

  it("grades arming and disarming as information", () => {
    expect(severityOf({ event: listener({ kind: "armed" }) })).toBe("info");
    expect(severityOf({ event: listener({ kind: "disarmed" }) })).toBe("info");
  });

  it("grades a failed recipe stage as an alert", () => {
    expect(severityOf({ event: recipe({ kind: "failed" }) })).toBe("alert");
  });

  it("grades an expired result wait as an alert", () => {
    expect(severityOf({ event: recipe({ kind: "result-wait-expired" }) })).toBe("alert");
  });

  it("grades a started and a completed slot as information", () => {
    expect(severityOf({ event: recipe({ kind: "slot-started" }) })).toBe("info");
    expect(severityOf({ event: recipe({ kind: "completed" }) })).toBe("info");
  });
});

describe("the severity floor", () => {
  it("passes an event at exactly the floor", () => {
    expect(meetsSeverity({ event: listener({ kind: "re-armed" }), minimum: "warn" })).toBe(true);
  });

  it("passes an event above the floor", () => {
    expect(meetsSeverity({ event: listener({ kind: "died" }), minimum: "warn" })).toBe(true);
  });

  it("rejects an event below the floor", () => {
    expect(meetsSeverity({ event: listener({ kind: "armed" }), minimum: "warn" })).toBe(false);
  });

  it("passes everything at the weakest floor", () => {
    expect(meetsSeverity({ event: listener({ kind: "armed" }), minimum: "info" })).toBe(true);
  });
});

describe("encoding", () => {
  it("encodes one event as ONE physical line, even when it carries a multi-line log", () => {
    const line = supervisorEventLine({
      event: listener({ kind: "died", lastLog: "first line\nsecond line\nthird line" }),
    });
    expect(line.includes("\n")).toBe(false);
  });

  it("round-trips a death with its captured log", () => {
    const event = listener({ kind: "died", lastLog: "connected to Slack over Socket Mode\nignored a message" });
    expect(parseSupervisorEvent({ line: supervisorEventLine({ event }) })).toStrictEqual(event);
  });

  it("round-trips a recipe event", () => {
    const event = recipe({ kind: "failed", why: "a recipe slot FAILED at dispatch" });
    expect(parseSupervisorEvent({ line: supervisorEventLine({ event }) })).toStrictEqual(event);
  });

  it("keeps a listener event with no arm and no pid — an escalation outlives its process", () => {
    const event = listener({ armId: undefined, kind: "escalated", pid: undefined });
    expect(parseSupervisorEvent({ line: supervisorEventLine({ event }) })).toStrictEqual(event);
  });
});

describe("parsing a line that is not an event", () => {
  it("drops a line that is not JSON", () => {
    expect(parseSupervisorEvent({ line: "{not json" })).toBe(undefined);
  });

  it("drops a JSON value that is not an object", () => {
    expect(parseSupervisorEvent({ line: "[1,2,3]" })).toBe(undefined);
  });

  it("drops a line with an unknown source", () => {
    expect(parseSupervisorEvent({ line: JSON.stringify({ ...listener(), source: "somewhere-else" }) })).toBe(undefined);
  });

  it("drops a line with an unknown kind", () => {
    expect(parseSupervisorEvent({ line: JSON.stringify({ ...listener(), kind: "exploded" }) })).toBe(undefined);
  });

  it("drops a line whose timestamp is not a date", () => {
    expect(parseSupervisorEvent({ line: JSON.stringify({ ...listener(), atIso: "whenever" }) })).toBe(undefined);
  });

  it("drops a line with no why — the sentence is the point of the event", () => {
    expect(parseSupervisorEvent({ line: JSON.stringify({ ...listener(), why: "" }) })).toBe(undefined);
  });

  it("drops a recipe event with no runId, so it can never be attributed to a generation", () => {
    expect(parseSupervisorEvent({ line: JSON.stringify({ ...recipe(), runId: "" }) })).toBe(undefined);
  });

  it("drops a listener pid that is not a real pid rather than believing it", () => {
    const parsed = parseSupervisorEvent({ line: JSON.stringify({ ...listener(), pid: -1 }) });
    expect(parsed).toStrictEqual(listener({ pid: undefined }));
  });
});

describe("the human line", () => {
  it("leads with the severity, so a long stream is scannable", () => {
    const line = renderSupervisorEventLine({ event: listener({ kind: "died", why: "the listener DIED" }) });
    expect(line.split("\t")).toStrictEqual([
      "alert",
      "2026-08-23T03:00:00.000Z",
      "listener",
      "died",
      "a1b2c3d4",
      "the listener DIED",
    ]);
  });

  it("names a recipe generation by slot and run", () => {
    const line = renderSupervisorEventLine({ event: recipe() });
    expect(line.split("\t")[4]).toBe("slot-7/run-9");
  });

  it("never inlines a captured log into the scannable line", () => {
    const line = renderSupervisorEventLine({ event: listener({ kind: "died", lastLog: "a very long tail" }) });
    expect(line.includes("a very long tail")).toBe(false);
  });

  it("says so plainly when there is no arm to name", () => {
    const line = renderSupervisorEventLine({ event: listener({ armId: undefined, kind: "escalated" }) });
    expect(line.split("\t")[4]).toBe("(no arm)");
  });
});

describe("the `github attach` source", () => {
  it("grades needs-owner-login as an alert — nothing but a pair of hands clears it", () => {
    expect(severityOf({ event: attach() })).toBe("alert");
  });

  it("grades login-captured as info — it is the clearing half, not a new problem", () => {
    expect(severityOf({ event: attach({ kind: "login-captured" }) })).toBe("info");
  });

  it("round-trips through the wire", () => {
    expect(parseSupervisorEvent({ line: supervisorEventLine({ event: attach() }) })).toEqual(attach());
  });

  it("renders the session file as the `where` column", () => {
    expect(renderSupervisorEventLine({ event: attach() })).toBe(
      "alert\t2026-08-26T14:30:00.000Z\tgithub-attach\tneeds-owner-login\tstate-home/github-web-session.json\t" +
        "the saved GitHub web session has expired",
    );
  });

  it("drops a line with no sessionPath rather than inventing one", () => {
    const line = JSON.stringify({
      atIso: "2026-08-26T14:30:00.000Z",
      kind: "needs-owner-login",
      source: "github-attach",
      why: "something",
    });
    expect(parseSupervisorEvent({ line })).toBe(undefined);
  });

  it("drops a kind this source does not publish", () => {
    expect(parseSupervisorEvent({ line: JSON.stringify({ ...attach(), kind: "died" }) })).toBe(undefined);
  });
});

describe("the `github merge` source", () => {
  it("grades main-gate-failed as an alert — a red base is discovered by the next branch otherwise", () => {
    expect(severityOf({ event: mergeAlert() })).toBe("alert");
  });

  it("round-trips through the wire", () => {
    expect(parseSupervisorEvent({ line: supervisorEventLine({ event: mergeAlert() }) })).toEqual(mergeAlert());
  });

  it("renders the repo as the `where` column", () => {
    expect(renderSupervisorEventLine({ event: mergeAlert() })).toBe(
      "alert\t2026-08-26T15:00:00.000Z\tgithub-merge\tmain-gate-failed\towner/name\t" +
        "main crossed the skill-body cap right after this merge landed",
    );
  });

  it("drops a line with no repo rather than inventing one", () => {
    const line = JSON.stringify({
      atIso: "2026-08-26T15:00:00.000Z",
      kind: "main-gate-failed",
      source: "github-merge",
      why: "something",
    });
    expect(parseSupervisorEvent({ line })).toBe(undefined);
  });

  it("drops a kind this source does not publish", () => {
    expect(parseSupervisorEvent({ line: JSON.stringify({ ...mergeAlert(), kind: "died" }) })).toBe(undefined);
  });
});

describe("the `machine` source", () => {
  it("grades capacity-alert as an alert — a tick under threshold simply publishes nothing", () => {
    expect(severityOf({ event: machineAlert() })).toBe("alert");
  });

  it("round-trips through the wire", () => {
    expect(parseSupervisorEvent({ line: supervisorEventLine({ event: machineAlert() }) })).toEqual(machineAlert());
  });

  it("round-trips a swap-only alert with no foreign process over its own threshold", () => {
    const event = machineAlert({ topForeignGb: undefined, topForeignLabel: undefined });
    expect(parseSupervisorEvent({ line: supervisorEventLine({ event }) })).toEqual(event);
  });

  it("renders the top foreign process's label as the `where` column", () => {
    expect(renderSupervisorEventLine({ event: machineAlert() })).toBe(
      "alert\t2026-08-31T00:19:00.000Z\tmachine\tcapacity-alert\tmds\t" +
        "machine capacity: ALERT (foreign footprint over 8 GB, swap over 4 GB) — top foreign hog 'mds' at 19.7 GB · swap 6.2/8 GB",
    );
  });

  it("renders `swap` as the `where` column when no foreign process crossed its own threshold", () => {
    const line = renderSupervisorEventLine({
      event: machineAlert({ topForeignGb: undefined, topForeignLabel: undefined }),
    });
    expect(line.split("\t")[4]).toBe("swap");
  });

  it("renders a session's spawned child as the `where` column over the foreign process beside it, and round-trips its session", () => {
    const event = machineAlert({ fleetChildLabel: "Python", fleetChildSessionId: "d5546c00" });
    expect(renderSupervisorEventLine({ event }).split("\t")[4]).toBe("Python");
    expect(parseSupervisorEvent({ line: supervisorEventLine({ event }) })).toEqual(event);
  });

  it("grades capacity-hold as an alert too — it is the one that stops a spawn", () => {
    expect(severityOf({ event: machineHold() })).toBe("alert");
  });

  it("round-trips a hold, gauge readings included, with no foreign process on it", () => {
    expect(parseSupervisorEvent({ line: supervisorEventLine({ event: machineHold() }) })).toEqual(machineHold());
  });

  it("renders the hold's OWN subject as its `where` column, whatever foreign process was also over", () => {
    const line = renderSupervisorEventLine({ event: machineHold({ topForeignGb: 19.7, topForeignLabel: "mds" }) });
    expect(line.split("\t")[4]).toBe("memory");
  });

  it("renders `cpu` as the `where` column for a load hold, never the compressor that did not fire", () => {
    const line = renderSupervisorEventLine({ event: machineHold({ holdOn: "cpu", load1: 34.84, segmentsPct: 12 }) });
    expect(line.split("\t")[4]).toBe("cpu");
  });

  it("falls back to `compressor` for a hold written before holdOn existed", () => {
    const line = renderSupervisorEventLine({ event: machineHold({ holdOn: undefined }) });
    expect(line.split("\t")[4]).toBe("compressor");
  });

  it("round-trips a load hold, carrying the 1-minute load that fired it", () => {
    const event = machineHold({ holdOn: "cpu", load1: 34.84 });
    expect(parseSupervisorEvent({ line: supervisorEventLine({ event }) })).toEqual(event);
  });

  it("drops a kind this source does not publish", () => {
    expect(parseSupervisorEvent({ line: JSON.stringify({ ...machineAlert(), kind: "died" }) })).toBe(undefined);
  });
});

describe("the `github hold` source", () => {
  it("grades stale as a warning, so it never competes with a listener death for attention", () => {
    expect(severityOf({ event: holdEvent() })).toBe("warn");
  });

  it("grades held and released as info — they are the pair that reports the current state", () => {
    expect(severityOf({ event: holdEvent({ kind: "held" }) })).toBe("info");
    expect(severityOf({ event: holdEvent({ kind: "released" }) })).toBe("info");
  });

  it("round-trips through the wire", () => {
    expect(parseSupervisorEvent({ line: supervisorEventLine({ event: holdEvent() }) })).toEqual(holdEvent());
  });

  it("renders repo#number as the `where` column, which is what a reader compares against", () => {
    expect(renderSupervisorEventLine({ event: holdEvent() })).toBe(
      "warn\t2026-08-28T02:00:00.000Z\tgithub-hold\tstale\towner/name#32\t" +
        "owner/name#32 has held the merge queue for 87m",
    );
  });

  it("drops a line with no pull-request number rather than inventing one", () => {
    const line = JSON.stringify({ ...holdEvent(), pr: undefined });
    expect(parseSupervisorEvent({ line })).toBe(undefined);
  });

  it("drops a line whose pull-request number is not a real number", () => {
    expect(parseSupervisorEvent({ line: JSON.stringify({ ...holdEvent(), pr: 0 }) })).toBe(undefined);
  });

  it("drops a kind this source does not publish", () => {
    expect(parseSupervisorEvent({ line: JSON.stringify({ ...holdEvent(), kind: "died" }) })).toBe(undefined);
  });
});
