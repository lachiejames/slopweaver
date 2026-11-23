/*
 * The Queue on screen as the voice's window reads it in the desktop shell: the drawn
 * keys a Queue page carries, the rows held to them, the snapshot as it crosses the shell, and which Queue a tool reads.
 */
import { describe, expect, it } from "vitest";

import {
  drawnKeysOf,
  onQueuePath,
  QUEUE_SCREEN_WIRE_MAX_CHARS,
  type QueueScreenSnapshot,
  screenHeldOf,
  screenOrdered,
  screenSnapshotOf,
  screenSnapshotWire,
  screenSourceOf,
  unreadShown,
} from "../../lib/queueScreenVoice";
import { QUEUE_VOICE_ROWS, queueForVoice } from "../../lib/queueVoice";
import { askRow } from "./queueVoiceFixture";

const base = askRow();
const row = ({ key }: { key: string }): typeof base => ({ ...base, key });

const SNAPSHOT: QueueScreenSnapshot = {
  cards: { acts: [], focuses: [], recentlyLeft: [], rows: [row({ key: "ask:acme-1" })] },
  drawnKeys: ["ask:acme-1"],
  path: "/queue?view=all",
  shown: unreadShown({ otherContext: "slopweaver", view: "all" }),
};

describe("drawnKeys", () => {
  it("holds every key the Queue drew, past the cap the voice lists", () => {
    const drawn = Array.from({ length: QUEUE_VOICE_ROWS + 3 }, (_, n) => row({ key: `ask:acme-${String(n)}` }));
    const reading = queueForVoice({ drawn, folded: [], open: undefined, shows: () => true, unread: [], withheld: 0 });
    expect(reading.drawn).toHaveLength(QUEUE_VOICE_ROWS);
    expect(reading.drawnKeys).toEqual(drawn.map((each) => each.key));
    expect(drawnKeysOf({ shows: reading })).toEqual(drawn.map((each) => each.key));
  });

  it("reads none off a page that is not the Queue's reading", () => {
    expect(drawnKeysOf({ shows: undefined })).toBeUndefined();
    expect(drawnKeysOf({ shows: { cards: [] } })).toBeUndefined();
    expect(drawnKeysOf({ shows: { drawnKeys: ["ask:acme-1", 2] } })).toBeUndefined();
  });
});

describe("screenOrdered", () => {
  const live = [row({ key: "ask:acme-1" }), row({ key: "ask:acme-2" }), row({ key: "ask:acme-3" })];

  it("holds the rows to the drawn keys, in the order drawn, and names a key no row answers", () => {
    const held = screenOrdered({ drawn: ["ask:acme-3", "ask:acme-gone", "ask:acme-1"], live, ordered: live });
    expect(held.rows.map((each) => each.key)).toEqual(["ask:acme-3", "ask:acme-1"]);
    expect(held.missing).toEqual(["ask:acme-gone"]);
  });

  it("keeps the Queue's own order off the Queue", () => {
    const ordered = [live[1], live[0]];
    expect(screenOrdered({ drawn: undefined, live, ordered })).toEqual({ missing: [], rows: ordered });
  });
});

