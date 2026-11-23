/** Every source of the owner's guidance, ranked, each entry cited, an empty source told apart from an unread one. */
import { describe, expect, it } from "vitest";

import { unwrap } from "#lib/result.js";

import { buildAutonomyClassSteer } from "../../../autonomy/classSteer.js";
import type { AutonomyClassSteerRow } from "../../../autonomy/types.js";
import type { StandingGate } from "../../../handover/rulingGate.js";
import { parseMemoryLeaf } from "../../../memory/corpus.js";
import {
  askEntries,
  classSteerEntries,
  gateEntries,
  generalRulingState,
  guidanceLines,
  memoryState,
  profileState,
} from "../../../profile/guidance.js";
import {
  doctrineState,
  GUIDANCE_SOURCES,
  type GuidanceSourceState,
  guidanceWire,
} from "../../../profile/guidanceWire.js";
import type { StandingAsk } from "../../../profile/standingAsks.js";

/** A synthetic AGENTS.md: two rules under the heading, one bold numbered line outside it. */
const AGENTS = [
  "# Working in acme",
  "",
  "**9 · Not a rule.** It sits above the heading.",
  "",
  "## Operating doctrine",
  "",
  "**1 · Land your own work.** Undraft it once CI is green.",
  "",
  "**4 · The command surface is SKILLS**, one per verb.",
  "Each under 200 lines.",
  "",
  "## Design constraints",
  "",
  "**7 · Not a rule either.** It sits below the section.",
].join("\n");

/** One class steer, built by the factory the real recorder calls. */
function classSteer({ classId, steer }: { classId: string; steer: string }): AutonomyClassSteerRow {
  const row = buildAutonomyClassSteer({
    anchor: `talk:${classId}`,
    bySession: "acme-session",
    classId,
    kinds: "github.merge",
    steer,
    steeredIso: "2026-11-01T00:00:00.000Z",
  });
  return unwrap(row);
}

/** A memory leaf of one declared type, parsed off its text as the corpus reader parses it. */
function leaf({ file, type, description }: { file: string; type: string; description: string }) {
  const text = `---\nname: ${file.replace(".md", "")}\ndescription: ${description}\nmetadata:\n  type: ${type}\n---\n\nBody.\n`;
  return parseMemoryLeaf({ file, mtimeMs: 0, text });
}

/** A read state's entries, failing the test when it did not read. */
function entriesOf({ state }: { state: GuidanceSourceState }) {
  expect(state.kind).toBe("read");
  return (state as Extract<GuidanceSourceState, { kind: "read" }>).entries;
}

describe("doctrineState", () => {
  it("reads only the numbered rules under the operating-doctrine heading, each cited by number with its paragraph", () => {
    expect(entriesOf({ state: doctrineState({ text: AGENTS }) })).toEqual([
      {
        body: "**1 · Land your own work.** Undraft it once CI is green.",
        citation: "AGENTS.md rule 1",
        kinds: [],
        subjectPrefix: null,
        text: "Land your own work",
      },
      {
        body: "**4 · The command surface is SKILLS**, one per verb. Each under 200 lines.",
        citation: "AGENTS.md rule 4",
        kinds: [],
        subjectPrefix: null,
        text: "The command surface is SKILLS",
      },
    ]);
  });

  it("calls a file with no doctrine heading unreadable, never empty", () => {
    expect(doctrineState({ text: "# acme\n\n**1 · A rule.**" })).toEqual({
      kind: "unreadable",
      why: 'AGENTS.md has no "## Operating doctrine" heading',
    });
  });
});

