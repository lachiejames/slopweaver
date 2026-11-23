import { describe, expect, it } from "vitest";

import { BLOCK_MAX_SENTENCES } from "../../../briefing/caps.js";
import { headlineSentenceIssues } from "../../../briefing/headlineSentences.js";

const FIELD = "headline.sentences";

describe("headlineSentenceIssues — the count", () => {
  it("accepts one through four sentences, the schema's own cap", () => {
    expect(BLOCK_MAX_SENTENCES).toBe(4);
    expect(headlineSentenceIssues({ field: FIELD, sentences: ["One."] })).toEqual([]);
    expect(headlineSentenceIssues({ field: FIELD, sentences: ["One.", "Two!", "Three?", "Four."] })).toEqual([]);
  });

  it("refuses a fifth sentence, naming the count and the cap", () => {
    expect(headlineSentenceIssues({ field: FIELD, sentences: ["A.", "B.", "C.", "D.", "E."] })).toEqual([
      "headline.sentences: has 5 sentences; at most 4 are allowed — keep the ones the owner has to read to decide, " +
        "and move the rest into a fold",
    ]);
  });

  it("refuses an empty headline", () => {
    expect(headlineSentenceIssues({ field: FIELD, sentences: [] })).toEqual([
      "headline.sentences: has 0 sentences; the headline needs at least 1",
    ]);
  });
});

describe("headlineSentenceIssues — one sentence per element", () => {
  it("refuses an element carrying two sentences, so four elements can never hide five", () => {
    expect(headlineSentenceIssues({ field: FIELD, sentences: ["One. Two."] })).toEqual([
      "headline.sentences: sentence 1 must be exactly one sentence ending in . ! or ?, and it reads as 2 part(s) " +
        "with 2 terminator(s)",
    ]);
  });

  it("refuses an element with no terminator", () => {
    expect(headlineSentenceIssues({ field: FIELD, sentences: ["Two seats closed"] })).toEqual([
      "headline.sentences: sentence 1 must be exactly one sentence ending in . ! or ?, and it reads as 1 part(s) " +
        "with 0 terminator(s)",
    ]);
  });

  it("keeps an apostrophe as prose, never a quoting hazard", () => {
    expect(headlineSentenceIssues({ field: FIELD, sentences: ["The loop's successor isn't booted yet."] })).toEqual([]);
  });
});

