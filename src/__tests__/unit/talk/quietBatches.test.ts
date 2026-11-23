import { describe, expect, it } from "vitest";

import { type HeldRelay, QUIET_BEFORE_DELIVERY_MS } from "../../../talk/chairWake.js";
import {
  fittedHeard,
  HELD_RELAY_WORDS_BYTES,
  heldRelayPhrase,
  quietBatches,
  quietBatchLine,
} from "../../../talk/quietBatches.js";
import type { HeardEdges } from "../../../talk/relayHeardCut.js";
import { RELAY_ROW_QUOTE_LIMIT } from "../../../talk/relayRowQuote.js";
import type { UnreadWord } from "../../../talk/unreadWords.js";

const START = "2026-10-27T09:00:00.000Z";

/** A turn record that says it kept every word at both ends. */
const WHOLE: HeardEdges = { end: "kept", start: "kept" };

/** The bytes the flag on a record that never said takes: " (maybe not all their words)". */
const FLAG_BYTES = 28;

/** The instant `ms` milliseconds after {@link START}. */
const at = ({ ms }: { ms: number }): string => new Date(Date.parse(START) + ms).toISOString();

/** One unread stretch of the owner's whose newest snapshot was taken `ms` after {@link START}. */
const stretch = ({ id, ms }: { id: string; ms: number }): UnreadWord => ({
  atIso: at({ ms }),
  callId: "call-a",
  cut: false,
  final: true,
  growingSinceRead: false,
  latestAtIso: at({ ms }),
  nextRelay: undefined,
  pointer: `talk-call:call-a#${id}`,
  revisions: [],
  segmentId: id,
  text: "merge it",
});

/** One relay held `ms` after {@link START}, the owner having said `heard` on its turn, its record's ends as `heardEdges`. */
const relay = ({
  slug,
  ms,
  heard = "take the set",
  heardEdges = WHOLE,
}: {
  slug: string;
  ms: number;
  heard?: string;
  heardEdges?: HeardEdges;
}): HeldRelay => ({
  heard,
  heardEdges,
  heldAtIso: at({ ms }),
  slug,
  turnId: `turn-${slug}`,
});

