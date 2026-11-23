/**
 * Byte-GOLDEN tests for the Linear issue renderer. Every assertion here compares the WHOLE output string,
 * because a renderer test that checks for a substring passes on a body with a stray blank line, a changed
 * heading depth, or a collapsible that will not collapse.
 */
import { describe, expect, it } from "vitest";

import { renderAiPrompt, renderBlock, renderIssueBody } from "../../../../outbound/linear/render.js";
import type { FreeformIssue, SectionBlock, StructuredIssue } from "../../../../outbound/linear/types.js";

const PROMPT: readonly SectionBlock[] = [{ kind: "para", text: "**Goal.** Fix the thing." }];

function structured(overrides: Partial<StructuredIssue>): StructuredIssue {
  return {
    aiPrompt: PROMPT,
    kind: "structured",
    problem: [{ kind: "para", text: "The board shows six defects." }],
    solution: [{ kind: "para", text: "One PR off staging." }],
    ...overrides,
  };
}

describe("renderBlock", () => {
  it("renders a paragraph as its own markdown, untouched", () => {
    expect(renderBlock({ block: { kind: "para", text: "A **bold** claim." } })).toBe("A **bold** claim.");
  });

  it("preserves an em dash and an en dash byte for byte", () => {
    // Slopweaver supplies the SHAPE; the content system supplies the words. A body quoting an error message
    // with a dash is correct input, and rewriting it would corrupt a quotation.
    const text = "The run failed — twice – on page nine.";
    expect(renderBlock({ block: { kind: "para", text } })).toBe(text);
  });

  it("renders bullets one per line with no trailing newline", () => {
    expect(renderBlock({ block: { items: [{ text: "first" }, { text: "second" }], kind: "bullets" } })).toBe(
      "- first\n- second",
    );
  });

  it("NESTS a screenshot under the step it belongs to", () => {
    // The case the flat `string[]` could not express: the image belongs to step 2, and moving it after the
    // whole list loses that. Every nested line is indented, INCLUDING the blank line — an unindented blank
    // line terminates the list item, which would detach the image and float it past the list.
    expect(
      renderBlock({
        block: {
          items: [
            { text: "Open the import dialog." },
            {
              nested: [{ alt: "the validation failure", kind: "media", mime: "image/png", url: "https://x.test/v" }],
              text: "Select the CSV.",
            },
            { text: "Submit." },
          ],
          kind: "bullets",
        },
      }),
    ).toBe(
      "- Open the import dialog.\n" +
        "- Select the CSV.\n" +
        "  \n" +
        "  ![the validation failure](<https://x.test/v>)\n" +
        "- Submit.",
    );
  });

  it("nests a paragraph and a code block under one item, indenting every line of the fence", () => {
    expect(
      renderBlock({
        block: {
          items: [
            {
              nested: [
                { kind: "para", text: "Note the stack." },
                { kind: "code", lang: "", text: "line one\nline two" },
              ],
              text: "It throws.",
            },
          ],
          kind: "bullets",
        },
      }),
    ).toBe("- It throws.\n  \n  Note the stack.\n  \n  ```\n  line one\n  line two\n  ```");
  });

  it("renders a checklist with the box state the caller set", () => {
    expect(
      renderBlock({
        block: {
          items: [
            { done: false, text: "open" },
            { done: true, text: "closed" },
          ],
          kind: "checklist",
        },
      }),
    ).toBe("- [ ] open\n- [x] closed");
  });

  it("EMBEDS an image", () => {
    expect(
      renderBlock({ block: { alt: "the board", kind: "media", mime: "image/png", url: "https://x.test/a" } }),
    ).toBe("![the board](<https://x.test/a>)");
  });

  it("LINKS a non-image, because an image embed around a PDF renders broken", () => {
    expect(
      renderBlock({ block: { alt: "the export", kind: "media", mime: "application/pdf", url: "https://x.test/b" } }),
    ).toBe("[the export](<https://x.test/b>)");
  });

  it("links a CSV and a markdown file too", () => {
    expect(renderBlock({ block: { alt: "rows", kind: "media", mime: "text/csv", url: "https://x.test/c" } })).toBe(
      "[rows](<https://x.test/c>)",
    );
    expect(
      renderBlock({ block: { alt: "notes", kind: "media", mime: "text/markdown", url: "https://x.test/d" } }),
    ).toBe("[notes](<https://x.test/d>)");
  });

  it("treats the mime case-insensitively when deciding to embed", () => {
    expect(renderBlock({ block: { alt: "shot", kind: "media", mime: "IMAGE/PNG", url: "https://x.test/e" } })).toBe(
      "![shot](<https://x.test/e>)",
    );
  });

  it("ESCAPES alt text so one media block cannot become two image constructs", () => {
    // Unescaped, `alt: "x](…attacker…) ![y"` rendered as two images, the first pointing at a URL the caller
    // never supplied. A byte golden asserts injected bytes exactly as happily as correct ones.
    expect(
      renderBlock({
        block: {
          alt: "x](https://attacker.test/pixel) ![y",
          kind: "media",
          mime: "image/png",
          url: "https://safe.test/p.png",
        },
      }),
    ).toBe("![x\\](https://attacker.test/pixel) !\\[y](<https://safe.test/p.png>)");
  });

  it("fences code with a run LONGER than any backtick run inside it", () => {
    // A fixed triple fence is closed by the first ``` in the body, leaking the rest of the ticket as prose.
    expect(renderBlock({ block: { kind: "code", lang: "md", text: "```\nnested\n```" } })).toBe(
      "````md\n```\nnested\n```\n````",
    );
  });

  it("carries a unified diff, whose header lines begin with the collapsible delimiter", () => {
    expect(renderBlock({ block: { kind: "code", lang: "diff", text: "--- a/x\n+++ b/x" } })).toBe(
      "```diff\n--- a/x\n+++ b/x\n```",
    );
  });

  it("fences a code block, including an unlabelled one", () => {
    expect(renderBlock({ block: { kind: "code", lang: "ts", text: "const a = 1;" } })).toBe("```ts\nconst a = 1;\n```");
    expect(renderBlock({ block: { kind: "code", lang: "", text: "plain" } })).toBe("```\nplain\n```");
  });

  it("renders a freeform heading at depth two", () => {
    expect(renderBlock({ block: { kind: "heading", text: "Background" } })).toBe("## Background");
  });
});

