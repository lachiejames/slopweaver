/**
 * The private-terms file: its parser, its fail-closed loader, its refusal and status lines, and its matcher.
 * Every term is invented; the source cell carries a marker word so a test can prove it is never printed.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { privateTermHits, privateTermHitsBeside } from "../../../hygiene/privateTermMatches.js";
import {
  loadPrivateTerms,
  PRIVATE_TERM_CLASSES,
  type PrivateTermsLoad,
  parsePrivateTerms,
  printableUnderTerms,
  privateTermFindingSentence,
  privateTermsOrRefusal,
  privateTermsRefusal,
  privateTermsStatusLine,
  WITHHELD_REFUSAL_LINE,
} from "../../../hygiene/privateTerms.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";
import { writePrivateTerms } from "../../privateTermsFixture.js";

const HEADER = "class\tflags\tpattern\tsource";

/** The marker each source cell carries; nothing printed may contain it. */
const SOURCE = "provenance-marker-xq";

/** A row for a class, flags and pattern, its source the marker. */
const row = ({ className, flags = "i", pattern }: { className: string; flags?: string; pattern: string }): string =>
  [className, flags, pattern, SOURCE].join("\t");

/** A parse failure's message. */
const parseMessage = ({ text }: { text: string }): string => unwrapErr(parsePrivateTerms({ text })).message;

describe("parsePrivateTerms", () => {
  it("accepts every class in the closed set and keeps file order", () => {
    const text = [
      HEADER,
      ...PRIVATE_TERM_CLASSES.map((className) => row({ className, pattern: `t-${className}` })),
    ].join("\n");
    const terms = unwrap(parsePrivateTerms({ text }));
    expect(PRIVATE_TERM_CLASSES.length).toBe(9);
    expect(terms.map((term) => term.className)).toEqual([...PRIVATE_TERM_CLASSES]);
  });

  it("parses a header with no row to the explicit none", () => {
    expect(unwrap(parsePrivateTerms({ text: `# owner-only\n\n${HEADER}\n` }))).toEqual([]);
  });

  it("skips comments and blank lines and numbers rows by physical line, across CRLF", () => {
    const text = `# a comment\r\n\r\n${HEADER}\r\n# another\r\n${row({ className: "money", pattern: "(" })}\r\n`;
    expect(parseMessage({ text })).toBe("line 5 (class money): the pattern is not a valid regular expression");
  });

  it("compiles `i` as case-insensitive and `-` as case-sensitive", () => {
    const terms = unwrap(
      parsePrivateTerms({
        text: [
          HEADER,
          row({ className: "person", pattern: "quill" }),
          row({ className: "place", flags: "-", pattern: "Zorv" }),
        ].join("\n"),
      }),
    );
    expect(terms.map((term) => term.re.flags)).toEqual(["gi", "g"]);
  });

  it("refuses a missing header, naming the first content line", () => {
    expect(unwrapErr(parsePrivateTerms({ text: "# c\nclass\tflags\tpattern\n" }))).toEqual({
      code: "PRIVATE_TERMS_HEADER_MISSING",
      line: 2,
      message:
        "line 2: the first non-comment line must be the header class<TAB>flags<TAB>pattern<TAB>source, or id<TAB>class<TAB>flags<TAB>pattern<TAB>meaning<TAB>allowed-where<TAB>source",
    });
    expect(unwrapErr(parsePrivateTerms({ text: "" })).line).toBe(1);
  });

  it("refuses a row with the wrong cell count", () => {
    expect(parseMessage({ text: `${HEADER}\nperson\ti\tquill` })).toBe(
      "line 2 (class person): expected 4 tab-separated cells, got 3",
    );
  });

  it("refuses an unknown class without printing the cell, which may itself be a term", () => {
    const message = parseMessage({ text: `${HEADER}\n${row({ className: "Quillfeather", pattern: "x" })}` });
    expect(message).toBe(
      "line 2 (class <unknown, not printed>): the class must be one of owner-name, owner-handle, owner-address, person, organisation, place, health, money, topic",
    );
  });

  it("refuses an unknown flag, an empty pattern and a pattern matching the empty string", () => {
    expect(parseMessage({ text: `${HEADER}\n${row({ className: "topic", flags: "g", pattern: "x" })}` })).toBe(
      "line 2 (class topic): flags must be 'i' or '-'",
    );
    expect(parseMessage({ text: `${HEADER}\n${row({ className: "topic", pattern: "" })}` })).toBe(
      "line 2 (class topic): the pattern is empty",
    );
    expect(parseMessage({ text: `${HEADER}\n${row({ className: "topic", pattern: "a*" })}` })).toBe(
      "line 2 (class topic): the pattern matches the empty string, so it matches everywhere",
    );
  });

  it("refuses a pattern matching any part of the wording a finding prints, a class name included", () => {
    const refusal = ({ className }: { className: string }): string =>
      `line 2 (class ${className}): the pattern matches the wording every finding prints, a class name or the ` +
      "withheld-line stand-in included";
    expect(parseMessage({ text: `${HEADER}\n${row({ className: "person", pattern: "person" })}` })).toBe(
      refusal({ className: "person" }),
    );
    expect(parseMessage({ text: `${HEADER}\n${row({ className: "topic", flags: "i", pattern: "HEALTH" })}` })).toBe(
      refusal({ className: "topic" }),
    );
    expect(parseMessage({ text: `${HEADER}\n${row({ className: "place", pattern: "owner-" })}` })).toBe(
      refusal({ className: "place" }),
    );
    expect(parseMessage({ text: `${HEADER}\n${row({ className: "person", pattern: "private person" })}` })).toBe(
      refusal({ className: "person" }),
    );
    expect(parseMessage({ text: `${HEADER}\n${row({ className: "money", pattern: "redacted" })}` })).toBe(
      refusal({ className: "money" }),
    );
    expect(parseMessage({ text: `${HEADER}\n${row({ className: "topic", pattern: "withheld" })}` })).toBe(
      refusal({ className: "topic" }),
    );
  });

  it("accepts a term equal to a word of a locus prefix, and withholds the whole line that prints it", () => {
    const terms = unwrap(parsePrivateTerms({ text: `${HEADER}\n${row({ className: "topic", pattern: "title" })}` }));
    expect(printableUnderTerms({ line: "PR title line 1: a private topic term (redacted here)", terms })).toBe(
      WITHHELD_REFUSAL_LINE,
    );
    expect(printableUnderTerms({ line: "PR description line 1: clean", terms })).toBe("PR description line 1: clean");
    expect(privateTermHits({ forgiven: [], terms, text: WITHHELD_REFUSAL_LINE })).toEqual([]);
  });

  it("prints a finding sentence no accepted pattern matches", () => {
    const terms = unwrap(
      parsePrivateTerms({ text: `${HEADER}\n${row({ className: "person", pattern: "quillfeather" })}` }),
    );
    const sentence = privateTermFindingSentence({ className: "person" });
    expect(sentence).toBe(
      "a private person term (redacted here) — remove or generalise it, or if it is not private ask the chair to " +
        "narrow that terms row",
    );
    expect(privateTermHits({ forgiven: [], terms, text: sentence })).toEqual([]);
  });

  it("leaves a compiled pattern ready to match from the start after the wording check", () => {
    const [term] = unwrap(
      parsePrivateTerms({ text: `${HEADER}\n${row({ className: "person", pattern: "quillfeather" })}` }),
    );
    expect(term!.re.lastIndex).toBe(0);
    expect(term!.re.test("quillfeather")).toBe(true);
  });

  it("never prints a pattern or a source in any refusal", () => {
    const message = parseMessage({ text: `${HEADER}\n${row({ className: "health", pattern: "secretword(" })}` });
    expect(message).toBe("line 2 (class health): the pattern is not a valid regular expression");
    expect(message.includes("secretword")).toBe(false);
    expect(message.includes(SOURCE)).toBe(false);
  });
});

