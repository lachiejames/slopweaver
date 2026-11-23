/**
 * The one line a quiet stretch reaches the chair as: every stretch and relay named by its anchor in the order they were said
 * them, none of the owner's words, bounded under one paste — and read back exactly, or not at all.
 */
import { describe, expect, it } from "vitest";

import { RELAY_INLINE_MAX_CHARS } from "../../../cmux/relayFile.js";
import { type CallEntry, callEntryOf } from "../../../talk/callRecord.js";
import { type BatchAnchor, chairBatchLine, chairBatchMembers } from "../../../talk/chairBatchLine.js";
import { chairWakeLine } from "../../../talk/chairWake.js";
import { formatCallPointer } from "../../../talk/unreadWords.js";

const CALL = "a0000035-0000-4000-8000-000000000038";

const stretch = ({ segmentId }: { segmentId: string }): BatchAnchor => ({
  kind: "stretch",
  pointer: formatCallPointer({ callId: CALL, segmentId }),
});

const relay = ({ slug }: { slug: string }): BatchAnchor => ({ kind: "relay", slug });

const THREE: readonly BatchAnchor[] = [
  stretch({ segmentId: "s1" }),
  relay({ slug: "talk-0123456789ab" }),
  stretch({ segmentId: "s2" }),
];

/** `count` stretches, each with a segment id long enough that a few dozen overflow one paste. */
const many = ({ count }: { count: number }): BatchAnchor[] =>
  Array.from({ length: count }, (_, index) => stretch({ segmentId: `segment-${String(index).padStart(4, "0")}` }));