describe("renderAiPrompt — the measured collapsible byte form", () => {
  it("emits opener, blank line, content, blank line, bare closer", () => {
    expect(renderAiPrompt({ blocks: PROMPT })).toBe("+++ Prompt for AI agents\n\n**Goal.** Fix the thing.\n\n+++");
  });

  it("never emits the one-line `+++ title +++` form, which cannot collapse", () => {
    // 22 real tickets carry that form. It is unreachable here because the delimiters are emitted separately.
    const out = renderAiPrompt({ blocks: PROMPT });
    expect(out.split("\n")[0]).toBe("+++ Prompt for AI agents");
    expect(out.split("\n").at(-1)).toBe("+++");
  });

  it("never emits a heading instead of a delimiter, which is the owner's observed failure", () => {
    expect(renderAiPrompt({ blocks: PROMPT }).startsWith("## ")).toBe(false);
  });

  it("puts one blank line between multiple prompt blocks", () => {
    expect(
      renderAiPrompt({
        blocks: [
          { kind: "para", text: "**Goal.** One." },
          { items: [{ text: "a" }, { text: "b" }], kind: "bullets" },
        ],
      }),
    ).toBe("+++ Prompt for AI agents\n\n**Goal.** One.\n\n- a\n- b\n\n+++");
  });
});

