/**
 * A session card's reloads (`desktop/src/sessionCardRedraw.ts`): streamed agent text coalesced to one reload per
 * interval with the newest always drawn last, any other change at once, loads never overlapping, and nothing reloading
 * while a press holds the card. The timer and the window are plain fakes the test drives by hand.
 */
import { describe, expect, it } from "vitest";

import type { ScheduleTimeout } from "../../src/cardStop";
import { cardRedrawFor } from "../../src/sessionCardRedraw";

/**
 * A fake card on `idle`, its first document loaded and that load's interval closed: every document it was asked to
 * load, and ways to fire its timers. `fresh` leaves the first interval open.
 */
function fakeCard({ fresh = false }: { fresh?: boolean } = {}): {
  redraw: ReturnType<typeof cardRedrawFor>;
  loads: string[];
  fireTimers: () => void;
  fireOldestTimer: () => void;
} {
  const loads: string[] = [];
  // A cancelled timer still fires here, so a stale callback is exercised rather than trusted to never run.
  let timers: (() => void)[] = [];
  const schedule: ScheduleTimeout = ({ run }) => {
    timers.push(run);
    return () => undefined;
  };
  const redraw = cardRedrawFor({
    frame: "idle",
    load: ({ url }) => {
      loads.push(url);
    },
    schedule,
    tailMs: 500,
    url: "idle",
  });
  redraw.loaded({ failed: false });
  const fireTimers = (): void => {
    const due = timers;
    timers = [];
    for (const run of due) {
      run();
    }
  };
  if (!fresh) {
    fireTimers();
  }
  return {
    fireOldestTimer: () => {
      timers.shift()!();
    },
    fireTimers,
    loads,
    redraw,
  };
}

