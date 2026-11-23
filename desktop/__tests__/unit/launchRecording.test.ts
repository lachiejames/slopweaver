/*
 * The order a launch is journalled in: the process group the moment the worker runs, the vendor transcript only once
 * it reports ready, and a launch refused whenever a row cannot be written or the session is not the one the app
 * minted. A stop earns a closed row only when somebody asked for it and its group is proven gone, and a row it earned
 * but could not write is reported back so the close is refused.
 */
import { err, ok, type Result } from "neverthrow";
import { describe, expect, it } from "vitest";

import {
  closedRowAfter,
  type LaunchRecordingSeams,
  recordClose,
  recordLaunch,
  stopCause,
  type WorkerSettled,
} from "../../src/launchRecording";
import type { AppLaunchSpec } from "../../src/sessionControlProtocol";
import type { SessionRecoveryEvent } from "../../src/sessionRecoveryRecord";
import type { WorkerLaunchConfig } from "../../src/sessionWorker/workerWire";

const AT = "2026-11-10T00:00:00.000Z";
const MINTED = "a0000107-0000-4000-8000-000000000118";

const SPEC: AppLaunchSpec = {
  codexHome: "/h/codex-one",
  directory: "/work/acme",
  judgedInstanceId: "instance-a",
  ledgerKey: "abc-1",
  title: "abc-1",
  vendor: "codex",
};

const CLAUDE_SPEC: AppLaunchSpec = {
  claudeMdExcludes: [],
  credential: { kind: "store", secureStorageDir: "/h/c" },
  directory: "/work/acme",
  ledgerKey: "abc-1",
  title: "abc-1",
  vendor: "claude",
};

const CODEX: WorkerLaunchConfig = {
  adapterEntry: "/app/a.js",
  codexHome: "/h",
  codexPath: "/app/codex",
  directory: "/w",
  sessionId: "0b5e",
  vendor: "codex",
};

const CLAUDE: WorkerLaunchConfig = {
  claudeMdExcludes: [],
  claudePath: "/app/claude",
  credential: { kind: "store", secureStorageDir: "/h/c" },
  directory: "/w",
  sessionId: "0b5e",
  vendor: "claude",
  vendorSessionId: MINTED,
};

const GONE_AFTER_STOP = { gone: true, killed: false };

const GROUP_ROW: SessionRecoveryEvent = {
  atIso: AT,
  expectedExecutables: ["/app/Slopweaver", "/app/codex"],
  kind: "group-started",
  pgid: 4242,
  sessionId: "0b5e",
};

/**
 * A journal and a worker made of plain functions, recording the order things happened in.
 *
 * @param settled how the worker settles
 * @param refuseKind the row kind whose write fails, if any
 * @returns the seams, and the ordered log of what they saw
 */
function fakeLaunch({ settled, refuseKind }: { settled: WorkerSettled; refuseKind?: SessionRecoveryEvent["kind"] }): {
  seams: LaunchRecordingSeams;
  log: string[];
  rows: SessionRecoveryEvent[];
} {
  const log: string[] = [];
  const rows: SessionRecoveryEvent[] = [];
  const record = ({ event }: { event: SessionRecoveryEvent }): Result<void, string> => {
    log.push(`record:${event.kind}`);
    if (event.kind === refuseKind) {
      return err(`could not record the ${event.kind} row`);
    }
    rows.push(event);
    return ok(undefined);
  };
  const settle = async (): Promise<WorkerSettled> => {
    log.push("settle");
    return settled;
  };
  return { log, rows, seams: { execPath: "/app/Slopweaver", now: () => AT, record, settle } };
}

