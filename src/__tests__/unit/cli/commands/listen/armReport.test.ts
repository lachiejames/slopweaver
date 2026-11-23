/**
 * What `listen arm` prints, over a temp home's real Socket Mode observation and a logger whose two sinks feed
 * one ordered transcript: the connection budget is narrated on stderr ahead of anything else on both shapes;
 * a home that never observed a count says the arm opens blind, a reading prints its count, age and floor
 * caveat, and a corrupt record prints the read failure rather than "never observed"; `--json` puts one
 * document on stdout carrying the reading or `null` and the problem or `null`; and a human plan prints its
 * command on stdout and the foreground or background guidance on stderr, in order.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ArmPlan } from "../../../../../cli/commands/listen/armPlan.js";
import { printArmPlan } from "../../../../../cli/commands/listen/armReport.js";
import { createLogger, type Logger } from "../../../../../lib/logger.js";
import { unwrap } from "../../../../../lib/result.js";
import { ListenerStateErrors } from "../../../../../live/listen/supervise/errors.js";
import { writeSocketConnectionObservation } from "../../../../../live/listen/supervise/store.js";
import { stateHomePaths } from "../../../../../stateHome.js";

const NOW_MS = Date.parse("2026-10-01T10:05:00.000Z");

const BLIND =
  "err: no Socket Mode connection count has ever been observed on this home, so this arm opens blind — Slack " +
  "reports one only in the `hello` frame, and caps this app at 10 connections";

const STOP_GUIDANCE =
  "err: to stop it later, run `slopweaver listen disarm` FIRST and then kill it — an unjournalled stop is " +
  "counted as a death. Do not start a death-watch beside it; it dies in the same reap.";

const FOREGROUND: ArmPlan = {
  armId: "arm-1",
  background: false,
  command: "slopweaver listen --follow --arm arm-1",
  logPath: "/h/live/listener/logs/arm-1.err",
  mentionsPath: "/h/live/listener/logs/arm-1.jsonl",
  queuePath: "/h/queue.jsonl",
};

const BACKGROUND: ArmPlan = {
  ...FOREGROUND,
  background: true,
  command:
    "slopweaver listen --follow --arm arm-1 > /h/live/listener/logs/arm-1.jsonl 2> /h/live/listener/logs/arm-1.err &",
};

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "arm-report-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/** A logger whose stderr and stdout lines land in one transcript, each tagged with its stream. */
function transcriptLogger({ lines }: { lines: string[] }): Logger {
  return createLogger({
    outSink: (line) => {
      lines.push(`out: ${line}`);
    },
    sink: (line) => {
      lines.push(`err: ${line}`);
    },
  });
}

describe("printArmPlan", () => {
  it("narrates an arm opening blind, then prints a JSON plan with no reading and no problem", () => {
    const lines: string[] = [];

    printArmPlan({ home, json: true, log: transcriptLogger({ lines }), nowMs: NOW_MS, plan: FOREGROUND });

    expect(lines).toEqual([
      BLIND,
      `out: ${JSON.stringify({ ...FOREGROUND, socketConnections: null, socketConnectionsProblem: null })}`,
    ]);
  });

  it("narrates a reading's count, age and floor caveat, and embeds the whole reading in the JSON plan", () => {
    const lines: string[] = [];
    const observation = { armId: "arm-0", connections: 2, observedAtIso: "2026-10-01T10:00:00.000Z", pid: 4242 };
    unwrap(writeSocketConnectionObservation({ home, observation }));

    printArmPlan({ home, json: true, log: transcriptLogger({ lines }), nowMs: NOW_MS, plan: FOREGROUND });

    expect(lines).toEqual([
      "err: Slack last reported 2 of 10 Socket Mode connections for this app, 5m ago (arm arm-0, pid 4242)",
      "err: that is a FLOOR, not a live count: a closed socket keeps counting against the cap for tens of minutes " +
        "after its process is gone, and this is only the last `hello` a listener on this home saw",
      "err: more than one connection was open at that reading, so this arm is likely to be REFUSED at `hello` and " +
        "retry for up to 2m while Slack's count drains, exiting only if it still reports more than one — nothing " +
        "local frees a slot",
      `out: ${JSON.stringify({
        ...FOREGROUND,
        socketConnections: { connections: 2, observedAtIso: "2026-10-01T10:00:00.000Z", pid: 4242, armId: "arm-0" },
        socketConnectionsProblem: null,
      })}`,
    ]);
  });

  it("names a corrupt reading as a read failure rather than never-observed, and still prints the plan", () => {
    const lines: string[] = [];
    const path = stateHomePaths({ home }).live.listener.connectionsJson;
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, '{"connections":-1,"observedAtIso":"2026-10-01T10:00:00.000Z","pid":4242}', "utf8");
    const problem =
      'could not read the last Socket Mode connection count (listener supervision state field "connections" is ' +
      "invalid: -1) — arming without it";

    printArmPlan({ home, json: true, log: transcriptLogger({ lines }), nowMs: NOW_MS, plan: FOREGROUND });

    expect(lines).toEqual([
      `err: ${problem}`,
      `out: ${JSON.stringify({ ...FOREGROUND, socketConnections: null, socketConnectionsProblem: problem })}`,
    ]);
    expect(problem).toContain(ListenerStateErrors.invalid({ field: "connections", found: -1 }).message);
  });

  it("prints a foreground plan's command on stdout and its queue and long-lived-shell guidance on stderr", () => {
    const lines: string[] = [];

    printArmPlan({ home, json: false, log: transcriptLogger({ lines }), nowMs: NOW_MS, plan: FOREGROUND });

    expect(lines).toEqual([
      BLIND,
      "out: slopweaver listen --follow --arm arm-1",
      "err: arm arm-1 — queue /h/queue.jsonl",
      "err: run that as THIS session's own long-lived shell call — not detached, so it dies when the session does",
      STOP_GUIDANCE,
    ]);
  });

  it("prints a background plan's command on stdout and its three paths and not-detached guidance on stderr", () => {
    const lines: string[] = [];

    printArmPlan({ home, json: false, log: transcriptLogger({ lines }), nowMs: NOW_MS, plan: BACKGROUND });

    expect(lines).toEqual([
      BLIND,
      "out: slopweaver listen --follow --arm arm-1 > /h/live/listener/logs/arm-1.jsonl 2> /h/live/listener/logs/arm-1.err &",
      "err: arm arm-1 — mentions (watch this) /h/live/listener/logs/arm-1.jsonl, narration " +
        "/h/live/listener/logs/arm-1.err, queue /h/queue.jsonl",
      "err: run that in THIS session's own shell — backgrounded but NOT detached, so it dies when the session does",
      STOP_GUIDANCE,
    ]);
  });
});
