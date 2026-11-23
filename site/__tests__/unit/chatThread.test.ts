/*
 * The earlier conversation the messenger opens on: read off `talk thread --json`
 * whole or not at all, never a turn drawn twice beside the conversation going on now, a typed turn marked, and a
 * human-readable date over each stretch after a long quiet.
 */
import { describe, expect, it } from "vitest";
import {
  type EarlierTurn,
  earlierRowsOf,
  earlierTurnsOf,
  heldTurnsOf,
  readChatThread,
  saidAtLabel,
  sameEarlierTurns,
  unreadFacts,
} from "../../lib/chatThread";
import { carriedTurns, liveWindowOf, noteBegun } from "../../lib/chatThreadCarried";

const ZONE = "Australia/Sydney";

/** A turn, overridable, begun at its instant unless told otherwise. */
const turn = ({ atIso = "2026-10-10T05:45:49.000Z", ...over }: Partial<EarlierTurn> = {}): EarlierTurn => ({
  atIso,
  beganIso: atIso,
  final: true,
  id: "call-a:s-1",
  medium: "voice",
  text: "Night-night... Thank you",
  who: "owner",
  ...over,
});

describe("readChatThread", () => {
  it("reads every turn in the verb's order", () => {
    const typed = turn({ id: "call-a:typed-owner-1", medium: "typed", text: "read me the diff" });
    expect(
      readChatThread({
        cut: true,
        observedAtIso: "2026-10-11T00:00:00.000Z",
        turns: [typed, turn()],
        unreadable: [],
      }),
    ).toEqual({ cut: true, turns: [typed, turn()], unreadable: [] });
  });

  it("refuses the whole read when one turn is not its shape, rather than dropping it", () => {
    expect(
      [
        { cut: false, turns: [turn(), { ...turn(), who: "chair" }], unreadable: [] },
        { cut: false, turns: [{ ...turn(), medium: "chat" }], unreadable: [] },
        { cut: false, turns: [{ ...turn(), final: "yes" }], unreadable: [] },
        { cut: false, turns: [{ ...turn(), atIso: "yesterday" }], unreadable: [] },
        { cut: false, turns: [{ ...turn(), beganIso: undefined }], unreadable: [] },
        { cut: false, turns: [turn()] },
        { turns: [turn()], unreadable: [] },
        "not a payload",
      ].map((payload) => readChatThread(payload)),
    ).toEqual(Array.from({ length: 8 }, () => undefined));
  });
});

describe("heldTurnsOf", () => {
  const a = turn({ atIso: "2026-10-09T10:00:00.000Z", id: "a:1" });
  const b = turn({ atIso: "2026-10-09T11:00:00.000Z", id: "b:1" });
  const c = turn({ atIso: "2026-10-09T12:00:00.000Z", id: "c:1" });

  // One malformed call file read back as an empty thread emptied the history.
  it("keeps every held turn a read that could not open every file lacks, in time order", () => {
    expect(
      heldTurnsOf({ held: [a, b], read: { cut: false, turns: [c], unreadable: ["b.jsonl: malformed"] } }).map(
        (kept) => kept.id,
      ),
    ).toEqual(["a:1", "b:1", "c:1"]);
    expect(heldTurnsOf({ held: [a], read: { cut: false, turns: [], unreadable: ["a.jsonl: malformed"] } })).toEqual([
      a,
    ]);
  });

  // A turn begun first and finished last carries the later instant, so sorting by it reverses the two.
  it("keeps the new read's own order when it sets a held turn back among its turns", () => {
    const long = turn({ atIso: "2026-10-09T12:30:00.000Z", id: "c:1" });
    const short = turn({ atIso: "2026-10-09T12:10:00.000Z", id: "c:2" });
    expect(
      heldTurnsOf({
        held: [a, long, short],
        read: { cut: false, turns: [long, short], unreadable: ["a.jsonl: malformed"] },
      }).map((kept) => kept.id),
    ).toEqual(["a:1", "c:1", "c:2"]);
  });

  it("takes a read that opened every file as it stands, and any read before the first", () => {
    expect([
      heldTurnsOf({ held: [a, b], read: { cut: false, turns: [c], unreadable: [] } }),
      heldTurnsOf({ held: undefined, read: { cut: false, turns: [c], unreadable: ["b.jsonl: malformed"] } }),
    ]).toEqual([[c], [c]]);
  });
});

