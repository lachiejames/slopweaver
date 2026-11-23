import { describe, expect, it } from "vitest";

import type { OpenedMic } from "../../components/voice/audioRouteBrowser";
import {
  CARRYING_PREPARE_TIMEOUT_MS,
  callPreparationTimeoutMs,
  onReceipt,
  prepareCall,
} from "../../components/voice/prepareCall";
import type { LinkSchedule } from "../../lib/callLink";

/** A microphone that opens, and a count of the tracks a caller stopped on it. */
function fakeMic(): { opened: OpenedMic; openMic: () => Promise<OpenedMic>; stopped: () => number } {
  let stopped = 0;
  const track = {
    stop: () => {
      stopped += 1;
    },
  };
  const stream = { getTracks: () => [track] } as unknown as MediaStream;
  const opened: OpenedMic = { fellBack: false, stream };
  return { opened, openMic: () => Promise.resolve(opened), stopped: () => stopped };
}

/** A schedule that never fires, for a call with no bound. */
const NEVER: LinkSchedule = () => () => undefined;

/** No bound: the owner's own press. */
const UNBOUNDED = { mode: "fresh", schedule: NEVER } as const;

/** A schedule whose one timer fires when the test says, and which records whether it was cancelled. */
function heldTimer(): { schedule: LinkSchedule; fire: () => void; cancelled: () => boolean; ms: () => number } {
  let run: () => void = () => undefined;
  let ms = -1;
  let cancelled = false;
  return {
    cancelled: () => cancelled,
    fire: () => {
      run();
    },
    ms: () => ms,
    schedule: (timer) => {
      ({ run, ms } = timer);
      return () => {
        cancelled = true;
      };
    },
  };
}

describe("prepareCall", () => {
  it("releases the microphone the moment a superseded call has it, before the client loads", async () => {
    const mic = fakeMic();
    const ready = await prepareCall({ ...UNBOUNDED, openMic: mic.openMic, stillWanted: () => false });
    expect(ready).toEqual({ superseded: true });
    expect(mic.stopped()).toBe(1);
  });

  it("releases the microphone when the call is superseded while the client loads", async () => {
    const mic = fakeMic();
    const answers = [true, false];
    const ready = await prepareCall({ ...UNBOUNDED, openMic: mic.openMic, stillWanted: () => answers.shift()! });
    expect(ready).toEqual({ superseded: true });
    expect(mic.stopped()).toBe(1);
  });

  it("hands back the microphone and the client to a call still wanted, holding the microphone", async () => {
    const mic = fakeMic();
    const ready = await prepareCall({ ...UNBOUNDED, openMic: mic.openMic, stillWanted: () => true });
    expect("LiveWebRTC" in ready).toBe(true);
    expect(mic.stopped()).toBe(0);
  });

  it("says why when the microphone is refused to the current call", async () => {
    const ready = await prepareCall({
      ...UNBOUNDED,
      openMic: () => Promise.reject(new Error("Permission denied")),
      stillWanted: () => true,
    });
    expect(ready).toEqual({ why: "the microphone was not available: Permission denied" });
  });

  it("ends a superseded call quietly when its microphone is refused", async () => {
    const ready = await prepareCall({
      ...UNBOUNDED,
      openMic: () => Promise.reject(new Error("Permission denied")),
      stillWanted: () => false,
    });
    expect(ready).toEqual({ superseded: true });
  });

  // A call's reconnect journalled one attempt scheduled and nothing after.
  it("fails an attempt that runs out of time, naming what it waited on, and releases a microphone handed it late", async () => {
    const mic = fakeMic();
    let handOver: (opened: OpenedMic) => void = () => undefined;
    const late = new Promise<OpenedMic>((resolve) => {
      handOver = resolve;
    });
    const timer = heldTimer();
    const preparing = prepareCall({
      mode: "reconnect",
      openMic: () => late,
      schedule: timer.schedule,
      stillWanted: () => true,
    });
    timer.fire();
    const ready = await preparing;
    const stoppedBeforeLate = mic.stopped();
    handOver(mic.opened);
    await late;
    await Promise.resolve();
    expect([ready, timer.ms(), stoppedBeforeLate, mic.stopped()]).toEqual([
      { why: "the call did not finish preparing within 60 seconds, waiting on the microphone" },
      60_000,
      0,
      1,
    ]);
  });

  // A client load that never settles must not keep the microphone the failed attempt opened.
  it("releases a microphone already held when the bound passes while the call client loads", async () => {
    const mic = fakeMic();
    const timer = heldTimer();
    const preparing = prepareCall({
      mode: "reconnect",
      openMic: mic.openMic,
      schedule: timer.schedule,
      stillWanted: () => true,
    });
    await Promise.resolve();
    await Promise.resolve();
    timer.fire();
    const ready = await preparing;
    expect([ready, mic.stopped()]).toEqual([
      { why: "the call did not finish preparing within 60 seconds, waiting on the call client" },
      1,
    ]);
  });

  it("cancels its bound once the call is prepared in time, and holds the microphone", async () => {
    const mic = fakeMic();
    const timer = heldTimer();
    const ready = await prepareCall({
      mode: "rollover",
      openMic: mic.openMic,
      schedule: timer.schedule,
      stillWanted: () => true,
    });
    expect(["LiveWebRTC" in ready, timer.cancelled(), mic.stopped()]).toEqual([true, true, 0]);
  });
});

describe("callPreparationTimeoutMs", () => {
  it("bounds only a call the page opens on its own, never the owner's press", () => {
    expect([
      callPreparationTimeoutMs({ mode: "fresh" }),
      callPreparationTimeoutMs({ mode: "reconnect" }),
      callPreparationTimeoutMs({ mode: "rollover" }),
    ]).toEqual([undefined, CARRYING_PREPARE_TIMEOUT_MS, 60_000]);
  });
});

describe("onReceipt", () => {
  it("drops a failure sentence judged current inside but superseded by the time it is received", () => {
    const ready = onReceipt({
      ready: { why: "the microphone was not available: Permission denied" },
      stillWanted: () => false,
    });
    expect(ready).toEqual({ superseded: true });
  });

  it("releases a prepared microphone superseded by the time it is received", async () => {
    const mic = fakeMic();
    const prepared = await prepareCall({ ...UNBOUNDED, openMic: mic.openMic, stillWanted: () => true });
    const ready = onReceipt({ ready: prepared, stillWanted: () => false });
    expect(ready).toEqual({ superseded: true });
    expect(mic.stopped()).toBe(1);
  });

  it("passes a still-current answer through unchanged", () => {
    const why = { why: "the call client did not load: offline" };
    expect(onReceipt({ ready: why, stillWanted: () => true })).toBe(why);
  });
});
