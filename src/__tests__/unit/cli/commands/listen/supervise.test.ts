import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { armPlan, planArm } from "../../../../../cli/commands/listen/armPlan.js";
import {
  LISTEN_ARM_USAGE,
  LISTEN_DISARM_USAGE,
  LISTEN_RECONCILE_USAGE,
  LISTEN_STATUS_USAGE,
  LISTEN_SUPERVISE_USAGE,
} from "../../../../../cli/commands/listen/listenUsage.js";
import {
  LISTEN_ARM_FLAG_NAMES,
  LISTEN_RECONCILE_FLAG_NAMES,
  listenArmCommand,
  listenDisarmCommand,
  listenReconcileCommand,
  listenStatusCommand,
  listenSuperviseCommand,
  livenessLine,
} from "../../../../../cli/commands/listen/supervise.js";
import { superviseTick } from "../../../../../cli/commands/listen/superviseTick.js";
import { EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import { UNSCOPED } from "../../../../../live/listen/scope.js";
import type { ListenerArmEvent } from "../../../../../live/listen/supervise/rearm.js";
import {
  appendListenerArmEvent,
  readListenerArm,
  readListenerArmEvents,
  writeListenerArm,
} from "../../../../../live/listen/supervise/store.js";

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

const home = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "slopweaver-supervise-cli-"));
  fixtureDirs.push(dir);
  return dir;
};

/** `[node, cli, listen, <verb>, ...rest]` — the shape every verb in this family slices from. */
const argv = ({ verb, rest }: { verb: string; rest: readonly string[] }): readonly string[] => [
  "node",
  "cli",
  "listen",
  verb,
  ...rest,
];

describe("livenessLine", () => {
  it("says the no-op state plainly for an unarmed listener", () => {
    expect(livenessLine({ liveness: { state: "unarmed" } })).toContain("no-op BY DESIGN");
  });

  it("marks every down state DOWN, so a human scanning a log cannot miss one", () => {
    expect(livenessLine({ liveness: { armId: "a", pid: 1, state: "process-dead" } })).toContain("DOWN");
    expect(livenessLine({ liveness: { armAgeMs: 1, armId: "a", pid: 1, state: "heartbeat-missing" } })).toContain(
      "DOWN",
    );
    expect(
      livenessLine({ liveness: { armId: "a", heartbeatArmId: "b", pid: 1, state: "heartbeat-foreign" } }),
    ).toContain("DOWN");
    expect(livenessLine({ liveness: { ageMs: 1, armId: "a", pid: 1, state: "heartbeat-stale" } })).toContain("DOWN");
    expect(livenessLine({ liveness: { armId: "a", pid: 1, socketDownMs: 120_000, state: "socket-down" } })).toContain(
      "DOWN",
    );
  });

  it("does not mark healthy, starting or reconnecting DOWN", () => {
    expect(livenessLine({ liveness: { ageMs: 1, armId: "a", pid: 1, state: "healthy" } })).not.toContain("DOWN");
    expect(livenessLine({ liveness: { armAgeMs: 1, armId: "a", pid: 1, state: "starting" } })).not.toContain("DOWN");
    expect(
      livenessLine({ liveness: { armId: "a", pid: 1, socketDownMs: 5_000, state: "reconnecting" } }),
    ).not.toContain("DOWN");
  });

  it("says a reconnecting listener is inside a normal backoff, not broken", () => {
    expect(livenessLine({ liveness: { armId: "a", pid: 1, socketDownMs: 5_000, state: "reconnecting" } })).toContain(
      "normal reconnect",
    );
  });

  it("names the socket-down verdict as the one a pidfile check cannot see", () => {
    expect(livenessLine({ liveness: { armId: "a", pid: 7, socketDownMs: 120_000, state: "socket-down" } })).toContain(
      "Socket Mode connection has been down",
    );
  });
});

