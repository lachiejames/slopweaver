/**
 * The owner-pronoun class's own tests: the four words are counted whole and in any case, a regular-expression
 * literal is left out because it recognises any speaker, an identifier never matches, and the transient-references
 * gate that runs the class counts it per file and reads prose and code with data and this class's own files left out.
 */
import { describe, expect, it } from "vitest";
import { scanOwnerPronouns } from "../../../devLint/ownerPronouns.js";
import { countsOf, isScannablePath, scanTransientReferences } from "../../../devLint/transientReferences.js";

/** The parts of a hit a case asserts, with the offset left out because it only keeps two findings apart. */
const shapes = ({ path, content }: { path: string; content: string }) =>
  scanOwnerPronouns({ content, path }).map((hit) => ({ line: hit.line, word: hit.word }));

describe("scanOwnerPronouns", () => {
  it("counts each of the four words, whole and in any case, on the line it sits on", () => {
    const content = ["He asked for it.", "", "Tell him, then his card; HIMSELF too."].join("\n");

    expect(shapes({ content, path: "docs/example.md" })).toStrictEqual([
      { line: 1, word: "he" },
      { line: 3, word: "him" },
      { line: 3, word: "his" },
      { line: 3, word: "himself" },
    ]);
  });

  it("never matches inside a longer word or an identifier", () => {
    const content = "the help sheet: hisWords, himTurnId, his_words, shed, ethics, theme, chemist";

    expect(shapes({ content, path: "docs/example.md" })).toStrictEqual([]);
  });

  it("counts a contraction, since the pronoun is still there", () => {
    expect(shapes({ content: "he's away and he'd said so", path: "docs/example.md" })).toStrictEqual([
      { line: 1, word: "he" },
      { line: 1, word: "he" },
    ]);
  });

  it("counts a comment, a string and JSX text in TypeScript", () => {
    const content = [
      "// he reads this",
      'const a = "posted as him";',
      "const b = `for ${x} and his`;",
      "const c = <p>he sees it</p>;",
    ].join("\n");

    expect(shapes({ content, path: "site/components/Example.tsx" })).toStrictEqual([
      { line: 1, word: "he" },
      { line: 2, word: "him" },
      { line: 3, word: "his" },
      { line: 4, word: "he" },
    ]);
  });

  it("leaves out a regular-expression literal, which recognises any speaker", () => {
    const content = ["const asks = /^(?:does he|do they)\\b/i;", "// but he is counted here"].join("\n");

    expect(shapes({ content, path: "src/briefing/example.ts" })).toStrictEqual([{ line: 2, word: "he" }]);
  });

  it("leaves out a RegExp constructor's pattern argument, but not its flags or another call's strings", () => {
    const content = [
      'const a = new RegExp("\\\\b(?:his|her)\\\\b", "i");',
      'const b = RegExp(`does ${"he"}`);',
      'const c = notRegExp("he");',
      'const d = new RegExp(pattern, "him");',
    ].join("\n");

    expect(shapes({ content, path: "src/briefing/example.ts" })).toStrictEqual([
      { line: 3, word: "he" },
      { line: 4, word: "him" },
    ]);
  });

  it("finds the RegExp constructor through parentheses and as a property, such as globalThis.RegExp", () => {
    const content = [
      'const a = new (RegExp)("he");',
      'const b = globalThis.RegExp("him");',
      'const c = new ((RegExp))("his");',
      'const d = other.notRegExp("he");',
    ].join("\n");

    expect(shapes({ content, path: "src/briefing/example.ts" })).toStrictEqual([{ line: 4, word: "he" }]);
  });

  it("treats a letter, mark or digit of any script as part of the word, so no pronoun hides inside one", () => {
    const content = "éhe hisé hé 2him him2 αhis, but -he- and (him) count";

    expect(shapes({ content, path: "docs/example.md" })).toStrictEqual([
      { line: 1, word: "he" },
      { line: 1, word: "him" },
    ]);
  });

  it("matches only the ASCII spellings, so a Unicode case fold such as the long s in hiſ is no pronoun", () => {
    expect(shapes({ content: "hiſ hımself HİM hE", path: "docs/example.md" })).toStrictEqual([{ line: 1, word: "he" }]);
  });

  it("reads a regular expression in a Markdown file as prose, since only the TypeScript AST knows a literal", () => {
    expect(shapes({ content: "match `/does he/`", path: "docs/example.md" })).toStrictEqual([{ line: 1, word: "he" }]);
  });

  it("returns nothing for a file with none of the words, without parsing it", () => {
    expect(scanOwnerPronouns({ content: "the owner asked; they wanted it", path: "src/x.ts" })).toStrictEqual([]);
  });

  it("numbers lines across LF, CRLF and a lone CR alike", () => {
    expect(shapes({ content: "he\rhim\r\nhis\nhimself", path: "docs/example.md" })).toStrictEqual([
      { line: 1, word: "he" },
      { line: 2, word: "him" },
      { line: 3, word: "his" },
      { line: 4, word: "himself" },
    ]);
  });

  it("carries the whole line as a clipped preview", () => {
    const hit = scanOwnerPronouns({ content: "first\n  he   wants it  ", path: "docs/example.md" })[0]!;

    expect(hit.preview).toBe("he wants it");
    expect(hit.offset).toBe(8);
  });
});

describe("countsOf, over the pronoun class", () => {
  it("collapses hits into one entry per file, in path order", () => {
    const hits = [
      ...scanTransientReferences({ content: "he and him", path: "skills/b.md" }),
      ...scanTransientReferences({ content: "his", path: "docs/a.md" }),
    ];

    expect(countsOf({ hits })).toStrictEqual([
      { count: 1, kind: "owner-pronoun", path: "docs/a.md" },
      { count: 2, kind: "owner-pronoun", path: "skills/b.md" },
    ]);
  });

  it("is empty for no hits", () => {
    expect(countsOf({ hits: [] })).toStrictEqual([]);
  });
});

describe("isScannablePath, for the pronoun class", () => {
  it("reads prose and code anywhere in the tree, tests included", () => {
    const paths = [
      "AGENTS.md",
      "skills/github/SKILL.md",
      "site/content/docs/page.mdx",
      "src/__tests__/unit/x.test.ts",
      "site/components/Example.tsx",
      "scripts/hook.sh",
      "docs/diagrams/voice.mmd",
      "lefthook.yml",
      "site/app/console-tw.css",
    ];

    expect(paths.filter((path) => isScannablePath({ path }))).toStrictEqual(paths);
  });

  it("leaves out the pronoun class's own source and test", () => {
    const paths = ["src/devLint/ownerPronouns.ts", "src/__tests__/unit/devLint/ownerPronouns.test.ts"];

    expect(paths.filter((path) => isScannablePath({ path }))).toStrictEqual([]);
  });

  it("scans a JSON or JSONL data file, but never for a pronoun", () => {
    const paths = [
      "src/__tests__/fixtures/contract/profile-steers.json",
      "site/__tests__/unit/fixtures/repeated-ask.jsonl",
    ];
    const content = JSON.stringify({ said: "He asked for it." });

    expect(paths.filter((path) => isScannablePath({ path }))).toStrictEqual(paths);
    expect(paths.flatMap((path) => scanTransientReferences({ content, path }))).toStrictEqual([]);
  });
});
