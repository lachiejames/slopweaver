import { describe, expect, it } from "vitest";

import {
  cell,
  declined,
  parseBullets,
  parseRerunBlocks,
  parseUncheckedLines,
  renderBullets,
  renderRerunBlocks,
  renderUncheckedLines,
} from "../../../../outbound/github/authoringGrammar.js";
import { parseProofSlot, renderProofSlotLines } from "../../../../outbound/github/authoringProofSlot.js";
import { t } from "./fixtures.js";

describe("declined", () => {
  it("is true only for a record carrying an error string", () => {
    expect([declined({ error: "x" }), declined({ error: 1 }), declined(undefined), declined([])]).toEqual([
      true,
      false,
      false,
      false,
    ]);
  });
});

describe("cell", () => {
  it("parses a cell's inline content", () => {
    expect(cell({ source: "hello", where: "## Checks" })).toEqual(t({ text: "hello" }));
  });
});

describe("bullets", () => {
  it("renders one `- ` line per cell and reads them back", () => {
    const cells = [t({ text: "one" }), t({ text: "two" })];
    const rendered = renderBullets({ cells });
    expect(rendered).toBe("- one\n- two");
    expect(parseBullets({ section: "Checks", source: rendered })).toEqual(cells);
  });

  it("names the section and the line when a line is not a bullet", () => {
    expect(declined(parseBullets({ section: "Checks", source: "- ok\nnope" }))).toBe(true);
    expect(parseBullets({ section: "Checks", source: "nope" })).toEqual({
      error: '## Checks: every line is a `- ` bullet, and "nope" is not',
    });
  });

  it("ignores blank lines", () => {
    expect(parseBullets({ section: "Checks", source: "\n- a\n\n" })).toEqual([t({ text: "a" })]);
  });
});

describe("proof slot lines", () => {
  it("writes a reason slot as one `reason: ` line and reads it back", () => {
    const slot = { kind: "reason", reason: t({ text: "nothing on screen" }) } as const;
    const lines = renderProofSlotLines({ slot });
    expect(lines).toBe("reason: nothing on screen");
    expect(parseProofSlot({ section: "Proof of the problem", source: lines })).toEqual(slot);
  });

  it("writes a screenshot slot as proves line, picture and run-by, and reads it back", () => {
    const slot = {
      image: { alt: "the page", kind: "image", url: "https://github.com/user-attachments/assets/abc" },
      kind: "screenshot",
      proves: t({ text: "the page loads" }),
      runBy: "agent",
    } as const;
    const lines = renderProofSlotLines({ slot });
    expect(lines.split("\n")).toEqual([
      "the page loads",
      "![the page](https://github.com/user-attachments/assets/abc)",
      "run by: agent",
    ]);
    expect(parseProofSlot({ section: "Proof of the solution", source: lines })).toEqual(slot);
  });

  it("names all three shapes when the section is none of them", () => {
    const result = parseProofSlot({ section: "Proof of the problem", source: "a\nb" });
    expect(result).toEqual({
      error:
        '## Proof of the problem: the section is one line "reason: <why there is no screenshot>"; three: the line the ' +
        'screenshot proves, "![alt](url)" (optionally "{width=N}") alone on its line, and "run by: owner" or "run by: ' +
        'agent"; or a quote: a quote is four parts: the line it proves, the output in a fenced block, "source: ' +
        '[label](url)" or "source: `command`", and "run by: owner" or "run by: agent"',
    });
  });

  it("writes a quote slot as proves line, fenced output, source and run-by, and reads the output back byte for byte", () => {
    const slot = {
      kind: "quote",
      lang: "text",
      proves: t({ text: "the job fails" }),
      runBy: "agent",
      source: { kind: "link", text: "the job log", url: "https://github.com/acme/widgets/actions/runs/1/job/2" },
      text: "  indented line\nprinted ``` mid-line",
    } as const;
    const lines = renderProofSlotLines({ slot });
    expect(lines.split("\n")).toEqual([
      "the job fails",
      "````text",
      "  indented line",
      "printed ``` mid-line",
      "````",
      "source: [the job log](https://github.com/acme/widgets/actions/runs/1/job/2)",
      "run by: agent",
    ]);
    expect(parseProofSlot({ section: "Proof of the problem", source: `\n${lines}\n\n` })).toEqual(slot);
  });

  it("reads a quote whose source is a command", () => {
    const source = "it passes\n```\nok\n```\nsource: `widgets checks`\nrun by: owner";
    expect(parseProofSlot({ section: "Proof of the solution", source })).toEqual({
      kind: "quote",
      lang: "",
      proves: t({ text: "it passes" }),
      runBy: "owner",
      source: { kind: "code", text: "widgets checks" },
      text: "ok",
    });
  });

  it("declines an unclosed quote fence", () => {
    const source = "it passes\n```\nok\nsource: `widgets checks`\nrun by: owner";
    expect(parseProofSlot({ section: "Proof of the solution", source })).toEqual({
      error: "## Proof of the solution: an unclosed fenced code block — it opens with ``` but nothing closes it",
    });
  });

  it("declines a source that is prose rather than one link or code span", () => {
    const source = "it passes\n```\nok\n```\nsource: the log\nrun by: owner";
    expect(parseProofSlot({ section: "Proof of the solution", source })).toEqual({
      error: '## Proof of the solution: the source is one link or one code span alone, and "source: the log" is not',
    });
  });

  it("declines a quote missing its run-by line", () => {
    const source = "it passes\n```\nok\n```\nsource: `widgets checks`";
    expect(parseProofSlot({ section: "Proof of the solution", source })).toEqual({
      error:
        '## Proof of the solution: a quote is four parts: the line it proves, the output in a fenced block, "source: ' +
        '[label](url)" or "source: `command`", and "run by: owner" or "run by: agent"',
    });
  });
});

