/**
 * The address dedupe window. "One tag, one turn" is the property; the key naming the MESSAGE is what makes
 * two distinct events for it one address (proved at the socket, `socket.test.ts`), and the ring forgetting
 * its oldest key is the only other way a duplicate could get through.
 */
import { describe, expect, it } from "vitest";

import { admitEvent, createDedupeState, DEDUPE_CAPACITY, dedupeKeyFor } from "../../../../live/listen/dedupe.js";

/** The addressed message the key is built from. */
const MENTION = { channel: "C0LISTEN", messageTs: "1785114398.557099" };

describe("dedupeKeyFor", () => {
  it("keys on the channel and the addressed message's ts", () => {
    expect(dedupeKeyFor({ mention: MENTION })).toBe("C0LISTEN/1785114398.557099");
  });

  it("keeps the same ts in two channels apart", () => {
    expect(dedupeKeyFor({ mention: { ...MENTION, channel: "C0OTHER" } })).toBe("C0OTHER/1785114398.557099");
  });

  it("never lets a slash inside one half collide two messages onto one key", () => {
    const left = dedupeKeyFor({ mention: { channel: "C/A", messageTs: "B" } });
    const right = dedupeKeyFor({ mention: { channel: "C", messageTs: "A/B" } });
    expect([left, right]).toEqual(["C%2FA/B", "C/A%2FB"]);
  });
});

describe("createDedupeState", () => {
  it("starts empty at the default capacity", () => {
    expect(createDedupeState()).toEqual({ capacity: DEDUPE_CAPACITY, keys: [] });
  });

  it("accepts a smaller window", () => {
    expect(createDedupeState({ capacity: 2 })).toEqual({ capacity: 2, keys: [] });
  });

  it("refuses a zero capacity, which would remember nothing and dedupe nothing", () => {
    expect(createDedupeState({ capacity: 0 }).capacity).toBe(1);
  });
});

describe("admitEvent", () => {
  it("admits a key it has not seen and remembers it", () => {
    const admitted = admitEvent({ key: "Ev1", state: createDedupeState({ capacity: 4 }) });

    expect(admitted.duplicate).toBe(false);
    expect(admitted.state.keys).toEqual(["Ev1"]);
  });

  it("reports the second delivery of one event id as a duplicate", () => {
    const first = admitEvent({ key: "Ev1", state: createDedupeState({ capacity: 4 }) });
    const second = admitEvent({ key: "Ev1", state: first.state });

    expect(second.duplicate).toBe(true);
    expect(second.state.keys).toEqual(["Ev1"]);
  });

  it("keeps distinct events apart", () => {
    const first = admitEvent({ key: "Ev1", state: createDedupeState({ capacity: 4 }) });
    const second = admitEvent({ key: "Ev2", state: first.state });

    expect(second.duplicate).toBe(false);
    expect(second.state.keys).toEqual(["Ev1", "Ev2"]);
  });

  it("forgets the OLDEST key once the window is full, and never grows past capacity", () => {
    const one = admitEvent({ key: "Ev1", state: createDedupeState({ capacity: 2 }) });
    const two = admitEvent({ key: "Ev2", state: one.state });
    const three = admitEvent({ key: "Ev3", state: two.state });

    expect(three.state.keys).toEqual(["Ev2", "Ev3"]);
    expect(admitEvent({ key: "Ev1", state: three.state }).duplicate).toBe(false);
    expect(admitEvent({ key: "Ev3", state: three.state }).duplicate).toBe(true);
  });

  it("leaves the input state untouched, so a window can be carried across connections", () => {
    const start = createDedupeState({ capacity: 2 });
    admitEvent({ key: "Ev1", state: start });

    expect(start.keys).toEqual([]);
  });
});
