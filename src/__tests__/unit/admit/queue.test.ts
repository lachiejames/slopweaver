/**
 * The withheld-reply queue: encoding, parsing, and the fold that turns a log into current state.
 *
 * Pure throughout — the store's round trip is exercised separately against a temp home, and everything that
 * decides anything is here.
 */
import { describe, expect, it } from "vitest";
import {
  foldQueue,
  type HeldReply,
  parseQueueLog,
  QUEUE_SCHEMA_VERSION,
  type QueueEvent,
  queueEventLine,
  recordedAskIdentityForHeld,
} from "../../../admit/queue.js";
import type { SchemaOneHeldReply } from "../../../admit/schemaOneAskRow.js";
import { parseOwnJson } from "../../parseOwnJson.js";

const HELD: HeldReply = {
  askedBy: "U_COLLEAGUE",
  channel: "C1",
  code: "withhold.reply",
  draft: { kind: "update", tldr: "We render rich_text." },
  messageTs: "1712345678.000100",
  question: "what did we decide about the renderer?",
  reason: "the answer applies the owner's lens and U_COLLEAGUE is not the owner",
  surface: "channel",
  threadTs: "1712345678.000100",
};

const HELD_EVENT: QueueEvent = { held: HELD, id: "q-aaaa1111", kind: "held", tsIso: "2026-08-06T01:00:00.000Z" };

describe("queueEventLine", () => {
  it("encodes a held event as one line with no newline of its own", () => {
    expect(queueEventLine({ event: HELD_EVENT }).includes("\n")).toBe(false);
  });

  it("round-trips through the parser", () => {
    const { events } = parseQueueLog({ text: queueEventLine({ event: HELD_EVENT }) });
    expect(events).toEqual([HELD_EVENT]);
  });

  it("stamps a schema version so the shape can move later", () => {
    const parsed = parseOwnJson<{ schemaVersion: number }>({ text: queueEventLine({ event: HELD_EVENT }) });
    expect(parsed.schemaVersion).toBe(QUEUE_SCHEMA_VERSION);
  });
});

describe("parseQueueLog", () => {
  it("reads an empty log as no events", () => {
    expect(parseQueueLog({ text: "" })).toEqual({ events: [], unreadable: [] });
  });

  it("ignores blank lines without counting them as damage", () => {
    const text = `${queueEventLine({ event: HELD_EVENT })}\n\n`;
    expect(parseQueueLog({ text }).unreadable).toEqual([]);
  });

  it("REPORTS a malformed line rather than skipping it silently", () => {
    const text = `not json\n${queueEventLine({ event: HELD_EVENT })}`;
    const { events, unreadable } = parseQueueLog({ text });
    expect(events.length).toBe(1);
    expect(unreadable).toEqual([1]);
  });

  it("reports a held line whose draft is missing — that is a promise nobody can keep", () => {
    const text = JSON.stringify({ held: { ...HELD, draft: undefined }, id: "q-x", kind: "held", tsIso: "t" });
    expect(parseQueueLog({ text }).unreadable).toEqual([1]);
  });

  it("reads a released event, defaulting an absent note to the empty string", () => {
    const text = JSON.stringify({ id: "q-aaaa1111", kind: "released", tsIso: "2026-08-06T02:00:00.000Z" });
    expect(parseQueueLog({ text }).events).toEqual([
      { id: "q-aaaa1111", kind: "released", note: "", tsIso: "2026-08-06T02:00:00.000Z" },
    ]);
  });

  it("reports an unknown event kind", () => {
    const text = JSON.stringify({ id: "q-x", kind: "archived", tsIso: "t" });
    expect(parseQueueLog({ text }).unreadable).toEqual([1]);
  });

  it("reads a pre-H6 schema-1 held row through its own schema-1 shape, never inventing a messageTs", () => {
    const text = JSON.stringify({
      held: {
        askedBy: "U_COLLEAGUE",
        channel: "C1",
        code: "withhold.reply",
        draft: { kind: "update", tldr: "schema one" },
        question: "what did we decide?",
        reason: "not the owner",
        surface: "channel",
        threadTs: "1712000000.000100",
      },
      id: "q-schema-one",
      kind: "held",
      schemaVersion: 1,
      tsIso: "2026-01-01T00:00:00.000Z",
    });
    const { events, unreadable } = parseQueueLog({ text });

    expect(unreadable).toEqual([]);
    expect(events).toEqual([
      {
        held: {
          askedBy: "U_COLLEAGUE",
          channel: "C1",
          code: "withhold.reply",
          draft: { kind: "update", tldr: "schema one" },
          question: "what did we decide?",
          reason: "not the owner",
          surface: "channel",
          threadTs: "1712000000.000100",
        },
        id: "q-schema-one",
        kind: "held",
        tsIso: "2026-01-01T00:00:00.000Z",
      },
    ]);
  });

  it("reports a schema-1 held row whose schema-1 body is malformed, rather than silently dropping it", () => {
    const text = JSON.stringify({
      held: { channel: "C1" },
      id: "q-schema-one",
      kind: "held",
      schemaVersion: 1,
      tsIso: "2026-01-01T00:00:00.000Z",
    });

    expect(parseQueueLog({ text }).unreadable).toEqual([1]);
  });

  it("reports a held row of neither schema version, rather than guessing which it is", () => {
    const text = JSON.stringify({ held: HELD, id: "q-x", kind: "held", schemaVersion: 3, tsIso: "t" });

    expect(parseQueueLog({ text }).unreadable).toEqual([1]);
  });
});

