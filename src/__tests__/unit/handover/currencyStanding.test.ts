/**
 * The standing half of a card's steers check: what changed in the owner's
 * memories, owner profile and rulings strictly after a card's floor, filed to it or to no card, and every gap that
 * applies to it — and each source's entries as the shell's reads become them.
 */
import { describe, expect, it } from "vitest";

import { type StandingEntry, type StandingRead, standingSince } from "../../../handover/currencyStanding.js";
import { memoryPart, profileChangedIso, profilePart, rulingPart } from "../../../handover/currencyStandingEntries.js";
import type { RunEvent } from "../../../handover/ledger.js";
import { parseMemoryLeaf } from "../../../memory/corpus.js";

const FLOOR = "2026-10-02T09:00:00.000Z";
const BEFORE = "2026-10-02T08:00:00.000Z";
const AFTER = "2026-10-02T10:00:00.000Z";
const NOW = "2026-10-02T12:00:00.000Z";
const SOURCES = { memory: "m", profile: "p", rulings: "r" };

const entry = (over: Partial<StandingEntry>): StandingEntry => ({
  atIso: AFTER,
  pointer: "memory:p/a.md",
  row: undefined,
  source: "memory",
  text: "a",
  ...over,
});

const read = (over: Partial<StandingRead>): StandingRead => ({ entries: [], gaps: [], sources: SOURCES, ...over });

describe("standingSince", () => {
  it("keeps only what changed strictly after the floor, oldest first", () => {
    const standing = read({
      entries: [
        entry({ atIso: "2026-10-02T11:00:00.000Z", pointer: "memory:p/late.md" }),
        entry({ atIso: FLOOR, pointer: "memory:p/at.md" }),
        entry({ atIso: BEFORE, pointer: "memory:p/early.md" }),
        entry({ pointer: "profile:revision-2", source: "profile" }),
      ],
    });

    const since = standingSince({ floorMs: Date.parse(FLOOR), row: undefined, standing });

    expect(since.changes).toEqual([
      { atIso: AFTER, filed: "unfiled", pointer: "profile:revision-2", source: "profile" },
      { atIso: "2026-10-02T11:00:00.000Z", filed: "unfiled", pointer: "memory:p/late.md", source: "memory" },
    ]);
    expect(since.gaps).toEqual([]);
  });

  it("files a ruling to its own row's card and ignores it on every other", () => {
    const standing = read({ entries: [entry({ pointer: "ruling:mirror#x", row: "mirror", source: "ruling" })] });

    const mine = standingSince({ floorMs: Date.parse(FLOOR), row: "mirror", standing });
    const theirs = standingSince({ floorMs: Date.parse(FLOOR), row: "other", standing });
    const hand = standingSince({ floorMs: Date.parse(FLOOR), row: undefined, standing });

    expect(mine.changes.map((change) => change.filed)).toEqual(["here"]);
    expect([theirs.changes, hand.changes]).toEqual([[], []]);
  });

  it("carries every gap to every card, and an unparseable instant as a gap", () => {
    const standing = read({
      entries: [entry({ atIso: "not a time", pointer: "profile:revision-3", source: "profile" })],
      gaps: [{ why: "the store did not answer" }, { why: "1 run journal holds a line this build could not read" }],
    });
    const expected = [
      "the store did not answer",
      "1 run journal holds a line this build could not read",
      "one owner-profile statement carries no time, so whether it changed after this reached you cannot be told",
    ];

    const mine = standingSince({ floorMs: Date.parse(FLOOR), row: "mirror", standing });
    const hand = standingSince({ floorMs: Date.parse(FLOOR), row: undefined, standing });

    expect([mine.gaps, hand.gaps]).toEqual([expected, expected]);
    expect(mine.changes).toEqual([]);
  });
});

