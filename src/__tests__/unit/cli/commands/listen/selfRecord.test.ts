import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { liveHelloRecorder, liveListenerBeatIfSupervised } from "../../../../../cli/commands/listen/selfRecord.js";
import { unwrap } from "../../../../../lib/result.js";
import { UNSCOPED } from "../../../../../live/listen/scope.js";
import type { ListenLog } from "../../../../../live/listen/socket.js";
import { ListenerStateErrors } from "../../../../../live/listen/supervise/errors.js";
import { readListenerArm, readSocketConnectionObservation } from "../../../../../live/listen/supervise/store.js";

const FIXED_ISO = "2026-10-01T09:30:00.000Z";

const homes: string[] = [];

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

/** A throwaway home, removed after the test. */
function freshHome(): string {
  const home = mkdtempSync(join(tmpdir(), "self-record-"));
  homes.push(home);
  return home;
}

/** Every path under `root` with its bytes (directories as `null`), sorted, so a whole-tree change is visible. */
function treeSnapshot({ root }: { root: string }): readonly (readonly [string, string | null])[] {
  return readdirSync(root, { recursive: true, encoding: "utf8" })
    .toSorted()
    .map((relative): readonly [string, string | null] => {
      const path = join(root, relative);
      return [relative, statSync(path).isDirectory() ? null : readFileSync(path, "utf8")];
    });
}

/** A progress log that keeps every line it was handed. */
function recordingLog(): { readonly lines: string[]; readonly log: ListenLog } {
  const lines: string[] = [];
  const log: ListenLog = ({ line }) => {
    lines.push(line);
  };
  return { lines, log };
}

describe("liveHelloRecorder", () => {
  it("writes the reported count with the injected instant, this pid and the arm id, narrating nothing", () => {
    const home = freshHome();
    const { lines, log } = recordingLog();
    const clockIso: NonNullable<Parameters<typeof liveHelloRecorder>[0]["clockIso"]> = () => FIXED_ISO;

    liveHelloRecorder({ armId: "arm-7", clockIso, home, progressLog: log })({ connections: 3 });

    const read = readSocketConnectionObservation({ home });
    expect(read.isOk()).toBe(true);
    expect(unwrap(read)).toEqual({ armId: "arm-7", connections: 3, observedAtIso: FIXED_ISO, pid: process.pid });
    expect(lines).toEqual([]);
  });

  it("samples the clock on each hello rather than once when the recorder is built", () => {
    const home = freshHome();
    const { log } = recordingLog();
    const instants = ["2026-10-01T09:30:00.000Z", "2026-10-01T09:31:00.000Z"];
    let calls = 0;
    const clockIso: NonNullable<Parameters<typeof liveHelloRecorder>[0]["clockIso"]> = () => {
      calls += 1;
      return instants[calls - 1]!;
    };

    const onHello = liveHelloRecorder({ armId: undefined, clockIso, home, progressLog: log });
    expect(calls).toBe(0);
    onHello({ connections: 1 });
    onHello({ connections: 2 });

    expect(calls).toBe(2);
    expect(unwrap(readSocketConnectionObservation({ home }))).toEqual({
      connections: 2,
      observedAtIso: "2026-10-01T09:31:00.000Z",
      pid: process.pid,
    });
  });

  it("narrates a failed write and returns instead of throwing", () => {
    const parent = freshHome();
    const home = join(parent, "not-a-directory");
    writeFileSync(home, "a file where the home should be\n");
    const { lines, log } = recordingLog();

    liveHelloRecorder({ armId: "arm-7", clockIso: () => FIXED_ISO, home, progressLog: log })({ connections: 3 });

    const path = join(home, "live", "listener", "connections.json");
    expect(lines).toEqual([
      `could not record the Socket Mode connection count — continuing: ${ListenerStateErrors.writeFailed({ cause: undefined, path }).message}`,
    ]);
    expect(lines[0]).toBe(
      `could not record the Socket Mode connection count — continuing: listener supervision state at ${path} could not be written`,
    );
  });
});

describe("liveListenerBeatIfSupervised", () => {
  it("returns no writer for a hand-started listener and leaves a seeded home byte-for-byte unchanged", () => {
    const home = freshHome();
    mkdirSync(join(home, "live", "listener"), { recursive: true });
    writeFileSync(join(home, "live", "listener", "arms.jsonl"), '{"kind":"armed"}\n');
    const before = treeSnapshot({ root: home });
    const { lines, log } = recordingLog();

    const beat = liveListenerBeatIfSupervised({
      armId: undefined,
      home,
      progressLog: log,
      scope: UNSCOPED,
      threadReplyChannels: [],
    });

    expect(beat).toBe(undefined);
    expect(treeSnapshot({ root: home })).toEqual(before);
    expect(lines).toEqual([]);
  });

  it("writes no arm record when the armed journal line would not append, so no clear can erase the only evidence", () => {
    // An arm record written over a failed append, later cleared, left an install reading as never armed.
    const home = freshHome();
    const journal = join(home, "live", "listener", "arms.jsonl");
    mkdirSync(journal, { recursive: true });
    const { lines, log } = recordingLog();

    const beat = liveListenerBeatIfSupervised({
      armId: "arm-9",
      home,
      progressLog: log,
      scope: UNSCOPED,
      threadReplyChannels: [],
    });
    beat!.stop();

    expect(unwrap(readListenerArm({ home }))).toBe(undefined);
    expect(lines).toEqual([
      `could not journal this listener's arm — continuing unsupervised: listener supervision state at ${journal} could not be written`,
    ]);
  });
});
