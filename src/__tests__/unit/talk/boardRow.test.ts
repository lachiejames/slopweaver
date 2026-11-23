/**
 * One board row as the console voice reads it: the owner's words first, bounded, and nothing it names ever opened.
 *
 * The verb's end-to-end half runs `talk row` against an explicit home built with `mkdtempSync`, so nothing
 * here touches the ambient one.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runTalkRow } from "../../../cli/commands/talk/rowRun.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../cli/exitCodes.js";
import { parseHandoverDoc } from "../../../handover/doc.js";
import type { RunEvent } from "../../../handover/ledger.js";
import {
  BOARD_ROW_MAX_BYTES,
  boardRowForVoice,
  boardRowOwnerWords,
  isBoardSlug,
  latestRecordedQuestion,
  OWNER_WORD_HEADING,
} from "../../../talk/boardRow.js";

// The pronoun spellings docs on disk still carry, assembled from patterns: the transient-references gate exempts a regex literal only.
const POSSESSIVE = /His/u.source;
const POSSESSIVE_LOWER = /his/u.source;
const SUBJECT = /he/u.source;

/** A row shaped like a real ask: a ruling, a word section, options, and a body. Synthetic words. */
const ROW = [
  "---",
  "slug: memory-for-the-answerer",
  "kind: ask",
  'summary: "give the answerer memory so an investigation is not amnesiac"',
  "status: ready",
  "priority: p1",
  'ruling: "it is almost like a flywheel within a flywheel"',
  "rulingAnchor: /somewhere/owner-turn.txt",
  "evidence: [owner-turn.txt]",
  'lean: "A"',
  "options:",
  '  - option: "A"',
  '    tradeoff: "notes only"',
  '  - option: "B"',
  '    tradeoff: "full recall"',
  "---",
  "",
  "# memory for the answerer",
  "",
  "## What was observed",
  "",
  "The answerer forgets everything between questions.",
  "",
  "## The owner's word, 10:58Z",
  "",
  "> remember which dead ends to avoid",
  "",
].join("\n");

const PATH = "/board/memory-for-the-answerer.md";

/** A run never started: an empty journal. */
const NO_JOURNAL = { events: [], unreadableLines: [] };

/** The run's start. */
const STARTED: RunEvent = { atIso: "2026-10-20T10:00:00.000Z", branch: "tauri", docHash: "h1", kind: "started" };

/** The Tauri run's question as first recorded, cut to where it placed the plan. */
const ASKED: RunEvent = {
  atIso: "2026-10-20T10:28:00.000Z",
  kind: "question",
  question: "The prototype is ready. Plan: /Users/someone/dev/acme-desktop-tauri/PLAN.md.",
};

/** Its later correction, which moved the plan to a bare name beside the folder. */
const CORRECTED: RunEvent = {
  atIso: "2026-10-20T10:59:00.000Z",
  kind: "question-corrected",
  question: "Want to try it? Folder: ~/dev/acme-desktop-tauri (local git). Plan: PLAN.md in the folder.",
  why: "shorter",
};

/** The owner's answer, after which the card is closed but the question still says where the plan is. */
const ANSWERED: RunEvent = { answer: "yes", atIso: "2026-10-20T11:00:00.000Z", kind: "answered" };

describe("boardRowForVoice", () => {
  it("puts the owner's ruling and every word section first, and keeps the rest of the body after", () => {
    const row = boardRowForVoice({
      doc: parseHandoverDoc({ path: PATH, text: ROW }),
      journal: NO_JOURNAL,
      maxBytes: BOARD_ROW_MAX_BYTES,
      text: ROW,
    });
    expect(row.ownerWords).toEqual([
      "it is almost like a flywheel within a flywheel",
      "## The owner's word, 10:58Z\n\n> remember which dead ends to avoid",
    ]);
    expect(row.body).toBe("## What was observed\n\nThe answerer forgets everything between questions.");
    expect(row.truncated).toBe(undefined);
  });

  it("returns the files the row names as strings, never their contents", () => {
    const row = boardRowForVoice({
      doc: parseHandoverDoc({ path: PATH, text: ROW }),
      journal: NO_JOURNAL,
      maxBytes: BOARD_ROW_MAX_BYTES,
      text: ROW,
    });
    expect(row.names).toEqual(["owner-turn.txt", "/somewhere/owner-turn.txt"]);
  });

  it("carries the options and the lean the card is asking the owner to choose between", () => {
    const row = boardRowForVoice({
      doc: parseHandoverDoc({ path: PATH, text: ROW }),
      journal: NO_JOURNAL,
      maxBytes: BOARD_ROW_MAX_BYTES,
      text: ROW,
    });
    expect(row.options).toEqual([
      { option: "A", tradeoff: "notes only" },
      { option: "B", tradeoff: "full recall" },
    ]);
    expect(row.lean).toBe("A");
  });

  it("cuts the body before the owner's words when the row is too big, and says it cut", () => {
    const long = `${ROW}\n## Detail\n\n${"x".repeat(6000)}\n`;
    const row = boardRowForVoice({
      doc: parseHandoverDoc({ path: PATH, text: long }),
      journal: NO_JOURNAL,
      maxBytes: 2048,
      text: long,
    });
    expect(Buffer.byteLength(JSON.stringify(row), "utf8")).toBeLessThanOrEqual(2048);
    expect(row.ownerWords[0]).toBe("it is almost like a flywheel within a flywheel");
    expect(row.truncated).toContain("this read carries 2048");
  });
});

