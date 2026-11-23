/*
 * The owner's own words on a board row: the excerpt, the stored group read back through the real doc parser, and the
 * backfill's verdicts and writes (`handover quote`). Every group here is written by the same functions the verbs
 * call and read back by `parseHandoverDoc`, so a spelling the writer and the reader disagree on fails here.
 */
import { describe, expect, it } from "vitest";

import {
  quoteScope,
  quoteVerdict,
  quoteVerdictPhrase,
  rowText,
  textWithHisWords,
} from "../../../cli/commands/handover/quotePlan.js";
import { parseHandoverDoc } from "../../../handover/doc.js";
import { flatFields } from "../../../handover/docFlat.js";
import {
  HIS_WORDS_MAX,
  type HisWords,
  hisWordsExcerpt,
  ownerWordsSchemeOf,
  problemsBesideHisWords,
  unreadOwnerWords,
} from "../../../handover/hisWords.js";
import { HisWordsErrors } from "../../../handover/hisWordsErrors.js";
import { recordOfRead } from "../../../handover/hisWordsRecord.js";
import { err, ok, unwrap, unwrapErr } from "../../../lib/result.js";

const TALK = "talk:a0000015-0000-4000-8000-000000000016";
const PATH = "/h/the-ask.md";
const WORDS: HisWords = {
  anchor: TALK,
  cut: "none",
  atIso: "2026-09-28T06:03:54.584Z",
  where: "console-voice",
  words: 'my exact words, "prominent" on the card \\ really',
};

function docText({ anchor = TALK, extra = "" }: { anchor?: string; extra?: string }): string {
  return `---\nstatus: ready\nanchor: ${anchor}\n${extra}---\n\n# the ask\n`;
}

function quoted({ text }: { text: string }): string {
  return unwrap(textWithHisWords({ path: PATH, record: { hisWords: WORDS, kind: "held" }, text }));
}