describe("unreadFacts", () => {
  // When the newest call anyone spoke on cannot be read, the history ends on an older line, so the failed read shows as
  // a staleness mark whose hover says why, never a sentence.
  it("names each call file the read could not open, with why, and nothing when it opened them all", () => {
    expect([
      unreadFacts({ unreadable: [] }),
      unreadFacts({ unreadable: ["b: none of its 3 line(s) parsed"] }),
      unreadFacts({ unreadable: ["b: torn", "c: torn"] }),
    ]).toEqual([
      undefined,
      [{ subject: "what was said on a call", why: "b: none of its 3 line(s) parsed" }],
      [
        { subject: "what was said on a call", why: "b: torn" },
        { subject: "what was said on a call", why: "c: torn" },
      ],
    ]);
  });
});

describe("carriedTurns", () => {
  it("keeps an ending conversation's words, marked with its medium and whether each was finished, once each", () => {
    const held = [turn({ id: "call-a:s-1" })];
    const segments = [
      { final: true, id: "call-a:s-1", text: "Night-night... Thank you", who: "owner" as const },
      { final: true, id: "call-b:typed-item-1", text: " Two cards. ", who: "voice" as const },
      { final: false, id: "call-b:typed-item-2", text: "and a thi", who: "voice" as const },
      { final: true, id: "call-b:typed-item-3", text: "  ", who: "voice" as const },
    ];
    const began = new Map([["call-b:typed-item-1", "2026-10-10T23:50:00.000Z"]]);
    expect(carriedTurns({ atIso: "2026-10-11T00:00:00.000Z", began, held, medium: "typed", segments })).toEqual([
      turn({ id: "call-a:s-1" }),
      turn({
        atIso: "2026-10-11T00:00:00.000Z",
        beganIso: "2026-10-10T23:50:00.000Z",
        id: "call-b:typed-item-1",
        medium: "typed",
        text: "Two cards.",
        who: "voice",
      }),
      turn({
        atIso: "2026-10-11T00:00:00.000Z",
        final: false,
        id: "call-b:typed-item-2",
        medium: "typed",
        text: "and a thi",
        who: "voice",
      }),
    ]);
  });
});

describe("carriedTurns order", () => {
  // A turn evicted from the live window and finished late was shown last, and carried last.
  it("carries the turns in the order each began, not the order the live window shows them", () => {
    const began = new Map([
      ["c:a", "2026-10-10T10:00:00.000Z"],
      ["c:b", "2026-10-10T10:01:00.000Z"],
    ]);
    const segments = [
      { final: true, id: "c:b", text: "later", who: "owner" as const },
      { final: true, id: "c:a", text: "earlier, finished late", who: "voice" as const },
    ];
    expect(
      carriedTurns({ atIso: "2026-10-10T10:05:00.000Z", began, held: [], medium: "voice", segments }).map(
        (carried) => carried.id,
      ),
    ).toEqual(["c:a", "c:b"]);
  });
});

describe("noteBegun", () => {
  it("notes the instant the page first shows a turn, and never moves one already noted", () => {
    const began = new Map([["call-a:s-1", "2026-10-10T10:00:00.000Z"]]);
    const segments = [
      { final: true, id: "call-a:s-1", text: "first", who: "owner" as const },
      { final: false, id: "call-a:s-2", text: "sec", who: "voice" as const },
    ];
    noteBegun({ atIso: "2026-10-10T10:05:00.000Z", began, segments });
    expect([...began]).toEqual([
      ["call-a:s-1", "2026-10-10T10:00:00.000Z"],
      ["call-a:s-2", "2026-10-10T10:05:00.000Z"],
    ]);
  });
});

