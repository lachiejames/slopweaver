/**
 * The audit's classification, over hand-built input — every verdict a manifest entry can reach, and every way
 * the input can stop a count being a count.
 *
 * The property that matters most is asserted from both sides: an entry is `decided` only on a ruling that
 * NAMES its source with the manifest's exact words and anchor, and a ruling that merely says the same words is
 * not one. Each negative test changes one thing from the decided fixture, so it fails for that reason alone.
 */
import { describe, expect, it } from "vitest";

import { type HandoverDoc, parseHandoverDoc } from "../../../handover/doc.js";
import type { RulingEvent, RunEvent } from "../../../handover/ledger.js";
import { auditRulings, rulingAuditExitCode } from "../../../handover/rulingAudit.js";
import { RulingAuditProblems } from "../../../handover/rulingAuditErrors.js";
import type { RulingAuditInput, RulingAuditInputRow } from "../../../handover/rulingAuditTypes.js";
import type { RulingManifestEntry } from "../../../handover/rulingManifest.js";

const SOURCE = "2026-09-04T12:38:57.414Z";
const LATER = "2026-09-10T09:00:00.000Z";
const TODAY = "2026-09-13T02:00:00.000Z";
const WORDS = "OWNER RULED: ship it";
const ANCHOR = "https://example.invalid/p9";

/** A row document, parsed by the real parser. */
function doc({
  slug = "a-row",
  lines = [],
  path = `/board/${slug}.md`,
}: {
  slug?: string;
  lines?: readonly string[];
  path?: string;
}): HandoverDoc {
  return parseHandoverDoc({
    path: path,
    text: ["---", `slug: ${slug}`, "summary: a row", ...lines, "---", ""].join("\n"),
  });
}

/**
 * A row carrying an AUTHORED ruling, with the whole front matter the parser requires for one: the pair was
 * only ever written onto a finding row, and a row missing any of those fields is a parse defect the audit
 * now reports.
 */
function ruledDoc({
  words = "yes",
  anchor = ANCHOR,
  path,
}: {
  words?: string;
  anchor?: string;
  path?: string;
} = {}): HandoverDoc {
  return doc({
    lines: [
      "kind: ask",
      "origin: finding",
      `askedIso: ${SOURCE}`,
      "observedBy: session-1",
      "evidence: owner/repo#1",
      `ruling: "${words}"`,
      `rulingAnchor: ${anchor}`,
    ],
    ...(path === undefined ? {} : { path }),
  });
}

const answer: RunEvent = { answer: WORDS, atIso: SOURCE, kind: "answered" };

/** The reconstruction the backfill writes for {@link answer}. */
function backfill(over: Partial<RulingEvent> = {}): RulingEvent {
  return {
    anchor: ANCHOR,
    atIso: TODAY,
    backfilledFrom: SOURCE,
    decidedIso: SOURCE,
    kind: "ruling",
    ruling: WORDS,
    ...over,
  };
}

/** A ruling recorded as the owner gave it. */
function live({ at, words = "actually, production" }: { at: string; words?: string }): RulingEvent {
  return { anchor: "https://example.invalid/live", atIso: at, decidedIso: at, kind: "ruling", ruling: words };
}

/** One acquired row. */
function row({
  slug = "a-row",
  docs = [doc({ slug })],
  events = [answer],
  unreadableLines = [],
}: {
  slug?: string;
  docs?: readonly HandoverDoc[];
  events?: readonly RunEvent[];
  unreadableLines?: readonly number[];
}): RulingAuditInputRow {
  return {
    docs: docs.map((each) => ({ doc: each, location: "active", path: each.path })),
    journal: { events, kind: "read", unreadableLines },
    journalPath: `/runs/${slug}.jsonl`,
    slug,
  };
}

const ENTRY: RulingManifestEntry = { anchor: ANCHOR, slug: "a-row", sourceAtIso: SOURCE, words: WORDS };

/** The whole input around some rows. */
function input({
  rows,
  entries,
  problems = [],
}: {
  rows: readonly RulingAuditInputRow[];
  entries?: readonly RulingManifestEntry[];
  problems?: RulingAuditInput["problems"];
}): RulingAuditInput {
  return {
    handoverDir: "/board",
    manifest: entries === undefined ? null : { entries, schemaVersion: 1 },
    manifestPath: entries === undefined ? null : "/m.json",
    problems,
    rows,
    runsDir: "/runs",
  };
}

