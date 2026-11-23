/**
 * The unknown-kind split: a word a NEWER build wrote must stop disarming ownership on an older checkout,
 * while genuine damage keeps doing exactly what it always did.
 *
 * The falsifiable witness throughout is the PAIR — every case asserts both buckets, because
 * `unreadable` keeping its old meaning is half the contract and `ownershipAmbiguousLines` forgiving the
 * right lines is the other half. Asserting only the second would pass for a reader that had simply stopped
 * reporting unreadable lines at all.
 */
import { describe, expect, it } from "vitest";

import {
  ledgerLine,
  ownershipAmbiguousLines,
  parseLedger,
  type RunEvent,
  runStateOf,
} from "../../../handover/ledger.js";
import { runOwnership } from "../../../handover/runOwner.js";
import {
  skippedLinesNote,
  staleJournalHatchOpen,
  staleJournalRefusal,
  stalenessClause,
  unknownKindNames,
} from "../../../handover/staleReader.js";
import { ownershipAmbiguousLines as ambiguousLinesDirect, unknownKindOf } from "../../../handover/unknownKind.js";

const AT = "2026-09-16T19:25:00.000Z";

const STARTED: RunEvent = { atIso: AT, branch: "feat/x", docHash: "abc123", kind: "started" };

const LAUNCHED: RunEvent = {
  atIso: AT,
  host: "claude-code",
  kind: "launched",
  pid: 40542,
  sessionId: "session-one",
  worktree: "/trees/a-doc",
};

/** A journal as it would be on disk, with raw lines appended verbatim after the typed ones. */
function journal({ events, raw = [] }: { events: readonly RunEvent[]; raw?: readonly string[] }): string {
  return `${events.map((event) => ledgerLine({ event })).join("")}${raw.map((line) => `${line}\n`).join("")}`;
}