describe("liveWindowOf", () => {
  // The provider held 41 turns, the stage drew 40, and the history left out all 41 — so the first was nowhere.
  it("leaves out only the turns the stage draws, and hands the older ones to the history as begun", () => {
    const segments = Array.from({ length: 42 }, (_, at) => ({
      final: true,
      id: `c:s-${at}`,
      text: `turn ${at}`,
      who: "owner" as const,
    }));
    const began = new Map([["c:s-0", "2026-10-10T10:00:00.000Z"]]);
    const split = liveWindowOf({ atIso: "2026-10-10T10:30:00.000Z", began, medium: "typed", segments, shown: 40 });
    expect([split.live.length, split.live[0], split.live.at(-1)]).toEqual([40, "c:s-2", "c:s-41"]);
    expect(split.older).toEqual([
      turn({ atIso: "2026-10-10T10:00:00.000Z", id: "c:s-0", medium: "typed", text: "turn 0" }),
      turn({ atIso: "2026-10-10T10:30:00.000Z", id: "c:s-1", medium: "typed", text: "turn 1" }),
    ]);
  });

  it("hands the history nothing while the stage draws every turn", () => {
    const segments = [{ final: false, id: "c:s-0", text: "hel", who: "voice" as const }];
    expect(
      liveWindowOf({ atIso: "2026-10-10T10:30:00.000Z", began: new Map(), medium: "voice", segments, shown: 40 }),
    ).toEqual({ live: ["c:s-0"], older: [] });
  });
});

