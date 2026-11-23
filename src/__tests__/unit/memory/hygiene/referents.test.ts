/**
 * CHECK 4 — referent extraction, and resolution over an injected fake.
 *
 * The narrow criterion is the property under test: in a leaf only a single-backtick code span makes a referent, so
 * the controls here are the shapes a looser scanner would wrongly claim — prose, a fenced example, a glob, a bare
 * noun after the binary's name. A scanner that reported those would manufacture findings out of sentences. A
 * knowledge row's prose is read too, and its controls are every root no checkout has.
 *
 * `resolve` is a plain function passed in, which `.claude/rules/testing.md` distinguishes from a mock.
 *
 * Everything here is invented. This is a public repository, and a fixture is the easiest place for a private
 * string to arrive unnoticed.
 */
import { describe, expect, it } from "vitest";

import {
  extractCommandReferents,
  extractProseReferents,
  extractReferents,
  findStaleReferents,
  type Referent,
  type ReferentVerdict,
} from "../../../../memory/hygiene/referents.js";
import type { MemoryLeaf } from "../../../../memory/types.js";

/** A leaf carrying only the fields this check reads. */
function leafOf({ file }: { file: string }): MemoryLeaf {
  return {
    amendsCanon: null,
    correctionSubject: null,
    declaredModified: null,
    declaredName: null,
    declaredType: null,
    description: null,
    file,
    mtimeMs: null,
    overlaps: [],
    ownerDirective: null,
    schemaFindings: [],
    stem: file.replace(/\.md$/, ""),
    text: "",
    wikilinks: [],
  };
}

describe("extractReferents", () => {
  it("reads a path, a flag and a verb out of single-backtick spans, with their lines", () => {
    const text = [
      "one `src/pelican/migrate.ts` here",
      "two `--quokka-batch` here",
      "three `slopweaver pelican migrate --quokka-batch` here",
    ].join("\n");
    expect(extractReferents({ text })).toEqual([
      { kind: "path", line: 1, text: "src/pelican/migrate.ts" },
      { kind: "flag", line: 2, text: "--quokka-batch" },
      { kind: "verb", line: 3, text: "pelican migrate" },
    ]);
  });

  it("reads nothing out of prose, a fenced block, a glob or a bare noun", () => {
    const text = [
      "the src/pelican/migrate.ts module and the --quokka-batch flag, unspanned",
      "`src/pelican/*.ts` is a pattern, `docs/pelican` has no extension, `slopweaver pelican` is a noun",
      "```bash",
      "`src/pelican/fenced.ts` --fenced-flag",
      "```",
    ].join("\n");
    expect(extractReferents({ text })).toEqual([]);
  });

  it("reads a skill by its directory or its slash command as ONE referent, and a skill's file as a path", () => {
    const text = [
      "one `skills/pelican-sweep` here",
      "two `skills/pelican-sweep/` and `/slopweaver:pelican-sweep` again",
      "three `/slopweaver:quokka-audit`",
      "four `skills/pelican-sweep/SKILL.md`, `skills/*` and `skills/pelican-sweep/reference` are not skills",
    ].join("\n");
    expect(extractReferents({ text })).toEqual([
      { kind: "skill", line: 1, text: "skills/pelican-sweep" },
      { kind: "skill", line: 3, text: "skills/quokka-audit" },
      { kind: "path", line: 4, text: "skills/pelican-sweep/SKILL.md" },
    ]);
  });

  it("dedupes a referent a memory names three times, keeping the first line", () => {
    const text = ["`src/pelican/migrate.ts`", "`src/pelican/migrate.ts` again", "and `src/pelican/migrate.ts`"].join(
      "\n",
    );
    expect(extractReferents({ text })).toEqual([{ kind: "path", line: 1, text: "src/pelican/migrate.ts" }]);
  });

  it("reads a referent out of frontmatter, because a stale description is as stale as a stale body", () => {
    const text = "---\nname: pelican\ndescription: use `src/pelican/migrate.ts`\n---\n\nA fact.\n";
    expect(extractReferents({ text })).toEqual([{ kind: "path", line: 3, text: "src/pelican/migrate.ts" }]);
  });
});

