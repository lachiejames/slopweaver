import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import type { ListenerHeartbeat } from "../../../../../live/listen/supervise/heartbeat.js";
import type { ListenerArm } from "../../../../../live/listen/supervise/liveness.js";
import {
  appendListenerArmEvent,
  clearListenerArm,
  listenerLogPath,
  listenerMentionsPath,
  readListenerArm,
  readListenerArmEvents,
  readListenerHeartbeat,
  readSocketConnectionObservation,
  writeListenerArm,
  writeListenerHeartbeat,
  writeSocketConnectionObservation,
} from "../../../../../live/listen/supervise/store.js";
import { stateHomePaths } from "../../../../../stateHome.js";

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

const home = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "slopweaver-listener-"));
  fixtureDirs.push(dir);
  return dir;
};

const arm: ListenerArm = {
  armId: "arm-1",
  logPath: "/tmp/arm-1.log",
  pid: 4242,
  scope: { channels: ["D0SYN000001"], kind: "channels" },
  startedAtIso: "2026-08-23T03:00:00.000Z",
  threadReplyChannels: [],
};

const heartbeat: ListenerHeartbeat = {
  armId: "arm-1",
  lastSocketEventAtIso: "2026-08-23T03:00:01.000Z",
  pid: 4242,
  socketState: "connected",
  socketStateSinceIso: "2026-08-23T03:00:01.000Z",
  writtenAtIso: "2026-08-23T03:00:02.000Z",
};

describe("the arm record", () => {
  it("reads back undefined when nothing has ever been armed", () => {
    const read = readListenerArm({ home: home() });
    expect(read.isOk()).toBe(true);
    expect(unwrap(read)).toBe(undefined);
  });

  it("round-trips through the real filesystem", () => {
    const dir = home();
    expect(writeListenerArm({ arm, home: dir }).isOk()).toBe(true);
    expect(unwrap(readListenerArm({ home: dir }))).toEqual(arm);
  });

  it("REFUSES a corrupt record rather than reading it as unarmed — the two-listener defect", () => {
    const dir = home();
    const path = stateHomePaths({ home: dir }).live.listener.armJson;
    mkdirSync(join(dir, "live", "listener"), { recursive: true });
    writeFileSync(path, "{not json", "utf8");
    const read = readListenerArm({ home: dir });
    expect(read.isErr()).toBe(true);
    expect(unwrapErr(read).code).toBe("LISTENER_STATE_MALFORMED_JSON");
  });

  it("refuses a well-formed JSON record that is not an arm", () => {
    const dir = home();
    mkdirSync(join(dir, "live", "listener"), { recursive: true });
    writeFileSync(stateHomePaths({ home: dir }).live.listener.armJson, '{"armId":"a"}', "utf8");
    const read = readListenerArm({ home: dir });
    expect(read.isErr()).toBe(true);
    expect(unwrapErr(read).code).toBe("LISTENER_STATE_INVALID");
  });

  it("clears the record, and clearing nothing is success", () => {
    const dir = home();
    expect(clearListenerArm({ home: dir }).isOk()).toBe(true);
    expect(writeListenerArm({ arm, home: dir }).isOk()).toBe(true);
    expect(clearListenerArm({ home: dir }).isOk()).toBe(true);
    expect(unwrap(readListenerArm({ home: dir }))).toBe(undefined);
  });
});

describe("the heartbeat file", () => {
  it("reads back undefined before the listener has ever beaten", () => {
    expect(unwrap(readListenerHeartbeat({ home: home() }))).toBe(undefined);
  });

  it("round-trips through the real filesystem", () => {
    const dir = home();
    expect(writeListenerHeartbeat({ heartbeat, home: dir }).isOk()).toBe(true);
    expect(unwrap(readListenerHeartbeat({ home: dir }))).toEqual(heartbeat);
  });

  it("is REWRITTEN whole, so a new arm's beat replaces the old one instead of appending behind it", () => {
    const dir = home();
    writeListenerHeartbeat({ heartbeat, home: dir });
    const second: ListenerHeartbeat = { ...heartbeat, armId: "arm-2", writtenAtIso: "2026-08-23T03:05:00.000Z" };
    writeListenerHeartbeat({ heartbeat: second, home: dir });
    expect(unwrap(readListenerHeartbeat({ home: dir }))).toEqual(second);
  });
});