describe("earlierTurnsOf", () => {
  /** No turn the sink lost. */
  const NONE: ReadonlySet<string> = new Set();

  it("draws the read, then a carried turn not on disk yet, less whatever the conversation now shows", () => {
    const onDisk = [turn({ id: "a:1" }), turn({ id: "a:2" }), turn({ id: "b:1" })];
    const carried = [turn({ id: "b:1", text: "carried copy" }), turn({ id: "b:2" })];
    expect(
      earlierTurnsOf({ carried, complete: true, cut: false, live: ["b:2"], read: onDisk, unwritten: NONE }).map(
        (shown) => `${shown.id} ${shown.text}`,
      ),
    ).toEqual(["a:1 Night-night... Thank you", "a:2 Night-night... Thank you", "b:1 Night-night... Thank you"]);
  });

  // A read capped at 200 turns aged the oldest carried one out, and the carry drew it back in last.
  it("never draws back a carried turn older than every one a read that left older history out holds", () => {
    const carried = [turn({ id: "a:1" }), turn({ id: "a:2" }), turn({ id: "b:1" }), turn({ id: "b:2" })];
    expect(
      earlierTurnsOf({
        carried,
        complete: true,
        cut: true,
        live: [],
        read: [turn({ id: "a:2" }), turn({ id: "b:1" })],
        unwritten: NONE,
      }).map((shown) => shown.id),
    ).toEqual(["a:2", "b:1", "b:2"]);
  });

  // A later batch landed before an earlier one, and a complete read that cut nothing pruned the earlier.
  it("keeps a carried turn a complete read lacks unless it falls ahead of a cut the read made", () => {
    const z = turn({ atIso: "2026-10-10T09:00:00.000Z", id: "z:1" });
    const a = turn({ atIso: "2026-10-10T10:00:00.000Z", id: "b:1", text: "in flight" });
    const b = turn({ atIso: "2026-10-10T10:05:00.000Z", id: "b:2" });
    expect([
      earlierTurnsOf({ carried: [a, b], complete: true, cut: false, live: [], read: [b], unwritten: NONE }).map(
        (shown) => shown.id,
      ),
      earlierTurnsOf({ carried: [a, b], complete: true, cut: true, live: [], read: [z, b], unwritten: NONE }).map(
        (shown) => shown.id,
      ),
      earlierTurnsOf({ carried: [a, b], complete: true, cut: true, live: [], read: [b], unwritten: NONE }).map(
        (shown) => shown.id,
      ),
    ]).toEqual([["b:1", "b:2"], ["z:1", "b:1", "b:2"], ["b:2"]]);
  });

  // A carried turn stamped when its conversation ended was drawn below a later-begun turn on disk.
  it("sets a carried turn among the read's by when it began, not when its conversation ended", () => {
    const a1 = turn({ atIso: "2026-10-10T10:20:00.000Z", beganIso: "2026-10-10T10:00:00.000Z", id: "a:1" });
    const b1 = turn({ atIso: "2026-10-10T10:10:00.000Z", id: "b:1" });
    expect(
      earlierTurnsOf({ carried: [a1], complete: true, cut: false, live: [], read: [b1], unwritten: NONE }).map(
        (shown) => shown.id,
      ),
    ).toEqual(["a:1", "b:1"]);
  });

  // A turn's partial reached the file, its final was refused, and the partial replaced the page's copy.
  it("draws the carried copy of a turn the sink lost a batch of, unless only the disk's is finished", () => {
    const partial = turn({ final: false, id: "c:1", text: "hel" });
    const finished = turn({ atIso: "2026-10-10T06:00:00.000Z", id: "c:1", text: "hello" });
    const lost = new Set(["c:1"]);
    const shown = (input: {
      carried: readonly EarlierTurn[];
      read: readonly EarlierTurn[];
      unwritten: ReadonlySet<string>;
    }) =>
      earlierTurnsOf({ ...input, complete: true, cut: false, live: [] }).map(
        (row) => `${row.text} ${String(row.final)} ${row.beganIso}`,
      );
    expect([
      shown({ carried: [finished], read: [partial], unwritten: lost }),
      shown({ carried: [finished], read: [partial], unwritten: NONE }),
      shown({ carried: [partial], read: [finished], unwritten: lost }),
    ]).toEqual([
      ["hello true 2026-10-10T05:45:49.000Z"],
      ["hel false 2026-10-10T05:45:49.000Z"],
      ["hello true 2026-10-10T06:00:00.000Z"],
    ]);
  });

  // A batch the route refused for good never reached the file, and the next complete read pruned it.
  it("keeps a carried turn the sink lost even ahead of a cut, since it was never on disk to age out", () => {
    const lost = turn({ atIso: "2026-10-10T10:30:00.000Z", id: "a:2", text: "goodnight" });
    const b1 = turn({ atIso: "2026-10-10T11:00:00.000Z", id: "b:1" });
    const b2 = turn({ atIso: "2026-10-10T11:05:00.000Z", id: "b:2" });
    const read = [b1, b2];
    expect([
      earlierTurnsOf({
        carried: [lost, b1],
        complete: true,
        cut: true,
        live: [],
        read,
        unwritten: new Set(["a:2"]),
      }).map((shown) => shown.id),
      earlierTurnsOf({ carried: [lost, b1], complete: true, cut: true, live: [], read, unwritten: NONE }).map(
        (shown) => shown.id,
      ),
    ]).toEqual([
      ["a:2", "b:1", "b:2"],
      ["b:1", "b:2"],
    ]);
  });

  // A read that missed call A's file held call B's turn, and the carry dropped A's as aged out.
  it("keeps every carried turn a read that missed a file lacks, in the order it was said", () => {
    const carried = [turn({ id: "a:1" }), turn({ id: "b:1" })];
    expect(
      earlierTurnsOf({
        carried,
        complete: false,
        cut: false,
        live: [],
        read: [turn({ id: "z:1" }), turn({ id: "b:1" })],
        unwritten: NONE,
      }).map((shown) => shown.id),
    ).toEqual(["z:1", "a:1", "b:1"]);
  });

  // A carried turn the read lacked was drawn below a newer turn only the read held.
  it("draws a carried turn a read that missed a file lacks in time order among the read's own", () => {
    const a = turn({ atIso: "2026-10-10T10:30:00.000Z", id: "a:1" });
    const b1 = turn({ atIso: "2026-10-10T11:01:00.000Z", id: "b:1" });
    const b2 = turn({ atIso: "2026-10-10T11:02:00.000Z", id: "b:2" });
    expect(
      earlierTurnsOf({
        carried: [a, { ...b2, atIso: "2026-10-10T11:45:00.000Z" }],
        complete: false,
        cut: false,
        live: [],
        read: [b1, b2],
        unwritten: NONE,
      }).map((shown) => shown.id),
    ).toEqual(["a:1", "b:1", "b:2"]);
  });

  // A torn line made the read incomplete, and re-sorting it by last snapshot put s-1 below s-2.
  it("never re-orders the read's own turns, whose order is when each began, when the read missed a line", () => {
    const s1 = turn({ atIso: "2026-10-10T10:02:00.000Z", id: "b:s-1", text: "the long one, finished last" });
    const s2 = turn({ atIso: "2026-10-10T10:01:00.000Z", id: "b:s-2", text: "the short one" });
    const a = turn({ atIso: "2026-10-10T09:30:00.000Z", id: "a:1" });
    expect(
      earlierTurnsOf({ carried: [a], complete: false, cut: false, live: [], read: [s1, s2], unwritten: NONE }).map(
        (shown) => shown.id,
      ),
    ).toEqual(["a:1", "b:s-1", "b:s-2"]);
  });

  // The carried copy, cut before the last batch, replaced the finished one the read held.
  it("draws the read's copy of a carried turn it holds, even when the read missed a file", () => {
    const carried = [turn({ final: false, id: "b:1", text: "hel" })];
    expect(
      earlierTurnsOf({
        carried,
        complete: false,
        cut: false,
        live: [],
        read: [turn({ id: "b:1", text: "hello" })],
        unwritten: NONE,
      }).map((shown) => `${shown.id} ${shown.text} ${String(shown.final)}`),
    ).toEqual(["b:1 hello true"]);
  });

  it("draws the carried turns alone while the thread has not been read", () => {
    expect(
      earlierTurnsOf({
        carried: [turn({ id: "b:1" })],
        complete: true,
        cut: false,
        live: [],
        read: undefined,
        unwritten: NONE,
      }),
    ).toEqual([turn({ id: "b:1" })]);
  });
});