describe("quietBatches", () => {
  it("is empty when there is nothing unread and nothing held", () => {
    expect(quietBatches({ nowIso: START, relays: [], words: [] })).toStrictEqual([]);
  });

  it("keeps a gap one millisecond under the floor in one batch, and splits on the floor itself", () => {
    const words = [
      stretch({ id: "s1", ms: 0 }),
      stretch({ id: "s2", ms: QUIET_BEFORE_DELIVERY_MS - 1 }),
      stretch({ id: "s3", ms: 2 * QUIET_BEFORE_DELIVERY_MS - 1 }),
    ];
    const batches = quietBatches({ nowIso: at({ ms: 10 * QUIET_BEFORE_DELIVERY_MS }), relays: [], words });
    expect(batches.map((batch) => batch.stretches)).toStrictEqual([
      ["talk-call:call-a#s1", "talk-call:call-a#s2"],
      ["talk-call:call-a#s3"],
    ]);
  });

  it("orders a relay among the stretches by the instant it was held", () => {
    const words = [stretch({ id: "s2", ms: 60_000 }), stretch({ id: "s1", ms: 0 })];
    const [batch] = quietBatches({
      nowIso: at({ ms: 61_000 }),
      relays: [relay({ ms: 30_000, slug: "talk-aaa" })],
      words,
    });
    expect([batch!.stretches, batch!.relays, batch!.lastWordIso]).toStrictEqual([
      ["talk-call:call-a#s1", "talk-call:call-a#s2"],
      [{ cut: false, heardEdges: WHOLE, slug: "talk-aaa", words: "take the set" }],
      at({ ms: 60_000 }),
    ]);
  });

  it("is due exactly the floor after its last word, and holding a millisecond before", () => {
    const words = [stretch({ id: "s1", ms: 0 })];
    const holding = quietBatches({ nowIso: at({ ms: QUIET_BEFORE_DELIVERY_MS - 1 }), relays: [], words });
    const due = quietBatches({ nowIso: at({ ms: QUIET_BEFORE_DELIVERY_MS }), relays: [], words });
    expect([holding[0]!.due, due[0]!.due, due[0]!.dueAtIso]).toStrictEqual([
      false,
      true,
      at({ ms: QUIET_BEFORE_DELIVERY_MS }),
    ]);
  });

  it("makes a batch of a held relay alone", () => {
    const batches = quietBatches({ nowIso: START, relays: [relay({ ms: 0, slug: "talk-bbb" })], words: [] });
    expect(batches).toStrictEqual([
      {
        due: false,
        dueAtIso: at({ ms: QUIET_BEFORE_DELIVERY_MS }),
        lastWordIso: START,
        relays: [{ cut: false, heardEdges: WHOLE, slug: "talk-bbb", words: "take the set" }],
        stretches: [],
      },
    ]);
  });

  it("quotes one held relay up to its board row's limit, and splits the words budget evenly past that", () => {
    const fitted = ({ heard, count }: { heard: string; count: number }): (string | number | boolean)[][] =>
      quietBatches({
        nowIso: START,
        relays: Array.from({ length: count }, (_, index) => relay({ heard, ms: index, slug: `talk-${String(index)}` })),
        words: [],
      })[0]!.relays.map((held) => [held.slug, held.cut, held.words.length]);
    const third = Math.floor(HELD_RELAY_WORDS_BYTES / 3);
    expect([
      fitted({ count: 1, heard: "w".repeat(RELAY_ROW_QUOTE_LIMIT) }),
      fitted({ count: 1, heard: "w".repeat(RELAY_ROW_QUOTE_LIMIT + 1) }),
      fitted({ count: 3, heard: "w".repeat(RELAY_ROW_QUOTE_LIMIT) }),
    ]).toStrictEqual([
      [["talk-0", false, RELAY_ROW_QUOTE_LIMIT]],
      [["talk-0", true, RELAY_ROW_QUOTE_LIMIT - 3]],
      [
        ["talk-0", true, third - 3],
        ["talk-1", true, third - 3],
        ["talk-2", true, third - 3],
      ],
    ]);
  });

  it("holds back each record mark's bytes, and the flag's, so the whole phrase still fits the share", () => {
    const kept = ({ heardEdges }: { heardEdges: HeardEdges }): number =>
      quietBatches({
        nowIso: START,
        relays: [relay({ heard: "w".repeat(RELAY_ROW_QUOTE_LIMIT), heardEdges, ms: 0, slug: "talk-eee" })],
        words: [],
      })[0]!.relays[0]!.words.length;
    // The opening mark takes 3 bytes once, whether the fit cut or the record lost its start; a lost end 3 more; a record
    // that never said, the flag.
    expect([
      kept({ heardEdges: { end: "lost", start: "kept" } }),
      kept({ heardEdges: { end: "lost", start: "lost" } }),
      kept({ heardEdges: { end: "unknown", start: "kept" } }),
      kept({ heardEdges: { end: "lost", start: "unknown" } }),
    ]).toStrictEqual([
      RELAY_ROW_QUOTE_LIMIT - 6,
      RELAY_ROW_QUOTE_LIMIT - 6,
      RELAY_ROW_QUOTE_LIMIT - 3 - FLAG_BYTES,
      RELAY_ROW_QUOTE_LIMIT - 6 - FLAG_BYTES,
    ]);
  });

  it("keeps every relay's whole phrase inside its share, however its record reads", () => {
    const edges: readonly HeardEdges[] = [
      WHOLE,
      { end: "lost", start: "lost" },
      { end: "unknown", start: "unknown" },
      { end: "lost", start: "unknown" },
    ];
    const relays = Array.from({ length: 40 }, (_, index) =>
      relay({
        heard: "合并 🚀 ".repeat(500),
        heardEdges: edges[index % edges.length]!,
        ms: index,
        slug: `talk-${String(index).padStart(12, "0")}`,
      }),
    );
    const share = Math.floor(HELD_RELAY_WORDS_BYTES / relays.length);
    const over = quietBatches({ nowIso: START, relays, words: [] })[0]!.relays.filter(
      (held) => Buffer.byteLength(heldRelayPhrase({ relay: held }), "utf8") - held.slug.length - 3 > share,
    );
    expect([relays.length, over]).toStrictEqual([40, []]);
  });
});

describe("fittedHeard", () => {
  it("keeps words of exactly the share whole", () => {
    const heard = "a".repeat(100);
    expect(fittedHeard({ bytes: 100, heard })).toStrictEqual({ cut: false, words: heard });
  });

  it("keeps only the newest words past the share, the cut mark's three bytes counted", () => {
    // 101 bytes into 100: the mark takes 3, so the newest 97 stay and the oldest four go.
    const heard = `${"x".repeat(5)}${"b".repeat(84)}take the set`;
    expect(fittedHeard({ bytes: 100, heard })).toStrictEqual({
      cut: true,
      words: `x${"b".repeat(84)}take the set`,
    });
  });

  it("counts a JSON escape as the bytes it prints", () => {
    // Each line break prints as two bytes, so ten of them (20 bytes) fit a share of 20 whole and not one of 19.
    const heard = "\n".repeat(10);
    expect([fittedHeard({ bytes: 20, heard }), fittedHeard({ bytes: 19, heard })]).toStrictEqual([
      { cut: false, words: heard },
      { cut: true, words: "\n".repeat(8) },
    ]);
  });

  it("counts a multibyte character by its UTF-8 bytes and never splits a surrogate pair", () => {
    // Each emoji is 4 bytes in two code units: 3 of them (12 bytes) plus the mark (3) fit 16; a fourth does not.
    const heard = "\u{1F600}".repeat(5);
    expect(fittedHeard({ bytes: 16, heard })).toStrictEqual({ cut: true, words: "\u{1F600}".repeat(3) });
  });

  it("reads a surrogate already lone in the turn record as U+FFFD, whole or cut", () => {
    expect([
      fittedHeard({ bytes: 100, heard: "take \uD800 the set" }),
      fittedHeard({ bytes: 9, heard: "take the set \uDC00" }),
    ]).toStrictEqual([
      { cut: false, words: "take � the set" },
      // 9 bytes less the mark's 3: U+FFFD's 3 and "et "'s 3.
      { cut: true, words: "et �" },
    ]);
  });

  it("keeps nothing but the cut mark when the share cannot hold a word, never the whole string", () => {
    expect(fittedHeard({ bytes: 0, heard: "take the set" })).toStrictEqual({ cut: true, words: "" });
  });

  it("pays an opening mark the record already owes once: whole when words and mark fit, cut to the same tail when not", () => {
    // "take the set" is 12 bytes; the mark 3. At 15 it fits whole behind the mark; at 14 the tail keeps 11, mark paid once.
    expect([
      fittedHeard({ bytes: 15, heard: "take the set", opened: true }),
      fittedHeard({ bytes: 14, heard: "take the set", opened: true }),
    ]).toStrictEqual([
      { cut: false, words: "take the set" },
      { cut: true, words: "ake the set" },
    ]);
  });
});