describe("the usage lines", () => {
  it("has at least one entry in LISTEN_ARM_FLAG_NAMES, so the guards below are not vacuously green", () => {
    expect(LISTEN_ARM_FLAG_NAMES.length).toBeGreaterThan(0);
  });

  it("advertise every flag the arm verb's ratchet list names", () => {
    for (const flag of LISTEN_ARM_FLAG_NAMES) {
      expect(LISTEN_ARM_USAGE).toContain(flag);
    }
  });

  it("state the escalation contract in supervise's own help rather than only in code", () => {
    expect(LISTEN_SUPERVISE_USAGE).toContain("3 deaths inside 15 minutes");
  });

  it("say plainly that arm starts nothing itself — the session runs the command", () => {
    expect(LISTEN_ARM_USAGE).toContain("Starts nothing itself");
  });

  it("say disarm sends no signal, because the process belongs to the session", () => {
    expect(LISTEN_DISARM_USAGE).toContain("Sends NO signal");
  });

  it("say disarm is idempotent, which is the behaviour a second run relies on", () => {
    expect(LISTEN_DISARM_USAGE).toContain("Idempotent");
  });

  it("say status exits non-zero when the listener is down OR stale", () => {
    expect(LISTEN_STATUS_USAGE).toContain("Exits 3 when the listener is\n  DOWN or its freshness grades STALE");
  });

  it("says status also reports which commit the loop is running", () => {
    expect(LISTEN_STATUS_USAGE).toContain("its bin and its\n  plugin-dir");
  });
});

describe("the verbs' parse-reject path", () => {
  it("refuses an unknown flag on arm without spawning anything", async () => {
    expect(await listenArmCommand(argv({ rest: ["--nope"], verb: "arm" }))).toBe(EXIT_USAGE);
  });

  it("refuses an unknown flag on status", async () => {
    expect(await listenStatusCommand(argv({ rest: ["--nope"], verb: "status" }))).toBe(EXIT_USAGE);
  });

  it("refuses an unknown flag on supervise", async () => {
    expect(await listenSuperviseCommand(argv({ rest: ["--nope"], verb: "supervise" }))).toBe(EXIT_USAGE);
  });

  it("refuses an unknown flag on disarm", async () => {
    expect(await listenDisarmCommand(argv({ rest: ["--nope"], verb: "disarm" }))).toBe(EXIT_USAGE);
  });
});

describe("armPlan", () => {
  it("is a PLAIN FOREGROUND call by default — the shape the owner asked for", () => {
    const plan = armPlan({ armId: "arm-1", home: "/tmp/h", queuePath: "/tmp/q.jsonl", scope: UNSCOPED });
    expect(plan.background).toBe(false);
    expect(plan.command.endsWith(" &")).toBe(false);
    expect(plan.command).not.toContain(">>");
  });

  it("backgrounds with a bare & and redirects, only when asked", () => {
    const plan = armPlan({
      armId: "arm-1",
      background: true,
      home: "/tmp/h",
      queuePath: "/tmp/q.jsonl",
      scope: UNSCOPED,
    });
    expect(plan.background).toBe(true);
    expect(plan.command.endsWith(" &")).toBe(true);
  });

  it("creates its own log directory when backgrounding, so `arm` itself writes nothing at all", () => {
    const plan = armPlan({
      armId: "arm-1",
      background: true,
      home: "/tmp/h",
      queuePath: "/tmp/q.jsonl",
      scope: UNSCOPED,
    });
    expect(plan.command.startsWith("mkdir -p ")).toBe(true);
  });

  it("uses no nohup, no setsid and no disown — each would outlive the session, which is the rejected shape", () => {
    const plan = armPlan({
      armId: "arm-1",
      background: true,
      home: "/tmp/h",
      queuePath: "/tmp/q.jsonl",
      scope: UNSCOPED,
    });
    expect(plan.command).not.toContain("nohup");
    expect(plan.command).not.toContain("setsid");
    expect(plan.command).not.toContain("disown");
  });

  it("carries --thread-replies onto the line, so a channel somebody switched it on for keeps it", () => {
    const plan = armPlan({
      armId: "arm-1",
      home: "/tmp/h",
      queuePath: "/tmp/q.jsonl",
      scope: UNSCOPED,
      threadReplyChannels: ["C0ALERTS", "G0SYNPRIVATE"],
    });
    expect(plan.command).toContain("--thread-replies C0ALERTS,G0SYNPRIVATE");
  });

  it("omits --thread-replies entirely when nothing is switched on, which is the default", () => {
    const plan = armPlan({ armId: "arm-1", home: "/tmp/h", queuePath: "/tmp/q.jsonl", scope: UNSCOPED });
    expect(plan.command).not.toContain("--thread-replies");
  });

  it("passes the arm id through as --heartbeat's value so the listener can register and beat as this arm", () => {
    const plan = armPlan({ armId: "arm-1", home: "/tmp/h", queuePath: "/tmp/q.jsonl", scope: UNSCOPED });
    expect(plan.command).toContain("--heartbeat arm-1");
  });

  it("names a per-arm pair of files for the arm, never a shared one", () => {
    const first = armPlan({
      armId: "arm-1",
      background: true,
      home: "/tmp/h",
      queuePath: "/tmp/q.jsonl",
      scope: UNSCOPED,
    });
    const second = armPlan({
      armId: "arm-2",
      background: true,
      home: "/tmp/h",
      queuePath: "/tmp/q.jsonl",
      scope: UNSCOPED,
    });
    expect(first.logPath).toContain("arm-1.err");
    expect(first.mentionsPath).toContain("arm-1.jsonl");
    expect(first.logPath).not.toBe(second.logPath);
    expect(first.command).toContain(first.logPath);
  });

  it("NEVER merges stderr into stdout — loop.md forbids 2>&1, because stdout is the trigger stream", () => {
    const plan = armPlan({
      armId: "arm-1",
      background: true,
      home: "/tmp/h",
      queuePath: "/tmp/q.jsonl",
      scope: UNSCOPED,
    });
    expect(plan.command).not.toContain("2>&1");
  });

  it("sends stdout to the mentions file and stderr to the narration file, as two separate redirects", () => {
    const plan = armPlan({
      armId: "arm-1",
      background: true,
      home: "/tmp/h",
      queuePath: "/tmp/q.jsonl",
      scope: UNSCOPED,
    });
    expect(plan.command).toContain(`>> ${plan.mentionsPath}`);
    expect(plan.command).toContain(`2> ${plan.logPath}`);
  });

  it("carries a scope onto the listener line, so an arm proved in a DM is not live everywhere", () => {
    const dmOnly = armPlan({ armId: "arm-1", home: "/tmp/h", queuePath: "/tmp/q.jsonl", scope: { kind: "dm-only" } });
    const channels = armPlan({
      armId: "arm-1",
      home: "/tmp/h",
      queuePath: "/tmp/q.jsonl",
      scope: { channels: ["D0SYN000001", "C0SYN000002"], kind: "channels" },
    });

    expect(dmOnly.command).toContain(" listen --follow --heartbeat arm-1 --dm-only --queue /tmp/q.jsonl --home /tmp/h");
    expect(channels.command).toContain(
      " listen --follow --heartbeat arm-1 --channels D0SYN000001,C0SYN000002 --queue /tmp/q.jsonl --home /tmp/h",
    );
  });

  it("adds no scope flag for the unscoped arm", () => {
    const plan = armPlan({ armId: "arm-1", home: "/tmp/h", queuePath: "/tmp/q.jsonl", scope: UNSCOPED });

    expect(plan.command).toContain(" listen --follow --heartbeat arm-1 --queue /tmp/q.jsonl --home /tmp/h");
  });
});