describe("headlineSentenceIssues — wording", () => {
  it("refuses the words tick and row in any casing or plural", () => {
    expect(
      headlineSentenceIssues({ field: FIELD, sentences: ["This Tick closed two rows.", "One ROW and three ticks."] }),
    ).toEqual([
      'headline.sentences: sentence 1 uses the fleet word "Tick" — say what happened, in plain words',
      'headline.sentences: sentence 1 uses the fleet word "rows" — say what happened, in plain words',
      'headline.sentences: sentence 2 uses the fleet word "ROW" — say what happened, in plain words',
      'headline.sentences: sentence 2 uses the fleet word "ticks" — say what happened, in plain words',
    ]);
  });

  it("passes a word that merely contains one of them", () => {
    expect(headlineSentenceIssues({ field: FIELD, sentences: ["Tomorrow's ticket is ticked off."] })).toEqual([]);
  });

  it("refuses a seat number in either spelling", () => {
    expect(
      headlineSentenceIssues({ field: FIELD, sentences: ["workspace:323 is reviewing.", "Seat #307 stopped."] }),
    ).toEqual([
      'headline.sentences: sentence 1 names a seat number, "workspace:323" — say what the seat is doing, not its number',
      'headline.sentences: sentence 2 names a seat number, "Seat #307" — say what the seat is doing, not its number',
    ]);
  });

  it("refuses a seat number spaced or spelled out", () => {
    expect(
      headlineSentenceIssues({
        field: FIELD,
        sentences: ["Seat # 307 stopped.", "Seat no 12 and seat-9 stopped.", "Workspace number 4 stopped."],
      }),
    ).toEqual([
      'headline.sentences: sentence 1 names a seat number, "Seat # 307" — say what the seat is doing, not its number',
      'headline.sentences: sentence 2 names a seat number, "Seat no 12" — say what the seat is doing, not its number',
      'headline.sentences: sentence 2 names a seat number, "seat-9" — say what the seat is doing, not its number',
      'headline.sentences: sentence 3 names a seat number, "Workspace number 4" — say what the seat is doing, not its number',
    ]);
  });

  it("passes a number beside the word seats that is not a seat's address", () => {
    expect(headlineSentenceIssues({ field: FIELD, sentences: ["307 seats recovered overnight."] })).toEqual([]);
  });

  it("refuses absolute, home, relative-dot and file paths, stripping wrapping punctuation", () => {
    expect(
      headlineSentenceIssues({
        field: FIELD,
        sentences: [
          "It wrote (/tmp/x.json).",
          "See ~/.slopweaver/pages and ./out.",
          "It lives in skills/supervisor/SKILL.md, data/cache.sqlite3, data/cache.7z, data/cache.123 and assets/report.final-copy now.",
          "It opened file:///Users/a/b.html and *src/file.ts* today.",
        ],
      }),
    ).toEqual([
      "headline.sentences: sentence 1 names a filesystem path, /tmp/x.json — say what it is, not where",
      "headline.sentences: sentence 2 names a filesystem path, ~/.slopweaver/pages — say what it is, not where",
      "headline.sentences: sentence 2 names a filesystem path, ./out — say what it is, not where",
      "headline.sentences: sentence 3 names a filesystem path, skills/supervisor/SKILL.md — say what it is, not where",
      "headline.sentences: sentence 3 names a filesystem path, data/cache.sqlite3 — say what it is, not where",
      "headline.sentences: sentence 3 names a filesystem path, data/cache.7z — say what it is, not where",
      "headline.sentences: sentence 3 names a filesystem path, data/cache.123 — say what it is, not where",
      "headline.sentences: sentence 3 names a filesystem path, assets/report.final-copy — say what it is, not where",
      "headline.sentences: sentence 4 names a filesystem path, file:///Users/a/b.html — say what it is, not where",
      "headline.sentences: sentence 4 names a filesystem path, src/file.ts — say what it is, not where",
    ]);
  });

  it("refuses a relative directory, a deep path, a dot directory and a quoted path with a space", () => {
    expect(
      headlineSentenceIssues({
        field: FIELD,
        sentences: [
          "The details are in docs/archive/ and packages/@scope/pkg/index.ts.",
          "It wrote src/cli/commands today.",
          "See .slopweaver/pages now.",
          'Use "docs/my archive/file" and "docs/my archive" now.',
        ],
      }),
    ).toEqual([
      "headline.sentences: sentence 1 names a filesystem path, docs/archive/ — say what it is, not where",
      "headline.sentences: sentence 1 names a filesystem path, packages/@scope/pkg/index.ts — say what it is, not where",
      "headline.sentences: sentence 2 names a filesystem path, src/cli/commands — say what it is, not where",
      "headline.sentences: sentence 3 names a filesystem path, .slopweaver/pages — say what it is, not where",
      "headline.sentences: sentence 4 names a filesystem path, docs/my archive/file — say what it is, not where",
      "headline.sentences: sentence 4 names a filesystem path, docs/my archive — say what it is, not where",
    ]);
  });

  it("passes a web address and an owner/repo name", () => {
    expect(
      headlineSentenceIssues({
        field: FIELD,
        sentences: [
          "Your queue is at http://localhost:3000/queue now.",
          "lachiejames/slopweaver#1350 landed.",
          "Sadie’s fix for lachiejames/slopweaver#12 and Theo’s review both landed.",
          "The fix landed (lachiejames/slopweaver#12, merged).",
        ],
      }),
    ).toEqual([]);
  });

  it("refuses a spaced path in a fullwidth or corner-bracket quote", () => {
    expect(
      headlineSentenceIssues({
        field: FIELD,
        sentences: ["Opened ＂ docs/my archive/file ＂.", "Opened 「docs/my archive」."],
      }),
    ).toEqual([
      "headline.sentences: sentence 1 names a filesystem path, docs/my archive/file — say what it is, not where",
      "headline.sentences: sentence 2 names a filesystem path, docs/my archive — say what it is, not where",
    ]);
  });

  it("keeps a quoted span open past an apostrophe inside it", () => {
    expect(
      headlineSentenceIssues({
        field: FIELD,
        sentences: ['The path is "Sadie’s note: docs/my archive/file is here".'],
      }),
    ).toEqual([
      "headline.sentences: sentence 1 names a filesystem path, Sadie’s note: docs/my archive/file is here — say what it is, not where",
    ]);
  });

  it("keeps a quoted span open past an inner quote that a letter follows", () => {
    expect(headlineSentenceIssues({ field: FIELD, sentences: [`" docs/my 'end".`] })).toEqual([
      "headline.sentences: sentence 1 names a filesystem path, docs/my 'end — say what it is, not where",
    ]);
  });

  it("refuses a quoted path that opens in one sentence and closes in the next", () => {
    expect(
      headlineSentenceIssues({ field: FIELD, sentences: ["The path is \u201C docs/my.", "archive/file \u201D."] }),
    ).toEqual([
      "headline.sentences: the headline as rendered names a filesystem path, docs/my. archive/file — say what it is, not where",
    ]);
  });

  it("refuses a seat number whose digits follow no or number with no space", () => {
    expect(
      headlineSentenceIssues({
        field: FIELD,
        sentences: ["Seat number12 stopped.", "Seat no12 stopped.", "Seatno12 stopped."],
      }),
    ).toEqual([
      'headline.sentences: sentence 1 names a seat number, "Seat number12" — say what the seat is doing, not its number',
      'headline.sentences: sentence 2 names a seat number, "Seat no12" — say what the seat is doing, not its number',
      'headline.sentences: sentence 3 names a seat number, "Seatno12" — say what the seat is doing, not its number',
    ]);
  });

  it("refuses a quoted repository-shaped path padded with spaces inside its quotes", () => {
    expect(headlineSentenceIssues({ field: FIELD, sentences: ['The project is " docs/archive ".'] })).toEqual([
      "headline.sentences: sentence 1 names a filesystem path, docs/archive — say what it is, not where",
    ]);
  });

  it("refuses a seat number split across two sentences", () => {
    expect(headlineSentenceIssues({ field: FIELD, sentences: ["Seat no.", "12 recovered."] })).toEqual([
      'headline.sentences: the headline as rendered names a seat number, "Seat no. 12" — say what the seat is doing, not its number',
    ]);
  });

  it("passes an unquoted spaced path whose slash pieces are repository-shaped — the stated residue", () => {
    expect(
      headlineSentenceIssues({ field: FIELD, sentences: ["The filesystem path docs/my archive was written."] }),
    ).toEqual([]);
  });

  it("refuses a path riding on a web address, bare or quoted", () => {
    expect(
      headlineSentenceIssues({
        field: FIELD,
        sentences: ["See https://example.com,/tmp/secret now.", 'See "https://example.com and docs/my archive" now.'],
      }),
    ).toEqual([
      "headline.sentences: sentence 1 names a filesystem path, https://example.com,/tmp/secret — say what it is, not where",
      "headline.sentences: sentence 2 names a filesystem path, https://example.com and docs/my archive — say what it is, not where",
    ]);
  });

  it("refuses a slash token opened by anything but a bracket or quote, while a bracketed address passes", () => {
    expect(
      headlineSentenceIssues({
        field: FIELD,
        sentences: [
          "The artifact is =https://example.com/tmp/report now.",
          "See (<https://example.com/tmp/report>) now.",
        ],
      }),
    ).toEqual([
      "headline.sentences: sentence 1 names a filesystem path, https://example.com/tmp/report — say what it is, not where",
    ]);
  });

  it("refuses a slash token closed by anything but a bracket, quote or sentence punctuation", () => {
    expect(
      headlineSentenceIssues({
        field: FIELD,
        sentences: ["See https://example.com= now.", "See (https://example.com/queue)."],
      }),
    ).toEqual([
      "headline.sentences: sentence 1 names a filesystem path, https://example.com — say what it is, not where",
    ]);
  });

  it("refuses a quoted path that follows an empty quoted span", () => {
    expect(headlineSentenceIssues({ field: FIELD, sentences: ['They said "" " docs/my archive ".'] })).toEqual([
      "headline.sentences: sentence 1 names a filesystem path, docs/my archive — say what it is, not where",
    ]);
  });

  it("passes a quoted web address with words around it", () => {
    expect(
      headlineSentenceIssues({ field: FIELD, sentences: ['The queue is "at http://localhost:3000/queue now".'] }),
    ).toEqual([]);
  });

  it("refuses a Windows path", () => {
    expect(
      headlineSentenceIssues({
        field: FIELD,
        sentences: ["The file is at C:\\Users\\alice\\report.txt now.", "The drive root is C:\\."],
      }),
    ).toEqual([
      "headline.sentences: sentence 1 names a filesystem path, C:\\Users\\alice\\report.txt — say what it is, not where",
      "headline.sentences: sentence 2 names a filesystem path, C:\\ — say what it is, not where",
    ]);
  });

  it("refuses a path in curly quotes, and a repository shape in any quote", () => {
    expect(
      headlineSentenceIssues({
        field: FIELD,
        sentences: [
          "The file is “docs/my archive”.",
          "It lives in “docs/archive” now.",
          "See 'docs/archive' and `src/cli`.",
        ],
      }),
    ).toEqual([
      "headline.sentences: sentence 1 names a filesystem path, docs/my archive — say what it is, not where",
      "headline.sentences: sentence 2 names a filesystem path, docs/archive — say what it is, not where",
      "headline.sentences: sentence 3 names a filesystem path, docs/archive — say what it is, not where",
      "headline.sentences: sentence 3 names a filesystem path, src/cli — say what it is, not where",
    ]);
  });
});
