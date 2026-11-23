/**
 * The pure half of showing a parked draft's attached document on the queue card: which names are read as text,
 * the card's type and size line, the route's answer, and how much of a text the collapsed card shows.
 */
import { describe, expect, it } from "vitest";

import {
  COLLAPSED_CHARS,
  COLLAPSED_LINES,
  collapsedLabel,
  type DraftMediaText,
  draftMediaTextOf,
  filePreviewOf,
  fileSizeLabel,
  fileTypeLabel,
  pdfReadAnswerOf,
  pdfShortfallOf,
  textHead,
  unshownWordsOf,
} from "../../lib/draftMediaText";

describe("filePreviewOf", () => {
  it("reads the named text types as text and a PDF as a PDF, whatever their case", () => {
    expect(
      ["iso-concerns-timelines.md", "a.MARKDOWN", "b.txt", "c.csv", "d.json", "e.log", "f.html", "g.htm", "h.PDF"].map(
        (name) => filePreviewOf({ name }),
      ),
    ).toEqual(["text", "text", "text", "text", "text", "text", "text", "text", "pdf"]);
  });

  it("previews nothing for a picture, a binary or a name with no extension", () => {
    expect(["a.png", "b.zip", "c.docx", "noext", "md"].map((name) => filePreviewOf({ name }))).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });
});

describe("fileTypeLabel", () => {
  it("names the previewed types and upper-cases any other extension", () => {
    expect(
      ["x.md", "x.txt", "x.log", "x.CSV", "x.json", "x.html", "x.pdf", "x.zip", "noext", ".env", "trailing."].map(
        (name) => fileTypeLabel({ name }),
      ),
    ).toEqual([
      "Markdown (raw)",
      "Plain Text",
      "Plain Text",
      "CSV",
      "JSON",
      "HTML",
      "PDF",
      "ZIP",
      "File",
      "File",
      "File",
    ]);
  });
});

describe("fileSizeLabel", () => {
  it("writes bytes, then binary units with one decimal below ten", () => {
    expect(
      [0, 1023, 1024, 9_600, 44_917, 1_048_576, 3_250_000, 5 * 1024 ** 3].map((bytes) => fileSizeLabel({ bytes })),
    ).toEqual(["0 B", "1023 B", "1.0 KB", "9.4 KB", "44 KB", "1.0 MB", "3.1 MB", "5.0 GB"]);
  });
});

describe("draftMediaTextOf", () => {
  it("reads a text answer and a PDF answer", () => {
    expect([
      draftMediaTextOf({ payload: { kind: "text", text: "# heading" } }),
      draftMediaTextOf({ payload: { glyphless: false, kind: "pdf", pages: 3, pagesRead: 2, text: "page one" } }),
    ]).toEqual([
      { kind: "text", text: "# heading" },
      { glyphless: false, kind: "pdf", pages: 3, pagesRead: 2, text: "page one" },
    ]);
  });

  it("reads nothing from a body missing a field, of another kind, or not an object", () => {
    expect(
      [
        { kind: "text" },
        { kind: "pdf", pages: 1, pagesRead: 1, text: "t" },
        { kind: "image", text: "t" },
        "text",
        null,
      ].map((payload) => draftMediaTextOf({ payload })),
    ).toEqual([undefined, undefined, undefined, undefined, undefined]);
  });
});

describe("pdfReadAnswerOf", () => {
  it("reads `pdf read --json`'s report as the PDF answer, dropping its path", () => {
    expect(
      pdfReadAnswerOf({
        payload: { glyphless: true, pages: 4, pagesRead: 4, path: "/tmp/x/attachment.pdf", text: "" },
      }),
    ).toEqual({ glyphless: true, kind: "pdf", pages: 4, pagesRead: 4, text: "" });
  });

  it("reads nothing from a report missing its page counts", () => {
    expect(pdfReadAnswerOf({ payload: { glyphless: false, text: "t" } })).toBe(undefined);
  });
});