describe("auditRulings — the rows", () => {
  it("reports an empty register as complete, with the candidate notice rather than a silent zero", () => {
    const report = auditRulings({ input: input({ rows: [] }) });
    expect(report.complete).toBe(true);
    expect(report.counts).toEqual({
      candidates: 0,
      confirmedUnrepresented: 0,
      decided: 0,
      effective: 0,
      historical: 0,
      incompleteInputs: 0,
      manifestEntries: 0,
      manifestIncomplete: 0,
      rows: 0,
      unclassifiedAnswers: 0,
    });
    expect(report.candidateNotice.enabled).toBe(false);
    expect(rulingAuditExitCode({ report })).toBe(0);
  });

  it("reads the authored pair when the register is silent, and counts the answer as unclassified", () => {
    const authored = ruledDoc();
    const report = auditRulings({ input: input({ rows: [row({ docs: [authored] })] }) });
    expect(report.rows[0]!.effective).toEqual({ anchor: ANCHOR, from: "authored", words: "yes" });
    expect(report.rows[0]!.history).toEqual([]);
    expect(report.rows[0]!.answers).toEqual([{ answer: WORDS, sourceAtIso: SOURCE, state: "unclassified-answer" }]);
  });

  it("keeps every displaced ruling as history — the older reconstruction and the authored pair", () => {
    const authored = ruledDoc();
    const newer = live({ at: LATER });
    const report = auditRulings({
      input: input({ rows: [row({ docs: [authored], events: [answer, newer, backfill()] })] }),
    });
    const audited = report.rows[0]!;
    expect(audited.effective).toEqual({ decidedIso: LATER, event: newer, from: "register" });
    expect(audited.history).toEqual([
      { decidedIso: SOURCE, event: backfill(), from: "register" },
      { anchor: ANCHOR, from: "authored", words: "yes" },
    ]);
    expect(audited.answers).toEqual([{ answer: WORDS, sourceAtIso: SOURCE, state: "represented" }]);
    expect(report.counts.historical).toBe(2);
  });

  it("dates a ruling from a journal older than decidedIso at the instant its line was recorded", () => {
    const legacy: RulingEvent = { anchor: ANCHOR, atIso: LATER, kind: "ruling", ruling: WORDS };
    const newer = live({ at: TODAY });
    const journalOnly = auditRulings({ input: input({ rows: [row({ docs: [], events: [answer, legacy] })] }) });
    expect(journalOnly.rows[0]!.effective).toEqual({ decidedIso: LATER, event: legacy, from: "register" });
    const superseded = auditRulings({ input: input({ rows: [row({ docs: [], events: [answer, legacy, newer] })] }) });
    expect(superseded.rows[0]!.effective).toEqual({ decidedIso: TODAY, event: newer, from: "register" });
    expect(superseded.rows[0]!.history).toEqual([{ decidedIso: LATER, event: legacy, from: "register" }]);
  });

  it("names a duplicate slug once, and chooses no winning document", () => {
    const report = auditRulings({
      input: input({ rows: [row({ docs: [doc({ path: "/board/a.md" }), doc({ path: "/board/archive/a.md" })] })] }),
    });
    expect(report.problems).toEqual([
      RulingAuditProblems.duplicateSlug({ paths: ["/board/a.md", "/board/archive/a.md"], slug: "a-row" }),
    ]);
    expect(report.complete).toBe(false);
  });

  it("reads what DID decode on a journal with a broken line, and marks the input incomplete", () => {
    const report = auditRulings({
      input: input({ rows: [row({ events: [answer, backfill()], unreadableLines: [3] })] }),
    });
    expect(report.rows[0]!.effective).toEqual({ decidedIso: SOURCE, event: backfill(), from: "register" });
    expect(report.problems).toEqual([
      RulingAuditProblems.journalLineUnreadable({ lines: [3], path: "/runs/a-row.jsonl", slug: "a-row" }),
    ]);
    expect(rulingAuditExitCode({ report })).toBe(1);
  });

  it("claims no CURRENT ruling for a row whose journal could not be opened", () => {
    const failed: RulingAuditInputRow = { ...row({}), journal: { cause: "EACCES", kind: "failed" } };
    const report = auditRulings({ input: input({ rows: [failed] }) });
    expect(report.rows[0]!.effective).toBeNull();
    expect(report.problems).toEqual([
      RulingAuditProblems.journalUnreadable({ cause: "EACCES", path: "/runs/a-row.jsonl", slug: "a-row" }),
    ]);
  });

  /**
   * A review finding: the row document was read perfectly well, so the owner's authored ruling is evidence this
   * audit holds. It is history rather than the current ruling, because the journal that could supersede it
   * is exactly what could not be read.
   */
  it("keeps the authored ruling of a row whose journal could not be opened, as history", () => {
    const authored = ruledDoc();
    const failed: RulingAuditInputRow = {
      ...row({ docs: [authored] }),
      journal: { cause: "EACCES", kind: "failed" },
    };
    const report = auditRulings({ input: input({ rows: [failed] }) });
    expect(report.rows[0]!.effective).toBeNull();
    expect(report.rows[0]!.history).toEqual([{ anchor: ANCHOR, from: "authored", words: "yes" }]);
  });

  it("carries a problem from acquisition through to an incomplete report", () => {
    const unreadable = RulingAuditProblems.docUnreadable({ path: "/board/broken.md" });
    const report = auditRulings({ input: input({ problems: [unreadable], rows: [] }) });
    expect(report.problems).toEqual([unreadable]);
    expect(report.complete).toBe(false);
    expect(rulingAuditExitCode({ report })).toBe(1);
  });
});