describe("planArm", () => {
  it("plans an arm when nothing is recorded", () => {
    const planned = planArm({
      armId: "arm-1",
      existing: undefined,
      existingAlive: false,
      home: "/tmp/h",
      queuePath: "/tmp/q.jsonl",
      scope: UNSCOPED,
    });
    expect(planned.isOk()).toBe(true);
    expect(unwrap(planned).armId).toBe("arm-1");
  });

  it("plans an arm when the recorded one is recorded but DEAD", () => {
    const planned = planArm({
      armId: "arm-2",
      existing: { armId: "arm-1", pid: 7 },
      existingAlive: false,
      home: "/tmp/h",
      queuePath: "/tmp/q.jsonl",
      scope: UNSCOPED,
    });
    expect(planned.isOk()).toBe(true);
  });

  it("REFUSES when a recorded arm is still alive, naming it so an operator knows what to clear", () => {
    const planned = planArm({
      armId: "arm-2",
      existing: { armId: "arm-1", pid: 7 },
      existingAlive: true,
      home: "/tmp/h",
      queuePath: "/tmp/q.jsonl",
      scope: UNSCOPED,
    });
    expect(planned.isErr()).toBe(true);
    expect(unwrapErr(planned).code).toBe("LISTENER_ALREADY_ARMED");
    expect(unwrapErr(planned).message).toContain("arm-1");
  });
});