describe("classSteerEntries", () => {
  it("keeps the latest words per class, in the order each class was last recorded", () => {
    const records = [
      classSteer({ classId: "merges", steer: "land them" }),
      classSteer({ classId: "bumps", steer: "press every bump" }),
      classSteer({ classId: "merges", steer: "land them once green" }),
    ];
    expect(classSteerEntries({ records }).map((entry) => [entry.citation, entry.text])).toEqual([
      ["talk:bumps", "bumps: press every bump"],
      ["talk:merges", "merges: land them once green"],
    ]);
  });

  it("carries the exact kinds a steer settles, and no scope when it was given none", () => {
    expect(classSteerEntries({ records: [classSteer({ classId: "merges", steer: "land them" })] })).toEqual([
      {
        body: "merges: land them",
        citation: "talk:merges",
        kinds: ["github.merge"],
        subjectPrefix: null,
        text: "merges: land them",
      },
    ]);
  });

  it("lists nothing for a ledger with no class steers", () => {
    expect(classSteerEntries({ records: [] })).toEqual([]);
  });
});

describe("generalRulingState", () => {
  it("reads no file as an empty source", () => {
    expect(generalRulingState({ rulings: { kind: "absent" } })).toEqual({ entries: [], gaps: [], kind: "read" });
  });

  it("carries an unreadable file's reason", () => {
    expect(generalRulingState({ rulings: { kind: "unreadable", why: "not valid JSON" } })).toEqual({
      kind: "unreadable",
      why: "not valid JSON",
    });
  });

  it("cites each ruling at its anchor", () => {
    const rulings = { kind: "list" as const, rulings: [{ act: "merge on green", anchor: "talk:abc", kind: "merge" }] };
    expect(entriesOf({ state: generalRulingState({ rulings }) })).toEqual([
      { body: "merge: merge on green", citation: "talk:abc", kinds: [], subjectPrefix: null, text: "merge on green" },
    ]);
  });
});

describe("gateEntries", () => {
  it("names each gate's words and the verbs it refuses, cited at its anchor", () => {
    const gate: StandingGate = {
      anchor: "talk:gate",
      id: "acme-row#2026-11-01T00:00:00.000Z",
      placedIso: "2026-11-01T00:00:00.000Z",
      slug: "acme-row",
      subjects: [],
      verbs: [
        { noun: "slack", verb: "send" },
        { noun: "linear", verb: "write" },
      ],
      words: "hold every post",
    };
    expect(gateEntries({ gates: [gate] }).map((entry) => [entry.citation, entry.text])).toEqual([
      ["talk:gate", "hold every post (refuses slack send, linear write)"],
    ]);
  });
});

describe("askEntries", () => {
  it("quotes each ask's words at the anchor they were read off", () => {
    const ask: StandingAsk = {
      covers: ["findings"],
      id: "acme-findings",
      quote: {
        anchor: "talk:ask",
        atIso: "2026-11-01T00:00:00.000Z",
        cut: "none",
        where: "console-voice",
        words: "find it",
      },
      recordedAtIso: "2026-11-01T00:00:00.000Z",
    };
    expect(askEntries({ asks: [ask] }).map((entry) => [entry.citation, entry.text])).toEqual([["talk:ask", "find it"]]);
  });
});

describe("memoryState", () => {
  it("lists feedback memories only, each cited at its project and file", () => {
    const state = memoryState({
      corpora: [
        {
          folderChangedMs: 0,
          kind: "read",
          leaves: [
            leaf({ description: "never lead with the PR", file: "lead.md", type: "feedback" }),
            leaf({ description: "the owner's role", file: "role.md", type: "user" }),
          ],
          project: "acme",
          statusChangedMs: new Map(),
        },
      ],
    });
    expect(state).toEqual({
      entries: [
        {
          body: "lead: never lead with the PR",
          citation: "memory:acme/lead.md",
          kinds: [],
          subjectPrefix: null,
          text: "lead: never lead with the PR",
        },
      ],
      gaps: [],
      kind: "read",
    });
  });

  it("keeps a corpus that would not read as a gap beside the ones that did", () => {
    const state = memoryState({ corpora: [{ kind: "unreadable", project: "acme", why: "EACCES" }] });
    expect(state).toEqual({ entries: [], gaps: ["acme: EACCES"], kind: "read" });
  });

  it("calls a projects folder that would not list unreadable", () => {
    expect(memoryState({ corpora: { why: "ENOENT" } })).toEqual({ kind: "unreadable", why: "ENOENT" });
  });
});

