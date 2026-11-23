/**
 * A proposal read into the `linear document` door's block vocabulary: what each proposal block becomes, and
 * which ones Linear cannot carry and are refused rather than published broken.
 */
import { describe, expect, it } from "vitest";

import { parseLinearDocumentForm } from "../../../../cli/commands/linear/documentCore.js";
import { PROPOSAL_FORM_EXAMPLE } from "../../../../cli/commands/proposal/formExample.js";
import { unwrap } from "../../../../lib/result.js";
import {
  ProposalLinearErrors,
  proposalLinearBlocks,
  proposalLinearDocumentForm,
} from "../../../../outbound/proposal/linearDocument.js";
import { renderProposal } from "../../../../outbound/proposal/render.js";

const DESTINATION = { id: "5f0c1d2e-3a4b-4c5d-8e6f-7a8b9c0d1e2f", kind: "project" } as const;

describe("proposalLinearBlocks", () => {
  it("keeps headings as headings and prose, quotes, tables and lists as paragraphs with their bytes", () => {
    const markdown = [
      "# Move intake to one queue",
      "",
      "One queue for every site.",
      "A second line of the same paragraph.",
      "",
      "> quoted from the room",
      "",
      "| a | b |",
      "| - | - |",
      "",
      "- first",
      "- second",
    ].join("\n");

    expect(unwrap(proposalLinearBlocks({ markdown }))).toEqual([
      { kind: "heading", text: "Move intake to one queue" },
      { kind: "para", text: "One queue for every site.\nA second line of the same paragraph." },
      { kind: "para", text: "> quoted from the room" },
      { kind: "para", text: "| a | b |\n| - | - |" },
      { kind: "para", text: "- first\n- second" },
    ]);
  });

  it("turns a fenced block into a code block carrying its language and body, without the fences", () => {
    const markdown = ["```ts", "const a = 1;", "const b = 2;", "```"].join("\n");

    expect(unwrap(proposalLinearBlocks({ markdown }))).toEqual([
      { kind: "code", lang: "ts", text: "const a = 1;\nconst b = 2;" },
    ]);
  });

  it("accepts a fence with no language as an empty language", () => {
    expect(unwrap(proposalLinearBlocks({ markdown: "```\nplain\n```" }))).toEqual([
      { kind: "code", lang: "", text: "plain" },
    ]);
  });

  it("labels a toggle's body with its summary in bold, never as a heading, and drops the table of contents and the closing line", () => {
    const markdown = [
      "<table_of_contents/>",
      "",
      "<details>",
      "<summary>Alternatives considered</summary>",
      "",
      "Two queues per site.",
      "",
      "</details>",
    ].join("\n");

    expect(unwrap(proposalLinearBlocks({ markdown }))).toEqual([
      { kind: "para", text: "**Alternatives considered**" },
      { kind: "para", text: "Two queues per site." },
    ]);
  });

  it("lets a toggle with no summary contribute only its body", () => {
    const markdown = ["<details>", "", "Body only.", "", "</details>"].join("\n");

    expect(unwrap(proposalLinearBlocks({ markdown }))).toEqual([{ kind: "para", text: "Body only." }]);
  });

  it("keeps an https image's markdown bytes as a paragraph", () => {
    const markdown = "![the queue](https://example.test/queue.png)";

    expect(unwrap(proposalLinearBlocks({ markdown }))).toEqual([{ kind: "para", text: markdown }]);
  });

  it("refuses a file: image, naming its line, because Linear cannot fetch a file on this machine", () => {
    const result = proposalLinearBlocks({ markdown: "Intro.\n\n![local](file:shots/queue.png)" });

    expect(result._unsafeUnwrapErr()).toEqual(
      ProposalLinearErrors.localMedia({ line: 3, source: "file:shots/queue.png" }),
    );
  });

  it("refuses an image whose address is not http(s)", () => {
    const result = proposalLinearBlocks({ markdown: "![relative](shots/queue.png)" });

    expect(result._unsafeUnwrapErr()).toEqual(
      ProposalLinearErrors.unreachableMedia({ line: 1, url: "shots/queue.png" }),
    );
  });

  it("refuses a file: image inline in a paragraph, not only one standing on its own line", () => {
    const result = proposalLinearBlocks({ markdown: "Intro.\n\nThe queue ![queue](file:shots/queue.png) today." });

    expect(result._unsafeUnwrapErr()).toEqual(
      ProposalLinearErrors.localMedia({ line: 3, source: "file:shots/queue.png" }),
    );
  });

  it("refuses a file: image inside a list item", () => {
    const result = proposalLinearBlocks({ markdown: "- first\n- see ![shot](file:a.png)" });

    expect(result._unsafeUnwrapErr()).toEqual(ProposalLinearErrors.localMedia({ line: 1, source: "file:a.png" }));
  });

  it("refuses a file: image carried in a heading", () => {
    const result = proposalLinearBlocks({ markdown: "## The fix ![x](file:a.png)" });

    expect(result._unsafeUnwrapErr()).toEqual(ProposalLinearErrors.localMedia({ line: 1, source: "file:a.png" }));
  });

  it("refuses a file: image carried in a toggle's summary", () => {
    const result = proposalLinearBlocks({
      markdown: "<details>\n<summary>![local](file:shots/a.png)</summary>\n\nbody\n\n</details>",
    });

    expect(result._unsafeUnwrapErr()).toEqual(ProposalLinearErrors.localMedia({ line: 1, source: "file:shots/a.png" }));
  });

  it("keeps a summary line that opens no toggle as a bold label, never as raw HTML and never dropped", () => {
    const markdown = "<summary>Kept</summary>\n\n## Next";

    expect(unwrap(proposalLinearBlocks({ markdown }))).toEqual([
      { kind: "para", text: "**Kept**" },
      { kind: "heading", text: "Next" },
    ]);
  });

  it("drops a summary line with no text, which carries nothing to label", () => {
    expect(unwrap(proposalLinearBlocks({ markdown: "Intro.\n\n<summary></summary>" }))).toEqual([
      { kind: "para", text: "Intro." },
    ]);
  });

  it("refuses a file: image trailing a table-of-contents marker on the same line, though the marker is dropped", () => {
    const result = proposalLinearBlocks({ markdown: '<table_of_contents color="gray"/> ![local](file:secret.png)' });

    expect(result._unsafeUnwrapErr()).toEqual(ProposalLinearErrors.localMedia({ line: 1, source: "file:secret.png" }));
  });

  it("keeps text trailing a table-of-contents marker as a paragraph, dropping only the marker", () => {
    expect(unwrap(proposalLinearBlocks({ markdown: '<table_of_contents color="gray"/> Keep me' }))).toEqual([
      { kind: "para", text: "Keep me" },
    ]);
  });

  it("refuses a reference-style link whose definition names a file on this machine", () => {
    const result = proposalLinearBlocks({ markdown: "See [notes][n].\n\n[n]: file:notes.md" });

    expect(result._unsafeUnwrapErr()).toEqual(ProposalLinearErrors.localMedia({ line: 3, source: "file:notes.md" }));
  });

  it("drops a table-of-contents marker the parser read as one even when it is left unclosed", () => {
    expect(unwrap(proposalLinearBlocks({ markdown: "Intro.\n\n<table_of_contents bogus" }))).toEqual([
      { kind: "para", text: "Intro." },
    ]);
  });

  it("refuses an autolink to a file on this machine", () => {
    const result = proposalLinearBlocks({ markdown: "See <file:notes.md>." });

    expect(result._unsafeUnwrapErr()).toEqual(ProposalLinearErrors.localMedia({ line: 1, source: "file:notes.md" }));
  });

  it("refuses a reference-style file: image whose label holds an escaped bracket", () => {
    const result = proposalLinearBlocks({ markdown: "![shot][im\\]g]\n\n[im\\]g]: file:a.png" });

    expect(result._unsafeUnwrapErr()).toEqual(ProposalLinearErrors.localMedia({ line: 1, source: "file:a.png" }));
  });

  it("refuses a file: image whose alt text holds an escaped bracket", () => {
    const result = proposalLinearBlocks({ markdown: "Intro.\n\n![a\\]b](file:secret.png)" });

    expect(result._unsafeUnwrapErr()).toEqual(ProposalLinearErrors.localMedia({ line: 3, source: "file:secret.png" }));
  });

  it("refuses a plain link to a file on this machine, which Linear can no more fetch than an image", () => {
    const result = proposalLinearBlocks({ markdown: "See [the notes](file:notes.md)." });

    expect(result._unsafeUnwrapErr()).toEqual(ProposalLinearErrors.localMedia({ line: 1, source: "file:notes.md" }));
  });

  it("refuses a reference-style file: image whose definition sits in a later block", () => {
    const result = proposalLinearBlocks({ markdown: "Intro.\n\n![shot][img]\n\n[img]: file:a.png" });

    expect(result._unsafeUnwrapErr()).toEqual(ProposalLinearErrors.localMedia({ line: 3, source: "file:a.png" }));
  });

  it("refuses a reference-style file: image whose definition puts the address on the next line", () => {
    const result = proposalLinearBlocks({ markdown: "## Context\n\n![shot][img]\n\n[img]:\n  file:a.png" });

    expect(result._unsafeUnwrapErr()).toEqual(ProposalLinearErrors.localMedia({ line: 3, source: "file:a.png" }));
  });

  it("resolves collapsed and shortcut reference images case-insensitively", () => {
    const collapsed = proposalLinearBlocks({ markdown: "See ![Shot][] here.\n\n[shot]: <file:b.png>" });
    const shortcut = proposalLinearBlocks({
      markdown: "See ![The  Shot] here.\n\n[the shot]: ftp://example.test/c.png",
    });

    expect(collapsed._unsafeUnwrapErr()).toEqual(ProposalLinearErrors.localMedia({ line: 1, source: "file:b.png" }));
    expect(shortcut._unsafeUnwrapErr()).toEqual(
      ProposalLinearErrors.unreachableMedia({ line: 1, url: "ftp://example.test/c.png" }),
    );
  });

  it("keeps a reference-style https image, and an undefined reference, as paragraphs with their bytes", () => {
    const markdown = "![shot][img] and ![nothing][missing]\n\n[img]: https://example.test/a.png";

    expect(unwrap(proposalLinearBlocks({ markdown }))).toEqual([
      { kind: "para", text: "![shot][img] and ![nothing][missing]" },
      { kind: "para", text: "[img]: https://example.test/a.png" },
    ]);
  });

  it("keeps an inline https image with a title in prose unchanged", () => {
    const markdown = 'The queue ![queue](https://example.test/q.png "the queue") today.';

    expect(unwrap(proposalLinearBlocks({ markdown }))).toEqual([{ kind: "para", text: markdown }]);
  });

  it("reads the shipped example proposal with no heading the draft did not write", () => {
    const markdown = renderProposal({ form: PROPOSAL_FORM_EXAMPLE });
    const draftHeadings = markdown.split("\n").filter((line) => /^#{1,6}\s/.test(line)).length;

    const blocks = unwrap(proposalLinearBlocks({ markdown }));

    expect(blocks.filter((block) => block.kind === "heading")).toHaveLength(draftHeadings);
  });

  it("refuses a fence whose info string is more than one bare word", () => {
    const result = proposalLinearBlocks({ markdown: "```ts title=a.ts\nconst a = 1;\n```" });

    expect(result._unsafeUnwrapErr()).toEqual(ProposalLinearErrors.codeLanguage({ lang: "ts title=a.ts", line: 1 }));
  });

  it("refuses an empty fenced block", () => {
    const result = proposalLinearBlocks({ markdown: "```ts\n\n```" });

    expect(result._unsafeUnwrapErr()).toEqual(ProposalLinearErrors.emptyCode({ line: 1 }));
  });

  it("reads an empty document as no blocks", () => {
    expect(unwrap(proposalLinearBlocks({ markdown: "" }))).toEqual([]);
  });
});

describe("proposalLinearDocumentForm", () => {
  it("builds a form the Linear door itself parses, with the icon carried in the title", () => {
    const form = unwrap(
      proposalLinearDocumentForm({
        destination: DESTINATION,
        icon: "🧭",
        markdown: "## Why now\n\nThe queue doubled in a week.",
        title: "Move intake to one queue",
      }),
    );

    expect(form.fields).toEqual({ destination: DESTINATION, title: "🧭 Move intake to one queue" });
    const reparsed = unwrap(parseLinearDocumentForm({ raw: JSON.stringify(form) }));
    expect(reparsed.content).toEqual([
      { kind: "heading", text: "Why now" },
      { kind: "para", text: "The queue doubled in a week." },
    ]);
  });

  it("uses the bare title when no icon is given", () => {
    const form = unwrap(
      proposalLinearDocumentForm({ destination: DESTINATION, icon: undefined, markdown: "Body.", title: "Plain" }),
    );

    expect(form.fields.title).toBe("Plain");
  });

  it("carries the block refusal through rather than building a form", () => {
    const result = proposalLinearDocumentForm({
      destination: DESTINATION,
      icon: undefined,
      markdown: "![x](file:a.png)",
      title: "Plain",
    });

    expect(result._unsafeUnwrapErr().code).toBe("LOCAL_MEDIA");
  });
});