describe("recordLaunch", () => {
  it("records the group before waiting for the worker, and the transcript only once it is ready", async () => {
    const launch = fakeLaunch({ settled: { kind: "ready", vendorSessionId: "thread-1" } });
    const refused = await recordLaunch({
      config: CODEX,
      pid: 4242,
      seams: launch.seams,
      sessionId: "0b5e",
      spec: SPEC,
    });
    expect(refused).toBeUndefined();
    expect(launch.log).toEqual(["record:group-started", "settle", "record:opened"]);
    expect(launch.rows).toEqual([
      GROUP_ROW,
      { atIso: AT, kind: "opened", sessionId: "0b5e", spec: SPEC, vendorSessionId: "thread-1" },
    ]);
  });

  it("records the transcript id a Claude session streams when it is the one the app minted", async () => {
    const launch = fakeLaunch({ settled: { kind: "ready", vendorSessionId: MINTED } });
    const spec = CLAUDE_SPEC;
    expect(await recordLaunch({ config: CLAUDE, pid: 4242, seams: launch.seams, sessionId: "0b5e", spec })).toBe(
      undefined,
    );
    expect(launch.rows[1]).toEqual({ atIso: AT, kind: "opened", sessionId: "0b5e", spec, vendorSessionId: MINTED });
  });

  it("refuses a Claude session reporting a transcript other than the one the app minted, recording no opened row", async () => {
    const launch = fakeLaunch({ settled: { kind: "ready", vendorSessionId: "other" } });
    const spec = CLAUDE_SPEC;
    expect(await recordLaunch({ config: CLAUDE, pid: 4242, seams: launch.seams, sessionId: "0b5e", spec })).toBe(
      `the session reported transcript other, not the ${MINTED} the app minted`,
    );
    expect(launch.log).toEqual(["record:group-started", "settle"]);
  });

  it("refuses a resumed session reporting a thread other than the one it was resuming", async () => {
    const launch = fakeLaunch({ settled: { kind: "ready", vendorSessionId: "thread-new" } });
    const config: WorkerLaunchConfig = { ...CODEX, resumeVendorSessionId: "thread-1" };
    expect(await recordLaunch({ config, pid: 4242, seams: launch.seams, sessionId: "0b5e", spec: SPEC })).toBe(
      "the session reported transcript thread-new, not the thread-1 it was resuming",
    );
    expect(launch.log).toEqual(["record:group-started", "settle"]);
  });

  it("records a resumed session's opened row on the thread it continued", async () => {
    const launch = fakeLaunch({ settled: { kind: "ready", vendorSessionId: "thread-1" } });
    const config: WorkerLaunchConfig = { ...CODEX, resumeVendorSessionId: "thread-1" };
    expect(await recordLaunch({ config, pid: 4242, seams: launch.seams, sessionId: "0b5e", spec: SPEC })).toBe(
      undefined,
    );
    expect(launch.rows[1]).toEqual({
      atIso: AT,
      kind: "opened",
      sessionId: "0b5e",
      spec: SPEC,
      vendorSessionId: "thread-1",
    });
  });

  it("refuses without waiting for the worker when the group row cannot be written", async () => {
    const launch = fakeLaunch({ refuseKind: "group-started", settled: { kind: "ready", vendorSessionId: "thread-1" } });
    expect(await recordLaunch({ config: CODEX, pid: 4242, seams: launch.seams, sessionId: "0b5e", spec: SPEC })).toBe(
      "could not record the group-started row",
    );
    expect(launch.log).toEqual(["record:group-started"]);
    expect(launch.rows).toEqual([]);
  });

  it("refuses when the opened row cannot be written", async () => {
    const launch = fakeLaunch({ refuseKind: "opened", settled: { kind: "ready", vendorSessionId: "thread-1" } });
    expect(await recordLaunch({ config: CODEX, pid: 4242, seams: launch.seams, sessionId: "0b5e", spec: SPEC })).toBe(
      "could not record the opened row",
    );
    expect(launch.rows).toEqual([GROUP_ROW]);
  });

  it("refuses with the worker's own reason when it fails to come up, recording no opened row", async () => {
    const launch = fakeLaunch({ settled: { kind: "failed", why: "the adapter exited 1" } });
    expect(await recordLaunch({ config: CODEX, pid: 4242, seams: launch.seams, sessionId: "0b5e", spec: SPEC })).toBe(
      "the adapter exited 1",
    );
    expect(launch.rows).toEqual([GROUP_ROW]);
  });

  it("refuses a worker that never started, recording nothing and waiting for nothing", async () => {
    const launch = fakeLaunch({ settled: { kind: "ready", vendorSessionId: "thread-1" } });
    expect(
      await recordLaunch({ config: CODEX, pid: undefined, seams: launch.seams, sessionId: "0b5e", spec: SPEC }),
    ).toBe("the session's worker did not start, so it has no process group to record");
    expect(launch.log).toEqual([]);
  });
});

