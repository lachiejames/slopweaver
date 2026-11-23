/**
 * The `github` noun's four long usage blocks, checked for the property that makes one useful: every flag the
 * synopsis line advertises is explained on a line of its own below it.
 *
 * A usage string grows with a verb's flags, and the failure it produces is silent — a flag added to the parser
 * and to the synopsis, with no line saying what it does, reads as complete. So the check is the cross-product
 * rather than a fragment match: the synopsis is the declaration, the indented lines are the explanation, and a
 * flag present in one and absent from the other is the defect.
 */
import { describe, expect, it } from "vitest";

import { providerReadUsage } from "../../../../cli/commands/providerRead/core.js";
import { MERGE_USAGE, PUSH_USAGE, READ_USAGE, USAGE } from "../../../../cli/manifests/githubNounUsage.js";

const BLOCKS: readonly { readonly verb: string; readonly text: string }[] = [
  { text: USAGE, verb: "pr" },
  { text: MERGE_USAGE, verb: "merge" },
  { text: PUSH_USAGE, verb: "push" },
  { text: READ_USAGE, verb: "read" },
];

/** Every distinct long flag the block's first line advertises. */
function advertised({ text }: { text: string }): readonly string[] {
  const synopsis = text.split("\n")[0]!;
  // Digits are part of a flag's name (`--convert-c3`); a pattern without them reads a truncated flag nobody declared.
  return [...new Set([...synopsis.matchAll(/--[a-z][a-z0-9-]+/g)].map((match) => match[0]))];
}

/** Every long flag the block explains on an indented line that opens with it. */
function explained({ text }: { text: string }): ReadonlySet<string> {
  const described = text
    .split("\n")
    .slice(1)
    .map((line) => line.trimStart())
    .filter((line) => line.startsWith("--"))
    .map((line) => line.split(/[ <=]/)[0]!);
  return new Set(described);
}

describe("the github noun's usage blocks", () => {
  it("covers all four verbs, so an added block cannot skip this check by being unlisted", () => {
    expect(BLOCKS.map((block) => block.verb)).toEqual(["pr", "merge", "push", "read"]);
  });

  it("opens each block with the invocation it documents", () => {
    expect(
      BLOCKS.map((block) => block.text.split("\n")[0]!.startsWith(`usage: slopweaver github ${block.verb} `)),
    ).toEqual([true, true, true, true]);
  });

  it("explains every flag its own synopsis advertises", () => {
    const unexplained = BLOCKS.map((block) => {
      const covered = explained({ text: block.text });
      return { unexplained: advertised({ text: block.text }).filter((flag) => !covered.has(flag)), verb: block.verb };
    });

    expect(unexplained).toEqual([
      { unexplained: [], verb: "pr" },
      { unexplained: [], verb: "merge" },
      { unexplained: [], verb: "push" },
      { unexplained: [], verb: "read" },
    ]);
  });

  it("advertises the flags each verb is actually about", () => {
    expect(advertised({ text: MERGE_USAGE })).toContain("--admin");
    expect(advertised({ text: PUSH_USAGE })).toContain("--force-with-lease");
    expect(advertised({ text: READ_USAGE })).toContain("--limit");
    expect(advertised({ text: USAGE })).toContain("--form");
  });

  it("prints the same `github read` usage on a parse refusal as `--help` does", () => {
    expect(providerReadUsage({ provider: "github" })).toBe(READ_USAGE);
  });
});
