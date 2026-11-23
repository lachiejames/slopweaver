/**
 * The two halves `memoryWriteDefects` composes, tested directly, and the before/after judge an `Edit` goes
 * through. Both halves are properties of TEXT, so each is worth its own falsifiable cases rather than only
 * being reachable through the composed judge; the third describe covers what a FRAGMENT alone cannot decide.
 */
import { describe, expect, it } from "vitest";

import { datedAddenda } from "../../../memory/addendum.js";
import { declaredNameInWrite, unresolvableWikilinkTargets, writeIntroducedDefects } from "../../../memory/writeGate.js";

const WHOLE = ["---", "name: owner-does-not-visit-boards", "description: a fact", "---", "", "body"].join("\n");

/** No sibling and no canon, so only the file-local questions are under test. */
const NO_OVERLAP = { sections: [], siblings: [] } as const;

describe("declaredNameInWrite, whole file", () => {
  it("reads the frontmatter name", () => {
    expect(declaredNameInWrite({ file: "a.md", kind: "whole-file", text: WHOLE })).toBe("owner-does-not-visit-boards");
  });

  it("is null when there is no frontmatter at all", () => {
    expect(declaredNameInWrite({ file: "a.md", kind: "whole-file", text: "just prose\n" })).toBe(null);
  });

  it("ignores a name: line in the BODY, because the real parser reads the fences", () => {
    const text = ["---", "description: a fact", "---", "", "name: not-the-declaration"].join("\n");
    expect(declaredNameInWrite({ file: "a.md", kind: "whole-file", text })).toBe(null);
  });
});

describe("declaredNameInWrite, fragment", () => {
  it("reads a bare name: line", () => {
    expect(declaredNameInWrite({ file: "a.md", kind: "fragment", text: "name: some-fact\n" })).toBe("some-fact");
  });

  it("trims the surrounding whitespace the pattern deliberately does not capture", () => {
    expect(declaredNameInWrite({ file: "a.md", kind: "fragment", text: "name:   some-fact  \n" })).toBe("some-fact");
  });

  it("is null for a name: with nothing after it — that is schema's finding, not this gate's", () => {
    expect(declaredNameInWrite({ file: "a.md", kind: "fragment", text: "name:   \n" })).toBe(null);
  });

  it("is null when the fragment sets no name", () => {
    expect(declaredNameInWrite({ file: "a.md", kind: "fragment", text: "some replacement prose\n" })).toBe(null);
  });

  it("does not match a name: that is not at the start of a line", () => {
    expect(declaredNameInWrite({ file: "a.md", kind: "fragment", text: "the name: thing\n" })).toBe(null);
  });
});

describe("unresolvableWikilinkTargets", () => {
  it("is empty for a forward reference to a well-formed name", () => {
    expect(unresolvableWikilinkTargets({ text: "see [[no-such-memory-yet]]" })).toEqual([]);
  });

  it("reports a target that can never be a memory identity", () => {
    expect(unresolvableWikilinkTargets({ text: "see [[Some Document.md Thing]]" })).toEqual(["Some Document.md Thing"]);
  });

  it("treats [[thing.md]] as [[thing]] rather than a malformed target", () => {
    expect(unresolvableWikilinkTargets({ text: "see [[some-fact.md]]" })).toEqual([]);
  });

  it("deduplicates, keeping first-occurrence order", () => {
    expect(unresolvableWikilinkTargets({ text: "[[Bad One]] [[Other Bad]] [[Bad One]]" })).toEqual([
      "Bad One",
      "Other Bad",
    ]);
  });

  it("ignores a malformed link inside a fenced block", () => {
    expect(unresolvableWikilinkTargets({ text: "```\n[[Bad One]]\n```\n" })).toEqual([]);
  });

  it("is empty for text with no links at all", () => {
    expect(unresolvableWikilinkTargets({ text: "plain prose\n" })).toEqual([]);
  });
});