describe("parseLedger unknown-kind classification", () => {
  it("reports a future kind in BOTH buckets, naming the word and that it declares no writer", () => {
    const parsed = parseLedger({
      text: journal({
        events: [STARTED, LAUNCHED],
        raw: [`{"kind":"vetoed","atIso":"${AT}","why":"a word from next month"}`],
      }),
    });

    expect(parsed.events).toEqual([STARTED, LAUNCHED]);
    expect(parsed.unreadable).toEqual([3]);
    expect(parsed.unknownKind).toEqual([{ kind: "vetoed", line: 3, namesWriter: false }]);
  });

  it("forgives that line for OWNERSHIP while keeping it unreadable", () => {
    const parsed = parseLedger({
      text: journal({
        events: [STARTED, LAUNCHED],
        raw: [`{"kind":"vetoed","atIso":"${AT}","why":"a word from next month"}`],
      }),
    });

    expect(ownershipAmbiguousLines({ journal: parsed })).toEqual([]);
    expect(parsed.unreadable).toEqual([3]);
  });

  it("keeps a future kind that DECLARES a sessionId ownership-ambiguous", () => {
    const parsed = parseLedger({
      text: journal({
        events: [STARTED, LAUNCHED],
        raw: [`{"kind":"seized","atIso":"${AT}","sessionId":"session-two"}`],
      }),
    });

    expect(parsed.unknownKind).toEqual([{ kind: "seized", line: 3, namesWriter: true }]);
    expect(ownershipAmbiguousLines({ journal: parsed })).toEqual([3]);
  });

  it("counts a MALFORMED sessionId on a future kind as naming a writer — the field's presence is the test", () => {
    const parsed = parseLedger({
      text: journal({ events: [STARTED], raw: [`{"kind":"seized","atIso":"${AT}","sessionId":42}`] }),
    });

    expect(parsed.unknownKind).toEqual([{ kind: "seized", line: 2, namesWriter: true }]);
    expect(ownershipAmbiguousLines({ journal: parsed })).toEqual([2]);
  });

  /**
   * The counterexample a review of this change's own diff produced against the first spelling, which asked
   * `Object.hasOwn(payload, "sessionId")` at the top level only. A future kind nesting its writer read as
   * naming nobody, so a stale checkout forgave it, folded the PREVIOUS writer as current, and a session that
   * had itself launched the run would have read `mine` over a claim it could not see.
   */
  it("finds a session named at DEPTH on a future kind, not only at the top level", () => {
    const parsed = parseLedger({
      text: journal({
        events: [STARTED],
        raw: [`{"kind":"seized","atIso":"${AT}","writer":{"sessionId":"session-two","pid":9}}`],
      }),
    });

    expect(parsed.unknownKind).toEqual([{ kind: "seized", line: 2, namesWriter: true }]);
    expect(ownershipAmbiguousLines({ journal: parsed })).toEqual([2]);
  });

  it("finds one inside an ARRAY too", () => {
    const parsed = parseLedger({
      text: journal({
        events: [STARTED],
        raw: [`{"kind":"handed-over","atIso":"${AT}","chain":[{"to":{"sessionId":"s3"}}]}`],
      }),
    });

    expect(ownershipAmbiguousLines({ journal: parsed })).toEqual([2]);
  });

  it("forgives a future kind whose payload mentions no session at any depth", () => {
    const parsed = parseLedger({
      text: journal({
        events: [STARTED],
        raw: [`{"kind":"vetoed","atIso":"${AT}","detail":{"why":"scope moved","by":["a probe"]}}`],
      }),
    });

    expect(parsed.unknownKind).toEqual([{ kind: "vetoed", line: 2, namesWriter: false }]);
    expect(ownershipAmbiguousLines({ journal: parsed })).toEqual([]);
  });

  it("never classifies truncated JSON as a future kind", () => {
    const parsed = parseLedger({ text: `${ledgerLine({ event: STARTED })}{"kind":"probed","atIs` });

    expect(parsed.unknownKind).toEqual([]);
    expect(parsed.unreadable).toEqual([2]);
    expect(ownershipAmbiguousLines({ journal: parsed })).toEqual([2]);
  });

  it("never classifies a KNOWN kind that refused its own line as a future kind", () => {
    // `ruling` is a word this build has a case for; the line is refused because it carries no anchor, which
    // is this build's own field rule working rather than a gap in its vocabulary.
    const parsed = parseLedger({
      text: journal({ events: [STARTED], raw: [`{"kind":"ruling","atIso":"${AT}","ruling":"yes"}`] }),
    });

    expect(parsed.unknownKind).toEqual([]);
    expect(ownershipAmbiguousLines({ journal: parsed })).toEqual([2]);
  });

  it("keeps a `launched` with no sessionId ownership-ambiguous, the one lever pulled deliberately", () => {
    const parsed = parseLedger({
      text: journal({ events: [STARTED], raw: [`{"kind":"launched","atIso":"${AT}","pid":1}`] }),
    });

    expect(parsed.unknownKind).toEqual([]);
    expect(ownershipAmbiguousLines({ journal: parsed })).toEqual([2]);
  });

  it("is empty on a journal that decoded completely", () => {
    const parsed = parseLedger({ text: journal({ events: [STARTED, LAUNCHED] }) });

    expect(parsed.unreadable).toEqual([]);
    expect(parsed.unknownKind).toEqual([]);
    expect(ownershipAmbiguousLines({ journal: parsed })).toEqual([]);
  });

  it("forgives only the writerless lines when a journal carries both flavours", () => {
    const parsed = parseLedger({
      text: journal({
        events: [STARTED],
        raw: [
          `{"kind":"vetoed","atIso":"${AT}"}`,
          `{"kind":"seized","atIso":"${AT}","sessionId":"session-two"}`,
          `{"kind":"vetoed","atIso":"${AT}"}`,
        ],
      }),
    });

    expect(parsed.unreadable).toEqual([2, 3, 4]);
    expect(ownershipAmbiguousLines({ journal: parsed })).toEqual([3]);
  });
});

describe("the ownership fold over a forgiven line", () => {
  /**
   * The reason the split is SAFE, asserted rather than argued: the writer a stale checkout folds over a
   * journal carrying a word it cannot name is the same writer the same journal folds without that line.
   */
  it("names the same writer with and without a future kind in the file", () => {
    const withUnknown = parseLedger({
      text: journal({ events: [STARTED, LAUNCHED], raw: [`{"kind":"vetoed","atIso":"${AT}"}`] }),
    });
    const without = parseLedger({ text: journal({ events: [STARTED, LAUNCHED] }) });

    const seen = runOwnership({ events: withUnknown.events, sessionId: "session-two" });
    const clean = runOwnership({ events: without.events, sessionId: "session-two" });

    expect(seen).toEqual(clean);
    expect(seen.kind).toBe("elsewhere");
  });

  it("still derives the run's phase from the last started, which every build has always decoded", () => {
    const parsed = parseLedger({
      text: journal({ events: [STARTED, LAUNCHED], raw: [`{"kind":"vetoed","atIso":"${AT}"}`] }),
    });

    expect(runStateOf({ events: parsed.events }).phase).toBe("open");
    expect(runStateOf({ events: parsed.events }).branch).toBe("feat/x");
  });
});

