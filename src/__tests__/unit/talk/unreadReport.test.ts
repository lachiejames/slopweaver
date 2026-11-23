/**
 * The batch `talk unread` prints is measured on the very output it prints, in either shape and in UTF-8 bytes: every
 * batch fits every host whatever the lines hold — revisions and non-ASCII speech included — and takes as many whole
 * lines as do; a line too large for any batch prints one part at a time.
 */
import { describe, expect, it } from "vitest";

import type { UnreadArgs } from "../../../cli/commands/talk/callArgs.js";
import { fitsHost, resolveBatch, type UnreadOutput, unreadOutput } from "../../../cli/commands/talk/unreadReport.js";
import type { AnswerContext } from "../../../talk/answerContext.js";
import type { CallEntry } from "../../../talk/callRecord.js";
import type { HeldRelay } from "../../../talk/chairWake.js";
import { lineCount, readThrough, UNREAD_BATCH_BYTES, UNREAD_BATCH_LINES } from "../../../talk/unreadBatch.js";
import { type CallTail, selectUnreadWords, type TailLine, type UnreadRead } from "../../../talk/unreadWords.js";

const CALL = "a0000035-0000-4000-8000-000000000038";
const OTHER = "a0000041-0000-4000-8000-000000000044";
const NOW = "2026-09-26T06:00:00.000Z";
const WRITTEN = "/home/talk/unread-cursors/supervisor.json";

/** No stretch here had what it answered read: each prints the line saying so. */
const NO_ANSWERS = new Map<string, AnswerContext>();

const ARGS: UnreadArgs = {
  adopt: false,
  all: false,
  cursor: "supervisor",
  home: undefined,
  json: false,
  mark: true,
  now: undefined,
};

const said = ({ id, text, final = true }: { id: string; text: string; final?: boolean }) =>
  ({ atIso: "2026-09-26T05:00:00.000Z", final, id, kind: "segment", text, who: "owner" }) satisfies CallEntry;

const entryLines = ({ entries }: { entries: readonly CallEntry[] }): readonly TailLine[] =>
  entries.map((entry, index) => ({
    after: { offset: index + 1, prefixSha256: `sha256:${String(index + 1)}` },
    entry,
    kind: "entry",
    sha256: `sha256:line-${String(index)}`,
  }));

const tailOf = ({ callId, lines }: { callId: string; lines: readonly TailLine[] }): CallTail => ({
  callId,
  endedBefore: false,
  finalBefore: [],
  lines,
  originBefore: undefined,
  relaysBefore: [],
  seenOriginBefore: new Map(),
  seenBefore: [],
  start: undefined,
});

const readOf = ({ tails }: { tails: readonly CallTail[] }): UnreadRead => ({
  bootstrapFloorIso: undefined,
  cursor: { calls: {}, recordedAtIso: "2026-09-26T04:00:00.000Z" },
  quarantined: [],
  tails,
});

/** Many words of uneven size across two calls, in the given script — far more than one batch prints. */
const manyIn = ({ word }: { word: string }): UnreadRead =>
  readOf({
    tails: [CALL, OTHER].map((callId) =>
      tailOf({
        callId,
        lines: entryLines({
          entries: Array.from({ length: 150 }, (_, index) =>
            said({ id: `s${String(index)}`, text: `"${word}" ${String(index)} `.repeat(1 + (index % 40)) }),
          ),
        }),
      }),
    ),
  });

/** What one output prints, byte for byte. */
const printed = ({ output }: { output: UnreadOutput }): string =>
  [...output.before, ...(output.after === undefined ? [] : [output.after])].map((line) => `${line}\n`).join("");