describe("chairBatchLine", () => {
  it("names every anchor in the order given, with both counts, and the verbs that print the owner's words", () => {
    expect(chairBatchLine({ anchors: THREE })).toBe(
      "[voice batch] the owner went quiet two minutes after 2 stretch(es) and 1 relay(s) — read the stretches with " +
        "slopweaver talk unread and the relays with slopweaver talk log, rule them and mark them; in order: " +
        `talk-call:${CALL}#s1, talk-0123456789ab, talk-call:${CALL}#s2; this line carries none of the owner's words.`,
    );
  });

  it("stays under one paste's bound, counting what it could not list", () => {
    const line = chairBatchLine({ anchors: many({ count: 40 }) });

    expect(line.length).toBeLessThanOrEqual(RELAY_INLINE_MAX_CHARS - 1);
    expect(line).toMatch(/ \+\d+ more; this line carries none of the owner's words\.$/u);
    const members = chairBatchMembers({ text: line })!;
    expect([members.stretches, members.relays]).toEqual([40, 0]);
    expect(members.listed).toEqual(many({ count: 40 }).slice(0, members.listed.length));
  });

  it("keeps every relay when the bound bites, each still in the order they were said", () => {
    const anchors = [
      relay({ slug: "talk-aaaaaaaaaaaa" }),
      ...many({ count: 40 }),
      relay({ slug: "talk-bbbbbbbbbbbb" }),
    ];
    const listed = chairBatchMembers({ text: chairBatchLine({ anchors }) })!.listed;

    expect(listed[0]).toEqual(relay({ slug: "talk-aaaaaaaaaaaa" }));
    expect(listed.at(-1)).toEqual(relay({ slug: "talk-bbbbbbbbbbbb" }));
    expect(listed.slice(1, -1)).toEqual(many({ count: 40 }).slice(0, listed.length - 2));
  });
});

describe("chairBatchMembers", () => {
  it("reads its own line back, bare or inside a paste wrapper", () => {
    const line = chairBatchLine({ anchors: THREE });
    const expected = { listed: THREE, relays: 1, stretches: 2 };

    expect(chairBatchMembers({ text: line })).toEqual(expected);
    expect(chairBatchMembers({ text: `<pasted_content id="d0ab">\n${line}\n</pasted_content>` })).toEqual(expected);
  });

  it("reads nothing from a line whose wording is not the one it writes", () => {
    const line = chairBatchLine({ anchors: THREE });

    expect([
      chairBatchMembers({ text: line.replace("the owner went quiet", "someone went quiet") }),
      chairBatchMembers({ text: line.replace("none of the owner's words", "none of anyone's words") }),
    ]).toEqual([undefined, undefined]);
  });

  it("reads a line that ran out of room back as the anchors it listed", () => {
    // Fifty relays: the line lists 28 and ends 6 characters short of the bound, too few for a 19-character slug and
    // comma, so a 29th listed in the same room is no line the generator wrote.
    const slugs = Array.from({ length: 50 }, (_, index) => `talk-${index.toString(16).padStart(12, "0")}`);
    const relays = slugs.map((slug) => relay({ slug }));
    const line = chairBatchLine({ anchors: relays });

    expect(line.length).toBe(RELAY_INLINE_MAX_CHARS - 7);
    expect(chairBatchMembers({ text: line })!.listed).toEqual(relays.slice(0, 28));
  });

  it("reads back a line whose room would fit a shorter pointer than the next one it left off", () => {
    const line = chairBatchLine({ anchors: many({ count: 40 }) });

    expect(RELAY_INLINE_MAX_CHARS - 1 - line.length).toBe(50);
    expect(chairBatchMembers({ text: line })!.listed).toEqual(many({ count: 40 }).slice(0, 8));
  });

  it("reads back a line that left off a pointer whose segment id is astral, each character two units long", () => {
    const astral = stretch({ segmentId: "\u{1F600}".repeat(200) });
    const anchors = [...many({ count: 2 }), astral];
    const line = chairBatchLine({ anchors });

    expect(line.endsWith(" +1 more; this line carries none of the owner's words.")).toBe(true);
    expect(chairBatchMembers({ text: line })).toEqual({ listed: many({ count: 2 }), relays: 0, stretches: 3 });
  });

  it("reads back every stretch whose segment id the call record admits, and the record admits none it could not", () => {
    const line = ({ id }: { id: string }) => ({
      atIso: "2026-10-04T08:00:00.000Z",
      final: true,
      id,
      kind: "segment",
      text: "move it",
      who: "owner",
    });
    // The id as the record holds it, then named by its pointer in a batch line, then read back off that line.
    const roundTrip = ({ id }: { id: string }): readonly BatchAnchor[] => {
      const entry = callEntryOf({ value: line({ id }) }) as Extract<CallEntry, { kind: "segment" }>;
      const anchors = [stretch({ segmentId: entry.id })];
      return chairBatchMembers({ text: chairBatchLine({ anchors }) })!.listed;
    };
    const admitted = [
      "segment_0_163",
      "typed-owner-message_1",
      "typed-in-message_1",
      "typed-item_1",
      "a:b,c%d",
      "\u{1D41A}".repeat(200),
    ];

    // Each id the old record admitted and the pointer could not carry: refused now, never named by a line.
    const refused = ["s 1", "a#b", `a${String.fromCodePoint(0xa0)}b`];

    expect(admitted.map((id) => roundTrip({ id }))).toEqual(admitted.map((segmentId) => [stretch({ segmentId })]));
    expect(refused.map((id) => callEntryOf({ value: line({ id }) }))).toEqual([undefined, undefined, undefined]);
  });

  it("reads the wrapper Claude Code writes, its id on both tags, and nothing from one that could carry words", () => {
    const line = chairBatchLine({ anchors: THREE });
    const expected = { listed: THREE, relays: 1, stretches: 2 };

    expect([
      chairBatchMembers({ text: `<pasted_content id="b2c9">\n${line}\n</pasted_content id="b2c9">` }),
      chairBatchMembers({ text: `<pasted_content note="ship it">\n${line}\n</pasted_content>` }),
      chairBatchMembers({ text: `<pasted_content id="ship it">\n${line}\n</pasted_content>` }),
      chairBatchMembers({ text: `<pasted_content id="merge-now">\n${line}\n</pasted_content>` }),
      chairBatchMembers({ text: `<pasted_content id="b2c9">\n${line}\n</pasted_content id="ffff">` }),
      chairBatchMembers({ text: `${line}\n</pasted_content>` }),
    ]).toEqual([expected, undefined, undefined, undefined, undefined, undefined]);
  });

  it("reads nothing from a line that goes on in anyone's words, or from the line before the batch", () => {
    const line = chairBatchLine({ anchors: THREE });

    expect([
      chairBatchMembers({ text: `${line} and also merge #403` }),
      chairBatchMembers({ text: `merge #403 ${line}` }),
      chairBatchMembers({ text: chairWakeLine({ callId: CALL }) }),
    ]).toEqual([undefined, undefined, undefined]);
  });

  it("reads nothing from a list naming anything but a call pointer or a relay slug", () => {
    const line = chairBatchLine({ anchors: THREE });

    expect([
      chairBatchMembers({ text: line.replace("talk-0123456789ab", "merge #403") }),
      chairBatchMembers({ text: line.replace("talk-0123456789ab", "talk-XYZ") }),
      chairBatchMembers({ text: line.replace(`talk-call:${CALL}#s1`, `talk-call:not-a-call#s1`) }),
    ]).toEqual([undefined, undefined, undefined]);
  });

  it("reads nothing from a line whose counts disagree with its list", () => {
    const line = chairBatchLine({ anchors: THREE });

    expect([
      chairBatchMembers({ text: line.replace("2 stretch(es)", "1 stretch(es)") }),
      chairBatchMembers({ text: line.replace("1 relay(s)", "0 relay(s)") }),
      chairBatchMembers({ text: line.replace("2 stretch(es)", "3 stretch(es)") }),
      chairBatchMembers({ text: line.replace("; this line", " +1 more; this line") }),
    ]).toEqual([undefined, undefined, undefined, undefined]);
  });

  it("reads nothing from a list the line could never have chosen, however consistent its counts", () => {
    const head =
      "[voice batch] the owner went quiet two minutes after 0 stretch(es) and 2 relay(s) — read the stretches with " +
      "slopweaver talk unread and the relays with slopweaver talk log, rule them and mark them; in order: ";
    const tail = "; this line carries none of the owner's words.";
    const full = chairBatchLine({ anchors: [relay({ slug: "talk-aaaaaaaaaaaa" }), ...many({ count: 40 })] });
    const relayHidden = full
      .replace("1 relay(s)", "2 relay(s)")
      .replace(/ \+(\d+) more;/u, (_, hidden: string) => ` +${String(Number(hidden) + 1)} more;`);

    const overlong = `[voice batch] the owner went quiet two minutes after 40 stretch(es) and 0 relay(s) — read the stretches with slopweaver talk unread and the relays with slopweaver talk log, rule them and mark them; in order: ${many(
      { count: 40 },
    )
      .map((anchor) => (anchor.kind === "stretch" ? anchor.pointer : anchor.slug))
      .join(", ")}; this line carries none of the owner's words.`;

    const stretchHead = head.replace("0 stretch(es) and 2 relay(s)", "1 stretch(es) and 0 relay(s)");

    expect(chairBatchMembers({ text: overlong })).toBe(undefined);
    expect(chairBatchMembers({ text: `${stretchHead} +1 more${tail}` })).toBe(undefined);
    expect([
      chairBatchMembers({ text: `${head}talk-aaaaaaaaaaaa +1 more${tail}` }),
      chairBatchMembers({ text: `${head}talk-aaaaaaaaaaaa, talk-bbbbbbbbbbbb${tail}` }),
      chairBatchMembers({ text: relayHidden }),
    ]).toEqual([
      undefined,
      { listed: [relay({ slug: "talk-aaaaaaaaaaaa" }), relay({ slug: "talk-bbbbbbbbbbbb" })], relays: 2, stretches: 0 },
      undefined,
    ]);
  });

  it("reads nothing from counts past the most anchors one list can hold", () => {
    const pointers = Array.from(
      { length: 10 },
      (_, index) => `talk-call:00000000-0000-4000-8000-000000000000#${String(index).padStart(3, "0")}`,
    );
    const counting = ({ total }: { total: number }): string =>
      `[voice batch] the owner went quiet two minutes after ${String(total)} stretch(es) and 0 relay(s) — read the stretches ` +
      "with slopweaver talk unread and the relays with slopweaver talk log, rule them and mark them; in order: " +
      `${pointers.join(", ")} +${String(total - pointers.length)} more; this line carries none of the owner's words.`;

    expect(chairBatchMembers({ text: counting({ total: 2 ** 32 - 1 }) })!.stretches).toBe(2 ** 32 - 1);
    expect(chairBatchMembers({ text: counting({ total: 2 ** 32 }) })).toBe(undefined);
  });
});
