/**
 * The one parser for `docs/recurring-failure-register.md` — its class inventory across four different
 * grammars, and the `## Bindings` table.
 *
 * The DECOY cases are the point of this file rather than a flourish. The register carries two sections whose
 * bullets open with a backticked token that is NOT a class — `## Two latent gaps` names functions
 * (`docProblemsRefuse`, `runSeed`) and `## Two seed candidates` opens with bold prose — and a naive "first
 * backticked token in a bullet" reader mints classes that do not exist. A parser that invented two classes
 * would make the gate above it demand bindings rows for them forever.
 */
import { describe, expect, it } from "vitest";

import { liveClasses, parseBindingCell, parseRegisterDoc, tableCells } from "../../../reflect/registerDoc.js";
import { sectionOf } from "../../../reflect/registerSections.js";

/** A register carrying one row of every shape the real document uses, including both decoy sections. */
const REGISTER = [
  "# The recurring-failure register",
  "",
  "## Survivors — the live build candidates",
  "",
  "### Medium build cost",
  "",
  "| n   | class            | what it refuses | seam                  |",
  "| --- | ---------------- | --------------- | --------------------- |",
  "| 9   | `a-live-class`   | it refuses X    | `linkify/bareRefs.ts` |",
  "",
  "- **`a-prose-survivor`** — the general class behind three measured instances.",
  "",
  "## Gated — a class here is no longer a build candidate",
  "",
  "- **`a-gated-class`** — FULLY gated, by `some-gate` in `yarn lint`.",
  "",
  "## Refuted — 36 classes. Do not re-propose these.",
  "",
  "| class          | why it was refuted            |",
  "| -------------- | ----------------------------- |",
  "| `a-dead-class` | REFUTED — already gated twice |",
  "",
  "## Filed separately, folded in here rather than duplicated",
  "",
  "- `a-filed-class` — has its own handover doc; do not re-file it.",
  "",
  "## Two seed candidates that already have partial mechanism",
  "",
  "- **Review rounds capped** — `src/live/turn/reviewRounds.ts` already narrows. (`a-live-class`.)",
  "",
  "## Two latent gaps found while verifying, not from the transcripts",
  "",
  "- `docProblemsRefuse` (`src/cli/commands/handover/lifecycle.ts`) is called by `finish` but not `start`.",
  "",
  "## Owner-ruled additions after the mining pass",
  "",
  "- **`an-owner-ruled-class`** — measured across the fleet on the night of 1–2 Sep 2026.",
  "- **Gold evidence for the two voice classes, 2 Sep 2026.** The owner APPROVED a one-card page.",
  "",
  "## Bindings",
  "",
  "| class                  | binds                           | strength  |",
  "| ---------------------- | ------------------------------- | --------- |",
  "| `a-live-class`         | `fixture:an-incident`           | witnesses |",
  "| `a-prose-survivor`     | none                            | none      |",
  "| `a-gated-class`        | `gate:some-gate test:src/a.ts`  | closes    |",
  "| `an-owner-ruled-class` | none                            | none      |",
  "",
  "## Keeping it current",
  "",
  "Append here when the daily report surfaces a class that recurs.",
].join("\n");

const DOC = parseRegisterDoc({ text: REGISTER });

describe("parseRegisterDoc class inventory", () => {
  it("reads a class out of a Survivors table row, where the first cell is an instance count", () => {
    expect(DOC.classes.filter((one) => one.name === "a-live-class").map((one) => one.section)).toEqual(["survivors"]);
  });

  it("reads a class out of a bold prose bullet in the same section", () => {
    expect(DOC.classes.find((one) => one.name === "a-prose-survivor")!.section).toBe("survivors");
  });

  it("reads a class out of a Gated bullet", () => {
    expect(DOC.classes.find((one) => one.name === "a-gated-class")!.section).toBe("gated");
  });

  it("reads a class out of a Refuted table row, where the class is the FIRST cell", () => {
    expect(DOC.classes.find((one) => one.name === "a-dead-class")!.section).toBe("refuted");
  });

  it("carries the refutation reason, which is what the coverage reader matches against", () => {
    expect(DOC.classes.find((one) => one.name === "a-dead-class")!.reason).toBe("REFUTED — already gated twice");
  });

  it("reads a class out of a plain backticked bullet in Filed separately", () => {
    expect(DOC.classes.find((one) => one.name === "a-filed-class")!.section).toBe("filed");
  });

  it("reads a class out of an owner-ruled bullet", () => {
    expect(DOC.classes.find((one) => one.name === "an-owner-ruled-class")!.section).toBe("ownerRuled");
  });

  it("names the line a class sits on, so a finding can point at it", () => {
    expect(DOC.classes.find((one) => one.name === "a-live-class")!.line).toBe(9);
  });
});

