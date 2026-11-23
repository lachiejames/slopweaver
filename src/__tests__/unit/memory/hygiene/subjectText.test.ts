/**
 * THE TEXT BOTH SCANS COMPARE ON — one function, so CHECK 3 and CHECK 5 cannot drift on what a memory is.
 *
 * The two properties worth a test are both absences: the BODY is never in it, and a missing field contributes
 * NOTHING rather than a placeholder. A placeholder would be shared vocabulary between every description-less
 * memory in the corpus, which is the duplicate scan pairing them with each other for having said nothing.
 *
 * Everything here is invented. This is a public repository, and a fixture is the easiest place for a private
 * string to arrive unnoticed.
 */
import { describe, expect, it } from "vitest";

import { buildMemoryCorpus } from "../../../../memory/corpus.js";
import { memorySubjectText } from "../../../../memory/hygiene/subjectText.js";
import type { MemoryLeaf } from "../../../../memory/types.js";

/** One leaf, through the real parser, with its frontmatter under this test's control. */
function leafOf({ frontmatter, body }: { frontmatter: string; body: string }): MemoryLeaf {
  const file = "pelican-batching.md";
  return buildMemoryCorpus({
    files: [
      { file: "MEMORY.md", text: `# Index\n\n- [X](${file}) — a fact\n` },
      { file, text: `---\n${frontmatter}\n---\n\n${body}\n` },
    ],
  }).leaves[0]!;
}

describe("memorySubjectText", () => {
  it("joins the stem, the declared name and the description — and nothing from the body", () => {
    const leaf = leafOf({
      body: "Quokka tolerance is a separate fact entirely.",
      frontmatter: "name: pelican-batching\ndescription: pelican batching is chronological\nmetadata:\n  type: project",
    });
    expect(memorySubjectText({ leaf })).toBe("pelican-batching pelican-batching pelican batching is chronological");
  });

  it("uses the stem as the identity when the frontmatter declares no name", () => {
    const leaf = leafOf({
      body: "A fact.",
      frontmatter: "description: pelican batching is chronological\nmetadata:\n  type: project",
    });
    expect(memorySubjectText({ leaf })).toBe("pelican-batching pelican-batching pelican batching is chronological");
  });

  it("contributes NOTHING for a missing description, rather than a placeholder word", () => {
    const leaf = leafOf({ body: "A fact.", frontmatter: "name: pelican-batching\nmetadata:\n  type: project" });
    expect(memorySubjectText({ leaf })).toBe("pelican-batching pelican-batching");
  });
});