describe("hisWordsExcerpt", () => {
  it("flattens whitespace and control characters into one line", () => {
    expect(hisWordsExcerpt({ headLost: false, text: "  merge it\n\ttoday\u0007 please " })).toEqual({
      cut: "none",
      words: "merge it today please",
    });
  });

  it("drops a control character between two letters rather than writing a space the record does not hold", () => {
    expect(hisWordsExcerpt({ headLost: false, text: "a\u0007b\u0000c" })).toEqual({ cut: "none", words: "abc" });
  });

  it("reads whitespace by Unicode, not JS's \\s: U+0085 becomes a space, an inner U+FEFF is kept as it stands", () => {
    expect(hisWordsExcerpt({ headLost: false, text: "a\u0085b﻿c" })).toEqual({ cut: "none", words: "a b﻿c" });
  });

  it("keeps a U+FEFF at either end, since it is not whitespace, and trims only the collapsed space", () => {
    expect(hisWordsExcerpt({ headLost: false, text: " \uFEFFhello\uFEFF\n" })).toEqual({
      cut: "none",
      words: "\uFEFFhello\uFEFF",
    });
  });

  it("drops a lone surrogate rather than writing a U+FFFD the record does not hold, and keeps a paired one", () => {
    expect(hisWordsExcerpt({ headLost: false, text: "a\uD800b 😀" })).toEqual({ cut: "none", words: "ab 😀" });
  });

  it("keeps exactly the cap and marks nothing cut", () => {
    const text = "a".repeat(HIS_WORDS_MAX);
    expect(hisWordsExcerpt({ headLost: false, text })).toEqual({ cut: "none", words: text });
  });

  it("cuts the tail past the cap, counting code points", () => {
    const text = "😀".repeat(HIS_WORDS_MAX + 1);
    expect(hisWordsExcerpt({ headLost: false, text })).toEqual({ cut: "end", words: "😀".repeat(HIS_WORDS_MAX) });
  });

  // The cap bounds code points and cuts between graphemes, so a flag straddling it is
  // dropped whole at either end, and one grapheme longer than the cap is still held to it.
  it("drops a grapheme the cap would split, whole, and holds one longer than the cap to it", () => {
    const flag = "🇦🇺";
    const head = `${"a".repeat(HIS_WORDS_MAX - 1)}${flag}`;
    const tail = `${flag}${"z".repeat(HIS_WORDS_MAX - 1)}`;
    const stacked = `e${"́".repeat(HIS_WORDS_MAX * 2)}`;
    expect([
      hisWordsExcerpt({ headLost: false, text: head }),
      hisWordsExcerpt({ headLost: true, text: tail }),
      Array.from(hisWordsExcerpt({ headLost: false, text: stacked })!.words).length,
    ]).toEqual([
      { cut: "end", words: "a".repeat(HIS_WORDS_MAX - 1) },
      { cut: "start", words: "z".repeat(HIS_WORDS_MAX - 1) },
      HIS_WORDS_MAX,
    ]);
  });

  it("keeps the record's own tail, with no mark written into it, when the record lost its head", () => {
    const text = `${"x".repeat(HIS_WORDS_MAX)}the end`;
    expect(hisWordsExcerpt({ headLost: true, text })).toEqual({
      cut: "start",
      words: text.slice(-HIS_WORDS_MAX),
    });
  });

  it("keeps a space or U+FEFF the cap lands beside, at either end, since it is theirs", () => {
    const head = `${"a".repeat(HIS_WORDS_MAX - 1)} b`;
    const tail = `a ﻿${"z".repeat(HIS_WORDS_MAX - 2)}`;
    expect([hisWordsExcerpt({ headLost: false, text: head }), hisWordsExcerpt({ headLost: true, text: tail })]).toEqual(
      [
        { cut: "end", words: `${"a".repeat(HIS_WORDS_MAX - 1)} ` },
        { cut: "start", words: ` ﻿${"z".repeat(HIS_WORDS_MAX - 2)}` },
      ],
    );
  });

  it("keeps a tail-only record within the cap whole, every character of it", () => {
    const text = `${"y".repeat(HIS_WORDS_MAX - 7)}the end`;
    expect(hisWordsExcerpt({ headLost: true, text })).toEqual({ cut: "start", words: text });
  });

  it("gives nothing for whitespace alone", () => {
    expect(hisWordsExcerpt({ headLost: false, text: " \n\t " })).toBeUndefined();
  });
});

describe("ownerWordsSchemeOf", () => {
  it("names each scheme by its exact prefix, and none for a pointer elsewhere or a spelling the resolver refuses", () => {
    expect(
      [
        "talk:a",
        "call:b#1",
        "talk-call:c#s",
        "transcript:d#e",
        "Transcript:d#e",
        "https://x.slack.com/p1",
        undefined,
      ].map((anchor) => ownerWordsSchemeOf({ anchor })),
    ).toEqual(["talk", "call", "talk-call", "transcript", undefined, undefined, undefined]);
  });
});