describe("parseRegisterDoc decoys", () => {
  it("never mints a class from a latent-gaps bullet naming a FUNCTION", () => {
    expect(DOC.classes.map((one) => one.name)).not.toContain("docProblemsRefuse");
  });

  it("never mints a class from a seed-candidate bullet, whose title is bold prose", () => {
    expect(DOC.classes.filter((one) => one.name === "a-live-class")).toHaveLength(1);
  });

  it("never mints a class from an owner-ruled bullet that names none", () => {
    expect(DOC.classes.map((one) => one.name)).toEqual([
      "a-live-class",
      "a-prose-survivor",
      "a-gated-class",
      "a-dead-class",
      "a-filed-class",
      "an-owner-ruled-class",
    ]);
  });

  it("never reads a seam cell as a class, because a path is not kebab-case", () => {
    expect(DOC.classes.map((one) => one.name)).not.toContain("linkify/bareRefs.ts");
  });

  it("reads nothing inside a code fence, neither a heading nor a row, and is not fooled by an inline triple backtick", () => {
    const fenced = parseRegisterDoc({
      text: [
        "# Refuted",
        "",
        "```md",
        "# Example heading",
        "| `a-fenced-row` | REFUTED — an example, code only |",
        "```",
        "| `a-row-after-a-fence` | REFUTED — counted `grep -c '```'` |",
        "",
        "# Next",
        "",
        "| `a-row-outside` | REFUTED — x |",
      ].join("\n"),
    });
    expect(fenced.classes.map((one) => [one.name, one.section])).toEqual([["a-row-after-a-fence", "refuted"]]);
  });

  it("keeps a section open past a subheading that repeats its name, as `###` always did on one page", () => {
    const nested = parseRegisterDoc({
      text: [
        "# Survivors",
        "",
        "## Survivors by cost",
        "",
        "## Medium build cost",
        "",
        "| 1 | `a-nested-survivor` | a seam | a cost |",
      ].join("\n"),
    });
    expect(nested.classes.map((one) => [one.name, one.section])).toEqual([["a-nested-survivor", "survivors"]]);
  });
});

describe("liveClasses", () => {
  it("is Survivors, Gated and the owner-ruled additions, and nothing else", () => {
    expect(liveClasses({ doc: DOC }).map((one) => one.name)).toEqual([
      "a-live-class",
      "a-prose-survivor",
      "a-gated-class",
      "an-owner-ruled-class",
    ]);
  });

  it("excludes a refuted class, which owes no binding", () => {
    expect(liveClasses({ doc: DOC }).map((one) => one.name)).not.toContain("a-dead-class");
  });
});

describe("parseRegisterDoc bindings", () => {
  it("reads one row per class in the table", () => {
    expect(DOC.bindings.map((one) => one.className)).toEqual([
      "a-live-class",
      "a-prose-survivor",
      "a-gated-class",
      "an-owner-ruled-class",
    ]);
  });

  it("reads a fixture target", () => {
    expect(DOC.bindings[0]!.targets).toEqual([{ kind: "fixture", value: "an-incident" }]);
  });

  it("reads two targets of different kinds out of one backticked cell", () => {
    expect(DOC.bindings[2]!.targets).toEqual([
      { kind: "gate", value: "some-gate" },
      { kind: "test", value: "src/a.ts" },
    ]);
  });

  it("reads the strength", () => {
    expect(DOC.bindings[2]!.strength).toBe("closes");
  });

  it("reads `none` as zero targets rather than as a target named none", () => {
    expect(DOC.bindings[1]!.targets).toEqual([]);
  });

  it("reports no problems over a well-formed register", () => {
    expect(DOC.problems).toEqual([]);
  });

  it("skips the header and separator rows rather than reading them as classes", () => {
    expect(DOC.bindings).toHaveLength(4);
  });
});

