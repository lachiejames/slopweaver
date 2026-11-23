/**
 * The overlap nomination: which memories and canon sections a written memory shares a subject with, what
 * answers one, and the write gate asking about each overlap exactly once.
 *
 * The fixture is the incident's shape, invented: two memories naming different reviewers for the same work,
 * and a canon section routing that work somewhere else again.
 */
import { describe, expect, it } from "vitest";

import { parseMemoryLeaf } from "../../../memory/corpus.js";
import {
  answers,
  type CanonSection,
  canonMaxFrequency,
  canonSections,
  corpusOverlaps,
  nominateOverlaps,
  overlapDefect,
  unansweredOverlaps,
} from "../../../memory/overlapNomination.js";
import { writeIntroducedDefects } from "../../../memory/writeGate.js";

/** One leaf's text, with an optional `overlaps` block under `metadata.slopweaver`. */
function leafText({
  name,
  description,
  overlaps = [],
}: {
  name: string;
  description: string;
  overlaps?: readonly string[];
}): string {
  const block =
    overlaps.length === 0 ? "" : `  slopweaver:\n    overlaps:\n${overlaps.map((l) => `      ${l}\n`).join("")}`;
  return `---\nname: ${name}\ndescription: ${description}\nmetadata:\n  type: feedback\n${block}---\n\nBody.\n`;
}

const KESTREL = parseMemoryLeaf({
  file: "review-asks-go-to-kestrel.md",
  text: leafText({ description: "backend pull request reviews go to kestrel", name: "review-asks-go-to-kestrel" }),
});

const MONITORS = parseMemoryLeaf({
  file: "monitors-are-alert-only.md",
  text: leafText({ description: "datadog monitors never carry a recovery block", name: "monitors-are-alert-only" }),
});

const PLOVER_FILE = "review-asks-go-to-plover.md";

/** The written memory: the same work routed to a different reviewer. */
function plover({ overlaps = [] }: { overlaps?: readonly string[] } = {}): string {
  return leafText({
    description: "backend pull request reviews go to plover, not kestrel",
    name: "review-asks-go-to-plover",
    overlaps,
  });
}

const SECTIONS: readonly CanonSection[] = [
  {
    id: "AGENTS.md § Review routing",
    text: "## Review routing\n\nBackend pull request reviews go to the codeowners team, never a named reviewer like kestrel.",
  },
  { id: "AGENTS.md § Monitors", text: "## Monitors\n\nDatadog monitors are alert-only." },
  { id: "AGENTS.md § Toolchain", text: "## Toolchain\n\nYarn and prettier format the tree." },
];

const KESTREL_DEFECT =
  "overlaps the memory `review-asks-go-to-kestrel` (shares `backend`, `kestrel`, `request`, `review`, `reviews`) — " +
  'read it, then answer under `metadata.slopweaver.overlaps`: `"review-asks-go-to-kestrel": supersedes` if this ' +
  'one replaces it (and delete it), or `"review-asks-go-to-kestrel": compatible` if both stand';

const CANON_DEFECT =
  "overlaps always-on canon `AGENTS.md § Review routing` (shares `backend`, `kestrel`, `request`, `review`, " +
  "`reviews`) — read it: if this memory contradicts it, change the canon instead of writing this; if it does " +
  'not, answer `"AGENTS.md § Review routing": compatible` under `metadata.slopweaver.overlaps`';

describe("canonSections", () => {
  it("splits at level-two headings, keeping the preamble under the bare path", () => {
    const content = "# Title\n\nIntro.\n\n## First\n\nOne.\n\n### Nested\n\nStill first.\n\n## Second\n\nTwo.\n";

    expect(canonSections({ content, path: "AGENTS.md" }).map((section) => section.id)).toEqual([
      "AGENTS.md",
      "AGENTS.md § First",
      "AGENTS.md § Second",
    ]);
  });

  it("does not split at a heading inside a fenced block", () => {
    const content = "## Real\n\n```markdown\n## Example heading\n```\n\nAfter.\n";

    expect(canonSections({ content, path: "rule.md" }).map((section) => section.id)).toEqual(["rule.md § Real"]);
  });

  it("returns nothing for an empty document", () => {
    expect(canonSections({ content: "", path: "empty.md" })).toEqual([]);
  });
});

