import { describe, expect, it } from "vitest";

import {
  atlasChannel,
  membershipUnknown,
  neverLookedAt,
  readToByChannel,
  slackAtlas,
  unreadable,
} from "../../../atlas/slack.js";
import type { StructureBronzeRow } from "../../../corpus/structures/types.js";

/** A Slack structure row carrying only what the atlas reads. */
function channelRow({
  id,
  name,
  isMember = true,
  archived = false,
  isPrivate = false,
  kind = "channel",
}: {
  id: string;
  name?: string;
  isMember?: boolean;
  archived?: boolean;
  isPrivate?: boolean;
  kind?: StructureBronzeRow["kind"];
}): StructureBronzeRow {
  return {
    attrs: { archived, isMember, private: isPrivate },
    fetchedAtIso: "2026-08-08T00:00:00.000Z",
    identity: { nativeId: id, ...(name !== undefined ? { name } : {}) },
    kind,
    provenance: ["slack.conversations.list"],
    raw: {},
    relations: [],
    source: "slack",
    sourceId: id,
    version: 1,
    warnings: [],
  };
}

const IN_READ = channelRow({ id: "C1", name: "joined-and-read" });
const IN_UNREAD = channelRow({ id: "C2", name: "joined-never-read" });
const OUT = channelRow({ id: "C3", isMember: false, isPrivate: true, name: "private-not-joined" });
const ARCHIVED = channelRow({ archived: true, id: "C4", name: "archived" });
const ROWS = [IN_READ, IN_UNREAD, OUT, ARCHIVED];
const READ_TO = new Map([["C1", "1785913155.614319"]]);