describe("parseBindingCell", () => {
  it("reads a bare none", () => {
    expect(parseBindingCell({ cell: "none" })).toEqual({ problems: [], targets: [] });
  });

  it("strips the wrapping backticks the document needs to stop __tests__ rendering as bold", () => {
    expect(parseBindingCell({ cell: "`test:src/__tests__/unit/a.test.ts`" }).targets).toEqual([
      { kind: "test", value: "src/__tests__/unit/a.test.ts" },
    ]);
  });

  it("refuses none listed beside a real target, which would read as both answers at once", () => {
    expect(parseBindingCell({ cell: "none gate:x" }).problems).toEqual(["`none` listed beside a real target"]);
  });

  it("refuses an empty cell, so a blank is never mistaken for a deliberate none", () => {
    expect(parseBindingCell({ cell: "" }).problems).toEqual([
      "empty binds cell — write `none` rather than leaving it blank",
    ]);
  });

  it("refuses a token naming no kind", () => {
    expect(parseBindingCell({ cell: "bareRefs.test.ts" }).problems[0]).toContain("names no kind");
  });

  it("refuses an unknown kind rather than silently ignoring it", () => {
    expect(parseBindingCell({ cell: "doc:docs/security.md" }).problems[0]).toContain("unknown kind");
  });

  it("refuses a kind with no value", () => {
    expect(parseBindingCell({ cell: "gate:" }).problems[0]).toContain("names a kind with no value");
  });

  it("keeps the good targets beside a bad one, so one typo does not hide the rest", () => {
    const read = parseBindingCell({ cell: "gate:real doc:nope" });
    expect(read.targets).toEqual([{ kind: "gate", value: "real" }]);
    expect(read.problems).toHaveLength(1);
  });
});

describe("parseRegisterDoc problems", () => {
  it("names a row whose strength is not one of the four", () => {
    const doc = parseRegisterDoc({
      text: ["## Bindings", "", "| `a-class` | none | mostly |"].join("\n"),
    });
    expect(doc.problems[0]!.message).toContain("is not a strength");
  });

  it("refuses a strength of none beside a real target", () => {
    const doc = parseRegisterDoc({
      text: ["## Bindings", "", "| `a-class` | `gate:x` | none |"].join("\n"),
    });
    expect(doc.problems[0]!.message).toContain("strength `none` beside a real target");
  });

  it("refuses a real strength while binding nothing", () => {
    const doc = parseRegisterDoc({
      text: ["## Bindings", "", "| `a-class` | none | closes |"].join("\n"),
    });
    expect(doc.problems[0]!.message).toContain("while binding nothing");
  });

  it("names a row with fewer than three cells", () => {
    const doc = parseRegisterDoc({ text: ["## Bindings", "", "| `a-class` | none |"].join("\n") });
    expect(doc.problems[0]!.message).toContain("fewer than three cells");
  });

  it("names a row whose first cell is not a class", () => {
    const doc = parseRegisterDoc({ text: ["## Bindings", "", "| not a class | none | none |"].join("\n") });
    expect(doc.problems[0]!.message).toContain("names no class in its first cell");
  });
});

describe("sectionOf", () => {
  it("matches on the heading's opening words, so a trailing count may change freely", () => {
    expect(sectionOf({ heading: "## Survivors — 22 classes with a confirmed seam" })).toBe("survivors");
  });

  it("matches whole words only, so a title whose first word merely begins with a section name opens nothing", () => {
    expect(sectionOf({ heading: "# Gatedness — not the Gated section" })).toBeUndefined();
    expect(sectionOf({ heading: "# Gatedé — a letter outside ASCII" })).toBeUndefined();
    expect(sectionOf({ heading: "# Gated\u0301 — a combining mark" })).toBeUndefined();
    expect(sectionOf({ heading: "# Gated, and why" })).toBe("gated");
  });

  it("answers undefined for a heading it does not classify, which then contributes nothing", () => {
    expect(sectionOf({ heading: "## How it was mined, once, on 1 Sep 2026" })).toBeUndefined();
  });
});

describe("tableCells", () => {
  it("trims each cell, because Prettier repads every table on format", () => {
    expect(tableCells({ line: "|  a  |   b |" })).toEqual(["a", "b"]);
  });

  it("collapses a separator cell to a fixed token", () => {
    expect(tableCells({ line: "| --- | ------- |" })).toEqual(["---", "---"]);
  });
});

