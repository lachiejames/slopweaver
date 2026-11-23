import { describe, expect, it } from "vitest";

import {
  deathOf,
  livenessLine,
  parseListenReconcileArgs,
  RECONCILE_SPEC,
  resolveTargets,
} from "../../../../../cli/commands/listen/listenShared.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import type { ListenerLiveness } from "../../../../../live/listen/supervise/liveness.js";

/** One fixture per verdict state the union declares, nine in all, each beside the line it must render. */
const RENDERED: readonly { readonly liveness: ListenerLiveness; readonly line: string }[] = [
  {
    line: "unarmed — no listener is running. A tag arriving now is a no-op BY DESIGN.",
    liveness: { state: "unarmed" },
  },
  {
    line: "starting — arm arm-1 (pid 41) is 12s old and has not beaten yet",
    liveness: { armAgeMs: 12_400, armId: "arm-1", pid: 41, state: "starting" },
  },
  {
    line: "DOWN process-dead — arm arm-1 pid 41 is gone from the process table",
    liveness: { armId: "arm-1", pid: 41, state: "process-dead" },
  },
  {
    line: "DOWN heartbeat-missing — arm arm-1 pid 41 is alive but has never written a beat in 91s",
    liveness: { armAgeMs: 90_600, armId: "arm-1", pid: 41, state: "heartbeat-missing" },
  },
  {
    line: "DOWN heartbeat-foreign — the newest beat belongs to arm arm-0, not the supervised arm arm-1",
    liveness: { armId: "arm-1", heartbeatArmId: "arm-0", pid: 41, state: "heartbeat-foreign" },
  },
  {
    line: "DOWN heartbeat-stale — arm arm-1 pid 41 last beat 120s ago",
    liveness: { ageMs: 120_000, armId: "arm-1", pid: 41, state: "heartbeat-stale" },
  },
  {
    line: "reconnecting — arm arm-1 pid 41 has been off the socket for 5s, still inside the backoff a normal reconnect takes",
    liveness: { armId: "arm-1", pid: 41, socketDownMs: 5_000, state: "reconnecting" },
  },
  {
    line: "DOWN socket-down — arm arm-1 pid 41 is alive and beating, but its Socket Mode connection has been down for 300s",
    liveness: { armId: "arm-1", pid: 41, socketDownMs: 300_000, state: "socket-down" },
  },
  {
    line: "healthy — arm arm-1 pid 41, beat 3s ago, socket connected",
    liveness: { ageMs: 3_000, armId: "arm-1", pid: 41, state: "healthy" },
  },
];

describe("livenessLine", () => {
  it("renders each of the nine verdict states as its exact line, rounding milliseconds to whole seconds", () => {
    expect(RENDERED.length).toBe(9);
    expect(RENDERED.map(({ liveness }) => livenessLine({ liveness }))).toEqual(RENDERED.map(({ line }) => line));
  });

  it("leads with DOWN for the five death states and for none of the four others", () => {
    expect(
      RENDERED.filter(({ liveness }) => livenessLine({ liveness }).startsWith("DOWN ")).map(
        ({ liveness }) => liveness.state,
      ),
    ).toEqual(["process-dead", "heartbeat-missing", "heartbeat-foreign", "heartbeat-stale", "socket-down"]);
  });
});

describe("deathOf", () => {
  it("names arm, pid and the state as the reason for each of the five death states", () => {
    expect(RENDERED.map(({ liveness }) => deathOf({ liveness })).filter((death) => death !== undefined)).toEqual([
      { armId: "arm-1", pid: 41, reason: "process-dead" },
      { armId: "arm-1", pid: 41, reason: "heartbeat-missing" },
      { armId: "arm-1", pid: 41, reason: "heartbeat-foreign" },
      { armId: "arm-1", pid: 41, reason: "heartbeat-stale" },
      { armId: "arm-1", pid: 41, reason: "socket-down" },
    ]);
  });

  it("answers undefined for the four non-death states: unarmed, starting, reconnecting and healthy", () => {
    expect(
      RENDERED.filter(({ liveness }) => deathOf({ liveness }) === undefined).map(({ liveness }) => liveness.state),
    ).toEqual(["unarmed", "starting", "reconnecting", "healthy"]);
  });
});

describe("parseListenReconcileArgs", () => {
  it("declares --json as its one switch and --home as its one value flag", () => {
    expect(RECONCILE_SPEC).toEqual({ boolean: ["json"], string: ["home"] });
  });

  it("accepts --json and --home <dir>", () => {
    const parsed = parseListenReconcileArgs({ rest: ["--json", "--home", "/fixture/home"] });
    expect(parsed.isOk()).toBe(true);
    expect(unwrap(parsed)).toEqual({ positionals: [], values: { home: "/fixture/home", json: true } });
  });

  it("refuses an undeclared flag, a value on the switch and a stray positional, naming each", () => {
    const parsed = parseListenReconcileArgs({ rest: ["--queue", "q", "--json=yes", "extra"] });
    expect(parsed.isErr()).toBe(true);
    expect(unwrapErr(parsed)).toEqual([
      "unknown flag: --queue",
      "--json is a switch, not a value: write it on its own as `--json`. `--json=yes` would be read as OFF, which is the opposite of what it looks like",
      "unexpected argument: q",
      "unexpected argument: extra",
    ]);
  });
});

describe("resolveTargets", () => {
  it("uses a non-empty --home and --queue exactly as given", () => {
    expect(resolveTargets({ homeFlag: "/fixture/home", queueFlag: "/fixture/q.jsonl" })).toEqual({
      home: "/fixture/home",
      queuePath: "/fixture/q.jsonl",
    });
  });

  it("puts the queue under the given home's listener directory when --queue is empty", () => {
    expect(resolveTargets({ homeFlag: "/fixture/home", queueFlag: "" })).toEqual({
      home: "/fixture/home",
      queuePath: "/fixture/home/live/listener/queue.jsonl",
    });
  });
});
