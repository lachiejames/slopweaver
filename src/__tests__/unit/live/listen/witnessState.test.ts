/**
 * The witnessed-thread state: activation by tag, the 14-day retention after the last observed message, the
 * 40-lines-per-UTC-day budget, the address path's `handOff: false` never spending a line, and the own watch
 * a tag of THIS bot starts.
 */
import { describe, expect, it } from "vitest";

import {
  emptyWitnessState,
  isOwnWatchedThread,
  observeWitnessMessage,
  pruneWitnessState,
  WITNESS_DAILY_LINE_CAP,
  WITNESS_RETENTION_DAYS,
  type WitnessObservation,
  type WitnessState,
  witnessThreadKey,
} from "../../../../live/listen/witnessState.js";

/** A fixed instant as a Slack ts — the thread root every case witnesses. */
const ROOT = "1790000000.000100";
const ROOT_MS = 1_790_000_000_000;
const DAY_MS = 86_400_000;
const PEER = "U0PEER";

/**
 * One message in the root's thread at `offsetSeconds` past the root, tagging `activatesFor` when given and
 * this bot when `tagsSelf`.
 */
function message({
  activatesFor,
  offsetSeconds,
  tagsSelf = false,
}: {
  activatesFor?: string;
  offsetSeconds: number;
  tagsSelf?: boolean;
}): WitnessObservation {
  return {
    activatesFor,
    channel: "C0OPS",
    messageTs: `${String(1_790_000_000 + offsetSeconds)}.000100`,
    tagsSelf,
    threadTs: ROOT,
  };
}

/** The state after a person tagged THIS bot in the root — an address, so `handOff: false`. */
function ownActivated(): WitnessState {
  return observeWitnessMessage({
    handOff: false,
    nowMs: ROOT_MS,
    observation: message({ offsetSeconds: 0, tagsSelf: true }),
    state: emptyWitnessState(),
  }).state;
}

/** The state after the root itself tagged the peer bot. */
function activated(): WitnessState {
  return observeWitnessMessage({
    handOff: true,
    nowMs: ROOT_MS,
    observation: message({ activatesFor: PEER, offsetSeconds: 0 }),
    state: emptyWitnessState(),
  }).state;
}