describe("earlierRowsOf", () => {
  it("opens the first stretch and every one after an hour's quiet with its date", () => {
    const rows = earlierRowsOf({
      nowIso: "2026-10-11T00:30:00.000Z",
      timeZone: ZONE,
      turns: [
        turn({ atIso: "2026-10-09T23:00:00.000Z", id: "a:1" }),
        turn({ atIso: "2026-10-09T23:59:59.000Z", id: "a:2" }),
        turn({ atIso: "2026-10-10T05:45:49.000Z", id: "b:1" }),
      ],
    });
    expect(rows.map((row) => (row.kind === "divider" ? `— ${row.label}` : row.turn.id))).toEqual([
      "— Yesterday, 10:00 am",
      "a:1",
      "a:2",
      "— Yesterday, 4:45 pm",
      "b:1",
    ]);
  });

  it("opens a new day under its own date however short the quiet before it", () => {
    const rows = earlierRowsOf({
      nowIso: "2026-10-11T00:30:00.000Z",
      timeZone: ZONE,
      turns: [
        turn({ atIso: "2026-10-09T12:30:00.000Z", id: "a:1" }),
        turn({ atIso: "2026-10-09T12:50:00.000Z", id: "a:2" }),
        turn({ atIso: "2026-10-09T13:10:00.000Z", id: "a:3" }),
      ],
    });
    expect(rows.map((row) => (row.kind === "divider" ? `— ${row.label}` : row.turn.id))).toEqual([
      "— Fri 9 Oct, 11:30 pm",
      "a:1",
      "a:2",
      "— Yesterday, 12:10 am",
      "a:3",
    ]);
  });

  it("draws nothing for no earlier turn", () => {
    expect(earlierRowsOf({ nowIso: "2026-10-11T00:30:00.000Z", timeZone: ZONE, turns: [] })).toEqual([]);
  });

  it("words each turn's tap line once, from when it began, so a render draws it without wording it", () => {
    const rows = earlierRowsOf({
      nowIso: "2026-10-11T00:30:00.000Z",
      timeZone: ZONE,
      turns: [turn({ atIso: "2026-10-10T05:46:30.000Z", beganIso: "2026-10-10T05:45:49.000Z", id: "b:1" })],
    });
    expect(rows).toEqual([
      { key: "divider-b:1", kind: "divider", label: "Yesterday, 4:46 pm" },
      {
        kind: "turn",
        saidAt: "Yesterday, 4:45 pm",
        turn: turn({ atIso: "2026-10-10T05:46:30.000Z", beganIso: "2026-10-10T05:45:49.000Z", id: "b:1" }),
      },
    ]);
  });
});

