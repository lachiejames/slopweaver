/**
 * The two placement rules — `why-always-loaded-missing` over routing shapes, and `amends-canon-without-row`
 * over every row state, filled through the pure `withAmendsRowStates` with plain fake resolvers.
 */
import { describe, expect, it } from "vitest";

import { declaredAmendsRows, withAmendsRowStates } from "../../../memory/amendsCanon.js";
import { routingTable } from "../../../memory/check.js";
import { buildMemoryCorpus } from "../../../memory/corpus.js";
import { amendsCanonRowFindings, whyAlwaysLoadedFindings } from "../../../memory/placement.js";
import type { AmendsRowState, MemoryCorpus, MemorySourceFile } from "../../../memory/types.js";

const WHY = "**Why always-loaded:** a session would act wrongly before retrieval ran.";

/** A leaf with a valid frontmatter and this body. */
function leaf({ body, slopweaver = "" }: { body: string; slopweaver?: string }): string {
  return `---\nname: thing\ndescription: a thing\nmetadata:\n  type: feedback\n${slopweaver}---\n\n${body}\n`;
}

/** The why findings' files for a corpus. */
function whyFiles({ files }: { files: readonly MemorySourceFile[] }): readonly string[] {
  const corpus = buildMemoryCorpus({ files });
  return whyAlwaysLoadedFindings({ corpus, routes: routingTable({ corpus }) }).map((finding) => finding.file);
}

describe("why-always-loaded-missing", () => {
  const rootRouted = ({ text }: { text: string }): readonly MemorySourceFile[] => [
    { file: "MEMORY.md", text: "- [Thing](thing.md) — a thing\n" },
    { file: "thing.md", text },
  ];

  it("fires on a root-routed memory whose Why paragraph is second rather than first", () => {
    expect(whyFiles({ files: rootRouted({ text: leaf({ body: `The rule.\n\n${WHY}` }) }) })).toEqual(["thing.md"]);
  });

  it("stays silent when the body opens with blank lines and then the Why line", () => {
    expect(whyFiles({ files: rootRouted({ text: leaf({ body: `\n\n${WHY}\n\nThe rule.` }) }) })).toEqual([]);
  });

  it("reads past an HTML comment or fenced block ahead of the Why line, since neither is content", () => {
    const body = `<!-- migrated from the work console -->\n\`\`\`\nnote\n\`\`\`\n${WHY}`;

    expect(whyFiles({ files: rootRouted({ text: leaf({ body }) }) })).toEqual([]);
  });

  it("fires on a root-routed memory with no frontmatter at all", () => {
    expect(whyFiles({ files: rootRouted({ text: "The rule.\n" }) })).toEqual(["thing.md"]);
  });

  it("stays silent for a memory routed only from a topic index, which does not load at boot", () => {
    const files = [
      { file: "MEMORY.md", text: "- [Topic](INDEX-topic.md) — the topic\n" },
      { file: "INDEX-topic.md", text: "- [Thing](thing.md) — a thing\n" },
      { file: "thing.md", text: leaf({ body: "The rule." }) },
    ];

    expect(whyFiles({ files })).toEqual([]);
  });

  it("stays silent for an orphan, which is orphan's finding", () => {
    const files = [
      { file: "MEMORY.md", text: "# Index\n" },
      { file: "thing.md", text: leaf({ body: "The rule." }) },
    ];

    expect(whyFiles({ files })).toEqual([]);
  });
});

/** A corpus of one amending memory naming `a-row`, plus one that declares nothing. */
function amendingCorpus(): MemoryCorpus {
  const amends = "  slopweaver:\n    amendsCanon:\n      target: AGENTS.md\n      row: a-row\n";
  return buildMemoryCorpus({
    files: [
      { file: "MEMORY.md", text: "# Index\n" },
      { file: "thing.md", text: leaf({ body: WHY, slopweaver: amends }) },
      { file: "twin.md", text: leaf({ body: WHY, slopweaver: amends }).replace("name: thing", "name: twin") },
      { file: "plain.md", text: leaf({ body: "Lands in row `a-row`, said in prose only." }) },
    ],
  });
}

/** The amends messages once every declared row reads as `state`. */
function amendsMessages({ state }: { state: AmendsRowState }): readonly string[] {
  const corpus = withAmendsRowStates({ corpus: amendingCorpus(), rowState: () => state });
  return amendsCanonRowFindings({ corpus })
    .filter((finding) => finding.file === "thing.md")
    .map((finding) => finding.message);
}

describe("amends-canon-without-row", () => {
  it("tells a memory whose row is done to delete itself", () => {
    expect(amendsMessages({ state: { kind: "landed" } })).toEqual([
      "amends `AGENTS.md` through `a-row`, which is done — confirm `AGENTS.md` carries the change, then delete this memory",
    ]);
  });

  it("calls an amendment whose row closed without landing void", () => {
    expect(amendsMessages({ state: { kind: "closed-unlanded", status: "cancelled" } })).toEqual([
      "amends `AGENTS.md` through `a-row`, which closed `cancelled` without landing — the amendment is void unless a new row carries it",
    ]);
  });

  it("reports a row the board does not carry", () => {
    expect(amendsMessages({ state: { kind: "missing" } })).toEqual([
      "`amendsCanon.row` names `a-row`, which no board doc carries, live or archived",
    ]);
  });

  it.each([
    ["live", { kind: "live", status: "ready" }],
    ["unreadable", { kind: "unreadable", why: "a journal line did not decode" }],
    ["unresolved", { kind: "unresolved" }],
  ] as const)("stays silent on a %s row", (_label, state) => {
    expect(amendsMessages({ state })).toEqual([]);
  });

  it("never reads a row named only in prose", () => {
    expect(declaredAmendsRows({ corpus: amendingCorpus() })).toEqual(["a-row"]);
  });

  it("asks the board once per distinct row, however many memories name it", () => {
    const asked: string[] = [];
    withAmendsRowStates({
      corpus: amendingCorpus(),
      rowState: ({ row }) => {
        asked.push(row);
        return { kind: "landed" };
      },
    });

    expect(asked).toEqual(["a-row"]);
  });
});