describe("recordedAskIdentityForHeld", () => {
  it("reads an exact schema-2 held reply as quality: exact, carrying its messageTs", () => {
    expect(recordedAskIdentityForHeld({ held: HELD })).toEqual({
      channel: "C1",
      messageTs: "1712345678.000100",
      quality: "exact",
      threadTs: "1712345678.000100",
    });
  });

  it("reads a thread-only held reply as quality: thread-only, never inventing a messageTs", () => {
    const threadOnly: SchemaOneHeldReply = {
      askedBy: "U_COLLEAGUE",
      channel: "C1",
      code: "withhold.reply",
      draft: { kind: "update" },
      question: "what did we decide?",
      reason: "not the owner",
      surface: "channel",
      threadTs: "1712000000.000100",
    };

    expect(recordedAskIdentityForHeld({ held: threadOnly })).toEqual({
      channel: "C1",
      quality: "thread-only",
      threadTs: "1712000000.000100",
    });
  });

  /**
   * A found-and-fixed defect: the check used to be `"messageTs" in held`, which also matches the
   * PROTOTYPE chain. A schema-1 row genuinely has no own `messageTs` — this proves an inherited
   * `messageTs` (from ANY prototype, not just the global `Object.prototype`) still cannot upgrade it to
   * `quality: "exact"`. Built via a scoped custom prototype rather than mutating the real
   * `Object.prototype`, so the same proof needs no global-state cleanup.
   */
  it("never upgrades a thread-only row to exact via an INHERITED messageTs", () => {
    const pollutedProto: Record<string, unknown> = Object.create(Object.prototype);
    pollutedProto["messageTs"] = "9.9";
    const threadOnly: SchemaOneHeldReply = Object.assign(Object.create(pollutedProto), {
      askedBy: "U_COLLEAGUE",
      channel: "C1",
      code: "withhold.reply",
      draft: { kind: "update" },
      question: "what did we decide?",
      reason: "not the owner",
      surface: "channel",
      threadTs: "1712000000.000100",
    });

    expect(Object.hasOwn(threadOnly, "messageTs")).toBe(false);
    expect("messageTs" in threadOnly).toBe(true);
    expect(recordedAskIdentityForHeld({ held: threadOnly })).toEqual({
      channel: "C1",
      quality: "thread-only",
      threadTs: "1712000000.000100",
    });
  });
});

describe("foldQueue", () => {
  it("folds one held event into one held item", () => {
    expect(foldQueue({ events: [HELD_EVENT] })).toEqual([
      { held: HELD, id: "q-aaaa1111", state: "held", tsIso: "2026-08-06T01:00:00.000Z" },
    ]);
  });

  it("keeps the draft on a released item, so it stays auditable after it went out", () => {
    const items = foldQueue({
      events: [HELD_EVENT, { id: "q-aaaa1111", kind: "released", note: "looked fine", tsIso: "2026-08-06T02:00:00Z" }],
    });
    expect(items[0]!.state).toBe("released");
    expect(items[0]!.note).toBe("looked fine");
    expect(items[0]!.resolvedIso).toBe("2026-08-06T02:00:00Z");
    expect(items[0]!.held.draft).toEqual(HELD.draft);
  });

  it("records a drop the same way, without sending anything", () => {
    const items = foldQueue({
      events: [HELD_EVENT, { id: "q-aaaa1111", kind: "dropped", note: "answered by hand", tsIso: "t2" }],
    });
    expect(items[0]!.state).toBe("dropped");
  });

  it("keeps the instant it was HELD as the item's timestamp, not the instant it was resolved", () => {
    const items = foldQueue({
      events: [HELD_EVENT, { id: "q-aaaa1111", kind: "released", note: "", tsIso: "2026-08-06T02:00:00Z" }],
    });
    expect(items[0]!.tsIso).toBe("2026-08-06T01:00:00.000Z");
  });

  it("IGNORES a resolution for an id that was never held — there would be nothing to act on", () => {
    expect(foldQueue({ events: [{ id: "q-ghost", kind: "released", note: "", tsIso: "t" }] })).toEqual([]);
  });

  it("returns newest first, because a queue is read from the top", () => {
    const second: QueueEvent = { ...HELD_EVENT, id: "q-bbbb2222", tsIso: "2026-08-06T03:00:00.000Z" };
    expect(foldQueue({ events: [HELD_EVENT, second] }).map((item) => item.id)).toEqual(["q-bbbb2222", "q-aaaa1111"]);
  });

  it("keeps the LAST resolution when an entry was resolved twice", () => {
    const items = foldQueue({
      events: [
        HELD_EVENT,
        { id: "q-aaaa1111", kind: "dropped", note: "first", tsIso: "t2" },
        { id: "q-aaaa1111", kind: "released", note: "second", tsIso: "t3" },
      ],
    });
    expect(items[0]!.state).toBe("released");
    expect(items[0]!.note).toBe("second");
  });
});