describe("a live class hidden from the parser by its punctuation", () => {
  // Every case here is a counterexample an adversarial review found against the first version, where the
  // bullet pattern demanded an em dash and a table cell was only ever unwrapped of backticks. Each one made
  // a live class INVISIBLE, so it owed no bindings row and the gate above stayed green at the old count
  // with nothing at all to tell the author. The shape, not the content, decided.
  it("reads a bullet punctuated with a colon rather than an em dash", () => {
    const doc = parseRegisterDoc({ text: ["## Gated", "", "- **`a-hidden-class`**: prose."].join("\n") });
    expect(doc.classes.map((one) => one.name)).toEqual(["a-hidden-class"]);
  });

  it("reads a bullet with no separator at all", () => {
    const doc = parseRegisterDoc({ text: ["## Gated", "", "- `a-hidden-class` prose."].join("\n") });
    expect(doc.classes.map((one) => one.name)).toEqual(["a-hidden-class"]);
  });

  it("reads a table cell whose class name is wrapped in bold outside the backticks", () => {
    const row = "| 1 | **`a-bold-class`** | it refuses X | `a.ts` |";
    const doc = parseRegisterDoc({ text: ["## Survivors", "", row].join("\n") });
    expect(doc.classes.map((one) => one.name)).toEqual(["a-bold-class"]);
  });

  it("reads a table cell whose bold sits inside the backticks", () => {
    const row = "| 1 | `**a-bold-class**` | it refuses X | `a.ts` |";
    const doc = parseRegisterDoc({ text: ["## Survivors", "", row].join("\n") });
    expect(doc.classes.map((one) => one.name)).toEqual(["a-bold-class"]);
  });

  // The SECOND adversarial review's counterexamples. After the separator was dropped, a class was still
  // invisible when the bullet carried any furniture in front of it — and `yarn prettier --check` calls every
  // one of these correctly formatted, so `pre-commit` would never normalise them away.
  it.each([
    ["a nested sub-bullet", "  - **`a-hidden-class`** — prose."],
    ["a numbered list item", "1. **`a-hidden-class`** — prose."],
    ["a tab-indented bullet", "\t- **`a-hidden-class`** — prose."],
    ["a blockquoted bullet", "> - **`a-hidden-class`** — prose."],
    ["an asterisk bullet", "* **`a-hidden-class`** — prose."],
    ["a bullet folded into a disclosure block", "<details><summary>- **`a-hidden-class`** — prose.</summary>"],
    ["a bolded name carrying no backticks", "- **a-hidden-class** — prose."],
  ])("reads a class declared as %s", (_shape, bullet) => {
    const doc = parseRegisterDoc({ text: ["## Gated", "", bullet].join("\n") });
    expect(doc.classes.map((one) => one.name)).toEqual(["a-hidden-class"]);
  });

  // The third adversarial review's counterexamples. The second fix normalised a list item's
  // FURNITURE, which closed every shape that was still a list item — and left every shape that is not one.
  // Each of these was run against the real gate over the real register: all three reported
  // `clean (38 live class(es))`, the unchanged count, while a live class owed a bindings row and had none.
  // Reproduce on the pre-fix parser by inserting the line into `## Gated` and running
  // `yarn tsx src/devLint/registerBindings.entry.ts`.
  it.each([
    ["its own subheading, which `## Survivors` already uses", "### `a-hidden-class`"],
    ["a bolded ordinary paragraph", "**`a-hidden-class`** — prose."],
    ["an HTML list item with an HTML code span", "<ul><li><code>a-hidden-class</code> — prose.</li></ul>"],
    ["an HTML paragraph", "<p><code>a-hidden-class</code> — prose.</p>"],
  ])("REPORTS a class declared as %s, which opens a block but no list item", (_shape, line) => {
    const doc = parseRegisterDoc({ text: ["## Gated", "", line].join("\n") });
    expect(doc.classes).toEqual([]);
    expect(doc.problems[0]!.message).toContain("looks like it declares a class");
  });

  it("says nothing about an INDENTED continuation opening with a backticked gate name", () => {
    // Measured on the committed register: eight wrapped continuation lines open with a backticked
    // kebab-case gate name, flag or hook. Indentation is what makes them continuations, and it is the only
    // thing separating them from the block openers above — so this is the falsifying half of that pair.
    const text = ["## Gated", "", "- **`a-real-class`** — gated by", "  `reverts-main` and nothing else."];
    const doc = parseRegisterDoc({ text: text.join("\n") });
    expect(doc.classes.map((one) => one.name)).toEqual(["a-real-class"]);
    expect(doc.problems).toEqual([]);
  });

  it("REPORTS a class-shaped name folded into a disclosure with no list marker at all", () => {
    const line = "<details><summary>**`a-folded-class`** — prose.</summary>";
    const doc = parseRegisterDoc({ text: ["## Gated", "", line].join("\n") });
    expect(doc.classes).toEqual([]);
    expect(doc.problems[0]!.message).toContain("looks like it declares a class");
  });

  it("never reads a hyphenated ordinary word as a class, which is what the delimiter requirement buys", () => {
    const doc = parseRegisterDoc({ text: ["## Gated", "", "- re-running the gate does not help."].join("\n") });
    expect(doc.classes).toEqual([]);
    expect(doc.problems).toEqual([]);
  });

  it("REPORTS a class-shaped live line it still could not read, rather than passing over it", () => {
    const row = "| 1 | _`an-italic-class`_ | it refuses X | `a.ts` |";
    const doc = parseRegisterDoc({ text: ["## Survivors", "", row].join("\n") });
    expect(doc.classes).toEqual([]);
    expect(doc.problems[0]!.message).toContain("looks like it declares a class");
  });

  it("says nothing about an ordinary prose line that quotes a class name, which the register does constantly", () => {
    const prose = "The class `a-quoted-class` is discussed here in a sentence.";
    expect(parseRegisterDoc({ text: ["## Survivors", "", prose].join("\n") }).problems).toEqual([]);
  });

  it("says nothing about a seam cell, which is a path rather than a class", () => {
    const row = "| 1 | `a-real-class` | it refuses X | `linkify/bareRefs.ts` |";
    expect(parseRegisterDoc({ text: ["## Survivors", "", row].join("\n") }).problems).toEqual([]);
  });

  it("says nothing about a class-shaped line in a section that is not live", () => {
    const row = "| _`an-italic-class`_ | REFUTED — gated |";
    expect(parseRegisterDoc({ text: ["## Refuted", "", row].join("\n") }).problems).toEqual([]);
  });
});