describe("renderIssueBody — structured", () => {
  it("renders the whole enforced shape byte for byte", () => {
    expect(
      renderIssueBody({
        artifact: structured({ acceptance: ["the harness completes a run", "the drill-down renders rows"] }),
      }),
    ).toBe(
      "## Problem\n\nThe board shows six defects.\n\n" +
        "## Solution\n\nOne PR off staging.\n\n" +
        "## Acceptance criteria\n\n- [ ] the harness completes a run\n- [ ] the drill-down renders rows\n\n" +
        "+++ Prompt for AI agents\n\n**Goal.** Fix the thing.\n\n+++",
    );
  });

  it("omits the Acceptance criteria HEADING entirely when the section is absent", () => {
    const out = renderIssueBody({ artifact: structured({}) });
    expect(out).toBe(
      "## Problem\n\nThe board shows six defects.\n\n" +
        "## Solution\n\nOne PR off staging.\n\n" +
        "+++ Prompt for AI agents\n\n**Goal.** Fix the thing.\n\n+++",
    );
    expect(out.includes("Acceptance criteria")).toBe(false);
  });

  it("appends proofOfProblem inside the Problem section with NO heading of its own", () => {
    expect(
      renderIssueBody({
        artifact: structured({
          proofOfProblem: [
            { kind: "para", text: "Two runs died on page nine." },
            { alt: "the trace", kind: "media", mime: "image/png", url: "https://x.test/p" },
          ],
        }),
      }),
    ).toBe(
      "## Problem\n\nThe board shows six defects.\n\nTwo runs died on page nine.\n\n" +
        "![the trace](<https://x.test/p>)\n\n" +
        "## Solution\n\nOne PR off staging.\n\n" +
        "+++ Prompt for AI agents\n\n**Goal.** Fix the thing.\n\n+++",
    );
  });

  it("keeps media POSITIONAL inside a section, in the order given", () => {
    // The whole reason Linear does not share Slack's schema: an image belongs to the prose beside it.
    expect(
      renderIssueBody({
        artifact: structured({
          solution: [
            { kind: "para", text: "Before." },
            { alt: "one", kind: "media", mime: "image/png", url: "https://x.test/1" },
            { kind: "para", text: "After." },
            { alt: "two", kind: "media", mime: "image/png", url: "https://x.test/2" },
          ],
        }),
      }),
    ).toBe(
      "## Problem\n\nThe board shows six defects.\n\n" +
        "## Solution\n\nBefore.\n\n![one](<https://x.test/1>)\n\nAfter.\n\n![two](<https://x.test/2>)\n\n" +
        "+++ Prompt for AI agents\n\n**Goal.** Fix the thing.\n\n+++",
    );
  });

  it("is deterministic: the same form renders identical bytes twice", () => {
    // `update` re-renders the same form, so any instability would make every edit look like a change.
    const artifact = structured({ acceptance: ["one"] });
    expect(renderIssueBody({ artifact })).toBe(renderIssueBody({ artifact }));
  });

  it("emits no trailing newline", () => {
    expect(renderIssueBody({ artifact: structured({}) }).endsWith("+++")).toBe(true);
  });
});

describe("renderIssueBody — details folds", () => {
  it("renders each fold in the measured byte form, after Acceptance criteria and before the AI prompt", () => {
    expect(
      renderIssueBody({
        artifact: structured({
          acceptance: ["it ships"],
          details: [
            { blocks: [{ kind: "para", text: "Why this route." }], title: "Options weighed" },
            { blocks: [{ items: [{ text: "a" }, { text: "b" }], kind: "bullets" }], title: "Rollout" },
          ],
        }),
      }),
    ).toBe(
      "## Problem\n\nThe board shows six defects.\n\n" +
        "## Solution\n\nOne PR off staging.\n\n" +
        "## Acceptance criteria\n\n- [ ] it ships\n\n" +
        "+++ Options weighed\n\nWhy this route.\n\n+++\n\n" +
        "+++ Rollout\n\n- a\n- b\n\n+++\n\n" +
        "+++ Prompt for AI agents\n\n**Goal.** Fix the thing.\n\n+++",
    );
  });

  it("renders a freeform issue's folds after its body and before the AI prompt", () => {
    const issue: FreeformIssue = {
      aiPrompt: PROMPT,
      body: [{ kind: "para", text: "Lead." }],
      details: [{ blocks: [{ kind: "para", text: "The long part." }], title: "Detail" }],
      kind: "freeform",
    };
    expect(renderIssueBody({ artifact: issue })).toBe(
      "Lead.\n\n+++ Detail\n\nThe long part.\n\n+++\n\n+++ Prompt for AI agents\n\n**Goal.** Fix the thing.\n\n+++",
    );
  });
});

