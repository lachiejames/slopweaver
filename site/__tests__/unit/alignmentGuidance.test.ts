/** The Alignment page's guidance fold: the reader refuses a partial payload, and every source is counted above the fold. */
import { describe, expect, it } from "vitest";

import { readGuidance } from "../../components/live/readGuidance";
import {
  GUIDANCE_LEVEL_HEADINGS,
  GUIDANCE_SOURCE_IDS,
  type GuidanceSourceView,
  type GuidanceView,
  guidanceByLevel,
  guidanceCountOf,
  guidanceItemsOf,
} from "../../lib/alignmentGuidance";

/** A ruling-gates source whose only journal, holding a live gate, would not read. */
const GATE_JOURNAL_UNREAD: GuidanceSourceView = {
  id: "ruling-gates",
  label: "Ruling gates in force",
  level: "rulings",
  state: { entries: [], gaps: ["acme-row.jsonl: EACCES: permission denied"], kind: "read" },
};

/** A memories source where every corpus would not read. */
const EVERY_CORPUS_UNREAD: GuidanceSourceView = {
  id: "memories",
  label: "Feedback memories",
  level: "rulings",
  state: { entries: [], gaps: ["acme-a: EACCES", "acme-b: EACCES"], kind: "read" },
};

/** A source that read whole and holds nothing. */
const TRULY_EMPTY: GuidanceSourceView = {
  id: "standing-asks",
  label: "Standing asks",
  level: "rulings",
  state: { entries: [], gaps: [], kind: "read" },
};

/** An empty source that read. */
function emptySource({ id, label, level }: { id: string; label: string; level: string }) {
  return { id, label, level, state: { entries: [], gaps: [], kind: "read" } };
}

/** A wire as `profile guidance --json` prints it, for the synthetic organisation: every source, three of them empty. */
const WIRE = {
  readAtIso: "2026-11-13T00:00:00.000Z",
  sources: [
    {
      id: "doctrine",
      label: "Doctrine (AGENTS.md)",
      level: "doctrine",
      state: {
        entries: [
          {
            body: "**3 · One door.** Every read.",
            citation: "AGENTS.md rule 3",
            kinds: [],
            subjectPrefix: null,
            text: "One door",
          },
        ],
        gaps: [],
        kind: "read",
      },
    },
    emptySource({ id: "class-steers", label: "Standing rules (class steers)", level: "standing-rules" }),
    emptySource({ id: "general-rulings", label: "General rulings", level: "rulings" }),
    emptySource({ id: "ruling-gates", label: "Ruling gates in force", level: "rulings" }),
    emptySource({ id: "standing-asks", label: "Standing asks", level: "rulings" }),
    {
      id: "memories",
      label: "Feedback memories",
      level: "rulings",
      state: {
        entries: [
          {
            body: "lead: never lead with the PR",
            citation: "memory:acme/lead.md",
            kinds: [],
            subjectPrefix: null,
            text: "lead: never lead with the PR",
          },
        ],
        gaps: ["acme-other: EACCES"],
        kind: "read",
      },
    },
    {
      id: "owner-profile",
      label: "Owner profile",
      level: "rulings",
      state: { kind: "unreadable", why: "the store did not answer within 5000ms" },
    },
  ],
};

/** The wire with its doctrine source replaced, every other source kept, so a refusal is about that one change. */
function withDoctrine({ doctrine }: { doctrine: Record<string, unknown> }) {
  return { ...WIRE, sources: [{ ...WIRE.sources[0], ...doctrine }, ...WIRE.sources.slice(1)] };
}

/** The wire read, failing the test when it does not. */
function view(): GuidanceView {
  const read = readGuidance(WIRE);
  expect(read).toBeDefined();
  return read!;
}