describe("an Edit is judged against the file it edits", () => {
  const FILE = "a-fact.md";
  const BEFORE = "---\nname: a-fact\ndescription: a fact\nmetadata:\n  type: project\n---\n\nSome body.\n";

  /** The shape the guard passes for an `Edit`, with only the varying parts named. */
  function edit({
    oldText,
    newText,
    priorText = BEFORE,
    replaceAll = false,
  }: {
    oldText: string;
    newText: string;
    priorText?: string | null;
    replaceAll?: boolean;
  }): readonly string[] {
    return writeIntroducedDefects({
      file: FILE,
      kind: "fragment",
      overlap: NO_OVERLAP,
      priorText,
      replaceAll,
      replacedText: oldText,
      text: newText,
    });
  }

  it("refuses a rename whose replacement text carries no `name:` token of its own", () => {
    // The r2 review's counterexample: the Edit tool wants a unique `old_string`, and in an ordinary leaf the
    // bare name occurs only on the `name:` line, so this is the spelling a caller actually reaches for.
    const defects = edit({ newText: "A_Fact", oldText: "a-fact" });

    expect(defects).toEqual([
      "`name: A_Fact` is not kebab-case — lowercase words joined by single hyphens, like `decisions-go-on-the-queue`; a wikilink written the natural way will not match anything else",
    ]);
  });

  it("refuses a rename that adds a type prefix", () => {
    expect(edit({ newText: "name: project-a-fact", oldText: "name: a-fact" })).toEqual([
      "`name: project-a-fact` opens with `project-` — `metadata.type` already carries the kind, so drop the prefix and name the fact",
    ]);
  });

  it("allows an edit that touches only the body", () => {
    expect(edit({ newText: "A longer body.", oldText: "Some body." })).toEqual([]);
  });

  it("allows an unrelated edit to a memory whose name is ALREADY malformed, and the edit that fixes it", () => {
    // Five real corpus defects stand accepted on this machine. A gate judging the after-state alone would
    // refuse every edit to those memories, the repair included.
    const broken = BEFORE.replace("name: a-fact", () => "name: A_Fact");

    expect(edit({ newText: "A longer body.", oldText: "Some body.", priorText: broken })).toEqual([]);
    expect(edit({ newText: "name: a-fact", oldText: "name: A_Fact", priorText: broken })).toEqual([]);
  });

  it("refuses a wikilink no memory can ever answer, arriving through an Edit", () => {
    expect(edit({ newText: "See [[.claude/rules/testing.md]].", oldText: "Some body." })).toEqual([
      "`[[.claude/rules/testing]]` is not a memory identity, so no memory can ever answer it — link to a memory's `name`, and put a pointer to a document in a markdown link instead",
    ]);
  });

  it("treats a replacement containing `$&` as text, never as a pattern", () => {
    // `String.replace`'s string form reads `$&` as the whole match, which would splice the file into itself
    // and have the gate judge something nobody wrote.
    const defects = edit({ newText: "$& and $` stay literal.", oldText: "Some body." });

    expect(defects).toEqual([]);
  });

  it("replaces every occurrence when the Edit says so", () => {
    const twice = "---\nname: a-fact\n---\n\na-fact and a-fact.\n";

    expect(edit({ newText: "A_Fact", oldText: "a-fact", priorText: twice, replaceAll: true })).toEqual([
      "`name: A_Fact` is not kebab-case — lowercase words joined by single hyphens, like `decisions-go-on-the-queue`; a wikilink written the natural way will not match anything else",
    ]);
  });

  it("falls back to the fragment when the prior text cannot be read", () => {
    expect(edit({ newText: "name: A_Fact", oldText: "name: a-fact", priorText: null })).toEqual([
      "`name: A_Fact` is not kebab-case — lowercase words joined by single hyphens, like `decisions-go-on-the-queue`; a wikilink written the natural way will not match anything else",
    ]);
  });
});

describe("a Write is judged the same way, against the file it replaces", () => {
  const FILE = "a-fact.md";
  const BROKEN = "---\nname: A_Fact\ndescription: a fact\nmetadata:\n  type: project\n---\n\nSome body.\n";

  /** The shape the guard passes for a `Write`. */
  function write({ text, priorText }: { text: string; priorText: string | null }): readonly string[] {
    return writeIntroducedDefects({
      file: FILE,
      kind: "whole-file",
      overlap: NO_OVERLAP,
      priorText,
      replaceAll: false,
      replacedText: null,
      text,
    });
  }

  it("refuses a new memory whose name is malformed, because it has no prior text to excuse it", () => {
    expect(write({ priorText: null, text: BROKEN })).toEqual([
      "`name: A_Fact` is not kebab-case — lowercase words joined by single hyphens, like `decisions-go-on-the-queue`; a wikilink written the natural way will not match anything else",
    ]);
  });

  it("allows a rewrite that carries a malformed name the file already had", () => {
    // `project-local-deploy-stacks` is a real standing finding on this machine. Refusing every rewrite of a
    // memory like it would refuse the rewrite that repairs it.
    const rewritten = BROKEN.replace("Some body.", () => "A longer body.");

    expect(write({ priorText: BROKEN, text: rewritten })).toEqual([]);
  });

  it("still refuses a rewrite that introduces a SECOND defect beside the standing one", () => {
    const worse = BROKEN.replace("Some body.", () => "See [[.claude/rules/testing.md]].");

    expect(write({ priorText: BROKEN, text: worse })).toEqual([
      "`[[.claude/rules/testing]]` is not a memory identity, so no memory can ever answer it — link to a memory's `name`, and put a pointer to a document in a markdown link instead",
    ]);
  });

  it("refuses a rewrite that swaps one malformed name for a different malformed name", () => {
    const renamed = BROKEN.replace("name: A_Fact", () => "name: B_Fact");

    expect(write({ priorText: BROKEN, text: renamed })).toEqual([
      "`name: B_Fact` is not kebab-case — lowercase words joined by single hyphens, like `decisions-go-on-the-queue`; a wikilink written the natural way will not match anything else",
    ]);
  });
});

describe("a dated addendum is reported, never refused at write time", () => {
  const BEFORE = "---\nname: a-fact\ndescription: a fact\nmetadata:\n  type: project\n---\n\nThe rule.\n";

  it("allows a whole-file write whose list records an outside system's dated history", () => {
    const text = `${BEFORE}\n- **Widened 3 Sep 2026** from 10 to 20 connections.\n- **Narrowed 9 Sep 2026** back to 15.\n`;

    // The input carries what the gate lets through: the report reads both items as amendments.
    expect(datedAddenda({ text }).map((hit) => hit.leadIn)).toEqual(["Widened 3 Sep 2026", "Narrowed 9 Sep 2026"]);
    expect(
      writeIntroducedDefects({
        overlap: NO_OVERLAP,
        file: "a-fact.md",
        kind: "whole-file",
        priorText: null,
        replaceAll: false,
        replacedText: null,
        text,
      }),
    ).toEqual([]);
  });
});