describe("canonMaxFrequency", () => {
  it("floors the share so a token in one section of a small canon still counts", () => {
    expect(canonMaxFrequency({ count: 3 })).toBeCloseTo(1 / 3);
  });

  it("keeps the library tenth once the canon is large enough", () => {
    expect(canonMaxFrequency({ count: 43 })).toBe(0.1);
  });

  it("does not divide by zero for an empty canon", () => {
    expect(canonMaxFrequency({ count: 0 })).toBe(0.1);
  });
});

describe("nominateOverlaps", () => {
  const written = parseMemoryLeaf({ file: PLOVER_FILE, text: plover() });

  it("nominates the memory and the canon section on the same subject, and nothing else", () => {
    expect(nominateOverlaps({ leaf: written, sections: SECTIONS, siblings: [KESTREL, MONITORS] })).toEqual([
      {
        aliases: ["review-asks-go-to-kestrel"],
        id: "review-asks-go-to-kestrel",
        kind: "memory",
        sharedTokens: ["backend", "kestrel", "request", "review", "reviews"],
      },
      {
        aliases: [],
        id: "AGENTS.md § Review routing",
        kind: "canon",
        sharedTokens: ["backend", "kestrel", "request", "review", "reviews"],
      },
    ]);
  });

  it("nominates nothing for a memory on an unrelated subject", () => {
    expect(nominateOverlaps({ leaf: MONITORS, sections: [], siblings: [KESTREL] })).toEqual([]);
  });

  it("nominates a sibling declaring no name under its stem", () => {
    const nameless = parseMemoryLeaf({
      file: "kestrel-reviews.md",
      text: "---\ndescription: backend pull request reviews go to kestrel\n---\n\nBody.\n",
    });

    expect(nominateOverlaps({ leaf: written, sections: [], siblings: [nameless] }).map((n) => n.id)).toEqual([
      "kestrel-reviews",
    ]);
  });
});

describe("answers", () => {
  const [memory, canon] = nominateOverlaps({
    leaf: parseMemoryLeaf({ file: PLOVER_FILE, text: plover() }),
    sections: SECTIONS,
    siblings: [KESTREL],
  });

  it("takes either answer for a memory", () => {
    expect(answers({ nomination: memory!, overlap: { answer: "supersedes", target: memory!.id } })).toBe(true);
    expect(answers({ nomination: memory!, overlap: { answer: "compatible", target: memory!.id } })).toBe(true);
  });

  it("takes only `compatible` for canon — a memory never supersedes canon", () => {
    expect(answers({ nomination: canon!, overlap: { answer: "supersedes", target: canon!.id } })).toBe(false);
    expect(answers({ nomination: canon!, overlap: { answer: "compatible", target: canon!.id } })).toBe(true);
  });

  it("does not take an answer naming something else", () => {
    expect(answers({ nomination: memory!, overlap: { answer: "compatible", target: "some-other-memory" } })).toBe(
      false,
    );
  });
});

describe("unansweredOverlaps", () => {
  it("drops what the memory's own frontmatter answers, and keeps what it does not", () => {
    const leaf = parseMemoryLeaf({
      file: PLOVER_FILE,
      text: plover({ overlaps: ["review-asks-go-to-kestrel: supersedes"] }),
    });
    const nominations = nominateOverlaps({ leaf, sections: SECTIONS, siblings: [KESTREL] });

    expect(unansweredOverlaps({ leaf, nominations }).map((n) => n.id)).toEqual(["AGENTS.md § Review routing"]);
  });

  it("keeps an overlap whose answer is not one of the two words", () => {
    const leaf = parseMemoryLeaf({
      file: PLOVER_FILE,
      text: plover({ overlaps: ["review-asks-go-to-kestrel: fine"] }),
    });
    const nominations = nominateOverlaps({ leaf, sections: [], siblings: [KESTREL] });

    expect(unansweredOverlaps({ leaf, nominations }).map((n) => n.id)).toEqual(["review-asks-go-to-kestrel"]);
  });
});