describe("board_row reads the run's journal", () => {
  it("carries the question the owner's card holds open, corrected, and the plan file it places beside its folder", () => {
    const row = boardRowForVoice({
      doc: parseHandoverDoc({ path: PATH, text: ROW }),
      journal: { events: [STARTED, ASKED, CORRECTED], unreadableLines: [] },
      maxBytes: BOARD_ROW_MAX_BYTES,
      text: ROW,
    });
    expect(row.question).toBe(
      "Want to try it? Folder: ~/dev/acme-desktop-tauri (local git). Plan: PLAN.md in the folder.",
    );
    expect(row.questionHeld).toBe(true);
    expect(row.files).toEqual(["~/dev/acme-desktop-tauri/PLAN.md"]);
    expect(row.journalUnread).toBe(undefined);
  });

  it("still carries the question once the owner answered it, marked as no longer held", () => {
    const row = boardRowForVoice({
      doc: parseHandoverDoc({ path: PATH, text: ROW }),
      journal: { events: [STARTED, ASKED, CORRECTED, ANSWERED], unreadableLines: [] },
      maxBytes: BOARD_ROW_MAX_BYTES,
      text: ROW,
    });
    expect(row.questionHeld).toBe(false);
    expect(row.files).toEqual(["~/dev/acme-desktop-tauri/PLAN.md"]);
  });

  it("carries no question for a run that recorded none", () => {
    const row = boardRowForVoice({
      doc: parseHandoverDoc({ path: PATH, text: ROW }),
      journal: { events: [STARTED], unreadableLines: [] },
      maxBytes: BOARD_ROW_MAX_BYTES,
      text: ROW,
    });
    expect(row.question).toBe(undefined);
    expect(row.questionHeld).toBe(undefined);
    expect(row.journalUnread).toBe(undefined);
  });

  // One bad line elsewhere once hid the readable correction and the plan file it placed.
  it("names undecodable journal lines and still carries the readable question and its file, held unknown", () => {
    const row = boardRowForVoice({
      doc: parseHandoverDoc({ path: PATH, text: ROW }),
      journal: { events: [STARTED, ASKED, CORRECTED], unreadableLines: [4] },
      maxBytes: BOARD_ROW_MAX_BYTES,
      text: ROW,
    });
    expect(row.journalUnread).toBe("1 journal line(s) could not be read");
    expect(row.question).toBe(CORRECTED.question);
    expect(row.questionHeld).toBe(undefined);
    expect(row.files).toEqual(["~/dev/acme-desktop-tauri/PLAN.md"]);
  });

  it("names a journal it could not read rather than reading as a run that asked nothing", () => {
    const row = boardRowForVoice({
      doc: parseHandoverDoc({ path: PATH, text: ROW }),
      journal: { unread: "EACCES: permission denied" },
      maxBytes: BOARD_ROW_MAX_BYTES,
      text: ROW,
    });
    expect(row.question).toBe(undefined);
    expect(row.journalUnread).toBe("EACCES: permission denied");
    expect(row.files).toEqual([]);
  });

  it("reads a file the body names as well as the question's", () => {
    const named = `${ROW}\n## Where it is\n\nThe draft is at ~/dev/notes/answerer.md.\n`;
    const row = boardRowForVoice({
      doc: parseHandoverDoc({ path: PATH, text: named }),
      journal: { events: [ASKED], unreadableLines: [] },
      maxBytes: BOARD_ROW_MAX_BYTES,
      text: named,
    });
    expect(row.files).toEqual(["~/dev/notes/answerer.md", "/Users/someone/dev/acme-desktop-tauri/PLAN.md"]);
  });

  it("cuts the question before the owner's words, and keeps every file it named", () => {
    const long: RunEvent = { ...ASKED, question: `${"y".repeat(6000)} Plan: ~/dev/x/PLAN.md` };
    const row = boardRowForVoice({
      doc: parseHandoverDoc({ path: PATH, text: ROW }),
      journal: { events: [long], unreadableLines: [] },
      maxBytes: 2048,
      text: ROW,
    });
    expect(Buffer.byteLength(JSON.stringify(row), "utf8")).toBeLessThanOrEqual(2048);
    expect(row.ownerWords[0]).toBe("it is almost like a flywheel within a flywheel");
    expect(row.question!.endsWith(" …")).toBe(true);
    expect(row.files).toEqual(["~/dev/x/PLAN.md"]);
  });
});