describe("sameEarlierTurns", () => {
  const history = [turn({ id: "a:1" }), turn({ id: "a:2", text: "and the second" })];

  it("holds two histories of the same turns the same, whatever arrays carry them", () => {
    expect(sameEarlierTurns({ left: history, right: history.map((each) => ({ ...each })) })).toBe(true);
  });

  it("tells a turn whose words grew apart", () => {
    expect(
      sameEarlierTurns({ left: history, right: [history[0], turn({ id: "a:2", text: "and the second one" })] }),
    ).toBe(false);
  });

  it("tells a turn that finished apart", () => {
    expect(sameEarlierTurns({ left: history, right: [history[0], { ...history[1], final: false }] })).toBe(false);
  });

  it("tells a history with a turn more apart", () => {
    expect(sameEarlierTurns({ left: history, right: [...history, turn({ id: "a:3" })] })).toBe(false);
  });

  it("holds two empty histories the same", () => {
    expect(sameEarlierTurns({ left: [], right: [] })).toBe(true);
  });
});

describe("saidAtLabel", () => {
  // Half past eleven in the morning on Sunday the eleventh in Sydney, the reader's zone.
  const NOW = "2026-10-11T00:30:00.000Z";

  it("says today and the time for a turn said earlier on the reader's own day, counted in the owner's zone", () => {
    // The tenth in UTC, which would read "Yesterday"; the eleventh in Sydney.
    expect(saidAtLabel({ atIso: "2026-10-10T23:00:00.000Z", nowIso: NOW, timeZone: ZONE })).toBe("Today, 10:00 am");
  });

  it("says yesterday and the time for a turn said the day before", () => {
    expect(saidAtLabel({ atIso: "2026-10-10T05:45:49.000Z", nowIso: NOW, timeZone: ZONE })).toBe("Yesterday, 4:45 pm");
  });

  it("says yesterday across the 23-hour day daylight saving starts on, counted on the calendar", () => {
    // Sydney springs forward on Sunday the fourth. Monday the fifth, half past midnight AEDT; 24 hours earlier is
    // Saturday the third, half past eleven at night AEST,
    // so a 24-hour step back skips the Sunday entirely.
    expect(saidAtLabel({ atIso: "2026-10-03T23:00:00.000Z", nowIso: "2026-10-04T13:30:00.000Z", timeZone: ZONE })).toBe(
      "Yesterday, 10:00 am",
    );
  });

  it("says the weekday and date for an older day this year, with no year", () => {
    expect(saidAtLabel({ atIso: "2026-10-07T22:00:00.000Z", nowIso: NOW, timeZone: ZONE })).toBe("Thu 8 Oct, 9:00 am");
  });

  it("adds the year only for a day in another year", () => {
    expect(saidAtLabel({ atIso: "2025-12-30T22:00:00.000Z", nowIso: NOW, timeZone: ZONE })).toBe(
      "Wed 31 Dec 2025, 9:00 am",
    );
  });

  it("never prints an ISO stamp or a long dash", () => {
    const labels = [
      "2026-10-10T23:00:00.000Z",
      "2026-10-10T05:45:49.000Z",
      "2026-10-07T22:00:00.000Z",
      "2025-12-30T22:00:00.000Z",
    ].map((atIso) => saidAtLabel({ atIso, nowIso: NOW, timeZone: ZONE }));
    expect(labels.length).toBe(4);
    expect(labels.filter((label) => /\d{4}-\d{2}-\d{2}|T\d{2}:|[–—]/u.test(label))).toEqual([]);
  });
});