/**
 * Every fence in a rendered document, as a run-length sequence. A well-formed document pairs them: each
 * opener is matched by a closer of AT LEAST the same length, and none is left hanging at the end.
 */
function fencesBalance({ body }: { body: string }): boolean {
  let open: number | undefined;
  for (const line of body.split("\n")) {
    // Sliced rather than matched with `(`{3,})(.*)`: those two groups can exchange characters, which is a
    // super-linear backtracking shape the lint gate rejects outright.
    const lead = /^`+/.exec(line);
    if (lead === null || lead[0].length < 3) {
      continue;
    }
    const width = lead[0].length;
    const rest = line.slice(width);
    if (open === undefined) {
      open = width;
      continue;
    }
    // A closer carries no info string and must be at least as wide as its opener.
    if (width >= open && rest.trim() === "") {
      open = undefined;
    }
  }
  return open === undefined;
}

describe("the rendered document never leaves a fence open", () => {
  // An unclosed fence swallows every later section INCLUDING the collapsible, so this is the invariant that
  // protects the one feature the whole shape exists for. Asserted over hostile inputs rather than over the
  // cases that happened to occur to me.
  const hostile: readonly { name: string; text: string; lang: string }[] = [
    { lang: "", name: "content that is itself a bare fence", text: "```" },
    { lang: "", name: "content with a longer fence", text: "````\ninner\n````" },
    { lang: "diff", name: "a unified diff", text: "--- a/x\n+++ b/x\n@@ -1 +1 @@" },
    { lang: "md", name: "nested fenced markdown", text: "```ts\nconst a = 1;\n```" },
    { lang: "", name: "a lone backtick run mid-content", text: "before\n`````\nafter" },
  ];

  for (const probe of hostile) {
    it(`stays balanced with ${probe.name}`, () => {
      const body = renderIssueBody({
        artifact: structured({ solution: [{ kind: "code", lang: probe.lang, text: probe.text }] }),
      });

      expect(fencesBalance({ body })).toBe(true);
      // And the collapsible still survives to the end of the document, which is the thing at stake.
      expect(body.endsWith("\n\n+++")).toBe(true);
    });
  }

  it("detects an unbalanced document, so the check above cannot pass vacuously", () => {
    expect(fencesBalance({ body: "## Problem\n\n```\nnever closed" })).toBe(false);
  });
});

describe("renderIssueBody — freeform", () => {
  it("renders the caller's own ordering, then the required collapsible", () => {
    const artifact: FreeformIssue = {
      aiPrompt: PROMPT,
      body: [
        { alt: "hero", kind: "media", mime: "image/png", url: "https://x.test/h" },
        { kind: "heading", text: "Background" },
        { kind: "para", text: "Some prose." },
      ],
      kind: "freeform",
    };
    expect(renderIssueBody({ artifact })).toBe(
      "![hero](<https://x.test/h>)\n\n## Background\n\nSome prose.\n\n" +
        "+++ Prompt for AI agents\n\n**Goal.** Fix the thing.\n\n+++",
    );
  });

  it("still carries the collapsible even though the body is unconstrained", () => {
    const artifact: FreeformIssue = {
      aiPrompt: PROMPT,
      body: [{ kind: "para", text: "Just a note." }],
      kind: "freeform",
    };
    expect(renderIssueBody({ artifact }).endsWith("+++ Prompt for AI agents\n\n**Goal.** Fix the thing.\n\n+++")).toBe(
      true,
    );
  });
});