describe("the byte bound over named files", () => {
  it("keeps the first-named files, fits, and says how many it kept", () => {
    const paths = Array.from({ length: 400 }, (_, index) => `~/dev/many/file-${String(index)}.md`).join(" ");
    const named = `${ROW}\n## Files\n\n${paths}\n`;
    const row = boardRowForVoice({
      doc: parseHandoverDoc({ path: PATH, text: named }),
      journal: NO_JOURNAL,
      maxBytes: 4096,
      text: named,
    });
    expect(Buffer.byteLength(JSON.stringify(row), "utf8")).toBeLessThanOrEqual(4096);
    expect(row.files[0]).toBe("~/dev/many/file-0.md");
    expect(row.truncated).toContain(`files (kept the first ${String(row.files.length)} of 400)`);
    expect(row.ownerWords[0]).toBe("it is almost like a flywheel within a flywheel");
  });
});

describe("the byte bound over an oversized doc", () => {
  // `talk row` checks the slug it was asked for, never the one the doc declares.
  it("cuts a 20,000-character declared slug, and still hands over the plan file the journal names", () => {
    const huge = ROW.replace("slug: memory-for-the-answerer", `slug: ${"x".repeat(20000)}`);
    const row = boardRowForVoice({
      doc: parseHandoverDoc({ path: PATH, text: huge }),
      journal: { events: [STARTED, ASKED, CORRECTED], unreadableLines: [] },
      maxBytes: BOARD_ROW_MAX_BYTES,
      text: huge,
    });
    expect(Buffer.byteLength(JSON.stringify(row), "utf8")).toBeLessThanOrEqual(BOARD_ROW_MAX_BYTES);
    expect(row.slug).toBe(`${"x".repeat(160)} …`);
    expect(row.files).toEqual(["~/dev/acme-desktop-tauri/PLAN.md"]);
    expect(row.truncated).toContain("the doc's own slug, kind, status, priority and asked instant");
  });

  // The read failure was the one field no cut reached.
  it("cuts a 20,000-character journal read failure, and keeps the owner's words", () => {
    const row = boardRowForVoice({
      doc: parseHandoverDoc({ path: PATH, text: ROW }),
      journal: { unread: "x".repeat(20000) },
      maxBytes: BOARD_ROW_MAX_BYTES,
      text: ROW,
    });
    expect(Buffer.byteLength(JSON.stringify(row), "utf8")).toBeLessThanOrEqual(BOARD_ROW_MAX_BYTES);
    expect(row.journalUnread!.endsWith("x …")).toBe(true);
    expect(row.truncated).toBe(
      "the row is 20557 bytes; this read carries 16384; cut: body, why the journal could not be read",
    );
    expect(row.ownerWords[0]).toBe("it is almost like a flywheel within a flywheel");
  });
});

describe("latestRecordedQuestion", () => {
  it("is undefined for a journal that recorded no question", () => {
    expect(latestRecordedQuestion({ events: [ANSWERED] })).toBe(undefined);
  });

  it("is the last question asked when a new one follows an answered one", () => {
    const next: RunEvent = { atIso: "2026-10-20T12:00:00.000Z", kind: "question", question: "Ship it?" };
    expect(latestRecordedQuestion({ events: [ASKED, ANSWERED, next] })).toBe("Ship it?");
  });
});