describe("memoryPart", () => {
  const leaf = ({ file, modified, mtimeMs }: { file: string; modified?: string; mtimeMs?: number }) =>
    parseMemoryLeaf({
      file,
      mtimeMs,
      text: [
        "---",
        "name: jq-is-banned",
        "description: no jq, verbs only",
        ...(modified === undefined ? [] : ["metadata:", `  modified: ${modified}`]),
        "---",
        "",
        "body",
      ].join("\n"),
    });

  it("dates a leaf by the LATEST of its declared modified field, its mtime and its ctime", () => {
    const part = memoryPart({
      corpora: [
        {
          kind: "read",
          leaves: [
            leaf({ file: "declared-later.md", modified: AFTER, mtimeMs: Date.parse(BEFORE) }),
            leaf({ file: "mtime-later.md", modified: BEFORE, mtimeMs: Date.parse(AFTER) }),
            leaf({ file: "backdated.md", modified: BEFORE, mtimeMs: Date.parse(BEFORE) }),
          ],
          folderChangedMs: Date.parse(BEFORE),
          project: "acme",
          statusChangedMs: new Map([["backdated.md", Date.parse(AFTER)]]),
        },
      ],
    });

    expect(part.entries.map(({ atIso, pointer, text }) => ({ atIso, pointer, text }))).toEqual([
      {
        atIso: "2026-10-02T10:00:00.001Z",
        pointer: "memory:acme/declared-later.md",
        text: "jq-is-banned: no jq, verbs only",
      },
      {
        atIso: "2026-10-02T10:00:00.001Z",
        pointer: "memory:acme/mtime-later.md",
        text: "jq-is-banned: no jq, verbs only",
      },
      {
        atIso: "2026-10-02T10:00:00.001Z",
        pointer: "memory:acme/backdated.md",
        text: "jq-is-banned: no jq, verbs only",
      },
      {
        atIso: "2026-10-02T08:00:00.001Z",
        pointer: "memory:acme/",
        text: "A memory in acme was added, removed or renamed",
      },
    ]);
    expect(part.source).toBe("3 memories read across 1 project");
  });

  it("dates every reading the millisecond after its own, so one on or a fraction past the floor is a change and one before it is not", () => {
    const part = memoryPart({
      corpora: [
        {
          kind: "read",
          leaves: [
            leaf({ file: "just-after.md", modified: BEFORE, mtimeMs: Date.parse(BEFORE) }),
            leaf({ file: "declared.md", modified: "2026-10-02T09:00:00.0005Z", mtimeMs: Date.parse(BEFORE) }),
            leaf({ file: "exact.md", modified: "2026-10-02T09:00:00.0000Z", mtimeMs: Date.parse(BEFORE) }),
            leaf({ file: "before.md", modified: "2026-10-02T08:59:59.999Z", mtimeMs: Date.parse(BEFORE) }),
          ],
          folderChangedMs: Date.parse(BEFORE),
          project: "acme",
          statusChangedMs: new Map([["just-after.md", Date.parse(FLOOR) + 0.5]]),
        },
      ],
    });

    const since = standingSince({
      floorMs: Date.parse(FLOOR),
      row: undefined,
      standing: read({ entries: part.entries }),
    });

    expect(since.changes.map(({ atIso, pointer }) => ({ atIso, pointer }))).toEqual([
      { atIso: "2026-10-02T09:00:00.001Z", pointer: "memory:acme/declared.md" },
      { atIso: "2026-10-02T09:00:00.001Z", pointer: "memory:acme/exact.md" },
      { atIso: "2026-10-02T09:00:00.001Z", pointer: "memory:acme/just-after.md" },
    ]);
  });

  it("names an unreadable corpus and a leaf with no time as gaps for every card", () => {
    const part = memoryPart({
      corpora: [
        { kind: "unreadable", project: "acme", why: "EACCES" },
        {
          folderChangedMs: Date.parse(BEFORE),
          kind: "read",
          leaves: [leaf({ file: "timeless.md" })],
          project: "other",
          statusChangedMs: new Map(),
        },
      ],
    });

    expect(part.gaps).toEqual([
      { why: "one of your memory folders would not read: EACCES" },
      { why: "one of your memories carries no time, so whether it changed after this reached you cannot be told" },
    ]);
    expect(part.source).toBe("0 memories read across 2 projects");
  });

  it("dates each folder by its own change time, so a memory deleted after the floor fails the card with no leaf left to read", () => {
    const part = memoryPart({
      corpora: [
        { folderChangedMs: Date.parse(AFTER), kind: "read", leaves: [], project: "acme", statusChangedMs: new Map() },
        { folderChangedMs: Date.parse(BEFORE), kind: "read", leaves: [], project: "quiet", statusChangedMs: new Map() },
      ],
    });

    const since = standingSince({
      floorMs: Date.parse(FLOOR),
      row: undefined,
      standing: read({ entries: part.entries }),
    });

    expect(since.changes).toEqual([
      { atIso: "2026-10-02T10:00:00.001Z", filed: "unfiled", pointer: "memory:acme/", source: "memory" },
    ]);
    expect(part.source).toBe("0 memories read across 2 projects");
  });
});