describe("overlapDefect", () => {
  it("names the memory, the evidence and both answers", () => {
    const [memory] = nominateOverlaps({
      leaf: parseMemoryLeaf({ file: PLOVER_FILE, text: plover() }),
      sections: [],
      siblings: [KESTREL],
    });

    expect(overlapDefect({ nomination: memory! })).toBe(KESTREL_DEFECT);
  });
});

describe("corpusOverlaps", () => {
  it("reports, per leaf, what the gate would ask if it were written now", () => {
    const written = parseMemoryLeaf({ file: PLOVER_FILE, text: plover() });

    expect(
      corpusOverlaps({ leaves: [KESTREL, MONITORS, written], sections: [] }).map((entry) => ({
        file: entry.file,
        ids: entry.unanswered.map((n) => n.id),
      })),
    ).toEqual([
      { file: "review-asks-go-to-kestrel.md", ids: ["review-asks-go-to-plover"] },
      { file: PLOVER_FILE, ids: ["review-asks-go-to-kestrel"] },
    ]);
  });
});

describe("the write gate asks about each overlap once", () => {
  /** A `Write` of the plover memory into a corpus holding kestrel and monitors, beside the canon. */
  function write({ text, priorText }: { text: string; priorText: string | null }): readonly string[] {
    return writeIntroducedDefects({
      file: PLOVER_FILE,
      kind: "whole-file",
      overlap: { sections: SECTIONS, siblings: [KESTREL, MONITORS] },
      priorText,
      replaceAll: false,
      replacedText: null,
      text,
    });
  }

  it("refuses a new memory that overlaps a memory and a canon section, naming both", () => {
    expect(write({ priorText: null, text: plover() })).toEqual([KESTREL_DEFECT, CANON_DEFECT]);
  });

  it("allows the same memory once it answers both", () => {
    const answered = plover({
      overlaps: ["review-asks-go-to-kestrel: supersedes", '"AGENTS.md § Review routing": compatible'],
    });

    expect(write({ priorText: null, text: answered })).toEqual([]);
  });

  it("still refuses a canon overlap answered `supersedes`", () => {
    const wrong = plover({
      overlaps: ["review-asks-go-to-kestrel: compatible", '"AGENTS.md § Review routing": supersedes'],
    });

    expect(write({ priorText: null, text: wrong })).toEqual([CANON_DEFECT]);
  });

  it("does not ask again about an overlap the file already carried unanswered", () => {
    const rewritten = plover().replace("Body.", () => "A longer body.");

    expect(write({ priorText: plover(), text: rewritten })).toEqual([]);
  });

  it("asks again when a rewrite REMOVES an answer the file had", () => {
    const answered = plover({
      overlaps: ["review-asks-go-to-kestrel: compatible", '"AGENTS.md § Review routing": compatible'],
    });
    const dropped = plover({ overlaps: ['"AGENTS.md § Review routing": compatible'] });

    expect(write({ priorText: answered, text: dropped })).toEqual([KESTREL_DEFECT]);
  });

  it("is cleared by the exact line its refusal suggests, for a heading YAML would otherwise misread", () => {
    const id = 'AGENTS.md § Review "routing": `\\n` #1 — ünïcode';
    const sections: readonly CanonSection[] = [{ id, text: SECTIONS[0]!.text }];
    const gate = ({ text }: { text: string }): readonly string[] =>
      writeIntroducedDefects({
        file: PLOVER_FILE,
        kind: "whole-file",
        overlap: { sections, siblings: [] },
        priorText: null,
        replaceAll: false,
        replacedText: null,
        text,
      });
    const suggested = `${JSON.stringify(id)}: compatible`;

    expect(gate({ text: plover() })[0]).toContain(`\`${suggested}\``);
    expect(gate({ text: plover({ overlaps: [suggested] }) })).toEqual([]);
  });

  it("never nominates the written memory against its own prior copy in the corpus", () => {
    const self = parseMemoryLeaf({ file: PLOVER_FILE, text: plover() });

    expect(
      writeIntroducedDefects({
        file: PLOVER_FILE,
        kind: "whole-file",
        overlap: { sections: [], siblings: [self] },
        priorText: null,
        replaceAll: false,
        replacedText: null,
        text: plover(),
      }),
    ).toEqual([]);
  });
});
