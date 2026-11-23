/**
 * The name grammar, at its edges. The registry test in `check.test.ts` proves the id FIRES; this proves it
 * fires on the right strings and — the half that matters more — stays quiet on the ones a real corpus holds.
 */
import { describe, expect, it } from "vitest";

import { parseMemoryLeaf } from "../../../memory/corpus.js";
import {
  isWellFormedMemoryName,
  MEMORY_NAME_BANNED_PREFIXES,
  MEMORY_NAME_MAX_LENGTH,
  nameFormatFindings,
  nameFormatFindingsForName,
} from "../../../memory/nameFormat.js";
import { MEMORY_TYPES } from "../../../memory/types.js";

/** The one message each defect produces, so a test asserts the string a reader will actually see. */
function messages({ name }: { name: string }): readonly string[] {
  return nameFormatFindingsForName({ file: "a.md", name }).map((finding) => finding.message);
}

describe("the grammar accepts what a real corpus holds", () => {
  it("accepts every name measured on this machine's corpora", () => {
    // Sampled from the 72 names standing across this machine’s three corpora, including the
    // longest (58 chars). All 72 are kebab-case and exactly one carries a type prefix; this is the sample
    // that would redden if the grammar ever tightened under a real corpus.
    const real = [
      "monitors-are-alert-only",
      "voice-and-response-shape",
      "data-source-allowlist-acme-crm-and-phones-are-not-approved",
      "owner-does-not-visit-boards",
      "north-star-throughput-per-attention",
    ];

    expect(real.filter((name) => messages({ name }).length > 0)).toEqual([]);
  });

  it("accepts a single word and a name carrying digits", () => {
    expect(messages({ name: "project" })).toEqual([]);
    expect(messages({ name: "turn-245-2-ruling" })).toEqual([]);
  });

  it("accepts a name whose PREFIX is a type word without the hyphen", () => {
    // `user` and `project` are type names; `userland-…` and `project` itself are not prefixed by `user-`.
    expect(messages({ name: "project" })).toEqual([]);
    expect(messages({ name: "userland-quirks" })).toEqual([]);
  });

  it("accepts a name exactly at the ceiling", () => {
    expect(messages({ name: "a".repeat(MEMORY_NAME_MAX_LENGTH) })).toEqual([]);
  });
});

describe("the grammar refuses each malformation, naming the offending string", () => {
  it("refuses uppercase, an underscore, a space and a dot", () => {
    for (const name of ["Project", "build_command", "build command", "build.command"]) {
      expect(messages({ name })).toEqual([
        `\`name: ${name}\` is not kebab-case — lowercase words joined by single hyphens, like \`decisions-go-on-the-queue\`; a wikilink written the natural way will not match anything else`,
      ]);
    }
  });

  it("refuses a leading, trailing or doubled hyphen", () => {
    expect(messages({ name: "-leading" }).length).toBe(1);
    expect(messages({ name: "trailing-" }).length).toBe(1);
    expect(messages({ name: "double--hyphen" }).length).toBe(1);
  });

  it("refuses a path, which is the shape that made a wikilink dangle", () => {
    expect(isWellFormedMemoryName({ value: "skills/knowledge/reference/placement.md" })).toBe(false);
  });

  it("refuses every type prefix, derived from MEMORY_TYPES rather than restated", () => {
    expect([...MEMORY_NAME_BANNED_PREFIXES]).toEqual(MEMORY_TYPES.map((type) => `${type}-`));
    expect(messages({ name: "feedback-voice-and-response-shape" })).toEqual([
      "`name: feedback-voice-and-response-shape` opens with `feedback-` — `metadata.type` already carries the kind, so drop the prefix and name the fact",
    ]);
  });

  it("refuses one character past the ceiling, and says how long it actually is", () => {
    const name = "a".repeat(MEMORY_NAME_MAX_LENGTH + 1);

    expect(messages({ name })).toEqual([
      `\`name: ${name}\` is ${MEMORY_NAME_MAX_LENGTH + 1} characters — the ceiling is ${MEMORY_NAME_MAX_LENGTH}, because a name is an identity a wikilink types rather than a description`,
    ]);
  });

  it("reports the prefix and the length together, because both are actionable at once", () => {
    expect(messages({ name: `user-${"a".repeat(MEMORY_NAME_MAX_LENGTH)}` }).length).toBe(2);
  });

  it("reports ONLY the grammar when a name is non-kebab as well as prefixed", () => {
    // The other two complaints are noise stacked on a name the author is about to rewrite anyway.
    expect(messages({ name: "user_Thing" }).length).toBe(1);
  });
});

describe("a leaf with no usable name is schema's finding, not this one", () => {
  it("stays silent when the frontmatter declares no name at all", () => {
    const leaf = parseMemoryLeaf({
      file: "a.md",
      text: "---\ndescription: a fact\nmetadata:\n  type: project\n---\n\nBody.\n",
    });

    expect(leaf.declaredName).toBe(null);
    expect(nameFormatFindings({ leaf })).toEqual([]);
    expect(leaf.schemaFindings.map((f) => f.message)).toEqual(["frontmatter is missing `name`"]);
  });

  it("judges the DECLARED name and never the filename stem", () => {
    // `build_command.md` with `name: build-command` is Claude Code's own ordinary output.
    const leaf = parseMemoryLeaf({
      file: "build_command.md",
      text: "---\nname: build-command\ndescription: how to build\nmetadata:\n  type: reference\n---\n\nBody.\n",
    });

    expect(nameFormatFindings({ leaf })).toEqual([]);
  });
});