describe("heldRelayPhrase", () => {
  it("quotes the owner's words beside the slug, escaping a quote and a line break so the line stays one line", () => {
    expect(
      heldRelayPhrase({
        relay: { cut: false, heardEdges: WHOLE, slug: "talk-ddd", words: 'take "the set"\nall of it' },
      }),
    ).toBe(String.raw`talk-ddd "take \"the set\"\nall of it"`);
  });

  it("opens a tail with an ellipsis", () => {
    expect(heldRelayPhrase({ relay: { cut: true, heardEdges: WHOLE, slug: "talk-fff", words: "take the set" } })).toBe(
      `talk-fff "…take the set"`,
    );
  });

  it("marks each end the record lost on its own, both together, and flags an end it never said about", () => {
    const phrase = ({ cut, heardEdges }: { cut: boolean; heardEdges: HeardEdges }): string =>
      heldRelayPhrase({ relay: { cut, heardEdges, slug: "talk-ggg", words: "take the set" } });
    expect([
      phrase({ cut: false, heardEdges: { end: "kept", start: "lost" } }),
      phrase({ cut: false, heardEdges: { end: "lost", start: "kept" } }),
      phrase({ cut: false, heardEdges: { end: "lost", start: "lost" } }),
      phrase({ cut: true, heardEdges: { end: "lost", start: "kept" } }),
      phrase({ cut: true, heardEdges: { end: "kept", start: "lost" } }),
      phrase({ cut: false, heardEdges: { end: "unknown", start: "kept" } }),
      phrase({ cut: false, heardEdges: { end: "lost", start: "unknown" } }),
    ]).toStrictEqual([
      `talk-ggg "…take the set"`,
      `talk-ggg "take the set…"`,
      `talk-ggg "…take the set…"`,
      `talk-ggg "…take the set…"`,
      `talk-ggg "…take the set"`,
      `talk-ggg "take the set" (maybe not all their words)`,
      `talk-ggg "take the set…" (maybe not all their words)`,
    ]);
  });

  it("says a turn record carries no words of theirs, rather than quoting nothing", () => {
    expect(
      heldRelayPhrase({
        relay: { cut: false, heardEdges: { end: "unknown", start: "unknown" }, slug: "talk-hhh", words: "" },
      }),
    ).toBe("talk-hhh (no words of theirs on its turn record — read it with slopweaver talk log)");
  });
});

describe("quietBatchLine", () => {
  it("names a due batch's relays with the owner's words on each, and the instant the owner went quiet", () => {
    const [batch] = quietBatches({
      nowIso: at({ ms: QUIET_BEFORE_DELIVERY_MS + 1 }),
      relays: [relay({ ms: 0, slug: "talk-ccc" }), relay({ heard: "and the ratchets", ms: 1, slug: "talk-ccd" })],
      words: [stretch({ id: "s1", ms: 0 })],
    });
    expect(quietBatchLine({ batch: batch!, index: 1 })).toBe(
      `quiet batch 1: 1 stretch(es), relay(s) held in it: talk-ccc "take the set", talk-ccd "and the ratchets"; ` +
        `due — the owner went quiet after ${at({ ms: 1 })}`,
    );
  });

  it("names when a holding batch falls due", () => {
    const [batch] = quietBatches({ nowIso: START, relays: [], words: [stretch({ id: "s1", ms: 0 })] });
    expect(quietBatchLine({ batch: batch!, index: 2 })).toBe(
      `quiet batch 2: 1 stretch(es); holding until ${at({ ms: QUIET_BEFORE_DELIVERY_MS })} — the owner's last word was at ` +
        `${START}, and they may still be speaking`,
    );
  });
});