describe("profilePart", () => {
  it("is one unfiled entry dated by its last write, quoting the three newest statements", () => {
    const statements = ["a", "b", "c", "d"].map((text, at) => ({ observedAt: `2026-10-0${String(at + 1)}`, text }));

    const part = profilePart({ profile: { kind: "read", revision: 4, statements, updatedAtIso: AFTER } });

    expect(part.entries).toEqual([
      {
        atIso: AFTER,
        pointer: "profile:revision-4",
        row: undefined,
        source: "profile",
        text: "Your owner profile, revision 4 · d · c · b",
      },
    ]);
    expect(part.source).toBe("revision 4");
  });

  it("dates a revision the millisecond after its truncated instant, so one sub-millisecond past a floor fails it", () => {
    const floorIso = "2026-10-02T09:00:00.000Z";
    // Postgres wrote 09:00:00.000500; the driver's `Date` holds 09:00:00.000.
    const atIso = profileChangedIso({ updatedAt: new Date(floorIso) });
    const part = profilePart({ profile: { kind: "read", revision: 2, statements: [], updatedAtIso: atIso } });

    expect(atIso).toBe("2026-10-02T09:00:00.001Z");
    expect(
      standingSince({
        floorMs: Date.parse(floorIso),
        row: "acme",
        standing: read({ entries: part.entries }),
      }).changes.map(({ pointer }) => pointer),
    ).toEqual(["profile:revision-2"]);
  });

  it("reads no profile as empty and an unread one as a gap", () => {
    expect(profilePart({ profile: { kind: "absent" } })).toEqual({
      entries: [],
      gaps: [],
      source: "no owner profile recorded",
    });
    expect(profilePart({ profile: { kind: "unavailable", why: "ECONNREFUSED" } }).gaps).toEqual([
      { why: "your owner profile could not be read: ECONNREFUSED" },
    ]);
  });
});

describe("rulingPart", () => {
  const ruling = ({ atIso, untilIso }: { atIso: string; untilIso?: string }): RunEvent => ({
    anchor: "transcript:a0000036#a0000064",
    atIso,
    decidedIso: atIso,
    gate: {
      subjects: [],
      ...(untilIso === undefined ? {} : { untilIso }),
      verbs: [{ noun: "slack", verb: "post" }],
    },
    kind: "ruling",
    ruling: "posts go to the owner's DM only",
  });
  const plain: RunEvent = {
    anchor: "transcript:a0000036#aa",
    atIso: AFTER,
    decidedIso: AFTER,
    kind: "ruling",
    ruling: "ship it",
  };

  it("files a ruling to its row, and leaves a gate still in force to the every-journal read", () => {
    const journals = new Map([
      ["gated", { events: [ruling({ atIso: "2026-10-02T09:30:00.000Z" })], unreadableLines: [] }],
      ["expired", { events: [ruling({ atIso: AFTER, untilIso: "2026-10-02T11:00:00.000Z" })], unreadableLines: [] }],
      ["plain", { events: [plain], unreadableLines: [] }],
    ]);

    const part = rulingPart({ journals, nowIso: NOW });

    expect(part.entries.map(({ pointer, row }) => ({ pointer, row }))).toEqual([
      { pointer: `ruling:expired#${AFTER}`, row: "expired" },
      { pointer: `ruling:plain#${AFTER}`, row: "plain" },
    ]);
    expect(part.gaps).toEqual([]);
    expect(part.source).toBe("2 rulings read");
  });

  it("lists a gate placed after a backdated reading clock as a ruling, since the gate read does not hold it in force yet", () => {
    const placedLater = "2026-10-02T11:00:00.000Z";
    const journals = new Map([["later", { events: [ruling({ atIso: placedLater })], unreadableLines: [] }]]);

    const part = rulingPart({ journals, nowIso: AFTER });

    expect(part.entries.map(({ atIso, pointer, row }) => ({ atIso, pointer, row }))).toEqual([
      { atIso: placedLater, pointer: `ruling:later#${placedLater}`, row: "later" },
    ]);
  });
});