describe("textHead", () => {
  it("shows a short text whole, counting a final newline as the end of a line rather than a new one", () => {
    expect(textHead({ text: "one\ntwo\n" })).toEqual({
      body: "one\ntwo",
      head: "one\ntwo",
      partLine: false,
      shownLines: 2,
      totalLines: 2,
      whole: true,
    });
  });

  it("shows nothing of an empty text and calls it whole", () => {
    expect(textHead({ text: "" })).toEqual({
      body: "",
      head: "",
      partLine: false,
      shownLines: 0,
      totalLines: 0,
      whole: true,
    });
  });

  it("counts CRLF and lone-CR line endings as the line breaks they are", () => {
    const head = textHead({ text: "a\r\nb\rc\r\n", lines: 2 });
    expect([head.head, head.body, head.shownLines, head.totalLines, head.whole]).toEqual([
      "a\nb",
      "a\nb\nc",
      2,
      3,
      false,
    ]);
  });

  it("stops at the last WHOLE line the character budget holds, never cutting a later line", () => {
    const head = textHead({ chars: 10, text: "aaaa\nbbbb\ncccc" });
    expect([head.head, head.shownLines, head.partLine, head.totalLines, head.whole]).toEqual([
      "aaaa\nbbbb",
      2,
      false,
      3,
      false,
    ]);
  });

  it("stops at the line budget and says how many lines there are", () => {
    const text = Array.from({ length: 30 }, (_, at) => `line ${String(at + 1)}`).join("\n");
    const head = textHead({ text });
    expect([head.shownLines, head.totalLines, head.whole, head.head.split("\n").at(-1)]).toEqual([
      COLLAPSED_LINES,
      30,
      false,
      `line ${String(COLLAPSED_LINES)}`,
    ]);
  });

  it("is whole at exactly the line budget", () => {
    const text = Array.from({ length: COLLAPSED_LINES }, () => "x").join("\n");
    expect(textHead({ text }).whole).toBe(true);
  });

  it("cuts an enormous FIRST line at the character budget without splitting a character, and says it is part", () => {
    const text = "🙂".repeat(COLLAPSED_CHARS + 5);
    const head = textHead({ text });
    expect([Array.from(head.head).length, head.shownLines, head.partLine, head.totalLines, head.whole]).toEqual([
      COLLAPSED_CHARS,
      0,
      true,
      1,
      false,
    ]);
  });
});

describe("collapsedLabel", () => {
  it("names whole lines shown, or the characters of a cut first line", () => {
    expect([
      collapsedLabel({ head: textHead({ chars: 10, text: "aaaa\nbbbb\ncccc" }) }),
      collapsedLabel({ head: textHead({ chars: 3, text: "abcdef" }) }),
      collapsedLabel({ head: textHead({ chars: 3, text: "abcdef\ng" }) }),
    ]).toEqual([
      "first 2 of 3 lines",
      "the first 3 characters of line 1, of 1 line",
      "the first 3 characters of line 1, of 2 lines",
    ]);
  });
});

describe("unshownWordsOf", () => {
  /** A PDF answer with these fields over a readable default. */
  const pdf = (over: { glyphless?: boolean; pages?: number; pagesRead?: number; text?: string }): DraftMediaText => ({
    glyphless: false,
    kind: "pdf",
    pages: 2,
    pagesRead: 2,
    text: "words",
    ...over,
  });

  it("shows the words of an answer of the kind its name promised", () => {
    expect([
      unshownWordsOf({ expected: "text", read: { kind: "text", text: "# words" } }),
      unshownWordsOf({ expected: "pdf", read: pdf({}) }),
    ]).toEqual([undefined, undefined]);
  });

  it("refuses bytes of the other kind than the name says, so the card never shows what the send would not", () => {
    expect(unshownWordsOf({ expected: "text", read: pdf({}) })).toEqual({
      text: "could not show this file's text: its bytes are a pdf file, not what its name says",
      warn: true,
    });
  });

  it("calls a glyphless PDF a scan, and a glyphless HEAD of a longer one only what was read", () => {
    expect([
      unshownWordsOf({ expected: "pdf", read: pdf({ glyphless: true, text: "" }) }),
      unshownWordsOf({ expected: "pdf", read: pdf({ glyphless: true, pages: 60, pagesRead: 50, text: "" }) }),
    ]).toEqual([
      { text: "this PDF has no text layer: a scan or picture, not a blank document", warn: true },
      { text: "the first 50 of 60 pages carry no text layer; the rest were not read", warn: true },
    ]);
  });

  it("says an empty file is empty and a blank one is blank, never a blank box", () => {
    expect([
      unshownWordsOf({ expected: "text", read: { kind: "text", text: "" } }),
      unshownWordsOf({ expected: "text", read: { kind: "text", text: "\n \t\n" } }),
    ]).toEqual([
      { text: "this file is empty", warn: false },
      { text: "this file holds only blank space", warn: false },
    ]);
  });
});

describe("pdfShortfallOf", () => {
  it("notes a PDF read short of its last page, and nothing for a whole one or a text file", () => {
    expect([
      pdfShortfallOf({ read: { glyphless: false, kind: "pdf", pages: 80, pagesRead: 50, text: "t" } }),
      pdfShortfallOf({ read: { glyphless: false, kind: "pdf", pages: 3, pagesRead: 3, text: "t" } }),
      pdfShortfallOf({ read: { kind: "text", text: "t" } }),
    ]).toEqual(["text of the first 50 of 80 pages; the rest were not read", undefined, undefined]);
  });
});