describe("observeWitnessMessage", () => {
  it("ignores a message in a thread nobody tagged the witnessed bot in", () => {
    const step = observeWitnessMessage({
      handOff: true,
      nowMs: ROOT_MS,
      observation: message({ offsetSeconds: 5 }),
      state: emptyWitnessState(),
    });

    expect(step.verdict.kind).toBe("inactive");
    expect(step.state).toEqual(emptyWitnessState());
  });

  it("activates the thread on a tag and admits that very message", () => {
    const step = observeWitnessMessage({
      handOff: true,
      nowMs: ROOT_MS,
      observation: message({ activatesFor: PEER, offsetSeconds: 0 }),
      state: emptyWitnessState(),
    });

    expect(step.verdict.kind).toBe("admitted");
    expect(step.state.threads[witnessThreadKey({ channel: "C0OPS", threadTs: ROOT })]).toEqual({
      channel: "C0OPS",
      dayCounts: { "2026-09-21": 1 },
      lastObservedTs: ROOT,
      threadTs: ROOT,
      witnessUserId: PEER,
    });
  });

  it("admits a later untagged message in an active thread, carrying the bot that activated it", () => {
    const step = observeWitnessMessage({
      handOff: true,
      nowMs: ROOT_MS + 60_000,
      observation: message({ offsetSeconds: 60 }),
      state: activated(),
    });

    expect(step.verdict.kind).toBe("admitted");
    expect(step.state.threads[`C0OPS:${ROOT}`]!.witnessUserId).toBe(PEER);
    expect(step.state.threads[`C0OPS:${ROOT}`]!.dayCounts).toEqual({ "2026-09-21": 2 });
    expect(step.state.threads[`C0OPS:${ROOT}`]!.lastObservedTs).toBe("1790000060.000100");
  });

  it("records an addressed message without spending a line", () => {
    const step = observeWitnessMessage({
      handOff: false,
      nowMs: ROOT_MS + 60_000,
      observation: message({ offsetSeconds: 60 }),
      state: activated(),
    });

    expect(step.verdict.kind).toBe("recorded");
    expect(step.state.threads[`C0OPS:${ROOT}`]!.dayCounts).toEqual({ "2026-09-21": 1 });
    expect(step.state.threads[`C0OPS:${ROOT}`]!.lastObservedTs).toBe("1790000060.000100");
  });

  it("refuses the line past the daily cap but still moves the thread's last-seen instant", () => {
    let state = activated();
    for (let index = 1; index < WITNESS_DAILY_LINE_CAP; index += 1) {
      state = observeWitnessMessage({
        handOff: true,
        nowMs: ROOT_MS,
        observation: message({ offsetSeconds: index }),
        state,
      }).state;
    }
    const over = observeWitnessMessage({
      handOff: true,
      nowMs: ROOT_MS,
      observation: message({ offsetSeconds: 500 }),
      state,
    });

    expect(state.threads[`C0OPS:${ROOT}`]!.dayCounts).toEqual({ "2026-09-21": WITNESS_DAILY_LINE_CAP });
    expect(over.verdict.kind).toBe("over-budget");
    expect(over.state.threads[`C0OPS:${ROOT}`]!.dayCounts).toEqual({ "2026-09-21": WITNESS_DAILY_LINE_CAP });
    expect(over.state.threads[`C0OPS:${ROOT}`]!.lastObservedTs).toBe("1790000500.000100");
  });

  it("starts a fresh budget on the next UTC day", () => {
    const nextDay = observeWitnessMessage({
      handOff: true,
      nowMs: ROOT_MS + DAY_MS,
      observation: message({ offsetSeconds: 86_400 }),
      state: activated(),
    });

    expect(nextDay.verdict.kind).toBe("admitted");
    expect(nextDay.state.threads[`C0OPS:${ROOT}`]!.dayCounts).toEqual({ "2026-09-21": 1, "2026-09-22": 1 });
  });

  it("charges a late delivery from a spent day to THAT day, never to a fresh count", () => {
    let state = activated();
    for (let index = 1; index < WITNESS_DAILY_LINE_CAP; index += 1) {
      state = observeWitnessMessage({
        handOff: true,
        nowMs: ROOT_MS,
        observation: message({ offsetSeconds: index }),
        state,
      }).state;
    }
    state = observeWitnessMessage({
      handOff: true,
      nowMs: ROOT_MS + DAY_MS,
      observation: message({ offsetSeconds: 86_400 }),
      state,
    }).state;
    const late = observeWitnessMessage({
      handOff: true,
      nowMs: ROOT_MS + DAY_MS,
      observation: message({ offsetSeconds: 600 }),
      state,
    });

    expect(late.verdict.kind).toBe("over-budget");
    expect(late.state.threads[`C0OPS:${ROOT}`]!.dayCounts).toEqual({
      "2026-09-21": WITNESS_DAILY_LINE_CAP,
      "2026-09-22": 1,
    });
  });

  it("never hands off a late message from a day whose count is no longer kept", () => {
    let state = activated();
    for (const days of [10, 20]) {
      state = observeWitnessMessage({
        handOff: true,
        nowMs: ROOT_MS + days * DAY_MS,
        observation: message({ offsetSeconds: days * 86_400 }),
        state,
      }).state;
    }
    const late = observeWitnessMessage({
      handOff: true,
      nowMs: ROOT_MS + 20 * DAY_MS,
      observation: message({ offsetSeconds: 60 }),
      state,
    });

    expect(late.verdict.kind).toBe("over-budget");
    expect(late.state.threads[`C0OPS:${ROOT}`]!.dayCounts).toEqual({ "2026-10-01": 1, "2026-10-11": 1 });
  });

  it("still witnesses a thread exactly at the retention boundary after its last message", () => {
    const step = observeWitnessMessage({
      handOff: true,
      nowMs: ROOT_MS + WITNESS_RETENTION_DAYS * DAY_MS,
      observation: message({ offsetSeconds: WITNESS_RETENTION_DAYS * 86_400 }),
      state: activated(),
    });

    expect(step.verdict.kind).toBe("admitted");
  });

  it("forgets a thread one millisecond past retention, unless a new tag restarts it", () => {
    const pastMs = ROOT_MS + WITNESS_RETENTION_DAYS * DAY_MS + 1;
    const untagged = observeWitnessMessage({
      handOff: true,
      nowMs: pastMs,
      observation: message({ offsetSeconds: WITNESS_RETENTION_DAYS * 86_400 + 1 }),
      state: activated(),
    });
    const retagged = observeWitnessMessage({
      handOff: true,
      nowMs: pastMs,
      observation: message({ activatesFor: PEER, offsetSeconds: WITNESS_RETENTION_DAYS * 86_400 + 1 }),
      state: activated(),
    });

    expect(untagged.verdict.kind).toBe("inactive");
    expect(retagged.verdict.kind).toBe("admitted");
    expect(retagged.state.threads[`C0OPS:${ROOT}`]!.dayCounts).toEqual({ "2026-10-05": 1 });
  });
});

