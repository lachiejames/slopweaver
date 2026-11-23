/**
 * The question and lean a page marks for its own card: read as the words a reader sees, and refused whenever
 * the page marks something short of exactly one of each.
 */
import { describe, expect, it } from "vitest";

import { readPageCardMarks } from "../../../briefing/pageCardMarks.js";
import { unwrap } from "../../../lib/result.js";

/** A page fragment with a question and a lean marked, around whatever else the page draws. */
const MARKED = [
  "<title>The queue decision</title>",
  "<h1>The queue decision</h1>",
  '<p data-card="question">Which queue should the console open on?</p>',
  "<h2>Options</h2><p>A, B or C.</p>",
  '<p class="lean" data-card="lean">A, because it is the one they already read.</p>',
].join("\n");

describe("readPageCardMarks", () => {
  it("reads both marked sentences exactly as the page draws them", () => {
    expect(unwrap(readPageCardMarks({ html: MARKED }))).toEqual({
      kind: "marked",
      lean: "A, because it is the one they already read.",
      question: "Which queue should the console open on?",
    });
  });

  it("answers unmarked for a page that marks neither sentence", () => {
    expect(unwrap(readPageCardMarks({ html: '<p class="lean">A, the page says so.</p>' }))).toEqual({
      kind: "unmarked",
    });
  });

  it("reads nested inline markup as words, decodes entities and collapses whitespace", () => {
    const html = [
      '<div data-card="question">Should <code>page publish</code>\n   freeze &amp; mark it?</div>',
      '<div data-card="lean"><b>A</b>,   one <em>command</em>.</div>',
    ].join("");

    expect(unwrap(readPageCardMarks({ html }))).toEqual({
      kind: "marked",
      lean: "A, one command.",
      question: "Should page publish freeze & mark it?",
    });
  });

  it("puts a space where a block breaks the line, so two paragraphs never weld into one word", () => {
    const html = '<p data-card="question">Which?</p><div data-card="lean"><p>A,</p><p>because.</p></div>';

    expect(unwrap(readPageCardMarks({ html }))).toEqual({
      kind: "marked",
      lean: "A, because.",
      question: "Which?",
    });
  });

  it("refuses a mark whose value is neither field, rather than reading a misspelling as no mark", () => {
    const html = MARKED.replace('data-card="lean"', 'data-card="leans"');

    expect(readPageCardMarks({ html })._unsafeUnwrapErr()).toEqual([
      'data-card="leans" marks nothing a card reads; the two values are question and lean',
      'the page marks no data-card="lean", and a card needs both sentences from it',
    ]);
  });

  it("refuses a field marked twice", () => {
    const html = `${MARKED}\n<p data-card="lean">B, on second thoughts.</p>`;

    expect(readPageCardMarks({ html })._unsafeUnwrapErr()).toEqual([
      'data-card="lean" is marked more than once; mark exactly one element',
    ]);
  });

  it("refuses one field marked without the other", () => {
    const html = '<p data-card="question">Which queue?</p>';

    expect(readPageCardMarks({ html })._unsafeUnwrapErr()).toEqual([
      'the page marks no data-card="lean", and a card needs both sentences from it',
    ]);
  });

  it("refuses a mark around no words", () => {
    const html = MARKED.replace(
      '<p class="lean" data-card="lean">A, because it is the one they already read.</p>',
      '<p data-card="lean">  <img src="x.png"> </p>',
    );

    expect(readPageCardMarks({ html })._unsafeUnwrapErr()).toEqual([
      'data-card="lean" marks an element holding no words',
    ]);
  });

  const CONCEALED =
    'data-card="lean" marks an element the page may never show (hidden, collapsed, struck, or inside a tag that ' +
    "does not draw its text as words); mark a sentence a reader sees";
  const NO_LEAN = 'the page marks no data-card="lean", and a card needs both sentences from it';
  const QUESTION = '<p data-card="question">Which?</p>';

  /** The refusal for a lean mark holding something that could hide words from a reader. */
  function holds({ what }: { what: string }): string {
    return `data-card="lean" holds ${what}, which can hide words from a reader that the card would still read; mark plain text`;
  }

  /** The refusal for a marked page carrying something that can redraw it after its bytes are read. */
  function redrawn({ what }: { what: string }): string {
    return `the page carries ${what}, which can change what a reader sees after the card reads its marks; a marked page is static HTML`;
  }

  it("refuses a mark holding anything but drawn text: code, a hidden run, a form control, or an inline style", () => {
    const inside = [
      '<p data-card="lean">A<style>.x{color:red}</style>, styled.</p>',
      '<p data-card="lean">A, <span hidden>not B, </span>styled.</p>',
      '<p data-card="lean"><select><option>A</option><option>B</option></select></p>',
      '<p data-card="lean">A<span style="opacity:0">, not really, B</span>.</p>',
      '<p data-card="lean" style="color: red">A.</p>',
    ].map((lean) => readPageCardMarks({ html: `${QUESTION}${lean}` })._unsafeUnwrapErr());

    expect(inside).toEqual([
      [holds({ what: "<style>" }), NO_LEAN],
      [holds({ what: "<span>" }), NO_LEAN],
      [holds({ what: "<select>" }), NO_LEAN],
      [holds({ what: "an inline style" }), NO_LEAN],
      [holds({ what: "an inline style" }), NO_LEAN],
    ]);
  });

  it("refuses a mark on or under a tag a browser does not draw as words: a closed dialog, a title", () => {
    const dialog = `${QUESTION}<dialog><p data-card="lean">B, never opened.</p></dialog>`;
    const title = '<title data-card="lean">B, the tab title.</title><p data-card="question">Which?</p>';

    expect(readPageCardMarks({ html: dialog })._unsafeUnwrapErr()).toEqual([CONCEALED, NO_LEAN]);
    expect(readPageCardMarks({ html: title })._unsafeUnwrapErr()).toEqual([CONCEALED, NO_LEAN]);
  });

  it("refuses a mark under an ancestor an inline style hides, a CSS comment included, but not under a styled box", () => {
    const hiddenBy = ({ style }: { style: string }): string =>
      `${QUESTION}<div style="${style}"><p data-card="lean">B.</p></div>`;

    expect(
      ["opacity: 0", "font-size:0px", "visibility:collapse", "content-visibility: hidden", "/*x*/display:none"].map(
        (style) => readPageCardMarks({ html: hiddenBy({ style }) })._unsafeUnwrapErr(),
      ),
    ).toEqual(Array.from({ length: 5 }, () => [CONCEALED, NO_LEAN]));
    expect(unwrap(readPageCardMarks({ html: hiddenBy({ style: "padding: 8px; opacity: 0.9" }) }))).toEqual({
      kind: "marked",
      lean: "B.",
      question: "Which?",
    });
  });

  it("refuses a lean marked inside a template, which the page never draws", () => {
    const html = '<p data-card="question">Which?</p><template><p data-card="lean">B, never drawn.</p></template>';

    expect(readPageCardMarks({ html })._unsafeUnwrapErr()).toEqual([CONCEALED, NO_LEAN]);
  });

  it("refuses a lean marked on a hidden element, whether by attribute or by inline style", () => {
    const attribute = '<p data-card="question">Which?</p><p hidden data-card="lean">B, hidden.</p>';
    const styled = '<p data-card="question">Which?</p><p style="color: red; display: none" data-card="lean">B.</p>';

    expect(readPageCardMarks({ html: attribute })._unsafeUnwrapErr()).toEqual([CONCEALED, NO_LEAN]);
    expect(readPageCardMarks({ html: styled })._unsafeUnwrapErr()).toEqual([CONCEALED, NO_LEAN]);
  });

  it("refuses a lean inside a CLOSED details, past its summary, while reading one inside an open details", () => {
    const question = '<p data-card="question">Which?</p><p>Lean: A.</p>';
    const closed = `${question}<details><summary>Earlier draft</summary><p data-card="lean">B, it can wait.</p></details>`;
    const open = `${question}<details open><summary>Lean</summary><p data-card="lean">A, now.</p></details>`;

    expect(readPageCardMarks({ html: closed })._unsafeUnwrapErr()).toEqual([CONCEALED, NO_LEAN]);
    expect(unwrap(readPageCardMarks({ html: open }))).toEqual({ kind: "marked", lean: "A, now.", question: "Which?" });
  });

  it("drops a struck run from the lean, since the page withdrew it", () => {
    const html =
      '<p data-card="question">Which?</p><p data-card="lean"><s>B, it can wait.</s> A, because they read it.</p>';

    expect(unwrap(readPageCardMarks({ html }))).toEqual({
      kind: "marked",
      lean: "A, because they read it.",
      question: "Which?",
    });
  });

  it("refuses a popover around the mark or inside it, which a browser hides until something opens it", () => {
    const around = `${QUESTION}<div popover><p data-card="lean">B, it can wait.</p></div>`;
    const inside = `${QUESTION}<p data-card="lean">A, <span popover>do not </span>merge.</p>`;

    expect(readPageCardMarks({ html: around })._unsafeUnwrapErr()).toEqual([CONCEALED, NO_LEAN]);
    expect(readPageCardMarks({ html: inside })._unsafeUnwrapErr()).toEqual([holds({ what: "<span>" }), NO_LEAN]);
  });

  it("refuses an image with alt text inside a mark, whose words a browser draws when the image fails", () => {
    const html = `${QUESTION}<p data-card="lean">A, <img alt="do not"> merge.</p>`;

    expect(readPageCardMarks({ html })._unsafeUnwrapErr()).toEqual([
      holds({ what: "an <img> with alt text" }),
      NO_LEAN,
    ]);
  });

  it("refuses a marked page carrying a script, a meta refresh or a shadow root, even with both marks sound", () => {
    const lean = '<p data-card="lean">B, it can wait.</p>';
    const pages = [
      `${QUESTION}${lean}<script>document.querySelector("p").textContent = "A";</script>`,
      `<meta http-equiv="Refresh" content="0; url=elsewhere.html">${QUESTION}${lean}`,
      `${QUESTION}<div><template shadowrootmode="open"><p>A, now.</p></template>${lean}</div>`,
    ];

    expect(pages.map((html) => readPageCardMarks({ html })._unsafeUnwrapErr())).toEqual([
      [redrawn({ what: "a <script>" })],
      [redrawn({ what: 'a <meta http-equiv="refresh">' })],
      [redrawn({ what: "a declarative shadow root" })],
    ]);
  });

  it("refuses script in every spelling a page can carry it: an event handler, a javascript: URL, a srcdoc", () => {
    const lean = '<p data-card="lean">B, it can wait.</p>';
    const pages = [
      `${QUESTION}${lean}<img src="missing.png" onerror="document.body.textContent = 'A'">`,
      `${QUESTION}${lean}<a href=" java\tscript:void(0)">open</a>`,
      `${QUESTION}${lean}<iframe srcdoc="<script>parent.document.body.textContent = 'A'</script>"></iframe>`,
      `${QUESTION}${lean}<a href="VBScript:msgbox">open</a>`,
      `${QUESTION}${lean}<iframe src="data:text/html,<p>A, now.</p>"></iframe>`,
    ];

    expect(pages.map((html) => readPageCardMarks({ html })._unsafeUnwrapErr())).toEqual([
      [redrawn({ what: "an onerror event handler" })],
      [redrawn({ what: "a javascript: URL" })],
      [redrawn({ what: "a <iframe srcdoc>" })],
      [redrawn({ what: "a vbscript: URL" })],
      [redrawn({ what: "a data: URL" })],
    ]);
  });

  it("reads a page embedding a screenshot as a data: image, or saying 'Data:' in a label", () => {
    const lean = '<p data-card="lean">B, it can wait.</p>';
    const pages = [
      `${QUESTION}${lean}<img src="data:image/png;base64,iVBORw0KGgo=">`,
      `${QUESTION}${lean}<img src="chart.png" alt="Data: weekly signups">`,
      `${QUESTION}${lean}<span title="Data: Hex export, 30 Sep">source</span>`,
    ];

    expect(pages.map((html) => readPageCardMarks({ html })._unsafeUnwrap())).toEqual(
      pages.map(() => ({ kind: "marked", lean: "B, it can wait.", question: "Which?" })),
    );
  });

  it("refuses a mark in a named details group, which a browser may close on insertion, open attribute or not", () => {
    const html = `${QUESTION}<details open name="g"><summary>Lean</summary><p data-card="lean">B, it can wait.</p></details>`;

    expect(readPageCardMarks({ html })._unsafeUnwrapErr()).toEqual([CONCEALED, NO_LEAN]);
  });

  it("refuses a mark whose words a browser may reorder: a dir attribute or a bidirectional control character", () => {
    const withDir = `${QUESTION}<p dir="rtl" data-card="lean"><span>B</span> ahead of <span>A</span></p>`;
    const withControl = `${QUESTION}<p data-card="lean">‮B ahead of A</p>`;

    expect(readPageCardMarks({ html: withDir })._unsafeUnwrapErr()).toEqual([
      holds({ what: "a dir attribute" }),
      NO_LEAN,
    ]);
    expect(readPageCardMarks({ html: withControl })._unsafeUnwrapErr()).toEqual([
      holds({ what: "a bidirectional control character" }),
      NO_LEAN,
    ]);
  });

  it("refuses a mark nested inside another, whose words would be read into both fields", () => {
    const html = '<div data-card="lean">A, because <span data-card="question">Which?</span></div>';

    expect(readPageCardMarks({ html })._unsafeUnwrapErr()).toEqual([
      'data-card="question" sits inside another data-card mark; mark two separate elements',
      'the page marks no data-card="question", and a card needs both sentences from it',
    ]);
  });
});