describe("auditRulings — a manifest entry", () => {
  it("is decided on the exact reconstruction, placed as the ruling the row reads", () => {
    const report = auditRulings({ input: input({ entries: [ENTRY], rows: [row({ events: [answer, backfill()] })] }) });
    expect(report.manifest).toEqual([
      {
        entryIndex: 0,
        placement: "effective",
        recordedAtIso: TODAY,
        slug: "a-row",
        sourceAtIso: SOURCE,
        status: "decided",
      },
    ]);
    expect(report.complete).toBe(true);
    expect(rulingAuditExitCode({ report })).toBe(0);
  });

  it("stays decided under a later decision, placed as history rather than refused", () => {
    const events = [answer, live({ at: LATER }), backfill()];
    const report = auditRulings({ input: input({ entries: [ENTRY], rows: [row({ events })] }) });
    expect(report.manifest[0]).toEqual({
      entryIndex: 0,
      placement: "historical",
      recordedAtIso: TODAY,
      slug: "a-row",
      sourceAtIso: SOURCE,
      status: "decided",
    });
  });

  it("is unrepresented when the answer checks out and nothing names it — complete, and still exit 1", () => {
    const report = auditRulings({ input: input({ entries: [ENTRY], rows: [row({})] }) });
    expect(report.manifest).toEqual([
      { entryIndex: 0, slug: "a-row", sourceAtIso: SOURCE, status: "confirmed-unrepresented" },
    ]);
    expect(report.complete).toBe(true);
    expect(rulingAuditExitCode({ report })).toBe(1);
  });

  it("is NOT satisfied by a live ruling with identical words and anchor, which names no source", () => {
    const lookalike: RulingEvent = { anchor: ANCHOR, atIso: SOURCE, decidedIso: SOURCE, kind: "ruling", ruling: WORDS };
    const report = auditRulings({ input: input({ entries: [ENTRY], rows: [row({ events: [answer, lookalike] })] }) });
    expect(report.manifest[0]!.status).toBe("confirmed-unrepresented");
  });

  it("is incomplete when the reconstruction's words were changed after it was written", () => {
    const events = [answer, backfill({ ruling: "OWNER RULED: do not ship it" })];
    const report = auditRulings({ input: input({ entries: [ENTRY], rows: [row({ events })] }) });
    expect(report.manifest[0]).toEqual({
      codes: ["RULING_WORDS_MISMATCH"],
      entryIndex: 0,
      slug: "a-row",
      sourceAtIso: SOURCE,
      status: "incomplete",
    });
    expect(rulingAuditExitCode({ report })).toBe(1);
  });

  it("is incomplete when the reconstruction points at a different anchor", () => {
    const events = [answer, backfill({ anchor: "https://example.invalid/elsewhere" })];
    const report = auditRulings({ input: input({ entries: [ENTRY], rows: [row({ events })] }) });
    expect(report.problems).toEqual([
      RulingAuditProblems.rulingAnchorMismatch({
        actual: "https://example.invalid/elsewhere",
        entryIndex: 0,
        expected: ANCHOR,
        slug: "a-row",
      }),
    ]);
  });

  it("is incomplete when two rulings claim the source, even though one of them matches", () => {
    const events = [answer, backfill(), backfill({ atIso: LATER })];
    const report = auditRulings({ input: input({ entries: [ENTRY], rows: [row({ events })] }) });
    expect(report.manifest[0]).toEqual({
      codes: ["SOURCE_REPRESENTATION_AMBIGUOUS"],
      entryIndex: 0,
      slug: "a-row",
      sourceAtIso: SOURCE,
      status: "incomplete",
    });
  });

  it("is incomplete when the manifest's words are not what the answer recorded", () => {
    const report = auditRulings({
      input: input({ entries: [{ ...ENTRY, words: `${WORDS} ` }], rows: [row({ events: [answer, backfill()] })] }),
    });
    expect(report.problems.map((problem) => problem.code)).toEqual(["SOURCE_INVALID"]);
    expect(report.problems[0]).toMatchObject({ integrity: { code: "RULING_SOURCE_WORDS_MISMATCH" } });
  });

  it("is incomplete when no answer carries the source instant", () => {
    const report = auditRulings({ input: input({ entries: [ENTRY], rows: [row({ events: [] })] }) });
    expect(report.problems[0]).toMatchObject({ code: "SOURCE_INVALID", integrity: { code: "RULING_SOURCE_MISSING" } });
  });

  it("does not count a ruling on another row whose text is identical", () => {
    const other = row({ events: [answer, backfill()], slug: "other-row" });
    const report = auditRulings({ input: input({ entries: [ENTRY], rows: [row({}), other] }) });
    expect(report.manifest[0]!.status).toBe("confirmed-unrepresented");
  });

  it("is incomplete when no document claims its row, even with a perfect journal", () => {
    const report = auditRulings({
      input: input({ entries: [ENTRY], rows: [row({ docs: [], events: [answer, backfill()] })] }),
    });
    expect(report.problems).toEqual([RulingAuditProblems.rowMissing({ entryIndex: 0, slug: "a-row" })]);
    expect(report.manifest[0]!.status).toBe("incomplete");
  });

  it("names the row's own problem without adding a second copy of it", () => {
    const report = auditRulings({
      input: input({ entries: [ENTRY], rows: [row({ events: [answer, backfill()], unreadableLines: [2] })] }),
    });
    expect(report.manifest[0]).toEqual({
      codes: ["JOURNAL_LINE_UNREADABLE"],
      entryIndex: 0,
      slug: "a-row",
      sourceAtIso: SOURCE,
      status: "incomplete",
    });
    expect(report.counts.incompleteInputs).toBe(1);
  });
});

