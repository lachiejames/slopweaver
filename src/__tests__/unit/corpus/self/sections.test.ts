/**
 * Sectioning is the difference between the `self` connector working and being a no-op, so these tests are
 * about the BOUND rather than about tidiness: every section must fit inside the 1,200-character budget the
 * answer prompt clips at, whatever the input looks like.
 *
 * The "neuter it and watch retrieval break" half of the proof is in `sectionsReachability.test.ts`, which
 * asserts against the real prompt builder rather than against this module's own idea of the budget.
 */
import { describe, expect, it } from "vitest";

import {
  MAX_TITLE_CHARS,
  MIN_BODY_CHARS,
  PROMPT_RECORD_CHARS,
  slugifyHeading,
  splitIntoSections,
} from "../../../../corpus/self/sections.js";

/** A body of `count` identical paragraphs, each 100 characters plus its separator. */
function paragraphs({ count }: { count: number }): string {
  return Array.from({ length: count }, (_unused, index) => `${String(index).padStart(3, "0")} ${"x".repeat(96)}`).join(
    "\n\n",
  );
}

describe("splitIntoSections — heading boundaries", () => {
  it("splits at a level-2 heading, carrying the heading as the title and the prose as the text", () => {
    const sections = splitIntoSections({ text: "## First\nalpha\n\n## Second\nbeta" });

    expect(sections.length).toBe(2);
    expect(sections[0]!.title).toBe("First");
    expect(sections[0]!.text).toBe("alpha");
    expect(sections[1]!.title).toBe("Second");
    expect(sections[1]!.text).toBe("beta");
  });

  it("keeps prose written before the first heading, as an untitled section at ordinal 0", () => {
    const sections = splitIntoSections({ text: "loose opening thought\n\n## Later\nunder the heading" });

    expect(sections[0]!.ordinal).toBe(0);
    expect(sections[0]!.title).toBe("");
    expect(sections[0]!.text).toBe("loose opening thought");
    expect(sections[1]!.ordinal).toBe(1);
  });

  it("splits at every ATX level, so a file structured only with ### is not one blob", () => {
    const sections = splitIntoSections({ text: "# Title\nintro\n\n### Deep\ndetail\n\n###### Deepest\ntail" });

    expect(sections.map((section) => section.title)).toEqual(["Title", "Deep", "Deepest"]);
  });

  it("ignores a # inside a fenced code block, which is a comment and not a heading", () => {
    const sections = splitIntoSections({ text: "## Real\n```sh\n# not a heading\nls\n```\nafter the fence" });

    expect(sections.length).toBe(1);
    expect(sections[0]!.title).toBe("Real");
    expect(sections[0]!.text).toContain("# not a heading");
  });

  it("numbers ordinals in file order and reports how many parts each section produced", () => {
    const sections = splitIntoSections({ text: "## A\nalpha\n\n## B\nbeta" });

    expect(sections.map((section) => section.ordinal)).toEqual([0, 1]);
    expect(sections.map((section) => section.part)).toEqual([0, 0]);
    expect(sections.map((section) => section.parts)).toEqual([1, 1]);
  });

  it("keeps a heading with an empty body as a section carrying the heading as its text", () => {
    const sections = splitIntoSections({ text: "## Orphan heading\n\n## Next\nbody" });

    expect(sections[0]!.title).toBe("Orphan heading");
    expect(sections[0]!.text).toBe("Orphan heading");
  });

  it("yields nothing for an empty or whitespace-only file", () => {
    expect(splitIntoSections({ text: "" })).toEqual([]);
    expect(splitIntoSections({ text: "\n\n   \n" })).toEqual([]);
  });

  it("normalises CRLF, so a Windows-written file sections the same as a Unix one", () => {
    const sections = splitIntoSections({ text: "## First\r\nalpha\r\n\r\n## Second\r\nbeta" });

    expect(sections.map((section) => section.title)).toEqual(["First", "Second"]);
    expect(sections[0]!.text).toBe("alpha");
  });
});