describe("the snapshot across the shell", () => {
  it("round-trips a snapshot, and one taken off the Queue with no drawn keys", () => {
    const wire = screenSnapshotWire({ snapshot: SNAPSHOT })!;
    const { drawnKeys: _drawn, ...offQueue } = { ...SNAPSHOT, path: "/alignment" };
    expect(screenSnapshotOf({ value: wire })).toEqual(SNAPSHOT);
    expect(screenSnapshotOf({ value: screenSnapshotWire({ snapshot: offQueue })! })).toEqual(offQueue);
  });

  it("refuses a snapshot past the bound, on both sides", () => {
    const huge = { ...SNAPSHOT, path: "x".repeat(QUEUE_SCREEN_WIRE_MAX_CHARS) };
    expect(screenSnapshotWire({ snapshot: huge })).toBeUndefined();
    expect(screenSnapshotOf({ value: "x".repeat(QUEUE_SCREEN_WIRE_MAX_CHARS + 1) })).toBeUndefined();
  });

  it("refuses what is not a snapshot", () => {
    expect(screenSnapshotOf({ value: "{" })).toBeUndefined();
    expect(screenSnapshotOf({ value: JSON.stringify({ ...SNAPSHOT, cards: { rows: [] } }) })).toBeUndefined();
    expect(screenSnapshotOf({ value: JSON.stringify({ ...SNAPSHOT, drawnKeys: ["ask:acme-1", 2] }) })).toBeUndefined();
  });

  it("carries the other context's hidden count across, and refuses counts that do not name the other context", () => {
    const counted = {
      ...SNAPSHOT,
      shown: { ...SNAPSHOT.shown, otherContext: { context: "slopweaver" as const, count: 20 } },
    };
    const carried = screenSnapshotOf({ value: screenSnapshotWire({ snapshot: counted })! })!;
    expect(carried.shown.otherContext).toEqual({ context: "slopweaver", count: 20 });
    const { otherContext: _other, ...unnamed } = SNAPSHOT.shown;
    expect(screenSnapshotOf({ value: JSON.stringify({ ...SNAPSHOT, shown: unnamed }) })).toBeUndefined();
    const stranger = { ...SNAPSHOT.shown, otherContext: { context: "acme", count: 1 } };
    expect(screenSnapshotOf({ value: JSON.stringify({ ...SNAPSHOT, shown: stranger }) })).toBeUndefined();
  });

  it("holds the shell's answer, and names a malformed one rather than reading it as an empty Queue", () => {
    const wire = screenSnapshotWire({ snapshot: SNAPSHOT })!;
    expect(screenHeldOf({ value: { kind: "served", snapshot: wire } })).toEqual({ kind: "served", snapshot: SNAPSHOT });
    expect(screenHeldOf({ value: { kind: "unreached", why: "no tab" } })).toEqual({ kind: "unreached", why: "no tab" });
    expect(screenHeldOf({ value: { kind: "served", snapshot: "{" } })).toEqual({
      kind: "unreached",
      why: "the console window's Queue arrived malformed or past the bound",
    });
    expect(screenHeldOf({ value: 3 })).toEqual({
      kind: "unreached",
      why: "the desktop app answered the ask for the Queue with something that is not one",
    });
  });
});

describe("which Queue a tool reads", () => {
  it("reads the console window's snapshot of the page on screen", () => {
    const held = { kind: "served", snapshot: SNAPSHOT } as const;
    expect(screenSourceOf({ carriedPath: "/queue?view=check-in", held })).toEqual({
      kind: "snapshot",
      snapshot: SNAPSHOT,
    });
  });

  it("never reads a snapshot of a page that was left", () => {
    const held = { kind: "served", snapshot: SNAPSHOT } as const;
    expect(screenSourceOf({ carriedPath: "/alignment", held })).toEqual({ kind: "local" });
  });

  it("on the Queue, without a snapshot, reads nothing but why", () => {
    expect(screenSourceOf({ carriedPath: "/queue", held: { kind: "unreached", why: "deadline" } })).toEqual({
      kind: "unreached",
      why: "deadline",
    });
    expect(screenSourceOf({ carriedPath: "/queue", held: { kind: "unasked" } })).toEqual({
      kind: "unreached",
      why: "the console window's Queue has not reached the voice's window for this page yet",
    });
  });

  it("off the Queue, with nothing asked, reads the voice window's own projection", () => {
    expect(screenSourceOf({ carriedPath: "/alignment", held: { kind: "unasked" } })).toEqual({ kind: "local" });
    expect(screenSourceOf({ carriedPath: undefined, held: { kind: "unasked" } })).toEqual({ kind: "local" });
  });

  it("off the Queue too, an ask that failed reads nothing but why, never the held copy", () => {
    expect(screenSourceOf({ carriedPath: "/alignment", held: { kind: "unreached", why: "deadline" } })).toEqual({
      kind: "unreached",
      why: "deadline",
    });
  });

  it("knows the Queue's page by its path, whatever its query", () => {
    expect([onQueuePath({ path: "/queue" }), onQueuePath({ path: "/queue?open=ask%3Aacme-1" })]).toEqual([true, true]);
    expect([onQueuePath({ path: "/queues" }), onQueuePath({ path: undefined })]).toEqual([false, false]);
  });
});