describe("loadPrivateTerms", () => {
  let home = "";
  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });
  const freshHome = (): string => {
    home = mkdtempSync(join(tmpdir(), "sw-terms-"));
    return home;
  };

  it("reads absent when no file sits at the path", () => {
    const dir = freshHome();
    expect(loadPrivateTerms({ home: dir })).toEqual({
      kind: "absent",
      path: join(dir, "hygiene", "private-terms.tsv"),
    });
  });

  it("loads a real 0600 file, and the explicit none", () => {
    const dir = freshHome();
    writePrivateTerms({ home: dir, rows: [row({ className: "person", pattern: "quill" })] });
    const loaded = loadPrivateTerms({ home: dir });
    expect(loaded.kind).toBe("loaded");
    expect(privateTermsStatusLine({ load: loaded })).toBe("hygiene: private terms LOADED 1");
    writePrivateTerms({ home: dir });
    expect(unwrap(privateTermsOrRefusal({ home: dir }))).toEqual([]);
  });

  it("answers the refusal sentence for an absent file", () => {
    const dir = freshHome();
    expect(unwrapErr(privateTermsOrRefusal({ home: dir }))).toBe(
      privateTermsRefusal({ load: { kind: "absent", path: join(dir, "hygiene", "private-terms.tsv") } }),
    );
  });

  it("refuses a file group or others can read", () => {
    const load = loadPrivateTerms({ fileMode: () => 0o100644, home: "/h", readText: () => `${HEADER}\n` });
    expect(load).toEqual({
      kind: "unreadable",
      path: "/h/hygiene/private-terms.tsv",
      reason: "mode 644 lets others read it; chmod 600 it",
    });
  });

  it("reads a failed read and a dangling link as unreadable", () => {
    const failing = (): string => {
      throw Object.assign(new Error("denied"), { code: "EACCES" });
    };
    const missing = (): string => {
      throw Object.assign(new Error("gone"), { code: "ENOENT" });
    };
    expect(loadPrivateTerms({ home: "/h", readText: failing })).toEqual({
      kind: "unreadable",
      path: "/h/hygiene/private-terms.tsv",
      reason: "EACCES",
    });
    expect(loadPrivateTerms({ home: "/h", nameExists: () => true, readText: missing })).toEqual({
      kind: "unreadable",
      path: "/h/hygiene/private-terms.tsv",
      reason: "ENOENT: a dangling link sits at the path",
    });
  });

  it("reads a malformed file as invalid, carrying the parse error", () => {
    const load = loadPrivateTerms({ fileMode: () => 0o100600, home: "/h", readText: () => "nope\n" });
    expect(load.kind).toBe("invalid");
    expect(privateTermsStatusLine({ load })).toBe(
      "hygiene: private terms UNREADABLE at /h/hygiene/private-terms.tsv (malformed at line 1: the first non-comment line must be the header class<TAB>flags<TAB>pattern<TAB>source, or id<TAB>class<TAB>flags<TAB>pattern<TAB>meaning<TAB>allowed-where<TAB>source) — every guarded write refuses",
    );
  });
});