describe("extractProseReferents", () => {
  const roots = new Set(["src", "skills", "docs"]);

  it("reads a path or skill whose first segment is a checkout's top-level directory, with its line", () => {
    const text = [
      "It lived in src/pelican/burst.ts, then ./docs/quokka.md.",
      "Run /slopweaver:quokka-audit, or read skills/pelican-sweep and skills/pelican-sweep/SKILL.md.",
    ].join("\n");
    expect(extractProseReferents({ roots, text })).toEqual([
      { kind: "path", line: 1, text: "src/pelican/burst.ts" },
      { kind: "path", line: 1, text: "docs/quokka.md" },
      { kind: "skill", line: 2, text: "skills/pelican-sweep" },
      { kind: "path", line: 2, text: "skills/pelican-sweep/SKILL.md" },
      { kind: "skill", line: 2, text: "skills/quokka-audit" },
    ]);
  });

  it("reads nothing rooted outside a checkout: a home path, a variable, a placeholder, a subdirectory-relative name", () => {
    const text = [
      "~/.slopweaver/live/pelican.ts and $SLOPWEAVER_HOME/src/pelican.ts",
      "<main>/src/pelican.ts and /abs/src/pelican.ts",
      "kit/pelican.ts sits under some subdirectory, and a/slopweaver:quokka is no slash command",
      "src/pelican has no extension, src/pelican/*.ts is a glob",
    ].join("\n");
    expect(extractProseReferents({ roots, text })).toEqual([]);
  });

  it("reads nothing at all with no checkout roots", () => {
    expect(extractProseReferents({ roots: new Set(), text: "src/pelican/burst.ts" })).toEqual([]);
  });
});

describe("extractCommandReferents", () => {
  it("reads a verb out of each chained segment that opens with the binary, on the given line", () => {
    const text = "slopweaver pelican migrate --dry && jq . | slopweaver quokka list; echo slopweaver fake verb";
    expect(extractCommandReferents({ line: 7, text })).toEqual([
      { kind: "verb", line: 7, text: "pelican migrate" },
      { kind: "verb", line: 7, text: "quokka list" },
    ]);
  });

  it("reads nothing out of a command that never runs the binary", () => {
    expect(extractCommandReferents({ line: 1, text: "grep -c pelican quokka.jsonl" })).toEqual([]);
  });
});

describe("findStaleReferents", () => {
  it("keeps only what the resolver could not account for, in leaf then line order", () => {
    const leaves = [leafOf({ file: "first.md" }), leafOf({ file: "second.md" })];
    const texts = new Map([
      ["first.md", "`src/pelican/gone.ts` then `src/pelican/here.ts` then `--quokka-batch`"],
      ["second.md", "`src/pelican/moved.ts`"],
    ]);
    const verdicts: Readonly<Record<string, ReferentVerdict>> = {
      "--quokka-batch": "gone",
      "src/pelican/gone.ts": "gone",
      "src/pelican/here.ts": "resolves",
      "src/pelican/moved.ts": "moved",
    };
    const resolve = ({ referent }: { referent: Referent }): ReferentVerdict => verdicts[referent.text]!;
    const stale = findStaleReferents({ leaves, resolve, texts });
    expect(stale.map((entry) => [entry.file, entry.referent.text, entry.verdict])).toEqual([
      ["first.md", "src/pelican/gone.ts", "gone"],
      ["first.md", "--quokka-batch", "gone"],
      ["second.md", "src/pelican/moved.ts", "moved"],
    ]);
  });

  it("returns nothing when every referent resolves, and nothing for a leaf with no text", () => {
    const leaves = [leafOf({ file: "first.md" }), leafOf({ file: "textless.md" })];
    const texts = new Map([["first.md", "`src/pelican/here.ts` and `--quokka-batch`"]]);
    const resolve = (): ReferentVerdict => "resolves";
    expect(findStaleReferents({ leaves, resolve, texts })).toEqual([]);
  });
});