/** Whether printing exactly the first `take` lines, with more remaining, would fit — how a candidate is measured. */
const fitsThrough = ({ args, read, take }: { args: UnreadArgs; read: UnreadRead; take: number }): boolean => {
  const candidate = readThrough({ read, take });
  const resolved = {
    answers: NO_ANSWERS,
    more: true,
    part: undefined,
    read: candidate,
    relays: [],
    relaysNotHeaded: 0,
    selection: selectUnreadWords({ read: candidate }),
  };
  return fitsHost({ output: unreadOutput({ args, nowIso: NOW, resolved, written: WRITTEN }) });
};

describe("resolveBatch", () => {
  it.each([
    ["text, ASCII", false, "steer"],
    ["json, ASCII", true, "steer"],
    ["text, CJK and emoji", false, "合并这个页面 🚀"],
    ["json, CJK and emoji", true, "合并这个页面 🚀"],
  ])(
    "fits the %s output it prints in bytes and lines, and takes every line that would still fit",
    (_label, json, w) => {
      const args = { ...ARGS, json };
      const read = manyIn({ word: w });
      const resolved = resolveBatch({ relays: [], answers: NO_ANSWERS, args, nowIso: NOW, read, written: WRITTEN });
      const out = printed({ output: unreadOutput({ args, nowIso: NOW, resolved, written: WRITTEN }) });
      const kept = lineCount({ read: resolved.read });

      expect(resolved.more).toBe(true);
      expect(kept).toBeGreaterThan(0);
      expect(Buffer.byteLength(out, "utf8")).toBeLessThanOrEqual(UNREAD_BATCH_BYTES);
      expect(out.split("\n").length - 1).toBeLessThanOrEqual(UNREAD_BATCH_LINES);
      expect(fitsThrough({ args, read, take: kept + 1 })).toBe(false);
    },
  );

  it("counts every revision's own printed line, so a segment revised a thousand times still fits", () => {
    const revised = Array.from({ length: 1000 }, (_, index) =>
      said({ final: false, id: "s", text: `take the page to version ${String(1000 - index)}` }),
    );
    const read = readOf({ tails: [tailOf({ callId: CALL, lines: entryLines({ entries: revised }) })] });
    const resolved = resolveBatch({ relays: [], answers: NO_ANSWERS, args: ARGS, nowIso: NOW, read, written: WRITTEN });
    const out = printed({ output: unreadOutput({ args: ARGS, nowIso: NOW, resolved, written: WRITTEN }) });

    expect(resolved.more).toBe(true);
    expect(Buffer.byteLength(out, "utf8")).toBeLessThanOrEqual(UNREAD_BATCH_BYTES);
    expect(out.split("\n").length - 1).toBeLessThanOrEqual(UNREAD_BATCH_LINES);
    expect(resolved.selection.words.map((word) => word.revisions.length)).toEqual([
      lineCount({ read: resolved.read }) - 1,
    ]);
  });

  it.each([
    ["text", false],
    ["json", true],
  ])("prints the first part of a line too large for any batch, in %s, and takes no whole line", (_label, json) => {
    const args = { ...ARGS, json };
    const huge: TailLine = {
      after: { offset: 30_001, prefixSha256: "sha256:huge" },
      kind: "unparseable",
      line: { byteOffset: 0, callId: CALL, text: "\u0001".repeat(30_000) },
      sha256: "sha256:first",
    };
    const read = readOf({
      tails: [tailOf({ callId: CALL, lines: [huge, ...entryLines({ entries: [said({ id: "s", text: "hi" })] })] })],
    });
    const resolved = resolveBatch({ relays: [], answers: NO_ANSWERS, args, nowIso: NOW, read, written: WRITTEN });
    const out = printed({ output: unreadOutput({ args, nowIso: NOW, resolved, written: WRITTEN }) });

    expect(lineCount({ read: resolved.read })).toBe(0);
    // "\u0001" escapes to six bytes, so 833 fit a 5,000-byte part and 30,000 take 37.
    expect([resolved.part!.index, resolved.part!.of, resolved.part!.byteOffset, resolved.more]).toEqual([
      1,
      37,
      0,
      true,
    ]);
    expect(resolved.part!.frontier).toEqual({
      offset: 0,
      part: { lineSha256: "sha256:first", printed: 1 },
      prefixSha256: "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    });
    expect(Buffer.byteLength(out, "utf8")).toBeLessThanOrEqual(UNREAD_BATCH_BYTES);
  });
});

describe("relays held for the chair that alone outgrow one batch", () => {
  /** Two hundred synthetic relays held a second apart, so one quiet batch heads them all — past 8,000 bytes either way. */
  const relays: readonly HeldRelay[] = Array.from({ length: 200 }, (_, index) => ({
    heard: "",
    heardEdges: { end: "kept", start: "kept" },
    heldAtIso: `2026-09-26T05:0${String(Math.floor(index / 60))}:${String(index % 60).padStart(2, "0")}.000Z`,
    slug: `synthetic-held-relay-row-${String(index).padStart(3, "0")}-for-the-chair`,
    turnId: `turn-${String(index).padStart(3, "0")}`,
  }));
  const nothingUnread = readOf({ tails: [] });

  it.each([
    [
      "text",
      false,
      ({ count }: { count: number }) => `${String(count)} more relay(s) held for the chair are not headed here`,
    ],
    ["json", true, ({ count }: { count: number }) => `"heldRelaysNotHeaded":${String(count)}`],
  ])("heads the oldest that fit in %s, names the rest, and never throws", (_label, json, named) => {
    const args = { ...ARGS, json };
    const resolved = resolveBatch({
      answers: NO_ANSWERS,
      args,
      nowIso: NOW,
      read: nothingUnread,
      relays,
      written: WRITTEN,
    });
    const out = printed({ output: unreadOutput({ args, nowIso: NOW, resolved, written: WRITTEN }) });
    const headed = resolved.relays.length;
    // Sized as resolveBatch sizes every candidate: with room for the more-remains notice.
    const oneMore = {
      ...resolved,
      more: true,
      relays: relays.slice(0, headed + 1),
      relaysNotHeaded: relays.length - headed - 1,
    };

    expect(headed).toBeGreaterThan(0);
    expect(resolved.relays).toEqual(relays.slice(0, headed));
    expect(resolved.relaysNotHeaded).toBe(relays.length - headed);
    expect([resolved.part, resolved.more]).toEqual([undefined, false]);
    expect(Buffer.byteLength(out, "utf8")).toBeLessThanOrEqual(UNREAD_BATCH_BYTES);
    expect(out.split("\n").length - 1).toBeLessThanOrEqual(UNREAD_BATCH_LINES);
    expect(out).toContain(named({ count: relays.length - headed }));
    expect(fitsHost({ output: unreadOutput({ args, nowIso: NOW, resolved: oneMore, written: WRITTEN }) })).toBe(false);
  });

  it.each([
    ["text", false],
    ["json", true],
  ])(
    "never renders a queue whose slugs alone outgrow a batch, in %s — its whole JSON would pass 100 MiB",
    (_l, json) => {
      const args = { ...ARGS, json };
      // One shared 600,000-byte slug: two hundred of it is 120 MB whole, which `safeJsonStringify` refuses by throwing.
      const slug = "x".repeat(600_000);
      const runaway = relays.map((relay) => ({ ...relay, slug }));
      const resolved = resolveBatch({
        answers: NO_ANSWERS,
        args,
        nowIso: NOW,
        read: nothingUnread,
        relays: runaway,
        written: WRITTEN,
      });

      expect([resolved.relays, resolved.relaysNotHeaded]).toEqual([[], 200]);
      expect(fitsHost({ output: unreadOutput({ args, nowIso: NOW, resolved, written: WRITTEN }) })).toBe(true);
    },
  );

  it("lists only the headed relays in the JSON, under heldRelays and in their quiet batches alike", () => {
    const args = { ...ARGS, json: true };
    const resolved = resolveBatch({
      answers: NO_ANSWERS,
      args,
      nowIso: NOW,
      read: nothingUnread,
      relays,
      written: WRITTEN,
    });
    const report = JSON.parse(unreadOutput({ args, nowIso: NOW, resolved, written: WRITTEN }).before.join("")) as {
      heldRelays: readonly Pick<HeldRelay, "heldAtIso" | "slug" | "turnId">[];
      quietBatches: readonly { relays: readonly { slug: string }[] }[];
    };

    expect(report.heldRelays).toEqual(
      resolved.relays.map(({ heldAtIso, slug, turnId }) => ({ heldAtIso, slug, turnId })),
    );
    expect(report.quietBatches.flatMap((batch) => batch.relays.map(({ slug }) => slug))).toEqual(
      resolved.relays.map((relay) => relay.slug),
    );
  });

  it.each([
    ["text", false],
    ["json", true],
  ])("still prints a few small stretches whole beside them in %s, never in parts", (_label, json) => {
    const args = { ...ARGS, json };
    const entries = ["one", "two", "three"].map((word, index) => said({ id: `s${String(index)}`, text: word }));
    const read = readOf({ tails: [tailOf({ callId: CALL, lines: entryLines({ entries }) })] });
    const resolved = resolveBatch({ answers: NO_ANSWERS, args, nowIso: NOW, read, relays, written: WRITTEN });

    expect([resolved.part, resolved.more, lineCount({ read: resolved.read })]).toEqual([undefined, false, 3]);
    expect(resolved.relays.length).toBeGreaterThan(0);
    expect(resolved.relays.length + resolved.relaysNotHeaded).toBe(relays.length);
  });

  it("heads every one of a few held relays beside more speech than one batch, sizing the speech around them", () => {
    const resolved = resolveBatch({
      answers: NO_ANSWERS,
      args: ARGS,
      nowIso: NOW,
      read: manyIn({ word: "steer" }),
      relays: relays.slice(0, 3),
      written: WRITTEN,
    });

    expect([resolved.relays, resolved.relaysNotHeaded, resolved.more]).toEqual([relays.slice(0, 3), 0, true]);
    expect(lineCount({ read: resolved.read })).toBeGreaterThan(0);
  });
});

describe("held relays headed with the owner's words", () => {
  /** Three relays, each turn carrying far more multibyte speech than one print could hold. */
  const RELAYS: readonly HeldRelay[] = ["talk-0000000000a1", "talk-0000000000a2", "talk-0000000000a3"].map(
    (slug, index) => ({
      heard: `${"合并这个页面 🚀 ".repeat(2_000)}take the set ${String(index)}`,
      heardEdges: { end: "kept", start: "kept" },
      heldAtIso: "2026-09-26T05:00:00.000Z",
      slug,
      turnId: `turn-${String(index)}`,
    }),
  );

  it.each([
    ["text", false],
    ["json", true],
  ])("still fit the %s print beside the stretches it takes, every slug and steer on it", (_label, json) => {
    const args = { ...ARGS, json };
    const read = manyIn({ word: "steer" });
    const resolved = resolveBatch({ relays: RELAYS, answers: NO_ANSWERS, args, nowIso: NOW, read, written: WRITTEN });
    const out = printed({ output: unreadOutput({ args, nowIso: NOW, resolved, written: WRITTEN }) });

    expect(lineCount({ read: resolved.read })).toBeGreaterThan(0);
    expect(Buffer.byteLength(out, "utf8")).toBeLessThanOrEqual(UNREAD_BATCH_BYTES);
    expect(
      RELAYS.map((held, index) => [out.includes(held.slug), out.includes(`take the set ${String(index)}`)]),
    ).toEqual([
      [true, true],
      [true, true],
      [true, true],
    ]);
  });

  it("quotes the words on the text head, a cut opened with an ellipsis", () => {
    const resolved = resolveBatch({
      relays: [{ ...RELAYS[0]!, heard: "take the set" }, RELAYS[1]!],
      answers: NO_ANSWERS,
      args: ARGS,
      nowIso: NOW,
      read: readOf({ tails: [] }),
      written: WRITTEN,
    });
    const head = unreadOutput({ args: ARGS, nowIso: NOW, resolved, written: WRITTEN }).before[1]!;

    expect(
      head.startsWith('quiet batch 1: 0 stretch(es), relay(s) held in it: talk-0000000000a1 "take the set", '),
    ).toBe(true);
    expect(head).toContain('talk-0000000000a2 "…');
  });

  it("names a held relay's turn in the JSON `heldRelays` without its words, which only `quietBatches` quotes", () => {
    const args = { ...ARGS, json: true };
    const resolved = resolveBatch({
      relays: [RELAYS[0]!],
      answers: NO_ANSWERS,
      args,
      nowIso: NOW,
      read: readOf({ tails: [] }),
      written: WRITTEN,
    });
    const report = JSON.parse(unreadOutput({ args, nowIso: NOW, resolved, written: WRITTEN }).before[0]!) as {
      heldRelays: unknown;
      quietBatches: { relays: { cut: boolean; slug: string }[] }[];
    };

    expect(report.heldRelays).toEqual([
      { heldAtIso: "2026-09-26T05:00:00.000Z", slug: "talk-0000000000a1", turnId: "turn-0" },
    ]);
    expect(report.quietBatches.map((batch) => batch.relays.map(({ cut, slug }) => [slug, cut]))).toEqual([
      [["talk-0000000000a1", true]],
    ]);
  });

  it('keeps a finished JSON batch within the bound, though its `"more":false` is a byte longer than `true`', () => {
    const args = { ...ARGS, json: true };
    // Relay 0's words grow a byte at a time until its share cuts them, beside seventeen cut to theirs, so the print walks
    // across the bound one byte at a time with nothing unread: every batch it resolves is finished, `more` false.
    const sizes = Array.from({ length: 300 }, (_, length) => {
      const relays: HeldRelay[] = Array.from({ length: 18 }, (_unused, index) => {
        const hex = index.toString(16).padStart(8, "0");
        return {
          heard: "w".repeat(index === 0 ? length : 10_000),
          heardEdges: { end: "kept", start: "kept" },
          heldAtIso: "2026-09-26T05:00:00.000Z",
          slug: `talk-${hex}0000`,
          turnId: `${hex}-0000-4000-8000-000000000000`,
        };
      });
      const read = readOf({ tails: [] });
      const resolved = resolveBatch({ answers: NO_ANSWERS, args, nowIso: NOW, read, relays, written: WRITTEN });
      const out = printed({ output: unreadOutput({ args, nowIso: NOW, resolved, written: WRITTEN }) });
      return Buffer.byteLength(out, "utf8");
    });

    // Exactly the bound: the walk reaches it, and a candidate sized only with `more: true` prints one byte past it.
    expect(Math.max(...sizes)).toBe(UNREAD_BATCH_BYTES);
  });
});

describe("a gone call read past on a quarantine", () => {
  const ids = [
    "0d33866b-0000-4000-8000-000000000001",
    "0d33866b-0000-4000-8000-000000000002",
    "0d33866b-0000-4000-8000-000000000003",
    "0d33866b-0000-4000-8000-000000000004",
    "0d33866b-0000-4000-8000-000000000005",
    "0d33866b-0000-4000-8000-000000000006",
  ];
  const rowOf = ({ callId }: { callId: string }) => ({ atIso: NOW, callId, reason: "e2e", session: null });
  const resolvedWith = ({ count }: { count: number }) => {
    const read = { ...readOf({ tails: [] }), quarantined: ids.slice(0, count).map((callId) => rowOf({ callId })) };
    return {
      answers: NO_ANSWERS,
      more: false,
      part: undefined,
      read,
      relays: [],
      relaysNotHeaded: 0,
      selection: selectUnreadWords({ read }),
    };
  };

  it("names it on every read, nothing unread included", () => {
    const output = unreadOutput({
      args: { ...ARGS, mark: false },
      nowIso: NOW,
      resolved: resolvedWith({ count: 1 }),
      written: undefined,
    });
    expect(output.before).toEqual([
      "talk unread: nothing new from them since the supervisor cursor was last marked (2026-09-26T04:00:00.000Z)",
      `talk unread: went past 1 gone call(s) whose loss is quarantined on the record, not read: ${ids[0]!} (accepted ${NOW}) — talk/call-quarantine.jsonl says why`,
    ]);
  });

  it("names at most five one by one, and counts the rest", () => {
    const output = unreadOutput({
      args: { ...ARGS, mark: false },
      nowIso: NOW,
      resolved: resolvedWith({ count: 6 }),
      written: undefined,
    });
    const named = ids
      .slice(0, 5)
      .map((callId) => `${callId} (accepted ${NOW})`)
      .join(", ");
    expect(output.before[1]).toBe(
      `talk unread: went past 6 gone call(s) whose loss is quarantined on the record, not read: ${named}, and 1 more — talk/call-quarantine.jsonl says why`,
    );
  });

  it("reports the count and the first five rows in the JSON", () => {
    const args = { ...ARGS, json: true, mark: false };
    const before = unreadOutput({ args, nowIso: NOW, resolved: resolvedWith({ count: 6 }), written: undefined }).before;
    const report = JSON.parse(before.join("")) as { quarantined: unknown };
    expect(report.quarantined).toEqual({ count: 6, named: ids.slice(0, 5).map((callId) => rowOf({ callId })) });
  });

  it("prints no quarantine line when nothing was quarantined", () => {
    const output = unreadOutput({
      args: { ...ARGS, mark: false },
      nowIso: NOW,
      resolved: resolvedWith({ count: 0 }),
      written: undefined,
    });
    expect(output.before).toEqual([
      "talk unread: nothing new from them since the supervisor cursor was last marked (2026-09-26T04:00:00.000Z)",
    ]);
  });
});

describe("a call a console that is not the owner's recorded", () => {
  const origin = { checkoutRoot: "/w/seat", defaultPort: 3000, mainWorktree: false, port: 3001 };
  const opened = {
    atIso: "2026-10-12T05:04:00.000Z",
    kind: "open",
    model: "m",
    origin,
    sessionId: "x",
    voice: "v",
  } satisfies CallEntry;
  const read = readOf({
    tails: [
      tailOf({
        callId: CALL,
        lines: entryLines({ entries: [opened, said({ id: "s", text: "synthetic" })] }),
      }),
    ],
  });
  const resolved = {
    answers: NO_ANSWERS,
    more: false,
    part: undefined,
    read,
    relays: [],
    relaysNotHeaded: 0,
    selection: selectUnreadWords({ read }),
  };

  it("is named as foreign with where it came from, never printed as the owner's words", () => {
    const output = unreadOutput({ args: { ...ARGS, mark: false }, nowIso: NOW, resolved, written: undefined });
    expect(output.before).toEqual([
      "talk unread: nothing new from them since the supervisor cursor was last marked (2026-09-26T04:00:00.000Z)",
      `NOT THEIRS: call ${CALL} — 1 stretch(es) recorded as them by a checkout that is not the owner's main checkout at /w/seat on :3001 (the owner's console is :3000); set aside, never their words or intake`,
    ]);
    expect(output.after).toBe("Once each is ruled, registered or intake-marked: slopweaver talk unread --mark");
  });

  it("is reported under `foreign` in the JSON, with no word of it under `words`", () => {
    const args = { ...ARGS, json: true, mark: false };
    const report = JSON.parse(unreadOutput({ args, nowIso: NOW, resolved, written: undefined }).before.join("")) as {
      foreign: unknown;
      words: unknown;
    };
    expect([report.foreign, report.words]).toEqual([[{ callId: CALL, origin, stretches: 1 }], []]);
  });
});