describe("a register that has drifted out of shape", () => {
  it("yields no classes rather than wrong ones, which is the missing-is-safe direction", () => {
    expect(parseRegisterDoc({ text: "# register\n\nsome prose and no headings at all" }).classes).toEqual([]);
  });

  it("yields no bindings when the Bindings heading is gone", () => {
    expect(parseRegisterDoc({ text: "## Survivors\n\n| 1 | `a-class` | x | y |" }).bindings).toEqual([]);
  });
});

describe("parseRegisterDoc over one page of the register", () => {
  it("keeps a page's opening section through its own ## sub-headings", () => {
    const text = "# Survivors — the live candidates\n\n## Medium build cost\n\n| 1 | `a-survivor` | seam | cost |";
    expect(parseRegisterDoc({ text }).classes.map((one) => [one.name, one.section])).toEqual([
      ["a-survivor", "survivors"],
    ]);
  });

  it("switches section at a ## heading the page's # heading did not name", () => {
    const text = "# Refuted\n\n| `a-dead-class` | x |\n\n## Filed separately\n\n- `a-filed-class` — own doc.";
    expect(parseRegisterDoc({ text }).classes.map((one) => [one.name, one.section])).toEqual([
      ["a-dead-class", "refuted"],
      ["a-filed-class", "filed"],
    ]);
  });

  it("ends a ##-opened section at an unrecognised ## heading, so a seed candidate is never read as filed", () => {
    const text = "## Filed separately\n\n- `a-filed-class` — own doc.\n\n## Two seed candidates\n\n- `a-seed` — decoy.";
    expect(parseRegisterDoc({ text }).classes.map((one) => one.name)).toEqual(["a-filed-class"]);
  });

  it("never ends a ## section at a ### heading beneath it", () => {
    const text = "## Gated\n\n### Closed by a gate\n\n- `a-gated-class` — closed.";
    expect(parseRegisterDoc({ text }).classes.map((one) => [one.name, one.section])).toEqual([
      ["a-gated-class", "gated"],
    ]);
  });

  it("carries the page's path on every class, binding and problem it reads", () => {
    const text = [
      "# Survivors",
      "",
      "| 1 | `a-survivor` | seam | cost |",
      "",
      "# Bindings",
      "",
      "| `a-survivor` | none | none |",
      "| `b-survivor` | none | strong |",
    ].join("\n");
    const doc = parseRegisterDoc({ path: "docs/page.md", text });
    expect(doc.classes.map((one) => one.path)).toEqual(["docs/page.md"]);
    expect(doc.bindings.map((row) => row.path)).toEqual(["docs/page.md"]);
    expect(doc.problems.map((one) => one.path)).toEqual(["docs/page.md"]);
  });

  it("defaults the path to the parent page, which is what a single-page read has always meant", () => {
    expect(parseRegisterDoc({ text: "## Gated\n\n- `a-gated-class` — closed." }).classes[0]!.path).toBe(
      "docs/recurring-failure-register.md",
    );
  });
});