describe("privateTermsRefusal and privateTermsStatusLine", () => {
  const PATH = "/h/hygiene/private-terms.tsv";

  it("names the file and the remedy when the file is absent", () => {
    const load: PrivateTermsLoad = { kind: "absent", path: PATH };
    expect(privateTermsRefusal({ load })).toBe(
      "hygiene: the private terms file /h/hygiene/private-terms.tsv does not exist, so no outbound write is checked for them. " +
        "Add a term with `slopweaver private-terms add`, or create it mode 0600 holding only the header line id<TAB>class<TAB>flags<TAB>pattern<TAB>meaning<TAB>allowed-where<TAB>source, which says there are none.",
    );
    expect(privateTermsStatusLine({ load })).toBe(
      "hygiene: private terms NOT PRESENT at /h/hygiene/private-terms.tsv — every guarded write refuses",
    );
  });

  it("names the reason when the file is unreadable, and the line and class when it is malformed", () => {
    expect(privateTermsRefusal({ load: { kind: "unreadable", path: PATH, reason: "EACCES" } })).toBe(
      "hygiene: the private terms file /h/hygiene/private-terms.tsv could not be relied on (EACCES).",
    );
    const error = unwrapErr(parsePrivateTerms({ text: `${HEADER}\nmoney\ti\t\t${SOURCE}` }));
    expect(privateTermsRefusal({ load: { error, kind: "invalid", path: PATH } })).toBe(
      "hygiene: the private terms file /h/hygiene/private-terms.tsv is malformed at line 2 (class money): the pattern is empty.",
    );
  });

  it("says EMPTY for the explicit none, distinct from every other status", () => {
    expect(privateTermsStatusLine({ load: { kind: "loaded", path: PATH, terms: [] } })).toBe(
      "hygiene: private terms EMPTY — the file says there are none",
    );
    expect(privateTermsStatusLine({ load: { kind: "unreadable", path: PATH, reason: "EACCES" } })).toBe(
      "hygiene: private terms UNREADABLE at /h/hygiene/private-terms.tsv (EACCES) — every guarded write refuses",
    );
  });
});

describe("privateTermHits", () => {
  const terms = unwrap(
    parsePrivateTerms({
      text: [
        HEADER,
        row({ className: "person", pattern: "quill" }),
        row({ className: "person", pattern: "feather" }),
      ].join("\n"),
    }),
  );

  it("reports each line once per class, in line order, never the matched text", () => {
    expect(privateTermHits({ forgiven: [], terms, text: "feather\nnothing\nquill and FEATHER" })).toEqual([
      { className: "person", line: 1 },
      { className: "person", line: 3 },
    ]);
  });

  it("finds nothing in an empty text or with no term", () => {
    expect(privateTermHits({ forgiven: [], terms, text: "" })).toEqual([]);
    expect(privateTermHits({ forgiven: [], terms: [], text: "quill" })).toEqual([]);
  });
});

describe("privateTermHitsBeside", () => {
  const terms = unwrap(
    parsePrivateTerms({ text: [HEADER, row({ className: "person", pattern: "quill" })].join("\n") }),
  );
  /** Exempts a match only when it ends inside the first ten characters: a stand-in for an owned span. */
  const firstTen = ({ end }: { end: number }) => (end <= 10 ? "owned" : undefined);

  it("counts an exempt match under its reason, and still hits an unexempt one of the same class on that line", () => {
    expect(privateTermHitsBeside({ exemptionOf: firstTen, terms, text: "a quill b quill\nquill" })).toEqual({
      exempted: [{ className: "person", reason: "owned" }],
      hits: [
        { className: "person", line: 1 },
        { className: "person", line: 2 },
      ],
    });
  });

  it("is privateTermHits exactly when nothing is exempt", () => {
    const text = "quill\nnothing\nQUILL";
    expect(privateTermHitsBeside({ exemptionOf: () => undefined, terms, text })).toEqual({
      exempted: [],
      hits: privateTermHits({ forgiven: [], terms, text }),
    });
  });
});