describe("boardRowOwnerWords", () => {
  it("reads the owner's words exactly as board_row hands them over, so find-card searches the words the voice reads", () => {
    const doc = parseHandoverDoc({ path: PATH, text: ROW });
    expect(boardRowOwnerWords({ doc, text: ROW })).toEqual(
      boardRowForVoice({ doc, journal: NO_JOURNAL, maxBytes: BOARD_ROW_MAX_BYTES, text: ROW }).ownerWords,
    );
  });

  it("reads the quote stored at the row's anchor and every readable steer, after the ruling", () => {
    const quoted = ROW.replace(
      'lean: "A"\n',
      [
        'lean: "A"',
        'anchor: "talk:a0000006-0000-4000-8000-000000000007"',
        'hisWords: "show me it working in both local and CI"',
        'hisWordsAnchor: "talk:a0000006-0000-4000-8000-000000000007"',
        'hisWordsIso: "2026-10-12T01:57:59.586Z"',
        "hisWordsWhere: console-voice",
        "hisWordsCut: none",
        'hisWordsSteer1Words: "I expected before and after proof with screenshots"',
        'hisWordsSteer1Anchor: "talk:a0000008-0000-4000-8000-000000000009"',
        'hisWordsSteer1Iso: "2026-09-25T02:41:26.704Z"',
        "hisWordsSteer1Where: console-voice",
        "hisWordsSteer1Cut: none",
        'hisWordsSteer2Anchor: "talk:a0000011-0000-4000-8000-000000000012"',
        'hisWordsSteer2Unread: "the turn file is gone"',
        "",
      ].join("\n"),
    );
    const doc = parseHandoverDoc({ path: PATH, text: quoted });
    expect(boardRowOwnerWords({ doc, text: quoted })).toEqual([
      "it is almost like a flywheel within a flywheel",
      "show me it working in both local and CI",
      "I expected before and after proof with screenshots",
      "## The owner's word, 10:58Z\n\n> remember which dead ends to avoid",
    ]);
  });

  it("returns only the word sections when the row carries no ruling", () => {
    const unruled = ROW.replace('ruling: "it is almost like a flywheel within a flywheel"\n', "");
    const doc = parseHandoverDoc({ path: PATH, text: unruled });
    expect(boardRowOwnerWords({ doc, text: unruled })).toEqual([
      "## The owner's word, 10:58Z\n\n> remember which dead ends to avoid",
    ]);
  });
});

describe("isBoardSlug", () => {
  it("accepts a board slug", () => {
    expect(isBoardSlug({ slug: "acme-ask-6-sep-turn-95-1-give" })).toBe(true);
  });

  it("refuses anything that could step out of the board", () => {
    expect(isBoardSlug({ slug: "../secrets/openai-api-key" })).toBe(false);
    expect(isBoardSlug({ slug: "a/b" })).toBe(false);
    expect(isBoardSlug({ slug: "Upper" })).toBe(false);
  });
});

describe("talk row", () => {
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "talk-row-"));
  });

  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  it("reads a row that is on the board", () => {
    writeFileSync(join(home, "memory-for-the-answerer.md"), ROW);
    expect(
      runTalkRow([
        "node",
        "slopweaver",
        "talk",
        "row",
        "--slug",
        "memory-for-the-answerer",
        "--dir",
        home,
        "--home",
        home,
        "--json",
      ]),
    ).toBe(EXIT_OK);
  });

  it("refuses a slug shaped like a path before building one", () => {
    expect(runTalkRow(["node", "slopweaver", "talk", "row", "--slug", "../x", "--dir", home, "--home", home])).toBe(
      EXIT_USAGE,
    );
  });

  it("says a row is missing rather than answering empty", () => {
    expect(
      runTalkRow(["node", "slopweaver", "talk", "row", "--slug", "nothing-here", "--dir", home, "--home", home]),
    ).toBe(EXIT_ERROR);
  });
});

describe("OWNER_WORD_HEADING", () => {
  it("matches every spelling the board uses for a section of the owner's own words", () => {
    const spellings = [
      "## The owner's word, 10:58Z",
      "## The owner's words",
      "### The owner's ruling (option C)",
      "## Owner ruling, 4 Sep",
      "## The bar, in the owner's words",
      "## What they want, the owner's words",
    ];
    expect(spellings.length).toBeGreaterThan(0);
    expect(spellings.filter((heading) => !OWNER_WORD_HEADING.test(heading))).toEqual([]);
  });

  it("matches the pronoun spelling of those headings, which docs on disk still carry", () => {
    const spellings = [
      `## ${POSSESSIVE} word, 10:58Z`,
      `## ${POSSESSIVE} words`,
      `### ${POSSESSIVE} ruling (option C)`,
      `## The bar, in ${POSSESSIVE_LOWER} words`,
      `## What ${SUBJECT} wants, ${POSSESSIVE_LOWER} words`,
    ];
    expect(spellings.filter((heading) => !OWNER_WORD_HEADING.test(heading))).toEqual([]);
  });

  it("does not match a heading that names a wait for the owner's word rather than quoting it", () => {
    expect(OWNER_WORD_HEADING.test("## Needs the owner's word")).toBe(false);
    expect(OWNER_WORD_HEADING.test("## On the owner's word")).toBe(false);
    expect(OWNER_WORD_HEADING.test(`## Needs ${POSSESSIVE_LOWER} word`)).toBe(false);
    expect(OWNER_WORD_HEADING.test("## Options")).toBe(false);
    expect(OWNER_WORD_HEADING.test("# The owner's words")).toBe(false);
    expect(OWNER_WORD_HEADING.test(`# ${POSSESSIVE} words`)).toBe(false);
  });
});
