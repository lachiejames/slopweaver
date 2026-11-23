/**
 * A card's Stop (`desktop/src/cardStop.ts`): one stop per card however many navigation events report the click, a
 * press answered only by a sighting after it armed, and a timeout or an abandon that touches only its own press. The
 * timer and the stop are plain fakes the test settles by hand.
 */
import { describe, expect, it } from "vitest";

import { cardStopFor, type ScheduleTimeout } from "../../src/cardStop";
import { stopLink } from "../../src/sessionCard";

const ID = "0b5e1c2d-3e4f-4a5b-8c6d-7e8f9a0b1c2d";
const OTHER = "1c6f2d3e-4f5a-4b6c-9d7e-8f9a0b1c2d3e";

/** A fake card: every stop it started, every timer, and a way to finish the stop and fire the timers. */
function fakeCard(): {
  stop: ReturnType<typeof cardStopFor>;
  startedFor: string[];
  finishStop: () => void;
  fireTimers: () => void;
  cancelled: () => number;
} {
  const startedFor: string[] = [];
  const timers: { run: () => void; live: boolean }[] = [];
  let finishStop = (): void => undefined;
  const schedule: ScheduleTimeout = ({ run }) => {
    const timer = { live: true, run };
    timers.push(timer);
    return () => {
      timer.live = false;
    };
  };
  const stop = cardStopFor({
    schedule,
    sessionId: ID,
    startStop: async ({ link }) => {
      startedFor.push(link.sessionId);
      await new Promise<void>((resolve) => {
        finishStop = resolve;
      });
    },
  });
  return {
    cancelled: () => timers.filter((timer) => !timer.live).length,
    finishStop: () => {
      finishStop();
    },
    fireTimers: () => {
      for (const timer of timers.filter((each) => each.live)) {
        timer.live = false;
        timer.run();
      }
    },
    startedFor,
    stop,
  };
}

/** Let every settled promise's handlers run. */
async function flush(): Promise<void> {
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
}

describe("cardStopFor", () => {
  it("starts one stop when both navigation events report the same click", () => {
    const card = fakeCard();
    card.stop.observe({ target: stopLink({ sessionId: ID }) });
    card.stop.observe({ target: stopLink({ sessionId: ID }) });
    expect(card.startedFor).toEqual([ID]);
  });

  it("starts nothing for another session's link, another scheme or an escaped spelling of the id", () => {
    const card = fakeCard();
    card.stop.observe({ target: stopLink({ sessionId: OTHER }) });
    card.stop.observe({ target: `https://example.com/stop/${ID}` });
    card.stop.observe({ target: `slopweaver-session:stop/%30${ID.slice(1)}` });
    expect(card.startedFor).toEqual([]);
  });

  it("answers an armed press with the stop its click started, once that stop settles", async () => {
    const card = fakeCard();
    const press = card.stop.press()._unsafeUnwrap();
    const seen = press.arm({ timeoutMs: 5000 });
    card.stop.observe({ target: stopLink({ sessionId: ID }) });
    const answered = await seen;
    expect(card.startedFor).toEqual([ID]);
    expect(card.cancelled()).toBe(1);
    card.finishStop();
    expect(await answered!.stopping).toBe(undefined);
  });

  it("never answers a press with a sighting from before it armed", async () => {
    const card = fakeCard();
    const press = card.stop.press()._unsafeUnwrap();
    card.stop.observe({ target: stopLink({ sessionId: ID }) });
    const seen = press.arm({ timeoutMs: 5000 });
    card.fireTimers();
    expect(await seen).toBe(undefined);
    expect(card.startedFor).toEqual([ID]);
  });

  it("refuses a press once the card's stop has started, since a press could only be handed it", () => {
    const card = fakeCard();
    card.stop.observe({ target: stopLink({ sessionId: ID }) });
    expect(card.stop.press()._unsafeUnwrapErr()).toBe(
      "that card's Stop was already pressed and its stop has started, so read cmux list",
    );
    expect(card.startedFor).toEqual([ID]);
  });

  it("refuses a second press while the first one's stop runs, and keeps refusing once it settles", async () => {
    const card = fakeCard();
    const seen = card.stop.press()._unsafeUnwrap().arm({ timeoutMs: 5000 });
    card.stop.observe({ target: stopLink({ sessionId: ID }) });
    await seen;
    expect(card.stop.press()._unsafeUnwrapErr()).toBe("a press of that card's Stop is already in flight");
    card.finishStop();
    await flush();
    expect(card.stop.press()._unsafeUnwrapErr()).toBe(
      "that card's Stop was already pressed and its stop has started, so read cmux list",
    );
  });

  it("frees the card when a press times out, and the timed-out press never answers a later one", async () => {
    const card = fakeCard();
    const first = card.stop.press()._unsafeUnwrap();
    const firstSeen = first.arm({ timeoutMs: 5000 });
    card.fireTimers();
    expect(await firstSeen).toBe(undefined);
    const secondSeen = card.stop.press()._unsafeUnwrap().arm({ timeoutMs: 5000 });
    first.abandon();
    card.stop.observe({ target: stopLink({ sessionId: ID }) });
    expect(await secondSeen).toEqual({ stopping: expect.any(Promise) });
  });

  it("withdraws an abandoned press's wait and timer, and frees the card", () => {
    const card = fakeCard();
    const press = card.stop.press()._unsafeUnwrap();
    void press.arm({ timeoutMs: 5000 });
    press.abandon();
    expect(card.cancelled()).toBe(1);
    expect(card.stop.press().isOk()).toBe(true);
  });
});