describe("the refusal that names its own fix", () => {
  it("deduplicates the words it could not name, in first-seen order", () => {
    const names = unknownKindNames({
      unknownKind: [
        { kind: "ruling", line: 3, namesWriter: false },
        { kind: "closed", line: 4, namesWriter: false },
        { kind: "ruling", line: 9, namesWriter: false },
      ],
    });

    expect(names).toEqual(["ruling", "closed"]);
  });

  it("says nothing about staleness when the damage is not a vintage gap", () => {
    expect(stalenessClause({ unknownKind: [] })).toBe("");
  });

  it("names the kind and both next moves when it is", () => {
    const clause = stalenessClause({ unknownKind: [{ kind: "ruling", line: 13, namesWriter: true }] });

    expect(clause).toContain("`ruling`");
    expect(clause).toContain("predates the build that wrote them");
    expect(clause).toContain("Pull the base branch in this worktree");
    expect(clause).toContain("run the verb from the main checkout");
  });

  it("renders all four refusal lines, carrying the verb, the line numbers and the hatch", () => {
    const parsed = parseLedger({
      text: journal({ events: [STARTED], raw: [`{"kind":"seized","atIso":"${AT}","sessionId":"s2"}`] }),
    });

    const lines = staleJournalRefusal({ journal: parsed, lines: [2], verb: "handover answer" });

    expect(lines.length).toBe(4);
    expect(lines[0]).toContain("handover answer — line(s) 2 of this run's journal did not decode");
    expect(lines[0]).toContain("`seized`");
    expect(lines[1]).toContain("Legitimate exceptions may include");
    expect(lines[2]).toContain("SLOPWEAVER_ALLOW_STALE_JOURNAL_READER=1");
    expect(lines[3]).toBe(
      "Use good judgement to determine whether the owner would approve of this, then proceed or correct your approach.",
    );
  });

  it("omits the staleness clause when every undecodable line is genuine damage", () => {
    const parsed = parseLedger({ text: `${ledgerLine({ event: STARTED })}{"kind":"probed","atIs` });

    const lines = staleJournalRefusal({ journal: parsed, lines: [2], verb: "handover finish" });

    expect(lines[0]).toBe(
      "slopweaver handover <ask|answer|abandon|finish|amend|claim|release|park> blocked because one or " +
        "more lines of this run's journal did not decode, so the session that holds the run cannot be proven — " +
        "and a write over a journal that may already carry a claim, a release or an ending nobody here could " +
        "read is a write over a guess (handover finish — line(s) 2 of this run's journal did not decode).",
    );
  });

  /**
   * Found end to end on the first real run of this refusal: a journal carrying a FORGIVEN unknown kind
   * alongside one blocking line named both words, sending the reader after a line the guard had released.
   */
  it("names only the words on the lines that actually made this refusal fire", () => {
    const parsed = parseLedger({
      text: journal({
        events: [STARTED],
        raw: [`{"kind":"vetoed","atIso":"${AT}"}`, `{"kind":"seized","atIso":"${AT}","sessionId":"s2"}`],
      }),
    });

    const lines = staleJournalRefusal({ journal: parsed, lines: [3], verb: "handover amend" });

    expect(lines[0]).toContain("`seized`");
    expect(lines[0]).not.toContain("`vetoed`");
    // The witness the `not.toContain` needs: the input really does carry the word it calls absent.
    expect(unknownKindNames({ unknownKind: parsed.unknownKind })).toEqual(["vetoed", "seized"]);
  });
});

describe("skippedLinesNote — what a live ruling recorded beside unread lines says about them", () => {
  it("says nothing on a clean journal", () => {
    expect(skippedLinesNote({ skipped: { unknownKind: [], unreadable: [] } })).toBe(undefined);
  });

  // The shape: line 6 a `parked` event this checkout's decoder predated.
  it("names the count, the line and the word this checkout predates, and says to pull", () => {
    const note = skippedLinesNote({
      skipped: { unknownKind: [{ kind: "parked", line: 6, namesWriter: true }], unreadable: [6] },
    });

    expect(note).toBe(
      "1 line(s) of this journal (6) did not decode and were skipped; the duplicate check ran over the rest" +
        " — the word(s) `parked` are ones THIS checkout's decoder has no case for, which means it predates the " +
        "build that wrote them rather than that the file is damaged. Pull the base branch in this worktree, or " +
        "run the verb from the main checkout",
    );
  });

  it("calls a line that is no unknown word damage in the file, never a reason to pull", () => {
    const note = skippedLinesNote({ skipped: { unknownKind: [], unreadable: [2, 9] } });

    expect(note).toBe(
      "2 line(s) of this journal (2, 9) did not decode and were skipped; the duplicate check ran over the rest" +
        " — no line is a word this checkout lacks, so the file itself is damaged there",
    );
  });
});