describe("cardRedrawFor", () => {
  it("ignores a stale timer though the scheduler hands every timer the same cancel", () => {
    const loads: string[] = [];
    const timers: (() => void)[] = [];
    const sharedCancel = (): void => undefined;
    const redraw = cardRedrawFor({
      frame: "idle",
      load: ({ url }) => {
        loads.push(url);
      },
      schedule: ({ run }) => {
        timers.push(run);
        return sharedCancel;
      },
      tailMs: 500,
      url: "idle",
    });
    redraw.loaded({ failed: false });
    redraw.request({ frame: "running", url: "running" });
    redraw.loaded({ failed: false });
    redraw.request({ frame: "running", url: "running a" });
    timers.shift()!();
    expect(loads).toEqual(["running"]);
    timers.shift()!();
    expect(loads).toEqual(["running", "running a"]);
  });

  it("draws a tail at once when no reload is inside its interval", () => {
    const { redraw, loads } = fakeCard();
    redraw.request({ frame: "idle", url: "idle a" });
    expect(loads).toEqual(["idle a"]);
  });

  it("holds a tail asked for just after the first document behind that document's own interval", () => {
    const { redraw, loads, fireTimers } = fakeCard({ fresh: true });
    redraw.request({ frame: "idle", url: "idle a" });
    expect(loads).toEqual([]);
    fireTimers();
    expect(loads).toEqual(["idle a"]);
  });

  it("keeps a tail inside the interval of a load that settled and asked again inside its own call", () => {
    const loads: string[] = [];
    let timers: (() => void)[] = [];
    let onLoad: (() => void) | undefined;
    const redraw = cardRedrawFor({
      frame: "idle",
      load: ({ url }) => {
        loads.push(url);
        onLoad?.();
      },
      schedule: ({ run }) => {
        timers.push(run);
        return () => undefined;
      },
      tailMs: 500,
      url: "idle",
    });
    redraw.loaded({ failed: false });
    for (const run of timers.splice(0)) {
      run();
    }
    onLoad = () => {
      onLoad = undefined;
      redraw.loaded({ failed: false });
      redraw.request({ frame: "idle", url: "idle ab" });
    };
    redraw.request({ frame: "idle", url: "idle a" });
    expect(loads).toEqual(["idle a"]);
    const due = timers;
    timers = [];
    for (const run of due) {
      run();
    }
    expect(loads).toEqual(["idle a", "idle ab"]);
  });

  it("keeps a tail inside its interval when the frame changed and changed back during a load", () => {
    const { redraw, loads, fireTimers } = fakeCard();
    redraw.request({ frame: "idle", url: "idle a" });
    redraw.request({ frame: "running", url: "running" });
    redraw.request({ frame: "idle", url: "idle ab" });
    redraw.request({ frame: "idle", url: "idle abc" });
    redraw.loaded({ failed: false });
    expect(loads).toEqual(["idle a"]);
    fireTimers();
    expect(loads).toEqual(["idle a", "idle abc"]);
  });

  it("draws a state change at once, then only the newest tail when its interval closes", () => {
    const { redraw, loads, fireTimers } = fakeCard();
    redraw.request({ frame: "running", url: "running" });
    redraw.loaded({ failed: false });
    for (const said of ["a", "ab", "abc", "abcd"]) {
      redraw.request({ frame: "running", url: `running ${said}` });
    }
    expect(loads).toEqual(["running"]);
    fireTimers();
    expect(loads).toEqual(["running", "running abcd"]);
  });

  it("draws the last tail once the stream stops, and nothing more after", () => {
    const { redraw, loads, fireTimers } = fakeCard();
    redraw.request({ frame: "running", url: "running" });
    redraw.loaded({ failed: false });
    redraw.request({ frame: "running", url: "running a" });
    fireTimers();
    redraw.loaded({ failed: false });
    redraw.request({ frame: "running", url: "running ab" });
    fireTimers();
    redraw.loaded({ failed: false });
    fireTimers();
    fireTimers();
    expect(loads).toEqual(["running", "running a", "running ab"]);
  });

  it("opens the interval on a tail drawn with a held state change, so the next tail waits it out", () => {
    const { redraw, loads, fireTimers } = fakeCard();
    const release = redraw.hold();
    redraw.request({ frame: "running", url: "running" });
    redraw.request({ frame: "running", url: "running a" });
    release();
    redraw.loaded({ failed: false });
    redraw.request({ frame: "running", url: "running ab" });
    expect(loads).toEqual(["running a"]);
    fireTimers();
    expect(loads).toEqual(["running a", "running ab"]);
  });

  it("draws a state change at once, tail included, and a stale timer never brings the old tail back", () => {
    const { redraw, loads, fireTimers } = fakeCard();
    redraw.request({ frame: "running", url: "running" });
    redraw.loaded({ failed: false });
    redraw.request({ frame: "running", url: "running a" });
    redraw.request({ frame: "running", url: "running ab" });
    redraw.request({ frame: "stopping", url: "stopping ab" });
    expect(loads).toEqual(["running", "stopping ab"]);
    redraw.loaded({ failed: false });
    fireTimers();
    expect(loads).toEqual(["running", "stopping ab"]);
  });

  it("never starts a load while one is under way, and then starts only the newest", () => {
    const { redraw, loads } = fakeCard();
    redraw.request({ frame: "running", url: "running" });
    redraw.request({ frame: "stopping", url: "stopping" });
    redraw.request({ frame: "closed", url: "closed" });
    expect(loads).toEqual(["running"]);
    redraw.loaded({ failed: false });
    expect(loads).toEqual(["running", "closed"]);
  });

  it("reloads nothing while a press holds the card, then draws the newest once the last hold lets go", () => {
    const { redraw, loads, fireTimers } = fakeCard();
    const first = redraw.hold();
    const second = redraw.hold();
    redraw.request({ frame: "running", url: "running a" });
    redraw.request({ frame: "stopping", url: "stopping a" });
    fireTimers();
    first();
    first();
    expect(loads).toEqual([]);
    second();
    expect(loads).toEqual(["stopping a"]);
  });

  it("keeps a tail held by a press inside its interval, so letting go never draws two tails in one interval", () => {
    const { redraw, loads, fireTimers } = fakeCard();
    redraw.request({ frame: "idle", url: "idle a" });
    redraw.loaded({ failed: false });
    const release = redraw.hold();
    redraw.request({ frame: "idle", url: "idle ab" });
    release();
    expect(loads).toEqual(["idle a"]);
    fireTimers();
    expect(loads).toEqual(["idle a", "idle ab"]);
  });

  it("loads a failed document once more when its interval closes, then gives it up until asked for again", () => {
    const { redraw, loads, fireTimers } = fakeCard();
    redraw.request({ frame: "running", url: "running" });
    redraw.loaded({ failed: true });
    expect(loads).toEqual(["running"]);
    fireTimers();
    redraw.loaded({ failed: true });
    fireTimers();
    expect(loads).toEqual(["running", "running"]);
    redraw.request({ frame: "running", url: "running" });
    expect(loads).toEqual(["running", "running", "running"]);
    redraw.loaded({ failed: true });
    fireTimers();
    expect(loads).toEqual(["running", "running", "running", "running"]);
  });

  it("retries a failed tail only once its interval closes", () => {
    const { redraw, loads, fireTimers } = fakeCard();
    redraw.request({ frame: "idle", url: "idle a" });
    redraw.loaded({ failed: true });
    expect(loads).toEqual(["idle a"]);
    fireTimers();
    expect(loads).toEqual(["idle a", "idle a"]);
  });

  it("gives a failed document up after its second failure though it was asked for again while its retry waited", () => {
    const { redraw, loads, fireTimers } = fakeCard();
    redraw.request({ frame: "running", url: "running" });
    redraw.loaded({ failed: true });
    redraw.request({ frame: "running", url: "running" });
    fireTimers();
    redraw.loaded({ failed: true });
    fireTimers();
    expect(loads).toEqual(["running", "running"]);
  });

  it("gives a failed document up after its second failure though another was asked for while its retry loaded", () => {
    const { redraw, loads, fireTimers } = fakeCard();
    redraw.request({ frame: "running", url: "running" });
    redraw.loaded({ failed: true });
    fireTimers();
    redraw.request({ frame: "stopping", url: "stopping" });
    redraw.request({ frame: "running", url: "running" });
    redraw.loaded({ failed: true });
    fireTimers();
    expect(loads).toEqual(["running", "running"]);
  });

  it("gives a failed document up after its second failure though another and then it were asked for while held", () => {
    const { redraw, loads, fireTimers } = fakeCard();
    redraw.request({ frame: "running", url: "running" });
    const release = redraw.hold();
    redraw.loaded({ failed: true });
    redraw.request({ frame: "stopping", url: "stopping" });
    redraw.request({ frame: "running", url: "running" });
    release();
    fireTimers();
    redraw.loaded({ failed: true });
    fireTimers();
    expect(loads).toEqual(["running", "running"]);
  });

  it("gives a failed document up after a second failure in a row though its first was overtaken", () => {
    const { redraw, loads, fireTimers } = fakeCard();
    redraw.request({ frame: "running", url: "running" });
    const release = redraw.hold();
    redraw.request({ frame: "stopping", url: "stopping" });
    redraw.loaded({ failed: true });
    redraw.request({ frame: "running", url: "running" });
    release();
    fireTimers();
    redraw.loaded({ failed: true });
    fireTimers();
    expect(loads).toEqual(["running", "running"]);
  });

  it("holds a tail of a failed load inside that load's interval, though the failure put the card back", () => {
    const { redraw, loads, fireTimers } = fakeCard();
    redraw.request({ frame: "running", url: "running" });
    redraw.loaded({ failed: true });
    redraw.request({ frame: "running", url: "running a" });
    expect(loads).toEqual(["running"]);
    fireTimers();
    expect(loads).toEqual(["running", "running a"]);
  });

  it("loads the newer document instead when a failed one has been overtaken", () => {
    const { redraw, loads } = fakeCard();
    redraw.request({ frame: "running", url: "running" });
    redraw.request({ frame: "stopping", url: "stopping" });
    redraw.loaded({ failed: true });
    redraw.loaded({ failed: false });
    expect(loads).toEqual(["running", "stopping"]);
  });

  it("never lets a stale timer start a tail its newer interval still holds back", () => {
    const { redraw, loads, fireTimers, fireOldestTimer } = fakeCard();
    redraw.request({ frame: "running", url: "running" });
    redraw.loaded({ failed: false });
    redraw.request({ frame: "running", url: "running a" });
    redraw.request({ frame: "stopping", url: "stopping" });
    redraw.loaded({ failed: false });
    const release = redraw.hold();
    redraw.request({ frame: "stopping", url: "stopping a" });
    release();
    fireOldestTimer();
    expect(loads).toEqual(["running", "stopping"]);
    fireTimers();
    expect(loads).toEqual(["running", "stopping", "stopping a"]);
  });

  it("reloads nothing when a failed load leaves the card on the very document waiting next", () => {
    const { redraw, loads } = fakeCard();
    redraw.request({ frame: "running", url: "running" });
    redraw.request({ frame: "idle", url: "idle" });
    redraw.loaded({ failed: true });
    expect(loads).toEqual(["running"]);
  });

  it("asks for nothing when the card already shows the document", () => {
    const { redraw, loads } = fakeCard();
    redraw.request({ frame: "idle", url: "idle" });
    redraw.request({ frame: "running", url: "running" });
    redraw.request({ frame: "idle", url: "idle" });
    redraw.loaded({ failed: false });
    expect(loads).toEqual(["running", "idle"]);
  });

  it("draws nothing once the card is retired", () => {
    const { redraw, loads, fireTimers } = fakeCard();
    redraw.request({ frame: "running", url: "running a" });
    redraw.request({ frame: "running", url: "running ab" });
    redraw.retire();
    redraw.loaded({ failed: false });
    fireTimers();
    redraw.request({ frame: "closed", url: "closed" });
    expect(loads).toEqual(["running a"]);
  });
});