describe("status and disarm against a real home", () => {
  it("reports an empty home as unarmed and exits ok — nothing armed is not a fault", async () => {
    const dir = home();
    expect(await listenStatusCommand(argv({ rest: ["--home", dir, "--json"], verb: "status" }))).toBe(EXIT_OK);
  });

  it("disarming nothing is success and leaves the home unarmed", async () => {
    const dir = home();
    expect(await listenDisarmCommand(argv({ rest: ["--home", dir], verb: "disarm" }))).toBe(EXIT_OK);
    expect(unwrap(readListenerArm({ home: dir }))).toBe(undefined);
  });

  it("supervising an empty home asks for an arm and exits ok", async () => {
    const dir = home();
    expect(await listenSuperviseCommand(argv({ rest: ["--home", dir, "--json"], verb: "supervise" }))).toBe(EXIT_OK);
  });

  it("disarming a recorded arm whose process is long gone still clears the record", async () => {
    const dir = home();
    writeListenerArm({
      // A pid far above any real one on this platform, so the SIGTERM this verb sends lands on nothing.
      arm: {
        armId: "arm-1",
        logPath: "/tmp/arm-1.log",
        pid: 4_194_303,
        scope: UNSCOPED,
        startedAtIso: "2026-08-23T03:00:00.000Z",
        threadReplyChannels: [],
      },
      home: dir,
    });
    expect(await listenDisarmCommand(argv({ rest: ["--home", dir], verb: "disarm" }))).toBe(EXIT_OK);
    expect(unwrap(readListenerArm({ home: dir }))).toBe(undefined);
  });
});

/**
 * A fresh home holding three arms and not one death — the exact shape a past incident left behind, journalled
 * the way the listener itself does it.
 *
 * Stamped RELATIVE to the real clock rather than at the literal instants of that day, because the escalation
 * counts deaths inside a fifteen-minute window measured from `Date.now()`. Fixed timestamps would make the
 * test pass on the day it was written and quietly stop exercising the escalation forever after.
 */
const silentDayHome = (): string => {
  const dir = home();
  const startedMs = Date.now();
  const armIds = ["928671dd", "a6adc431", "45177d69"] as const;
  armIds.forEach((armId, index) => {
    const event: ListenerArmEvent = {
      armId,
      atIso: new Date(startedMs - (6 - index * 2) * 60_000).toISOString(),
      kind: "armed",
      pid: 49_358 + index,
    };
    appendListenerArmEvent({ event, home: dir });
  });
  return dir;
};

/** The arm record for the last of {@link silentDayHome}'s arms, pointing at a pid the table cannot hold. */
const deadCurrentArm = (): Parameters<typeof writeListenerArm>[0]["arm"] => ({
  armId: "45177d69",
  logPath: "/tmp/45177d69.err",
  // Above any pid this platform issues, so `kill -0` cannot accidentally find a live process.
  pid: 4_194_303,
  scope: UNSCOPED,
  startedAtIso: new Date(Date.now() - 2 * 60_000).toISOString(),
  threadReplyChannels: [],
});

/** Every death the journal in `dir` now holds. */
const deathsIn = ({ dir }: { dir: string }): readonly ListenerArmEvent[] =>
  unwrap(readListenerArmEvents({ home: dir })).filter((event) => event.kind === "died");

describe("listen reconcile against a journal nothing was alive to write to", () => {
  it("has at least one entry in LISTEN_RECONCILE_FLAG_NAMES, so the guards below are not vacuously green", () => {
    expect(LISTEN_RECONCILE_FLAG_NAMES.length).toBeGreaterThan(0);
  });

  it("advertises every flag its ratchet list names", () => {
    for (const flag of LISTEN_RECONCILE_FLAG_NAMES) {
      expect(LISTEN_RECONCILE_USAGE).toContain(flag);
    }
  });

  it("refuses an unknown flag with the usage line", async () => {
    expect(await listenReconcileCommand(argv({ rest: ["--nope"], verb: "reconcile" }))).toBe(EXIT_USAGE);
  });

  it("records nothing, and says so, for a home that has never armed anything", async () => {
    const dir = home();
    expect(await listenReconcileCommand(argv({ rest: ["--home", dir], verb: "reconcile" }))).toBe(EXIT_OK);
    expect(deathsIn({ dir }).length).toBe(0);
  });

  it("turns a journal of three arms and zero deaths into two recorded deaths", async () => {
    const dir = silentDayHome();
    expect(await listenReconcileCommand(argv({ rest: ["--home", dir], verb: "reconcile" }))).toBe(EXIT_EXPECTED_EMPTY);
    expect(deathsIn({ dir }).map((death) => death.armId)).toEqual(["928671dd", "a6adc431"]);
  });

  it("is safe to tick: a second pass records nothing and exits ok", async () => {
    const dir = silentDayHome();
    await listenReconcileCommand(argv({ rest: ["--home", dir], verb: "reconcile" }));
    expect(await listenReconcileCommand(argv({ rest: ["--home", dir], verb: "reconcile" }))).toBe(EXIT_OK);
    expect(deathsIn({ dir }).length).toBe(2);
  });

  it("records the CURRENT arm's death too when its pid is gone from the process table", async () => {
    const dir = silentDayHome();
    writeListenerArm({ arm: deadCurrentArm(), home: dir });
    await listenReconcileCommand(argv({ rest: ["--home", dir], verb: "reconcile" }));
    const deaths = deathsIn({ dir });
    expect(deaths.map((death) => death.armId)).toEqual(["928671dd", "a6adc431", "45177d69"]);
    expect(deaths[2]!.kind === "died" ? deaths[2]!.reason : "").toBe("process-dead");
  });

  it("never escalates, however many deaths it finds — supervise alone may leave the bot DOWN", async () => {
    const dir = silentDayHome();
    await listenReconcileCommand(argv({ rest: ["--home", dir], verb: "reconcile" }));
    const escalations = unwrap(readListenerArmEvents({ home: dir })).filter((event) => event.kind === "escalated");
    expect(escalations.length).toBe(0);
  });
});