describe("slackAtlas", () => {
  it("seeds a row for EVERY channel, not just the ones that have been read", () => {
    // The inversion the whole file rests on: a channel nobody has opened is still a named row, so "never
    // looked at" is answerable on the first run rather than accumulating as work happens.
    const atlas = slackAtlas({ huddles: [], readTo: new Map(), rows: ROWS });

    expect(atlas.channels.map((c) => c.id)).toEqual(["C1", "C2", "C3", "C4"]);
    expect(atlas.counts.everRead).toBe(0);
  });

  it("ignores rows that are not channels", () => {
    const atlas = slackAtlas({
      huddles: [],
      readTo: new Map(),
      rows: [IN_READ, channelRow({ id: "S1", kind: "usergroup" }), channelRow({ id: "T1", kind: "org" })],
    });

    expect(atlas.channels.map((c) => c.id)).toEqual(["C1"]);
  });

  it("separates CAN read from HAVE read — they are independent facts", () => {
    const atlas = slackAtlas({ huddles: [], readTo: READ_TO, rows: ROWS });

    // C1 public+read, C2 public+unread, C4 archived-but-public+unread are all readable; only C3 (private,
    // not joined) is not. Archived is static, not unreadable — see UnreadableReason.
    expect(atlas.counts).toEqual({
      everRead: 1,
      membershipKnown: 4,
      neverReadArchived: 1,
      neverReadJoined: 1,
      readable: 3,
      readableNeverRead: 1,
      total: 4,
      unreadable: 1,
    });
  });

  it("reports coverage as the timestamp a re-read consumes, not a fraction", () => {
    const atlas = slackAtlas({ huddles: [], readTo: READ_TO, rows: ROWS });

    expect(atlasChannel({ atlas, channelId: "C1" })!.coverage).toEqual({
      kind: "read-to",
      ts: "1785913155.614319",
    });
    expect(atlasChannel({ atlas, channelId: "C2" })!.coverage).toEqual({ kind: "never-read" });
  });

  it("marks a PRIVATE channel the account has not joined as unreadable, with the reason", () => {
    const atlas = slackAtlas({ huddles: [], readTo: new Map(), rows: ROWS });
    const out = atlasChannel({ atlas, channelId: "C3" })!;

    expect(out.readable).toBe(false);
    expect(out.unreadableReason).toBe("private and not a member");
  });

  it("reads a PUBLIC channel the account has never joined — membership does not gate public history", () => {
    // PROVEN against the live API, not assumed: a thread in a channel whose `is_member` is false returned
    // its messages with completeness `corroborated`. The brief asserted such a call "would fail"; it does
    // not, and treating membership as the gate hid every public conversation the account had not joined.
    const atlas = slackAtlas({ huddles: [], readTo: new Map(), rows: [channelRow({ id: "C7", isMember: false })] });
    const pub = atlasChannel({ atlas, channelId: "C7" })!;

    expect(pub.readable).toBe(true);
    expect(pub.unreadableReason).toBe(undefined);
  });

  it("treats ARCHIVED as static, not unreadable — its history is still fetchable", () => {
    // Also proven live, on an archived channel the account is not in.
    const atlas = slackAtlas({ huddles: [], readTo: new Map(), rows: ROWS });
    const arch = atlasChannel({ atlas, channelId: "C4" })!;

    expect(arch.isArchived).toBe(true);
    expect(arch.readable).toBe(true);
  });

  it("refuses to call a row with NO privacy attribute readable — silence is not evidence", () => {
    // Reading absent privacy as "public, therefore readable" is a claim the capture does not support, and
    // it would let a stale cursor become a read claim too. A review pass produced that counterexample.
    const bare: StructureBronzeRow = { ...IN_READ, attrs: {}, sourceId: "C8" };

    const atlas = slackAtlas({ huddles: [], readTo: new Map([["C8", "1785913155.614319"]]), rows: [bare] });
    const ch = atlasChannel({ atlas, channelId: "C8" })!;

    expect(ch.readable).toBe(false);
    expect(ch.unreadableReason).toBe("unknown: capture predates privacy capture");
    expect(ch.coverage).toEqual({ kind: "never-read" });
  });

  it("never claims to have READ a channel it cannot read — the brief's falsifier", () => {
    // A cursor for a private channel the account is not in. Whatever produced it, the atlas must not answer
    // "I have read this" about something it cannot open, and must not count it in everRead.
    const atlas = slackAtlas({ huddles: [], readTo: new Map([["C3", "1785913155.614319"]]), rows: ROWS });
    const out = atlasChannel({ atlas, channelId: "C3" })!;

    expect(out.readable).toBe(false);
    expect(out.coverage).toEqual({ kind: "never-read" });
    expect(atlas.counts.everRead).toBe(0);
  });

  it("counts CHANNELS, not stored rows — the store appends a row per capture", () => {
    // Measured on the real store the moment this feature added a field: every channel held more than one
    // row, because changing the projection re-wrote every one. Counting rows counted each channel
    // once per capture.
    const older = { ...channelRow({ id: "C1", isMember: false }), fetchedAtIso: "2026-07-24T00:00:00.000Z" };
    const newer = { ...channelRow({ id: "C1", isMember: true }), fetchedAtIso: "2026-08-08T00:00:00.000Z" };

    const atlas = slackAtlas({ huddles: [], readTo: new Map(), rows: [older, newer] });

    expect(atlas.counts.total).toBe(1);
  });

  it("takes the NEWEST capture, so a stale row cannot override current membership", () => {
    const older = { ...channelRow({ id: "C1", isMember: false }), fetchedAtIso: "2026-07-24T00:00:00.000Z" };
    const newer = { ...channelRow({ id: "C1", isMember: true }), fetchedAtIso: "2026-08-08T00:00:00.000Z" };

    // Both orderings, because "last one wins by array position" would pass one and fail the other.
    expect(
      atlasChannel({ atlas: slackAtlas({ huddles: [], readTo: new Map(), rows: [older, newer] }), channelId: "C1" })!
        .isMember,
    ).toBe(true);
    expect(
      atlasChannel({ atlas: slackAtlas({ huddles: [], readTo: new Map(), rows: [newer, older] }), channelId: "C1" })!
        .isMember,
    ).toBe(true);
  });

  it("does not count a stale row's missing membership as membership-known", () => {
    const stale = { ...channelRow({ id: "C1" }), attrs: {}, fetchedAtIso: "2026-07-24T00:00:00.000Z" };
    const fresh = { ...channelRow({ id: "C1", isMember: true }), fetchedAtIso: "2026-08-08T00:00:00.000Z" };

    expect(slackAtlas({ huddles: [], readTo: new Map(), rows: [stale, fresh] }).counts.membershipKnown).toBe(1);
  });

  it("orders channels deterministically, so two runs produce the same map", () => {
    const forward = slackAtlas({ huddles: [], readTo: new Map(), rows: ROWS });
    const reversed = slackAtlas({ huddles: [], readTo: new Map(), rows: [...ROWS].toReversed() });

    expect(reversed.channels.map((c) => c.id)).toEqual(forward.channels.map((c) => c.id));
  });

  it("holds an empty workspace without inventing a count", () => {
    const atlas = slackAtlas({ huddles: [], readTo: new Map(), rows: [] });

    expect(atlas.channels).toEqual([]);
    expect(atlas.counts).toEqual({
      everRead: 0,
      membershipKnown: 0,
      neverReadArchived: 0,
      neverReadJoined: 0,
      readable: 0,
      readableNeverRead: 0,
      total: 0,
      unreadable: 0,
    });
  });
});