describe("profileState", () => {
  it("reads no profile as an empty source", () => {
    expect(profileState({ profile: { kind: "absent" } })).toEqual({ entries: [], gaps: [], kind: "read" });
  });

  it("calls a store that did not answer unreadable", () => {
    expect(profileState({ profile: { kind: "unavailable", why: "timed out" } })).toEqual({
      kind: "unreadable",
      why: "timed out",
    });
  });

  it("cites each statement at the profile's revision and when it was observed", () => {
    const profile = {
      kind: "read" as const,
      revision: 3,
      statements: [{ observedAt: "2026-11-01", text: "no riddles" }],
      updatedAtIso: "2026-11-01T00:00:00.000Z",
    };
    expect(entriesOf({ state: profileState({ profile }) }).map((entry) => [entry.citation, entry.text])).toEqual([
      ["profile revision 3, observed 2026-11-01", "no riddles"],
    ]);
  });
});

describe("guidanceWire and guidanceLines", () => {
  const empty: GuidanceSourceState = { entries: [], gaps: [], kind: "read" };
  const wire = guidanceWire({
    readAtIso: "2026-11-13T00:00:00.000Z",
    states: {
      "class-steers": empty,
      doctrine: doctrineState({ text: AGENTS }),
      "general-rulings": empty,
      memories: { entries: [], gaps: ["acme: EACCES"], kind: "read" },
      "owner-profile": { kind: "unreadable", why: "timed out" },
      "ruling-gates": empty,
      "standing-asks": empty,
    },
  });

  it("lists every source in rank order, doctrine first", () => {
    expect(GUIDANCE_SOURCES.length).toBeGreaterThan(0);
    expect(wire.sources.map((source) => `${source.level}/${source.id}`)).toEqual([
      "doctrine/doctrine",
      "standing-rules/class-steers",
      "rulings/general-rulings",
      "rulings/ruling-gates",
      "rulings/standing-asks",
      "rulings/memories",
      "rulings/owner-profile",
    ]);
  });

  it("names an empty source as empty, an unread one with its reason, and one with an unread part NOT READ", () => {
    expect(guidanceLines({ wire })).toEqual([
      "Doctrine (AGENTS.md): 2",
      "    Land your own work  [AGENTS.md rule 1]",
      "    The command surface is SKILLS  [AGENTS.md rule 4]",
      "Standing rules (class steers): empty",
      "General rulings: empty",
      "Ruling gates in force: empty",
      "Standing asks: empty",
      "Feedback memories: NOT READ (1)",
      "    not read: acme: EACCES",
      "Owner profile: NOT READ — timed out",
    ]);
  });

  it("heads a source with entries AND an unread part by both, never a bare count", () => {
    const mixed = guidanceWire({
      readAtIso: "2026-11-13T00:00:00.000Z",
      states: {
        "class-steers": empty,
        doctrine: empty,
        "general-rulings": empty,
        memories: memoryState({
          corpora: [
            { kind: "unreadable", project: "acme-a", why: "EACCES" },
            { kind: "unreadable", project: "acme-b", why: "EACCES" },
          ],
        }),
        "owner-profile": empty,
        "ruling-gates": {
          entries: [
            {
              body: "stop the acme digest",
              citation: "talk:acme-gate",
              kinds: [],
              subjectPrefix: null,
              text: "stop the acme digest",
            },
          ],
          gaps: ["acme-row.jsonl: EACCES"],
          kind: "read",
        },
        "standing-asks": empty,
      },
    });

    const lines = guidanceLines({ wire: mixed });

    expect(lines).toContain("Ruling gates in force: 1, 1 NOT READ");
    expect(lines).toContain("Feedback memories: NOT READ (2)");
    expect(lines).not.toContain("Ruling gates in force: 1");
  });
});