describe("Not checked lines", () => {
  it("writes `- <check> — <why>` and reads the item back", () => {
    const items = [{ check: t({ text: "A work account" }), why: t({ text: "Out of scope" }) }];
    const rendered = renderUncheckedLines({ items });
    expect(rendered).toBe("- A work account — Out of scope");
    expect(parseUncheckedLines({ source: rendered })).toEqual(items);
  });

  it("escapes an em dash inside the check so only the separator splits", () => {
    const items = [{ check: t({ text: "a — b" }), why: t({ text: "c" }) }];
    const rendered = renderUncheckedLines({ items });
    expect(rendered).toBe("- a \\— b — c");
    expect(parseUncheckedLines({ source: rendered })).toEqual(items);
  });

  it("declines a line with no separator, quoting it", () => {
    expect(parseUncheckedLines({ source: "- only a check" })).toEqual({
      error: '## Not checked, and why: "- only a check" is not "- <what was not checked> — <why>"',
    });
  });
});

describe("re-run blocks", () => {
  it("writes a command fence, a tests list and a note separated by blank lines, and reads them back", () => {
    const items = [
      { kind: "command", lang: "sh", text: "yarn vitest run a.test.ts" },
      { items: [t({ text: "a.test.ts" })], kind: "tests" },
      { content: t({ text: "Where it shows up." }), kind: "note" },
    ] as const;
    const rendered = renderRerunBlocks({ items });
    expect(rendered).toBe("```sh\nyarn vitest run a.test.ts\n```\n\n- a.test.ts\n\nWhere it shows up.");
    expect(parseRerunBlocks({ source: rendered })).toEqual(items);
  });

  it("lengthens the fence past any backtick run inside the command", () => {
    const rendered = renderRerunBlocks({ items: [{ kind: "command", lang: "", text: "echo ```x```" }] });
    expect(rendered).toBe("````\necho ```x```\n````");
  });

  it("declines an unclosed fence", () => {
    expect(parseRerunBlocks({ source: "```sh\nnever closed" })).toEqual({
      error: "## Re-run: an unclosed fenced code block — it opens with ``` but nothing closes it",
    });
  });

  it("reads an empty section as no items", () => {
    expect(parseRerunBlocks({ source: "  \n" })).toEqual([]);
  });
});