describe("membershipUnknown", () => {
  it("flags a map written before membership was captured, so 0-readable is not read as a finding", () => {
    // The old projection dropped `is_member` for EVERY row, so zero-known-out-of-many is the signature of a
    // stale store rather than of belonging to nothing. Reporting "0 readable" without this is a true number
    // that misleads.
    const stale = [IN_READ, OUT].map((r) => ({ ...r, attrs: { archived: false, private: false } }));

    const atlas = slackAtlas({ huddles: [], readTo: new Map(), rows: stale });

    expect(atlas.counts.membershipKnown).toBe(0);
    expect(membershipUnknown({ atlas })).toBe(true);
  });

  it("does NOT flag a fresh map in which the account genuinely belongs to nothing", () => {
    const none = [channelRow({ id: "C1", isMember: false }), channelRow({ id: "C2", isMember: false })];

    const atlas = slackAtlas({ huddles: [], readTo: new Map(), rows: none });

    expect(atlas.counts.membershipKnown).toBe(2);
    expect(membershipUnknown({ atlas })).toBe(false);
  });

  it("does not flag an empty workspace, which has nothing to be stale about", () => {
    expect(membershipUnknown({ atlas: slackAtlas({ huddles: [], readTo: new Map(), rows: [] }) })).toBe(false);
  });
});

describe("readToByChannel", () => {
  it("collapses per-thread cursors to the newest per conversation", () => {
    const cursors = new Map([
      ["C1:1785000000.000001", "1785000100.000001"],
      ["C1:1785000000.000002", "1785999999.000009"],
      ["C2:1785000000.000003", "1785000050.000001"],
    ]);

    const byChannel = readToByChannel({ cursors });

    expect(byChannel.get("C1")).toBe("1785999999.000009");
    expect(byChannel.get("C2")).toBe("1785000050.000001");
  });

  it("compares timestamps by value, not as strings of differing width", () => {
    const cursors = new Map([
      ["C1:a", "999999999.000001"],
      ["C1:b", "1785000000.000001"],
    ]);

    expect(readToByChannel({ cursors }).get("C1")).toBe("1785000000.000001");
  });

  it("skips a malformed key rather than inventing a conversation called the whole key", () => {
    const cursors = new Map([
      ["no-colon-here", "1785000000.000001"],
      ["C1:x", "1785000000.000002"],
    ]);

    const byChannel = readToByChannel({ cursors });

    expect([...byChannel.keys()]).toEqual(["C1"]);
  });
});

describe("neverLookedAt", () => {
  it("offers only channels that could actually be opened", () => {
    // A list including the ones the account cannot read is a list nobody would act on.
    const atlas = slackAtlas({ huddles: [], readTo: READ_TO, rows: ROWS });

    expect(neverLookedAt({ atlas }).map((c) => c.id)).toEqual(["C2"]);
  });

  it("is empty when everything readable has been read", () => {
    const atlas = slackAtlas({
      huddles: [],
      readTo: new Map([
        ["C1", "1.000001"],
        ["C2", "1.000002"],
      ]),
      rows: ROWS,
    });

    expect(neverLookedAt({ atlas })).toEqual([]);
  });
});

describe("neverLookedAt filtering", () => {
  it("EXCLUDES archived channels — nothing new can arrive, so it is not work", () => {
    // Measured on the real workspace: archived channels sat among the never-read rows beside the ones
    // worth opening. A list where the useful answer is a fraction of the rows is a report, not a tool.
    const atlas = slackAtlas({ huddles: [], readTo: new Map(), rows: ROWS });

    expect(neverLookedAt({ atlas }).some((c) => c.isArchived)).toBe(false);
    expect(atlas.counts.neverReadArchived).toBe(1);
  });

  it("sorts JOINED channels first — those are the real gaps", () => {
    // On the real workspace the joined never-read channels were alert channels never ingested.
    const rows = [
      channelRow({ id: "C1", isMember: false }),
      channelRow({ id: "C2", isMember: false }),
      channelRow({ id: "C3", isMember: true }),
    ];

    const atlas = slackAtlas({ huddles: [], readTo: new Map(), rows });

    expect(neverLookedAt({ atlas }).map((c) => c.id)).toEqual(["C3", "C1", "C2"]);
    expect(atlas.counts.neverReadJoined).toBe(1);
  });
});

describe("unreadable", () => {
  it("lists what cannot be opened, with reasons — the answer to being tagged somewhere you are not", () => {
    const atlas = slackAtlas({ huddles: [], readTo: new Map(), rows: ROWS });

    expect(unreadable({ atlas }).map((c) => [c.id, c.unreadableReason])).toEqual([["C3", "private and not a member"]]);
  });
});

describe("atlasChannel", () => {
  it("returns undefined for a conversation the map has never seen", () => {
    const atlas = slackAtlas({ huddles: [], readTo: new Map(), rows: ROWS });

    expect(atlasChannel({ atlas, channelId: "C404" })).toBe(undefined);
  });
});