describe("listen supervise after a reap it did not witness", () => {
  it("counts the unwatched deaths and ESCALATES rather than arming a fourth listener", async () => {
    const dir = silentDayHome();
    writeListenerArm({ arm: deadCurrentArm(), home: dir });
    expect(await listenSuperviseCommand(argv({ rest: ["--home", dir], verb: "supervise" }))).toBe(EXIT_EXPECTED_EMPTY);
    const events = unwrap(readListenerArmEvents({ home: dir }));
    expect(events.filter((event) => event.kind === "died").length).toBe(3);
    expect(events.filter((event) => event.kind === "escalated").length).toBe(1);
  });

  it("records each death ONCE — reconciling first must not double-count the one it is deciding about", async () => {
    const dir = silentDayHome();
    writeListenerArm({ arm: deadCurrentArm(), home: dir });
    await listenSuperviseCommand(argv({ rest: ["--home", dir], verb: "supervise" }));
    const armIds = deathsIn({ dir }).map((death) => death.armId);
    expect(armIds).toEqual(["928671dd", "a6adc431", "45177d69"]);
  });
});

describe("a re-arm after a death keeps the thread-reply channels the dead arm carried", () => {
  /** A dead arm in a fresh home: one journalled `armed`, a pid the table cannot hold, and no prior deaths. */
  const deadArmHome = ({ threadReplyChannels }: { threadReplyChannels: readonly string[] }): string => {
    const dir = home();
    const startedAtIso = new Date(Date.now() - 2 * 60_000).toISOString();
    // Above any pid this platform issues, so `kill -0` finds nothing and the tick reads `process-dead`.
    const pid = 4_194_303;
    appendListenerArmEvent({ event: { armId: "arm-dead", atIso: startedAtIso, kind: "armed", pid }, home: dir });
    writeListenerArm({
      arm: { armId: "arm-dead", logPath: "/tmp/arm-dead.err", pid, scope: UNSCOPED, startedAtIso, threadReplyChannels },
      home: dir,
    });
    return dir;
  };

  it("carries `--thread-replies` onto the re-arm line, so the feature survives the death", () => {
    const dir = deadArmHome({ threadReplyChannels: ["C0SYN000016"] });
    const outcome = superviseTick({ home: dir, queuePath: "/tmp/q.jsonl" });
    expect(outcome.action).toBe("rearm");
    expect(outcome.action === "rearm" ? outcome.plan.command : "").toContain("--thread-replies C0SYN000016");
  });

  it("carries both channels when two were switched on", () => {
    const dir = deadArmHome({ threadReplyChannels: ["C0SYN000016", "G0SYNPRIVATE"] });
    const outcome = superviseTick({ home: dir, queuePath: "/tmp/q.jsonl" });
    expect(outcome.action === "rearm" ? outcome.plan.command : "").toContain(
      "--thread-replies C0SYN000016,G0SYNPRIVATE",
    );
  });

  it("emits no `--thread-replies` at all when the dead arm had none — the twin that makes the pair falsifiable", () => {
    const dir = deadArmHome({ threadReplyChannels: [] });
    const outcome = superviseTick({ home: dir, queuePath: "/tmp/q.jsonl" });
    expect(outcome.action).toBe("rearm");
    expect(outcome.action === "rearm" ? outcome.plan.command : "").not.toContain("--thread-replies");
  });
});