describe("an unreadable document bears on every entry, not just its own row", () => {
  /**
   * A review finding: an oversized archived duplicate is reported unreadable by the scan and leaves ONE
   * occurrence standing, so the entry read as decided while a second document might have claimed its slug.
   * While any doc or directory is unread, the row set is not known and nothing may be called decided.
   */
  it("refuses to call an entry decided while a document somewhere could not be read", () => {
    const report = auditRulings({
      input: input({
        entries: [ENTRY],
        problems: [RulingAuditProblems.docUnreadable({ path: "/board/archive/huge.md" })],
        rows: [row({ events: [answer, backfill()] })],
      }),
    });
    expect(report.manifest[0]).toEqual({
      codes: ["DOC_UNREADABLE"],
      entryIndex: 0,
      slug: "a-row",
      sourceAtIso: SOURCE,
      status: "incomplete",
    });
    expect(report.counts.decided).toBe(0);
    expect(report.counts.incompleteInputs).toBe(1);
  });

  it("does the same when a directory could not be listed, and does not invent a missing row", () => {
    const report = auditRulings({
      input: input({
        entries: [ENTRY],
        problems: [RulingAuditProblems.directoryUnreadable({ cause: "EACCES", path: "/board/archive" })],
        rows: [],
      }),
    });
    expect(report.manifest[0]).toEqual({
      codes: ["DIRECTORY_UNREADABLE"],
      entryIndex: 0,
      slug: "a-row",
      sourceAtIso: SOURCE,
      status: "incomplete",
    });
    expect(report.problems.map((problem) => problem.code)).toEqual(["DIRECTORY_UNREADABLE"]);
  });
});