describe("a stored group read back through the doc parser", () => {
  it("reads a written quote back byte for byte, quotes and backslashes included", () => {
    const doc = parseHandoverDoc({ path: PATH, text: quoted({ text: docText({}) }) });
    expect([doc.problems, doc.hisWords]).toEqual([[], { hisWords: WORDS, kind: "held" }]);
  });

  it("reads a quote holding an inner or edge U+FEFF back as written", () => {
    const hisWords = { ...WORDS, words: "\uFEFFa﻿b\uFEFF" };
    const text = unwrap(textWithHisWords({ path: PATH, record: { hisWords, kind: "held" }, text: docText({}) }));
    expect(parseHandoverDoc({ path: PATH, text }).hisWords).toEqual({ hisWords, kind: "held" });
  });

  it("reads a cut quote whose edge the cap left on a space back as written", () => {
    const hisWords = { ...WORDS, cut: "end", words: "open PRs right " } as const;
    const text = unwrap(textWithHisWords({ path: PATH, record: { hisWords, kind: "held" }, text: docText({}) }));
    expect(parseHandoverDoc({ path: PATH, text }).hisWords).toEqual({ hisWords, kind: "held" });
  });

  it("reads a written unread record back", () => {
    const record = unreadOwnerWords({ anchor: TALK, why: "no relay\nturn carries it" });
    const text = unwrap(textWithHisWords({ path: PATH, record, text: docText({}) }));
    expect(parseHandoverDoc({ path: PATH, text }).hisWords).toEqual({
      anchor: TALK,
      kind: "unread",
      why: "no relay turn carries it",
    });
  });

  it("reads a group stored under the pronoun keys as the same record, and the backfill leaves it as stored", () => {
    const pronoun = quoted({ text: docText({}) }).replaceAll(/^ownerWords/gmu, "hisWords");
    const doc = parseHandoverDoc({ path: PATH, text: pronoun });
    expect(pronoun).toContain("\nhisWordsIso: ");
    expect([doc.problems, doc.hisWords]).toEqual([[], { hisWords: WORDS, kind: "held" }]);
    expect(quoteVerdict({ doc, read: ok(WORDS) }).kind).toBe("current");
  });

  it("rewrites a pronoun group it must replace under the owner-neutral keys alone", () => {
    const pronoun = quoted({ text: docText({}) }).replaceAll(/^ownerWords/gmu, "hisWords");
    const later = { ...WORDS, words: "a later reading" };
    const text = unwrap(textWithHisWords({ path: PATH, record: { hisWords: later, kind: "held" }, text: pronoun }));
    expect(text.match(/^(?:his|owner)Words[A-Za-z]*(?=:)/gmu)).toEqual([
      "ownerWords",
      "ownerWordsAnchor",
      "ownerWordsIso",
      "ownerWordsWhere",
      "ownerWordsCut",
    ]);
    expect(parseHandoverDoc({ path: PATH, text }).hisWords).toEqual({ hisWords: later, kind: "held" });
  });

  it("is a defect, not a doc problem, when one key is declared under both spellings", () => {
    const text = quoted({ text: docText({}) }).replace(
      "ownerWordsCut: none\n",
      "ownerWordsCut: none\nhisWordsCut: end\n",
    );
    const doc = parseHandoverDoc({ path: PATH, text });
    expect([doc.problems, doc.hisWords]).toEqual([
      [],
      { kind: "defect", why: "the stored quote declares ownerWordsCut more than once" },
    ]);
  });

  it("is a defect, not a doc problem, when one of its keys is declared twice", () => {
    const text = quoted({ text: docText({}) }).replace(
      "ownerWordsCut: none\n",
      "ownerWordsCut: none\nownerWordsCut: end\n",
    );
    const doc = parseHandoverDoc({ path: PATH, text });
    expect([doc.problems, doc.hisWords]).toEqual([
      [],
      { kind: "defect", why: "the stored quote declares ownerWordsCut more than once" },
    ]);
  });

  // The flat reader decodes an escaped `\n`, and the off-anchor defect quoted the anchor on one line.
  it("is a defect that does not quote the anchor when the stored anchor is not one line", () => {
    const text = quoted({ text: docText({}) }).replace(
      /^ownerWordsAnchor: .*$/mu,
      'ownerWordsAnchor: "talk:bad\\nFORGED"',
    );
    expect(parseHandoverDoc({ path: PATH, text }).hisWords).toEqual({
      kind: "defect",
      why: "the stored ownerWordsAnchor is not one line",
    });
  });

  it("is a defect when the quote was read off another anchor", () => {
    const text = quoted({ text: docText({}) }).replace(`anchor: ${TALK}\n`, "anchor: talk:another\n");
    expect(parseHandoverDoc({ path: PATH, text }).hisWords).toEqual({
      kind: "defect",
      why: `the stored quote was read off ${TALK}, not this row's anchor`,
    });
  });

  it("is a defect when a field is missing or will not read", () => {
    const missing = quoted({ text: docText({}) }).replace(/ownerWordsWhere: .*\n/u, "");
    const badIso = quoted({ text: docText({}) }).replace(/ownerWordsIso: .*\n/u, 'ownerWordsIso: "28 Sep"\n');
    expect([
      parseHandoverDoc({ path: PATH, text: missing }).hisWords,
      parseHandoverDoc({ path: PATH, text: badIso }).hisWords,
    ]).toEqual([
      { kind: "defect", why: "the stored quote is missing ownerWordsWhere" },
      { kind: "defect", why: "the stored quote's where, cut or instant does not read" },
    ]);
  });

  it("keeps a duplicate of a key outside the group as a doc problem", () => {
    const lines = ["status: ready", "status: done", "hisWords: a", "hisWords: b"];
    const flat = flatFields({ lines });
    expect(flat.duplicated).toEqual(["status", "hisWords"]);
    expect(problemsBesideHisWords({ duplicated: flat.duplicated, problems: flat.problems })).toEqual(
      flat.problems.filter((problem) => problem.includes("status")),
    );
    expect(problemsBesideHisWords({ duplicated: flat.duplicated, problems: flat.problems }).length).toBe(1);
  });
});