describe("splitIntoSections — the character budget", () => {
  it("cuts a heading-free file into sections that each fit the budget", () => {
    const sections = splitIntoSections({ text: paragraphs({ count: 60 }) });

    expect(sections.length).toBeGreaterThan(1);
    expect(sections.filter((section) => section.text.length > PROMPT_RECORD_CHARS)).toEqual([]);
  });

  it("cuts at a paragraph boundary, so a slice never starts mid-sentence", () => {
    const sections = splitIntoSections({ text: paragraphs({ count: 30 }) });

    expect(sections[1]!.text.startsWith("0")).toBe(true);
  });

  it("keeps every paragraph of a cut file, losing none of the middle", () => {
    const sections = splitIntoSections({ text: paragraphs({ count: 40 }) });
    const rejoined = sections.map((section) => section.text).join("\n\n");

    expect(rejoined.includes("020 ")).toBe(true);
    expect(rejoined.includes("039 ")).toBe(true);
  });

  it("hard-cuts a single unbroken run of text, which no paragraph rule could split", () => {
    const sections = splitIntoSections({ text: "y".repeat(5000) });

    expect(sections.length).toBe(5);
    expect(sections.filter((section) => section.text.length > PROMPT_RECORD_CHARS)).toEqual([]);
  });

  it("cuts at a line boundary when there are no blank lines to cut at", () => {
    const sections = splitIntoSections({ text: Array.from({ length: 40 }, () => "z".repeat(90)).join("\n") });

    expect(sections.filter((section) => section.text.includes("\n\n"))).toEqual([]);
    expect(sections.filter((section) => section.text.length > PROMPT_RECORD_CHARS)).toEqual([]);
  });

  it("reserves the title's share of the budget, because the prompt joins title and text before clipping", () => {
    const title = "T".repeat(300);
    const sections = splitIntoSections({ text: `## ${title}\n${"w".repeat(3000)}` });

    expect(sections.filter((section) => `${section.title}\n${section.text}`.length > PROMPT_RECORD_CHARS)).toEqual([]);
  });

  /**
   * The bound is on `title + "\n" + text`, not on `text` alone, and this is where the first version broke.
   * A review pass supplied the counterexample: a 1,200-character heading plus a 400-character body came to
   * 1,601 characters, so the prompt's slice held only the title and the body was unreachable — the floor had
   * silently defeated the guarantee it sat inside. An over-long heading is demoted to body text instead.
   */
  it("demotes an over-long heading to body text rather than letting title+text overrun the budget", () => {
    const buried = "BURIED_AFTER_1200";
    const sections = splitIntoSections({ text: `# ${"T".repeat(1200)}\n${buried}${"x".repeat(1000)}` });

    expect(sections.filter((section) => `${section.title}\n${section.text}`.length > PROMPT_RECORD_CHARS)).toEqual([]);
    expect(sections.filter((section) => section.title.length > MAX_TITLE_CHARS)).toEqual([]);
    expect(sections.filter((section) => section.text.includes(buried)).length).toBe(1);
  });

  it("keeps the demoted heading's own words, since demotion is lossless where clipping is not", () => {
    const heading = "T".repeat(1200);
    const sections = splitIntoSections({ text: `## ${heading}\nthe body` });
    const rejoined = sections.map((section) => section.text).join("\n");

    expect(sections[0]!.title).toBe("");
    expect(rejoined.includes(heading.slice(0, 400))).toBe(true);
    expect(rejoined.includes("the body")).toBe(true);
  });

  it("demotes an over-long heading that has no body at all", () => {
    const sections = splitIntoSections({ text: `## ${"T".repeat(2000)}` });

    expect(sections.filter((section) => `${section.title}\n${section.text}`.length > PROMPT_RECORD_CHARS)).toEqual([]);
    expect(sections[0]!.title).toBe("");
  });

  it("keeps a heading exactly at the cap as a title", () => {
    const sections = splitIntoSections({ text: `## ${"T".repeat(MAX_TITLE_CHARS)}\nbody` });

    expect(sections[0]!.title.length).toBe(MAX_TITLE_CHARS);
    expect(sections[0]!.text).toBe("body");
  });

  it("floors the body budget, so a long-but-allowed heading cannot shred a file into slivers", () => {
    const sections = splitIntoSections({ text: `## ${"T".repeat(MAX_TITLE_CHARS)}\n${"w".repeat(4000)}` });

    expect(sections.every((section) => section.text.length <= MIN_BODY_CHARS)).toBe(true);
    expect(sections.length).toBe(10);
  });

  it("marks each slice with its index and the total, so a reader can see a section was cut", () => {
    const sections = splitIntoSections({ text: paragraphs({ count: 30 }) });

    expect(sections.map((section) => section.part)).toEqual([0, 1, 2]);
    expect(sections.map((section) => section.parts)).toEqual([3, 3, 3]);
    expect(sections.map((section) => section.ordinal)).toEqual([0, 0, 0]);
  });

  it("honours an explicit smaller budget", () => {
    const sections = splitIntoSections({ maxChars: 500, text: paragraphs({ count: 20 }) });

    expect(sections.length).toBe(5);
    expect(sections.filter((section) => section.text.length > 500)).toEqual([]);
  });

  it("is deterministic — the same bytes yield the same sections, which is what keeps sourceIds stable", () => {
    const text = `## Heading\n${paragraphs({ count: 25 })}`;

    expect(splitIntoSections({ text })).toEqual(splitIntoSections({ text }));
  });
});

describe("slugifyHeading", () => {
  it("kebab-cases a heading", () => {
    expect(slugifyHeading({ title: "The Money Shot: did I raise this?" })).toBe("the-money-shot-did-i-raise-this");
  });

  it("returns body for a heading with no usable characters", () => {
    expect(slugifyHeading({ title: "???" })).toBe("body");
    expect(slugifyHeading({ title: "" })).toBe("body");
  });

  it("caps the slug and leaves no trailing hyphen", () => {
    const slug = slugifyHeading({ title: `${"word ".repeat(40)}end` });

    expect(slug.length).toBe(59);
    expect(slug.endsWith("-")).toBe(false);
  });
});