describe("readable evidence survives a failure somewhere else", () => {
  /**
   * A review finding: with two documents claiming one slug neither can be the row's ruling, and BOTH
   * front-matter rulings were dropped from the report rather than kept as the history they are.
   */
  it("keeps both authored rulings when two documents claim one slug", () => {
    const active = ruledDoc({ path: "/board/a-row.md", words: "ship it" });
    const archived = ruledDoc({ anchor: "p2", path: "/board/archive/a-row.md", words: "wait" });
    const report = auditRulings({ input: input({ rows: [row({ docs: [active, archived], events: [] })] }) });

    expect(report.rows[0]!.effective).toBeNull();
    expect(report.rows[0]!.history).toEqual([
      { anchor: ANCHOR, from: "authored", words: "ship it" },
      { anchor: "p2", from: "authored", words: "wait" },
    ]);
    expect(report.problems.map((problem) => problem.code)).toEqual(["DUPLICATE_SLUG"]);
  });

  it("still reports an authored ruling as the CURRENT one, and not twice", () => {
    const authored = ruledDoc();
    const report = auditRulings({ input: input({ rows: [row({ docs: [authored], events: [] })] }) });

    expect(report.rows[0]!.effective).toEqual({ anchor: ANCHOR, from: "authored", words: "yes" });
    expect(report.rows[0]!.history).toEqual([]);
  });
});

describe("a byte the decoder replaced is not the text that was written", () => {
  /**
   * A review finding: `readFileSync(path, "utf8")` substitutes invalid bytes rather than failing, so a
   * ruling reading `ship <0xFF> it` decoded cleanly and the report certified it complete.
   */
  it("refuses to certify a row whose event text carries a replacement character", () => {
    const mangled: RulingEvent = {
      anchor: ANCHOR,
      atIso: TODAY,
      decidedIso: TODAY,
      kind: "ruling",
      ruling: "ship � it",
    };
    const report = auditRulings({ input: input({ rows: [row({ events: [mangled] })] }) });

    expect(report.complete).toBe(false);
    expect(report.problems.map((problem) => problem.code)).toEqual(["JOURNAL_BYTES_REPLACED"]);
    expect(rulingAuditExitCode({ report })).toBe(1);
  });

  it("says nothing about a row whose text decoded whole", () => {
    const report = auditRulings({ input: input({ rows: [row({ events: [answer, backfill()] })] }) });
    expect(report.problems).toEqual([]);
  });
});

describe("the replaced-byte check is total, not a list of remembered fields", () => {
  /** A review finding: `finished.residue` is a list of strings, and a string-only check walked straight past it. */
  it("sees a replaced byte inside a list of strings", () => {
    const finished: RunEvent = { atIso: TODAY, kind: "finished", residue: ["repair �"] };
    const report = auditRulings({ input: input({ rows: [row({ events: [finished] })] }) });

    expect(report.problems.map((problem) => problem.code)).toEqual(["JOURNAL_BYTES_REPLACED"]);
    expect(rulingAuditExitCode({ report })).toBe(1);
  });
});

describe("the same substitution on the authored surface", () => {
  /** A review finding: a document is read with the same decoder, so its authored ruling can be substituted too. */
  it("refuses to certify a row whose authored ruling carries a replacement character", () => {
    const mangled = ruledDoc({ anchor: "p1", words: "ship � it" });
    const report = auditRulings({ input: input({ rows: [row({ docs: [mangled], events: [] })] }) });

    expect(report.problems.map((problem) => [problem.code, problem.path])).toEqual([
      ["DOC_BYTES_REPLACED", "/board/a-row.md"],
    ]);
    expect(rulingAuditExitCode({ report })).toBe(1);
  });
});

describe("what the parser already found is reported", () => {
  /**
   * A review finding: a repeated front-matter key discards the second value, so a corrupted second `ruling:`
   * never reached the byte check while the row still read clean. The parser says so on the doc; say it too.
   */
  it("names a document whose front matter did not parse cleanly", () => {
    const repeated = doc({ lines: ["kind: ask", "origin: finding", "ruling: ship it", "ruling: wait"] });
    const report = auditRulings({ input: input({ rows: [row({ docs: [repeated], events: [] })] }) });

    expect(report.problems.map((problem) => problem.code)).toEqual(["DOC_MALFORMED"]);
    expect(report.complete).toBe(false);
    expect(rulingAuditExitCode({ report })).toBe(1);
  });

  it("says nothing about a document that parsed cleanly", () => {
    const clean = ruledDoc({ anchor: "p1", words: "ship it" });
    expect(auditRulings({ input: input({ rows: [row({ docs: [clean], events: [] })] }) }).problems).toEqual([]);
  });
});