describe("the arm journal", () => {
  it("is empty before anything has been journalled", () => {
    expect(unwrap(readListenerArmEvents({ home: home() }))).toEqual([]);
  });

  it("appends events and reads them back in order", () => {
    const dir = home();
    appendListenerArmEvent({ event: { armId: "a", atIso: heartbeat.writtenAtIso, kind: "armed", pid: 1 }, home: dir });
    appendListenerArmEvent({
      event: { armId: "a", atIso: heartbeat.writtenAtIso, kind: "died", pid: 1, reason: "process-dead" },
      home: dir,
    });
    const events = unwrap(readListenerArmEvents({ home: dir }));
    expect(events.length).toBe(2);
    expect(events[0]!.kind).toBe("armed");
    expect(events[1]!.kind).toBe("died");
  });

  it("drops a torn line and keeps every other entry — evidence must survive a kill mid-write", () => {
    const dir = home();
    mkdirSync(join(dir, "live", "listener"), { recursive: true });
    writeFileSync(
      stateHomePaths({ home: dir }).live.listener.armsJsonl,
      `{"armId":"a","atIso":"${heartbeat.writtenAtIso}","kind":"armed","pid":1}\n{"armId":\n`,
      "utf8",
    );
    expect(unwrap(readListenerArmEvents({ home: dir })).length).toBe(1);
  });
});

describe("the Socket Mode connection reading", () => {
  it("is absent before any listener has ever connected", () => {
    expect(unwrap(readSocketConnectionObservation({ home: home() }))).toBe(undefined);
  });

  it("round-trips whole", () => {
    const dir = home();
    unwrap(
      writeSocketConnectionObservation({
        home: dir,
        observation: { armId: "613dcc8e", connections: 10, observedAtIso: "2026-09-09T17:55:53.000Z", pid: 15770 },
      }),
    );

    const read = unwrap(readSocketConnectionObservation({ home: dir }))!;
    expect(read.connections).toBe(10);
    expect(read.armId).toBe("613dcc8e");
    expect(read.observedAtIso).toBe("2026-09-09T17:55:53.000Z");
    expect(read.pid).toBe(15770);
  });

  it("keeps only the LAST reading — an older count says nothing about now", () => {
    const dir = home();
    unwrap(
      writeSocketConnectionObservation({
        home: dir,
        observation: { connections: 10, observedAtIso: "2026-09-09T17:55:53.000Z", pid: 15770 },
      }),
    );
    unwrap(
      writeSocketConnectionObservation({
        home: dir,
        observation: { connections: 1, observedAtIso: "2026-09-09T18:08:06.000Z", pid: 37660 },
      }),
    );

    expect(unwrap(readSocketConnectionObservation({ home: dir }))!.connections).toBe(1);
  });

  it("reports a corrupt record as MALFORMED rather than as never-observed", () => {
    const dir = home();
    mkdirSync(join(dir, "live", "listener"), { recursive: true });
    writeFileSync(stateHomePaths({ home: dir }).live.listener.connectionsJson, `{"connections":`, "utf8");

    expect(unwrapErr(readSocketConnectionObservation({ home: dir })).code).toBe("LISTENER_STATE_MALFORMED_JSON");
  });

  it("lives in its OWN file, not in the heartbeat — it outlives the arm that observed it", () => {
    const dir = home();
    expect(stateHomePaths({ home: dir }).live.listener.connectionsJson).not.toBe(
      stateHomePaths({ home: dir }).live.listener.heartbeatJson,
    );
  });
});

describe("listenerLogPath and listenerMentionsPath", () => {
  it("give every arm its OWN files — the measured fix for a shared append log", () => {
    const dir = home();
    expect(listenerLogPath({ armId: "arm-1", home: dir })).not.toBe(listenerLogPath({ armId: "arm-2", home: dir }));
    expect(listenerLogPath({ armId: "arm-1", home: dir })).toBe(
      join(stateHomePaths({ home: dir }).live.listener.logsDir, "arm-1.err"),
    );
  });

  it("keep the two streams in DIFFERENT files, because stdout is the loop's trigger and stderr is narration", () => {
    const dir = home();
    expect(listenerMentionsPath({ armId: "arm-1", home: dir })).toBe(
      join(stateHomePaths({ home: dir }).live.listener.logsDir, "arm-1.jsonl"),
    );
    expect(listenerMentionsPath({ armId: "arm-1", home: dir })).not.toBe(
      listenerLogPath({ armId: "arm-1", home: dir }),
    );
  });
});