describe("readGuidance", () => {
  it("reads every source in the wire's order, states intact", () => {
    expect(view().sources.map((source) => [source.id, source.level, source.state.kind])).toEqual([
      ["doctrine", "doctrine", "read"],
      ["class-steers", "standing-rules", "read"],
      ["general-rulings", "rulings", "read"],
      ["ruling-gates", "rulings", "read"],
      ["standing-asks", "rulings", "read"],
      ["memories", "rulings", "read"],
      ["owner-profile", "rulings", "unreadable"],
    ]);
  });

  it("refuses a wire missing a source, since a source left out would never be named as not read", () => {
    expect(GUIDANCE_SOURCE_IDS.length).toBeGreaterThan(0);
    expect(readGuidance({ ...WIRE, sources: WIRE.sources.slice(1) })).toBe(undefined);
    expect(readGuidance({ ...WIRE, sources: [] })).toBe(undefined);
  });

  it("refuses a wire carrying one source twice in place of another", () => {
    expect(readGuidance({ ...WIRE, sources: [WIRE.sources[0], ...WIRE.sources.slice(0, -1)] })).toBe(undefined);
  });

  it("refuses the whole reading when one entry lacks its citation", () => {
    const state = {
      entries: [{ body: "b", kinds: [], subjectPrefix: null, text: "One door" }],
      gaps: [],
      kind: "read",
    };
    expect(readGuidance(withDoctrine({ doctrine: { state } }))).toBe(undefined);
  });

  it("refuses an entry whose kinds do not read, since a dropped kind would hide a rule that settles a card", () => {
    const entry = { body: "b", citation: "talk:acme", kinds: "github.merge", subjectPrefix: null, text: "t" };
    expect(readGuidance(withDoctrine({ doctrine: { state: { entries: [entry], gaps: [], kind: "read" } } }))).toBe(
      undefined,
    );
  });

  it("reads a scoped entry's subject prefix", () => {
    const entry = {
      body: "b",
      citation: "talk:acme",
      kinds: ["enqueue"],
      subjectPrefix: "https://acme.test/",
      text: "t",
    };
    const read = readGuidance(withDoctrine({ doctrine: { state: { entries: [entry], gaps: [], kind: "read" } } }));
    const state = read!.sources[0].state;
    expect(state.kind).toBe("read");
    expect((state as Extract<typeof state, { kind: "read" }>).entries[0].subjectPrefix).toBe("https://acme.test/");
  });

  it("refuses a rank it does not know", () => {
    expect(readGuidance(withDoctrine({ doctrine: { level: "folklore" } }))).toBe(undefined);
  });

  it("refuses a payload that is not an object", () => {
    expect(readGuidance("[]")).toBe(undefined);
  });
});

describe("guidanceCountOf", () => {
  it("counts a source with entries, names an empty one empty and an unread one not read", () => {
    expect(view().sources.map((source) => guidanceCountOf({ source }))).toEqual([
      "Doctrine (AGENTS.md) 1",
      "Standing rules (class steers) empty",
      "General rulings empty",
      "Ruling gates in force empty",
      "Standing asks empty",
      "Feedback memories 1, 1 not read",
      "Owner profile not read",
    ]);
  });

  it("counts a source whose only part would not read as not read, never empty", () => {
    expect(guidanceCountOf({ source: GATE_JOURNAL_UNREAD })).toBe("Ruling gates in force not read (1)");
    expect(guidanceCountOf({ source: EVERY_CORPUS_UNREAD })).toBe("Feedback memories not read (2)");
    expect(guidanceCountOf({ source: TRULY_EMPTY })).toBe("Standing asks empty");
  });
});

describe("guidanceItemsOf", () => {
  it("draws no empty line under a source whose only part would not read, only its not-read lines", () => {
    expect(guidanceItemsOf({ source: GATE_JOURNAL_UNREAD })).toEqual([
      { kind: "not-read", why: "acme-row.jsonl: EACCES: permission denied" },
    ]);
    expect(guidanceItemsOf({ source: EVERY_CORPUS_UNREAD })).toEqual([
      { kind: "not-read", why: "acme-a: EACCES" },
      { kind: "not-read", why: "acme-b: EACCES" },
    ]);
  });

  it("draws empty alone only for a source that read whole and holds nothing", () => {
    expect(guidanceItemsOf({ source: TRULY_EMPTY })).toEqual([{ kind: "empty" }]);
  });

  it("draws entries then not-read lines for a source holding both, and the reason for an unread source", () => {
    const memories = view().sources.find((source) => source.id === "memories")!;
    const profile = view().sources.find((source) => source.id === "owner-profile")!;
    expect(guidanceItemsOf({ source: memories })).toEqual([
      { citation: "memory:acme/lead.md", kind: "entry", text: "lead: never lead with the PR" },
      { kind: "not-read", why: "acme-other: EACCES" },
    ]);
    expect(guidanceItemsOf({ source: profile })).toEqual([
      { kind: "not-read", why: "the store did not answer within 5000ms" },
    ]);
  });
});

describe("guidanceByLevel", () => {
  it("groups the sources under each rank's heading, doctrine first", () => {
    expect(GUIDANCE_LEVEL_HEADINGS.length).toBeGreaterThan(0);
    expect(
      guidanceByLevel({ view: view() }).map((group) => [group.heading, group.sources.map((source) => source.id)]),
    ).toEqual([
      ["Doctrine: binds every session", ["doctrine"]],
      ["Standing rules: settle a whole class of act", ["class-steers"]],
      [
        "Rulings, asks and memory: narrower than a standing rule",
        ["general-rulings", "ruling-gates", "standing-asks", "memories", "owner-profile"],
      ],
    ]);
  });

  it("leaves out a rank no source sits in", () => {
    const only = { readAtIso: "2026-11-13T00:00:00.000Z", sources: view().sources.slice(0, 1) };
    expect(guidanceByLevel({ view: only }).map((group) => group.heading)).toEqual(["Doctrine: binds every session"]);
  });
});