describe("closedRowAfter", () => {
  const GONE = { gone: true, killed: false };

  it("closes an asked-for stop that began holding the group and ends with it proven gone", () => {
    expect(closedRowAfter({ asked: true, atIso: AT, ended: GONE, heldPgid: 4242, sessionId: "0b5e" })).toEqual({
      atIso: AT,
      kind: "closed",
      sessionId: "0b5e",
    });
  });

  it("leaves a crash's cleanup nobody asked for unclosed even once its group is gone, so a later run may resume it", () => {
    expect(
      closedRowAfter({
        asked: false,
        atIso: AT,
        ended: { gone: true, killed: true },
        heldPgid: 4242,
        sessionId: "0b5e",
      }),
    ).toBeUndefined();
  });

  it("leaves an asked-for stop unclosed when its group survived the sweep", () => {
    expect(
      closedRowAfter({
        asked: true,
        atIso: AT,
        ended: { gone: false, killed: true },
        heldPgid: 4242,
        sessionId: "0b5e",
      }),
    ).toBeUndefined();
  });

  it("leaves a close that raced a launch still starting unclosed, since it held no group to prove gone", () => {
    expect(
      closedRowAfter({ asked: true, atIso: AT, ended: GONE, heldPgid: undefined, sessionId: "0b5e" }),
    ).toBeUndefined();
  });
});