describe("the backfill's verdict", () => {
  const read = ok(WORDS);

  it("adds a quote to a row anchored on the owner's words that has none", () => {
    const doc = parseHandoverDoc({ path: PATH, text: docText({}) });
    expect(quoteVerdict({ doc, read })).toEqual({ kind: "add", record: { hisWords: WORDS, kind: "held" } });
  });

  it("leaves a current quote alone, and refreshes one the record has outgrown", () => {
    const doc = parseHandoverDoc({ path: PATH, text: quoted({ text: docText({}) }) });
    const grown = { ...WORDS, words: `${WORDS.words} and more` };
    expect([quoteVerdict({ doc, read }), quoteVerdict({ doc, read: ok(grown) }).kind]).toEqual([
      { kind: "current" },
      "refresh",
    ]);
  });

  it("records a read that failed, and does not rewrite it while it still fails", () => {
    const failed = err(HisWordsErrors.anchorMalformed({ anchor: TALK }));
    const fresh = parseHandoverDoc({ path: PATH, text: docText({}) });
    const verdict = quoteVerdict({ doc: fresh, read: failed });
    expect(verdict.kind).toBe("unread");
    const stored = unwrap(
      textWithHisWords({ path: PATH, record: recordOfRead({ anchor: TALK, read: failed }), text: docText({}) }),
    );
    expect(quoteVerdict({ doc: parseHandoverDoc({ path: PATH, text: stored }), read: failed }).kind).toBe(
      "still-unread",
    );
  });

  it("repairs a duplicated group into exactly one canonical record", () => {
    const text = quoted({ text: docText({}) }).replace(
      "ownerWordsCut: none\n",
      "ownerWordsCut: none\nownerWordsCut: end\n",
    );
    const doc = parseHandoverDoc({ path: PATH, text });
    const verdict = quoteVerdict({ doc, read });
    expect(verdict.kind).toBe("repair");
    const repaired = parseHandoverDoc({ path: PATH, text: quoted({ text }) });
    expect([repaired.problems, repaired.hisWords]).toEqual([[], { hisWords: WORDS, kind: "held" }]);
  });

  it("drops a group left behind when the anchor moved off the owner's words", () => {
    const text = quoted({ text: docText({}) }).replace(`anchor: ${TALK}\n`, "anchor: https://x.slack.com/p1\n");
    const doc = parseHandoverDoc({ path: PATH, text });
    const verdict = quoteVerdict({ doc, read: undefined });
    expect(verdict).toEqual({ kind: "drop", why: "its anchor https://x.slack.com/p1 does not name the owner's words" });
    const dropped = unwrap(textWithHisWords({ path: PATH, record: undefined, text }));
    expect(parseHandoverDoc({ path: PATH, text: dropped }).hisWords).toEqual({ kind: "absent" });
  });

  it("scopes rows anchored on the owner's words or carrying a group, settled ones included", () => {
    const docs = [
      parseHandoverDoc({ path: "/h/a.md", text: docText({}).replace("status: ready", "status: done") }),
      parseHandoverDoc({ path: "/h/b.md", text: docText({ anchor: "https://x.slack.com/p1" }) }),
    ];
    expect(quoteScope({ docs }).map((doc) => doc.slug)).toEqual(["a"]);
  });

  it("refuses to rewrite a row with CR line endings, rather than normalising every line of it", () => {
    const text = docText({}).replaceAll("\n", "\r\n");
    const written = textWithHisWords({ path: PATH, record: { hisWords: WORDS, kind: "held" }, text });
    expect(unwrapErr(written).code).toBe("EDIT_WOULD_DAMAGE");
  });

  it("refuses a quote that would not read back as written, rather than rewriting the row on every run", () => {
    // The row's bare `anchor:` is trimmed on read while the quoted `ownerWordsAnchor` keeps its space, so they differ.
    const anchor = `${TALK} `;
    const record = unreadOwnerWords({ anchor, why: "not a well-formed pointer" });
    expect(unwrapErr(textWithHisWords({ path: PATH, record, text: docText({ anchor }) })).message).toBe(
      "the quote as written would not read back as the same record, so every later run would rewrite it",
    );
  });

  it("refuses a row that is not valid UTF-8, rather than writing U+FFFD over the byte it could not read", () => {
    const bytes = new Uint8Array([...new TextEncoder().encode(docText({})), 0xff]);
    expect(unwrapErr(rowText({ bytes })).message).toBe(
      "the row is not valid UTF-8, and rewriting its quote would change the bytes that are not",
    );
  });

  it("reads a valid row as its text, a leading byte-order mark kept so it is written back", () => {
    const text = `﻿${docText({})}`;
    expect(unwrap(rowText({ bytes: new TextEncoder().encode(text) }))).toBe(text);
  });

  it("refuses to rewrite a group whose key is followed by a line that is not a key, rather than removing it", () => {
    const text = quoted({ text: docText({}) }).replace("ownerWordsCut: none\n", "ownerWordsCut: none\nx.meta: kept\n");
    const written = textWithHisWords({ path: PATH, record: undefined, text });
    expect(unwrapErr(written).message).toContain('the line after "ownerWordsCut" is not a key of its own');
  });

  it("names an anchored row whose front matter does not parse, rather than passing over it", () => {
    const doc = parseHandoverDoc({ path: PATH, text: docText({ extra: "status: done\n" }) });
    const verdict = quoteVerdict({ doc, read });
    expect(doc.problems.length).toBeGreaterThan(0);
    expect([quoteScope({ docs: [doc] }).length, verdict.kind]).toEqual([1, "malformed"]);
    expect(quoteVerdictPhrase({ applied: true, verdict })).toBe(
      `nothing written — the board reads a problem in its front matter, so the quote cannot be written safely: ${doc.problems.join("; ")}`,
    );
  });

  it("scopes a malformed row whose first anchor is not the owner's words, since its second may be", () => {
    const doc = parseHandoverDoc({
      path: PATH,
      text: docText({ anchor: "https://x.slack.com/p1", extra: `anchor: ${TALK}\n` }),
    });
    expect([doc.anchor, quoteScope({ docs: [doc] }).length, quoteVerdict({ doc, read }).kind]).toEqual([
      "https://x.slack.com/p1",
      1,
      "malformed",
    ]);
  });

  it("phrases a write as proposed on a dry run and done on an apply", () => {
    const verdict = { kind: "drop", why: "the row has no anchor" } as const;
    expect([quoteVerdictPhrase({ applied: false, verdict }), quoteVerdictPhrase({ applied: true, verdict })]).toEqual([
      "would drop the quote (the row has no anchor)",
      "drop the quote: done (the row has no anchor)",
    ]);
  });
});
