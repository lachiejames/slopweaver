/**
 * A call survives the voice's renderer dying under it (`overlayRecovery.ts`): main remembers the call the page
 * reported, logs the death, and holds a recovery the reloaded page takes once — reconnecting unless the last death was
 * under a minute ago, and never once the recovery has aged out. The log line and its file round-trip here too.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../src/lib/result";
import { parseOverlayCall } from "../../src/desktopBridge";
import { appendDesktopEventLog, desktopEventLogLine } from "../../src/desktopEventLog";
import {
  CRASH_RECOVERY_SETTLE_MS,
  RECOVERY_TAKE_MS,
  recoveryAfterRendererGone,
  rendererGoneWhy,
  takeRecovery,
} from "../../src/overlayRecovery";

const TRANSCRIPT = "0442ee9a-dd6b-47ba-bb03-4ebead9df434";
const PLAN = "6f1c2d3e-4a5b-4c6d-8e7f-901234567890";
const CALL = { planCallId: PLAN, transcriptCallId: TRANSCRIPT };
const CRASH_MS = Date.parse("2026-10-25T12:43:23.000Z");
const OOM = { exitCode: 133, reason: "crashed" };

describe("parseOverlayCall", () => {
  it("takes a transcript id and a minted plan call's id", () => {
    expect(parseOverlayCall({ value: CALL })).toEqual(CALL);
  });

  it("takes a call the console has not minted yet", () => {
    expect(parseOverlayCall({ value: { planCallId: null, transcriptCallId: TRANSCRIPT } })).toEqual({
      planCallId: null,
      transcriptCallId: TRANSCRIPT,
    });
  });

  it("reads null as no call up", () => {
    expect(parseOverlayCall({ value: null })).toBe(null);
  });

  it("drops an id that is not a UUID", () => {
    expect(parseOverlayCall({ value: { planCallId: PLAN, transcriptCallId: "../calls" } })).toBe(undefined);
    expect(parseOverlayCall({ value: { planCallId: "x", transcriptCallId: TRANSCRIPT } })).toBe(undefined);
  });

  it("drops a missing plan id, an extra key and a non-object", () => {
    expect(parseOverlayCall({ value: { transcriptCallId: TRANSCRIPT } })).toBe(undefined);
    expect(parseOverlayCall({ value: { ...CALL, extra: 1 } })).toBe(undefined);
    expect(parseOverlayCall({ value: TRANSCRIPT })).toBe(undefined);
  });
});

describe("rendererGoneWhy", () => {
  it("words Electron's reason and keeps it with the exit code", () => {
    expect(rendererGoneWhy({ gone: { exitCode: 9, reason: "killed" } })).toBe(
      "the voice window's renderer was killed (killed, exit 9)",
    );
    expect(rendererGoneWhy({ gone: { exitCode: 0, reason: "oom" } })).toBe(
      "the voice window's renderer ran out of memory (oom, exit 0)",
    );
  });

  it("carries a reason it has no words for as itself", () => {
    expect(rendererGoneWhy({ gone: { exitCode: 1, reason: "something-new" } })).toBe(
      "the voice window's renderer went (something-new) (something-new, exit 1)",
    );
  });
});

describe("recoveryAfterRendererGone", () => {
  it("holds a reconnecting recovery for a call that was up, and logs the death with it", () => {
    const { entry, held } = recoveryAfterRendererGone({
      call: CALL,
      gone: OOM,
      held: undefined,
      lastCrashMonoMs: undefined,
      monoMs: CRASH_MS,
      nowMs: CRASH_MS,
    });
    expect(entry).toEqual({
      atIso: "2026-10-25T12:43:23.000Z",
      call: CALL,
      exitCode: 133,
      kind: "renderer-gone",
      reason: "crashed",
      reconnect: true,
      window: "overlay",
    });
    expect(held).toEqual({
      heldAtMonoMs: CRASH_MS,
      recovery: {
        crashedAtIso: "2026-10-25T12:43:23.000Z",
        planCallId: PLAN,
        reconnect: true,
        transcriptCallId: TRANSCRIPT,
        why: "the voice window's renderer crashed (crashed, exit 133)",
      },
    });
  });

  it("logs a death with no call and holds nothing", () => {
    const { entry, held } = recoveryAfterRendererGone({
      call: null,
      gone: OOM,
      held: undefined,
      lastCrashMonoMs: undefined,
      monoMs: CRASH_MS,
      nowMs: CRASH_MS,
    });
    expect(entry).toEqual({
      atIso: "2026-10-25T12:43:23.000Z",
      call: null,
      exitCode: 133,
      kind: "renderer-gone",
      reason: "crashed",
      reconnect: null,
      window: "overlay",
    });
    expect(held).toBe(undefined);
  });

  it("ends and closes a second death inside the minute, without reconnecting", () => {
    const lastCrashMonoMs = CRASH_MS - CRASH_RECOVERY_SETTLE_MS + 1;
    const { entry, held } = recoveryAfterRendererGone({
      call: CALL,
      gone: OOM,
      held: undefined,
      lastCrashMonoMs,
      monoMs: CRASH_MS,
      nowMs: CRASH_MS,
    });
    expect(held!.recovery.reconnect).toBe(false);
    expect(held!.recovery.transcriptCallId).toBe(TRANSCRIPT);
    expect(entry).toEqual({
      atIso: "2026-10-25T12:43:23.000Z",
      call: CALL,
      exitCode: 133,
      kind: "renderer-gone",
      reason: "crashed",
      reconnect: false,
      window: "overlay",
    });
  });

  it("reconnects again once a full minute has passed", () => {
    const lastCrashMonoMs = CRASH_MS - CRASH_RECOVERY_SETTLE_MS;
    const { held } = recoveryAfterRendererGone({
      call: CALL,
      gone: OOM,
      held: undefined,
      lastCrashMonoMs,
      monoMs: CRASH_MS,
      nowMs: CRASH_MS,
    });
    expect(held!.recovery.reconnect).toBe(true);
  });

  it("holds a call not yet minted, with no plan call to end", () => {
    const call = { planCallId: null, transcriptCallId: TRANSCRIPT };
    const { held } = recoveryAfterRendererGone({
      call,
      gone: OOM,
      held: undefined,
      lastCrashMonoMs: undefined,
      monoMs: CRASH_MS,
      nowMs: CRASH_MS,
    });
    expect(held!.recovery.planCallId).toBe(null);
  });

  it("keeps a recovery the replacement page died before taking, at its first age and no longer reconnecting", () => {
    const first = recoveryAfterRendererGone({
      call: CALL,
      gone: OOM,
      held: undefined,
      lastCrashMonoMs: undefined,
      monoMs: CRASH_MS,
      nowMs: CRASH_MS,
    });
    const againMs = CRASH_MS + 2_000;
    const { entry, held } = recoveryAfterRendererGone({
      call: null,
      gone: OOM,
      held: first.held,
      lastCrashMonoMs: CRASH_MS,
      monoMs: againMs,
      nowMs: againMs,
    });
    expect(entry).toEqual({
      atIso: "2026-10-25T12:43:25.000Z",
      call: null,
      exitCode: 133,
      kind: "renderer-gone",
      reason: "crashed",
      reconnect: null,
      window: "overlay",
    });
    expect(held).toEqual({
      heldAtMonoMs: CRASH_MS,
      recovery: {
        crashedAtIso: "2026-10-25T12:43:23.000Z",
        planCallId: PLAN,
        reconnect: false,
        transcriptCallId: TRANSCRIPT,
        why: "the voice window's renderer crashed (crashed, exit 133)",
      },
    });
  });

  it("withdraws the reconnect even when the next death with no call comes a full minute on", () => {
    const first = recoveryAfterRendererGone({
      call: CALL,
      gone: OOM,
      held: undefined,
      lastCrashMonoMs: undefined,
      monoMs: CRASH_MS,
      nowMs: CRASH_MS,
    });
    const againMs = CRASH_MS + CRASH_RECOVERY_SETTLE_MS;
    const { held } = recoveryAfterRendererGone({
      call: null,
      gone: OOM,
      held: first.held,
      lastCrashMonoMs: CRASH_MS,
      monoMs: againMs,
      nowMs: againMs,
    });
    expect(held!.recovery.reconnect).toBe(false);
    expect(held!.heldAtMonoMs).toBe(CRASH_MS);
  });

  it("ages a held recovery out from its first death however many deaths came between", () => {
    const first = recoveryAfterRendererGone({
      call: CALL,
      gone: OOM,
      held: undefined,
      lastCrashMonoMs: undefined,
      monoMs: CRASH_MS,
      nowMs: CRASH_MS,
    });
    const secondMs = CRASH_MS + CRASH_RECOVERY_SETTLE_MS + 1_000;
    const second = recoveryAfterRendererGone({
      call: null,
      gone: OOM,
      held: first.held,
      lastCrashMonoMs: CRASH_MS,
      monoMs: secondMs,
      nowMs: secondMs,
    });
    expect(second.held!.heldAtMonoMs).toBe(CRASH_MS);
    const { held } = recoveryAfterRendererGone({
      call: null,
      gone: OOM,
      held: second.held,
      lastCrashMonoMs: secondMs,
      monoMs: CRASH_MS + RECOVERY_TAKE_MS + 1,
      nowMs: CRASH_MS + RECOVERY_TAKE_MS + 1,
    });
    expect(held).toBe(undefined);
    expect(
      takeRecovery({
        held: second.held,
        monoMs: CRASH_MS + RECOVERY_TAKE_MS + 1,
        nowMs: CRASH_MS + RECOVERY_TAKE_MS + 1,
      }),
    ).toBe(undefined);
  });
});

describe("takeRecovery", () => {
  const { held } = recoveryAfterRendererGone({
    call: CALL,
    gone: OOM,
    held: undefined,
    lastCrashMonoMs: undefined,
    monoMs: CRASH_MS,
    nowMs: CRASH_MS,
  });

  it("hands a fresh recovery over and logs its taking", () => {
    const taken = takeRecovery({ held, monoMs: CRASH_MS + 4000, nowMs: CRASH_MS + 4000 });
    expect(taken!.recovery).toEqual(held!.recovery);
    expect(taken!.entry).toEqual({
      ageMs: 4000,
      atIso: "2026-10-25T12:43:27.000Z",
      kind: "recovery-taken",
      transcriptCallId: TRANSCRIPT,
    });
  });

  it("hands one over at the bound itself", () => {
    expect(
      takeRecovery({ held, monoMs: CRASH_MS + RECOVERY_TAKE_MS, nowMs: CRASH_MS + RECOVERY_TAKE_MS })!.recovery
        .transcriptCallId,
    ).toBe(TRANSCRIPT);
  });

  it("hands nothing over once it has aged out", () => {
    expect(
      takeRecovery({ held, monoMs: CRASH_MS + RECOVERY_TAKE_MS + 1, nowMs: CRASH_MS + RECOVERY_TAKE_MS + 1 }),
    ).toBe(undefined);
  });

  it("ages a recovery on the monotonic clock, whatever the wall clock was set to meanwhile", () => {
    const staleMono = CRASH_MS + RECOVERY_TAKE_MS + 60_000;
    expect(takeRecovery({ held, monoMs: staleMono, nowMs: CRASH_MS - 100_000 })).toBe(undefined);
    const taken = takeRecovery({ held, monoMs: CRASH_MS + 1_000, nowMs: CRASH_MS + 3_600_000 });
    expect(taken!.entry).toEqual({
      ageMs: 1_000,
      atIso: "2026-10-25T13:43:23.000Z",
      kind: "recovery-taken",
      transcriptCallId: TRANSCRIPT,
    });
  });

  it("hands nothing over when none is held", () => {
    expect(takeRecovery({ held: undefined, monoMs: CRASH_MS, nowMs: CRASH_MS })).toBe(undefined);
  });
});

describe("the desktop event log", () => {
  let dir: string | undefined;
  afterEach(() => {
    rmSync(dir!, { force: true, recursive: true });
  });

  it("appends one JSON line per entry, making the folder on the first", () => {
    dir = mkdtempSync(join(tmpdir(), "desktop-log-"));
    const path = join(dir, "Logs", "desktop-events.jsonl");
    const { entry } = recoveryAfterRendererGone({
      call: CALL,
      gone: OOM,
      held: undefined,
      lastCrashMonoMs: undefined,
      monoMs: CRASH_MS,
      nowMs: CRASH_MS,
    });
    const taken = takeRecovery({
      held: recoveryAfterRendererGone({
        call: CALL,
        gone: OOM,
        held: undefined,
        lastCrashMonoMs: undefined,
        monoMs: CRASH_MS,
        nowMs: CRASH_MS,
      }).held,
      monoMs: CRASH_MS + 2000,
      nowMs: CRASH_MS + 2000,
    });
    expect(unwrap(appendDesktopEventLog({ line: desktopEventLogLine({ entry }), path }))).toBe(undefined);
    expect(unwrap(appendDesktopEventLog({ line: desktopEventLogLine({ entry: taken!.entry }), path }))).toBe(undefined);
    const lines = readFileSync(path, "utf8").split("\n");
    expect(lines.length).toBe(3);
    expect(JSON.parse(lines[0]!)).toEqual(entry);
    expect(JSON.parse(lines[1]!)).toEqual(taken!.entry);
    expect(lines[2]).toBe("");
  });

  it("names the file it could not write", () => {
    dir = mkdtempSync(join(tmpdir(), "desktop-log-"));
    // A directory where the file should be: appending to it fails.
    const error = unwrapErr(appendDesktopEventLog({ line: "x\n", path: dir }));
    expect(error.code).toBe("LOG_UNWRITABLE");
    expect(error.path).toBe(dir);
    expect(error.message).toContain(`the desktop event log at ${dir} could not be written (EISDIR`);
  });
});