describe("observeWitnessMessage — the own watch", () => {
  it("starts the own watch on a tag of this bot, recorded without spending a line", () => {
    const step = observeWitnessMessage({
      handOff: false,
      nowMs: ROOT_MS,
      observation: message({ offsetSeconds: 0, tagsSelf: true }),
      state: emptyWitnessState(),
    });

    expect(step.verdict.kind).toBe("recorded");
    expect(step.state.threads[`C0OPS:${ROOT}`]).toEqual({
      channel: "C0OPS",
      dayCounts: { "2026-09-21": 0 },
      lastObservedTs: ROOT,
      ownTaggedTs: ROOT,
      threadTs: ROOT,
    });
  });

  it("admits a later untagged message in an own-only thread, carrying no peer", () => {
    const step = observeWitnessMessage({
      handOff: true,
      nowMs: ROOT_MS + 60_000,
      observation: message({ offsetSeconds: 60 }),
      state: ownActivated(),
    });

    expect(step.verdict).toEqual({
      kind: "admitted",
      thread: {
        channel: "C0OPS",
        dayCounts: { "2026-09-21": 1 },
        lastObservedTs: "1790000060.000100",
        ownTaggedTs: ROOT,
        threadTs: ROOT,
      },
    });
  });

  it("keeps the FIRST own tag when this bot is tagged again", () => {
    const step = observeWitnessMessage({
      handOff: false,
      nowMs: ROOT_MS + 60_000,
      observation: message({ offsetSeconds: 60, tagsSelf: true }),
      state: ownActivated(),
    });

    expect(step.state.threads[`C0OPS:${ROOT}`]!.ownTaggedTs).toBe(ROOT);
  });

  it("holds both watches when a peer-witnessed thread later tags this bot", () => {
    const step = observeWitnessMessage({
      handOff: false,
      nowMs: ROOT_MS + 60_000,
      observation: message({ offsetSeconds: 60, tagsSelf: true }),
      state: activated(),
    });

    expect(step.state.threads[`C0OPS:${ROOT}`]!.witnessUserId).toBe(PEER);
    expect(step.state.threads[`C0OPS:${ROOT}`]!.ownTaggedTs).toBe("1790000060.000100");
  });

  it("lets the own watch lapse with retention like any other", () => {
    const step = observeWitnessMessage({
      handOff: true,
      nowMs: ROOT_MS + WITNESS_RETENTION_DAYS * DAY_MS + 1,
      observation: message({ offsetSeconds: WITNESS_RETENTION_DAYS * 86_400 + 1 }),
      state: ownActivated(),
    });

    expect(step.verdict.kind).toBe("inactive");
  });
});

describe("isOwnWatchedThread", () => {
  const where = { channel: "C0OPS", threadTs: ROOT };

  it("is true for a retained thread this bot was tagged in", () => {
    expect(isOwnWatchedThread({ ...where, nowMs: ROOT_MS, state: ownActivated() })).toBe(true);
  });

  it("is false for a thread only a peer bot was tagged in", () => {
    expect(isOwnWatchedThread({ ...where, nowMs: ROOT_MS, state: activated() })).toBe(false);
  });

  it("is false for a thread nobody witnesses", () => {
    expect(isOwnWatchedThread({ ...where, nowMs: ROOT_MS, state: emptyWitnessState() })).toBe(false);
  });

  it("is false one millisecond past retention", () => {
    const nowMs = ROOT_MS + WITNESS_RETENTION_DAYS * DAY_MS + 1;

    expect(isOwnWatchedThread({ ...where, nowMs, state: ownActivated() })).toBe(false);
  });
});

describe("pruneWitnessState", () => {
  it("keeps a thread inside retention and drops one past it", () => {
    const state = activated();

    expect(Object.keys(pruneWitnessState({ nowMs: ROOT_MS + WITNESS_RETENTION_DAYS * DAY_MS, state }).threads)).toEqual(
      [`C0OPS:${ROOT}`],
    );
    expect(pruneWitnessState({ nowMs: ROOT_MS + WITNESS_RETENTION_DAYS * DAY_MS + 1, state }).threads).toEqual({});
  });
});