describe("staleJournalHatchOpen", () => {
  it("opens on the ambient variable alone", () => {
    expect(staleJournalHatchOpen({ env: "1", flag: false })).toBe(true);
  });

  it("opens on the caller's own flag alone", () => {
    expect(staleJournalHatchOpen({ env: undefined, flag: true })).toBe(true);
  });

  it("stays shut on an unset variable and no flag", () => {
    expect(staleJournalHatchOpen({ env: undefined, flag: false })).toBe(false);
  });

  it("stays shut on any value but 1 — an exported empty string is not a permission", () => {
    expect(staleJournalHatchOpen({ env: "", flag: false })).toBe(false);
    expect(staleJournalHatchOpen({ env: "0", flag: false })).toBe(false);
    expect(staleJournalHatchOpen({ env: "true", flag: false })).toBe(false);
  });
});

describe("unknownKindOf, read directly", () => {
  it("answers undefined for a line that is not JSON", () => {
    expect(unknownKindOf({ line: `{"kind":"vetoed","atIs`, lineNumber: 4 })).toBe(undefined);
  });

  it("answers undefined for JSON that is not a record, an array included", () => {
    expect(unknownKindOf({ line: `"vetoed"`, lineNumber: 1 })).toBe(undefined);
    expect(unknownKindOf({ line: `[{"kind":"vetoed","atIso":"${AT}"}]`, lineNumber: 1 })).toBe(undefined);
  });

  it("answers undefined when kind or atIso is missing or not a string, and classifies the complete line beside them", () => {
    expect(unknownKindOf({ line: `{"atIso":"${AT}"}`, lineNumber: 2 })).toBe(undefined);
    expect(unknownKindOf({ line: `{"kind":7,"atIso":"${AT}"}`, lineNumber: 2 })).toBe(undefined);
    expect(unknownKindOf({ line: `{"kind":"vetoed"}`, lineNumber: 2 })).toBe(undefined);
    expect(unknownKindOf({ line: `{"kind":"vetoed","atIso":7}`, lineNumber: 2 })).toBe(undefined);
    expect(unknownKindOf({ line: `{"kind":"vetoed","atIso":"${AT}"}`, lineNumber: 2 })).toEqual({
      kind: "vetoed",
      line: 2,
      namesWriter: false,
    });
  });

  it("answers undefined for a word this build has a case for, even when its fields are wrong", () => {
    expect(unknownKindOf({ line: `{"kind":"ruling","atIso":"${AT}","ruling":"yes"}`, lineNumber: 5 })).toBe(undefined);
  });

  it("does not treat an inherited property name as a known kind", () => {
    expect(unknownKindOf({ line: `{"kind":"toString","atIso":"${AT}"}`, lineNumber: 6 })).toEqual({
      kind: "toString",
      line: 6,
      namesWriter: false,
    });
  });

  it("flags a session named by a nested key, inside an array, or only inside a string value", () => {
    expect(
      unknownKindOf({ line: `{"kind":"seized","atIso":"${AT}","writer":{"SessionId":"s2"}}`, lineNumber: 7 }),
    ).toEqual({ kind: "seized", line: 7, namesWriter: true });
    expect(
      unknownKindOf({ line: `{"kind":"seized","atIso":"${AT}","chain":[1,["a SESSION ended"]]}`, lineNumber: 8 }),
    ).toEqual({ kind: "seized", line: 8, namesWriter: true });
    expect(
      unknownKindOf({ line: `{"kind":"seized","atIso":"${AT}","why":"the session moved"}`, lineNumber: 9 }),
    ).toEqual({ kind: "seized", line: 9, namesWriter: true });
  });

  it("does not flag a payload whose nested keys and strings never mention a session", () => {
    expect(
      unknownKindOf({
        line: `{"kind":"vetoed","atIso":"${AT}","detail":{"why":"sess ion","by":[{"pid":9},"a probe",null,3]}}`,
        lineNumber: 10,
      }),
    ).toEqual({ kind: "vetoed", line: 10, namesWriter: false });
  });
});

describe("ownershipAmbiguousLines, read directly", () => {
  it("drops only the writerless unknown-kind lines, keeping file order", () => {
    expect(
      ambiguousLinesDirect({
        journal: {
          unknownKind: [
            { kind: "vetoed", line: 2, namesWriter: false },
            { kind: "seized", line: 3, namesWriter: true },
            { kind: "vetoed", line: 4, namesWriter: false },
          ],
          unreadable: [2, 3, 4, 7],
        },
      }),
    ).toEqual([3, 7]);
  });

  it("forgives nothing that is not itself unreadable", () => {
    expect(
      ambiguousLinesDirect({
        journal: { unknownKind: [{ kind: "vetoed", line: 9, namesWriter: false }], unreadable: [1, 5] },
      }),
    ).toEqual([1, 5]);
  });

  it("is empty for an empty journal", () => {
    expect(ambiguousLinesDirect({ journal: { unknownKind: [], unreadable: [] } })).toEqual([]);
  });
});