describe("recordClose", () => {
  const READY: WorkerSettled = { kind: "ready", vendorSessionId: "thread-1" };
  const CLOSED_ROW = { atIso: AT, kind: "closed", sessionId: "0b5e" };

  it("journals the closed row an asked-for stop earned, leaving nothing unrecorded and nothing owed", () => {
    const launch = fakeLaunch({ settled: READY });
    const closed = recordClose({
      asked: true,
      atIso: AT,
      ended: GONE_AFTER_STOP,
      heldPgid: 4242,
      owedPgid: undefined,
      record: launch.seams.record,
      sessionId: "0b5e",
    });
    expect(closed).toEqual({ owedPgid: undefined, unrecorded: undefined });
    expect(launch.rows).toEqual([CLOSED_ROW]);
  });

  it("reports why an earned row could not be written and leaves its group owed, so the close is refused", () => {
    const launch = fakeLaunch({ refuseKind: "closed", settled: READY });
    const closed = recordClose({
      asked: true,
      atIso: AT,
      ended: GONE_AFTER_STOP,
      heldPgid: 4242,
      owedPgid: undefined,
      record: launch.seams.record,
      sessionId: "0b5e",
    });
    expect(closed).toEqual({ owedPgid: 4242, unrecorded: "could not record the closed row" });
    expect(launch.rows).toEqual([]);
  });

  it("pays an owed row on a later close that holds no group, rather than reading that close as done", () => {
    const launch = fakeLaunch({ settled: READY });
    const closed = recordClose({
      asked: true,
      atIso: AT,
      ended: GONE_AFTER_STOP,
      heldPgid: undefined,
      owedPgid: 4242,
      record: launch.seams.record,
      sessionId: "0b5e",
    });
    expect(closed).toEqual({ owedPgid: undefined, unrecorded: undefined });
    expect(launch.rows).toEqual([CLOSED_ROW]);
  });

  it("keeps the debt and refuses again when the later close cannot write the owed row either", () => {
    const launch = fakeLaunch({ refuseKind: "closed", settled: READY });
    const closed = recordClose({
      asked: true,
      atIso: AT,
      ended: GONE_AFTER_STOP,
      heldPgid: undefined,
      owedPgid: 4242,
      record: launch.seams.record,
      sessionId: "0b5e",
    });
    expect(closed).toEqual({ owedPgid: 4242, unrecorded: "could not record the closed row" });
  });

  it("owes the group a crash's cleanup proved gone, so an owner's later close still journals it closed", () => {
    const launch = fakeLaunch({ settled: READY });
    const cleanup = recordClose({
      asked: false,
      atIso: AT,
      ended: GONE_AFTER_STOP,
      heldPgid: 4242,
      owedPgid: undefined,
      record: launch.seams.record,
      sessionId: "0b5e",
    });
    expect(cleanup).toEqual({ owedPgid: 4242, unrecorded: undefined });
    const close = recordClose({
      asked: true,
      atIso: AT,
      ended: GONE_AFTER_STOP,
      heldPgid: undefined,
      owedPgid: cleanup.owedPgid,
      record: launch.seams.record,
      sessionId: "0b5e",
    });
    expect(close).toEqual({ owedPgid: undefined, unrecorded: undefined });
    expect(launch.rows).toEqual([CLOSED_ROW]);
  });

  it("owes nothing new for a group that survived the sweep", () => {
    const launch = fakeLaunch({ settled: READY });
    const closed = recordClose({
      asked: true,
      atIso: AT,
      ended: { gone: false, killed: true },
      heldPgid: 4242,
      owedPgid: undefined,
      record: launch.seams.record,
      sessionId: "0b5e",
    });
    expect(closed).toEqual({ owedPgid: undefined, unrecorded: undefined });
    expect(launch.log).toEqual([]);
  });

  it("writes nothing for a stop that earned no row, leaving any debt as it found it", () => {
    const launch = fakeLaunch({ settled: READY });
    const closed = recordClose({
      asked: false,
      atIso: AT,
      ended: GONE_AFTER_STOP,
      heldPgid: undefined,
      owedPgid: 4242,
      record: launch.seams.record,
      sessionId: "0b5e",
    });
    expect(closed).toEqual({ owedPgid: 4242, unrecorded: undefined });
    expect(launch.log).toEqual([]);
  });
});

describe("stopCause", () => {
  const rowFor = (cause: ReturnType<typeof stopCause>): unknown =>
    closedRowAfter({ asked: cause.asked(), atIso: AT, ended: GONE_AFTER_STOP, heldPgid: 4242, sessionId: "0b5e" });

  it("keeps an asked-for stop asked when the worker crashes or reports a failure on the way out, so it is never resumed", () => {
    const cause = stopCause({ failed: false });
    cause.markFailed();
    expect(cause.failed()).toBe(true);
    expect(rowFor(cause)).toEqual({ atIso: AT, kind: "closed", sessionId: "0b5e" });
  });

  it("makes a failure's cleanup asked for when a close joins it, since the owner wants it ended", () => {
    const cause = stopCause({ failed: true });
    cause.markAsked();
    expect(cause.failed()).toBe(true);
    expect(rowFor(cause)).toEqual({ atIso: AT, kind: "closed", sessionId: "0b5e" });
  });

  it("leaves a failure's cleanup nothing joined unasked, so it writes no closed row", () => {
    const cause = stopCause({ failed: true });
    expect(cause.asked()).toBe(false);
    expect(rowFor(cause)).toBeUndefined();
  });

  it("begins an asked-for stop asked and unfailed", () => {
    const cause = stopCause({ failed: false });
    expect(cause.asked()).toBe(true);
    expect(cause.failed()).toBe(false);
  });
});
