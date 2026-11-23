/**
 * The moved-not-deleted gate — the half of the docs budget that cannot be satisfied by cutting.
 *
 * Two describe blocks, the shape the other canon gates use: the first drives the pure functions on inline
 * fixtures and never touches disk; the second checks this repository's own declared moves against the real
 * files.
 *
 * ## Why this exists at all, in the owner's own framing
 *
 * Agents have been cutting content to satisfy a line limit, so the rule on this restructure was
 * MOVE, NEVER DELETE. A budget gate alone cannot enforce that — deleting is the easiest way to pass it. This
 * gate can only be satisfied by the removed text existing somewhere the root file still links to, so the two
 * pull in opposite directions and neither can green the other.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  bodyProblems,
  linkedPaths,
  MAX_HOPS,
  type MovedBody,
  type MovedHeading,
  moveProblems,
  reachableDocs,
  sectionBodyLines,
} from "../../../canon/movedHeadings.js";
import { repoRootOf } from "../../../lib/gitRepo.js";

const ROOT_DOC = "AGENTS.md";

/**
 * Every section that LEFT `AGENTS.md` during the August-2026 restructure, and where it went.
 *
 * `bodyLines` is the section's own non-blank body count MEASURED on `main` immediately before the move, not
 * a guess and not a round number. That is what makes the check bite: a later edit that hollows out the
 * destination while keeping its heading fails here, which is exactly the shape that reads as a clean move in
 * a diff.
 */
const MOVED: readonly MovedHeading[] = [
  // The sidebar-progress section that also moved out then was retired, by the owner's ruling that they
  // read no sidebar checklist or status lane — retired, not hollowed, so it has no destination left to guard.
  { bodyLines: 39, destination: "docs/what-slopweaver-is.md", heading: "## Codebase Overview" },
];

/**
 * Sections whose HEADING stayed in `AGENTS.md` while the detail behind it moved out.
 *
 * `minLines` is the destinations' non-blank line count, summed, at the move. These are the shape the owner asked
 * for — the root keeps the rule, the reference is one hop away — and they need their own check because the
 * first thing {@link MOVED} verifies is that a heading is gone, which for these must not be true.
 */
const MOVED_BODIES: readonly MovedBody[] = [
  {
    destinations: ["docs/toolchain/lint-reference-repository.md", "docs/toolchain/lint-reference-tests-and-ci.md"],
    label: "the per-linter toolchain reference",
    // Re-measured when the lint reference split into its two pages. Remeasure:
    // cat docs/toolchain/lint-reference-*.md | grep -c -v "^[[:space:]]*$"
    minLines: 455,
  },
  {
    destinations: ["skills/github/reference/pull-requests.md"],
    label: "the pull-request description format",
    minLines: 48,
  },
  {
    destinations: [
      "docs/doctrine-rationale.md",
      "docs/doctrine-rationale/accurate-answer.md",
      "docs/doctrine-rationale/always-on.md",
      "docs/doctrine-rationale/ambient-home.md",
      "docs/doctrine-rationale/error-shape.md",
      "docs/doctrine-rationale/failure-only-test.md",
      "docs/doctrine-rationale/fleet-capacity.md",
      "docs/doctrine-rationale/lost-between-supervisors.md",
      "docs/doctrine-rationale/no-python.md",
      "docs/doctrine-rationale/no-silent-fallback.md",
      "docs/doctrine-rationale/phase-rule.md",
      "docs/doctrine-rationale/rule-1.md",
      "docs/doctrine-rationale/rule-10-examples.md",
      "docs/doctrine-rationale/rule-10.md",
      "docs/doctrine-rationale/rule-2.md",
      "docs/doctrine-rationale/rule-3.md",
      "docs/doctrine-rationale/rule-5.md",
      "docs/doctrine-rationale/rule-7.md",
      "docs/doctrine-rationale/rule-8.md",
      "docs/doctrine-rationale/rule-9.md",
      "docs/doctrine-rationale/seat-never-scans.md",
      "docs/doctrine-rationale/supervisor-accounting.md",
      "docs/doctrine-rationale/temp-directories.md",
      "docs/doctrine-rationale/three-gaps.md",
      "docs/doctrine-rationale/two-clock.md",
      "docs/doctrine-rationale/whole-file-string.md",
    ],
    label: "the doctrine rationale",
    // Re-measured when the rationale split into pages, and when no-python.md's runtime paragraph stopped describing
    // the landed Python refusal as future work. The floor holds the TREE total, as bulk and never content,
    // since detail may move between pages; agent-doc-size caps each page at 300 lines, so it cannot all fold back
    // into the index. Remeasure:
    // cat docs/doctrine-rationale.md docs/doctrine-rationale/*.md | grep -c -v "^[[:space:]]*$"
    minLines: 1722,
  },
  { destinations: ["docs/what-slopweaver-is.md"], label: "the pitch and the module layout", minLines: 84 },
  {
    destinations: ["skills/handover/reference/running-a-run.md"],
    label: "the run lifecycle verbs and the sidebar protocol",
    minLines: 48,
  },
];

describe("linkedPaths", () => {
  it("finds a markdown link", () => {
    expect(linkedPaths({ content: "see [the doc](docs/architecture.md) for more" })).toEqual(["docs/architecture.md"]);
  });

  it("finds an @ import, which Claude Code expands at launch", () => {
    expect(linkedPaths({ content: "@.claude/rules/testing.md\n" })).toEqual([".claude/rules/testing.md"]);
  });

  it("resolves a link with an anchor to the file itself", () => {
    expect(linkedPaths({ content: "[partition](docs/constraints/partition.md#the-partition)" })).toEqual([
      "docs/constraints/partition.md",
    ]);
  });

  it("ignores an external URL", () => {
    expect(linkedPaths({ content: "[shields](https://shields.io/badge.md)" })).toEqual([]);
  });

  it("ignores a link to something that is not markdown", () => {
    expect(linkedPaths({ content: "[code](src/canon/movedHeadings.ts)" })).toEqual([]);
  });

  it("deduplicates a path linked twice", () => {
    expect(linkedPaths({ content: "[a](docs/x.md) and again [b](docs/x.md)" })).toEqual(["docs/x.md"]);
  });

  it("finds nothing in a document with no links", () => {
    expect(linkedPaths({ content: "# Title\n\nJust prose.\n" })).toEqual([]);
  });
});

describe("reachableDocs", () => {
  const tree: Record<string, string> = {
    "AGENTS.md": "[skill](skills/loop/SKILL.md) and [doc](docs/one.md)",
    "skills/loop/SKILL.md": "[bundled](reference/reviewer.md)",
    "skills/loop/reference/reviewer.md": "[deeper](further.md)",
    "docs/one.md": "[two](two.md)",
  };
  const read = ({ path }: { path: string }): string | undefined => tree[path];

  it("resolves a skill's relative link against the skill's OWN directory", () => {
    const reached = reachableDocs({ maxHops: MAX_HOPS, read, root: "AGENTS.md" });
    expect(reached.has("skills/loop/reference/reviewer.md")).toBe(true);
  });

  it("resolves a sibling link inside a docs page", () => {
    expect(reachableDocs({ maxHops: MAX_HOPS, read, root: "AGENTS.md" }).has("docs/two.md")).toBe(true);
  });

  it("stops at the hop limit rather than walking the whole graph", () => {
    expect(reachableDocs({ maxHops: MAX_HOPS, read, root: "AGENTS.md" }).has("skills/loop/reference/further.md")).toBe(
      false,
    );
  });

  it("includes the root itself", () => {
    expect(reachableDocs({ maxHops: 0, read, root: "AGENTS.md" })).toStrictEqual(new Set(["AGENTS.md"]));
  });

  it("survives a link to a file that does not exist", () => {
    const reached = reachableDocs({ maxHops: MAX_HOPS, read: () => undefined, root: "AGENTS.md" });
    expect(reached).toStrictEqual(new Set(["AGENTS.md"]));
  });
});

describe("sectionBodyLines", () => {
  const doc = "# Title\n\n## One\n\nalpha\n\nbeta\n\n### Nested\n\ngamma\n\n## Two\n\ndelta\n";

  it("counts a section's own non-blank body", () => {
    expect(sectionBodyLines({ content: doc, heading: "## One" })).toBe(2);
  });

  it("stops at a DEEPER heading, so a subsection answers for itself", () => {
    expect(sectionBodyLines({ content: doc, heading: "### Nested" })).toBe(1);
  });

  it("counts the last section to the end of the file", () => {
    expect(sectionBodyLines({ content: doc, heading: "## Two" })).toBe(1);
  });

  it("reports an absent heading as absent, not as empty", () => {
    expect(sectionBodyLines({ content: doc, heading: "## Missing" })).toBeUndefined();
  });

  it("reports a heading with no body as zero", () => {
    expect(sectionBodyLines({ content: "## Empty\n\n## Next\n", heading: "## Empty" })).toBe(0);
  });
});

describe("moveProblems", () => {
  const move: MovedHeading = { bodyLines: 2, destination: "docs/dest.md", heading: "## Moved" };
  const reachable = new Set(["AGENTS.md", "docs/dest.md"]);

  it("passes a real move", () => {
    const read = ({ path }: { path: string }): string | undefined =>
      ({ "AGENTS.md": "# Root\n\n[dest](docs/dest.md)\n", "docs/dest.md": "## Moved\n\nalpha\n\nbeta\n" })[path];
    expect(moveProblems({ moves: [move], reachable, read, rootPath: "AGENTS.md" })).toEqual([]);
  });

  it("fails a heading that never actually left the root", () => {
    const read = ({ path }: { path: string }): string | undefined =>
      ({ "AGENTS.md": "## Moved\n\nstill here\n", "docs/dest.md": "## Moved\n\nalpha\n\nbeta\n" })[path];
    const problems = moveProblems({ moves: [move], reachable, read, rootPath: "AGENTS.md" });
    expect(problems.map((problem) => problem.detail)).toContain(
      "still present in AGENTS.md — nothing moved, so this entry describes an intention rather than a change",
    );
  });

  it("fails a heading that reached no destination — deleted, not moved", () => {
    const read = ({ path }: { path: string }): string | undefined =>
      ({ "AGENTS.md": "# Root\n", "docs/dest.md": "## Something else\n\nalpha\n" })[path];
    const problems = moveProblems({ moves: [move], reachable, read, rootPath: "AGENTS.md" });
    expect(problems).toStrictEqual([
      {
        detail: "docs/dest.md does not carry the heading — the section was removed, not moved",
        heading: "## Moved",
      },
    ]);
  });

  it("fails a section that arrived with its paragraphs dropped", () => {
    const read = ({ path }: { path: string }): string | undefined =>
      ({ "AGENTS.md": "# Root\n", "docs/dest.md": "## Moved\n\nalpha\n" })[path];
    const problems = moveProblems({ moves: [move], reachable, read, rootPath: "AGENTS.md" });
    expect(problems).toStrictEqual([
      {
        detail:
          "docs/dest.md carries only 1 body lines, down from the 2 measured at the move — content was dropped on the way",
        heading: "## Moved",
      },
    ]);
  });

  it("fails a destination nothing links to — deleted with extra steps", () => {
    const read = ({ path }: { path: string }): string | undefined =>
      ({ "AGENTS.md": "# Root\n", "docs/dest.md": "## Moved\n\nalpha\n\nbeta\n" })[path];
    const problems = moveProblems({ moves: [move], reachable: new Set(["AGENTS.md"]), read, rootPath: "AGENTS.md" });
    expect(problems.map((problem) => problem.detail)).toStrictEqual([
      "docs/dest.md is not reachable from AGENTS.md within 2 link hops — a paragraph nothing links to is deleted with extra steps",
    ]);
  });

  it("fails a destination file that does not exist", () => {
    const read = ({ path }: { path: string }): string | undefined => ({ "AGENTS.md": "# Root\n" })[path];
    expect(moveProblems({ moves: [move], reachable, read, rootPath: "AGENTS.md" })).toStrictEqual([
      { detail: "destination docs/dest.md does not exist", heading: "## Moved" },
    ]);
  });

  it("looks for the ROOT spelling when a move changed the heading level", () => {
    const promoted: MovedHeading = { ...move, heading: "## Moved", rootHeading: "### Moved" };
    const read = ({ path }: { path: string }): string | undefined =>
      ({ "AGENTS.md": "### Moved\n\nstill here\n", "docs/dest.md": "## Moved\n\nalpha\n\nbeta\n" })[path];
    expect(
      moveProblems({ moves: [promoted], reachable, read, rootPath: "AGENTS.md" }).map((problem) => problem.detail),
    ).toContain(
      "still present in AGENTS.md — nothing moved, so this entry describes an intention rather than a change",
    );
  });
});

describe("bodyProblems", () => {
  const body: MovedBody = { destinations: ["docs/ref.md"], label: "the reference", minLines: 3 };
  const reachable = new Set(["AGENTS.md", "docs/ref.md"]);

  it("passes a destination that kept its bulk", () => {
    const read = (): string => "# Ref\n\nalpha\n\nbeta\n";
    expect(bodyProblems({ bodies: [body], reachable, read, rootPath: "AGENTS.md" })).toEqual([]);
  });

  it("fails a destination that was hollowed out", () => {
    const read = (): string => "# Ref\n";
    expect(bodyProblems({ bodies: [body], reachable, read, rootPath: "AGENTS.md" })).toStrictEqual([
      {
        detail:
          "docs/ref.md holds 1 non-blank lines, down from the 3 measured at the move — detail was dropped rather than relocated",
        heading: "the reference",
      },
    ]);
  });

  it("fails a destination nothing links to", () => {
    const read = (): string => "# Ref\n\nalpha\n\nbeta\n";
    expect(
      bodyProblems({ bodies: [body], reachable: new Set(["AGENTS.md"]), read, rootPath: "AGENTS.md" }),
    ).toStrictEqual([
      {
        detail: "docs/ref.md is not reachable from AGENTS.md within 2 link hops",
        heading: "the reference",
      },
    ]);
  });

  describe("a body split into an index and its pages", () => {
    const tree: MovedBody = {
      destinations: ["docs/ref.md", "docs/ref/a.md", "docs/ref/b.md"],
      label: "the reference",
      minLines: 4,
    };
    const pages: Readonly<Record<string, string>> = {
      "docs/ref.md": "# Ref\n\n- [A](ref/a.md)\n",
      "docs/ref/a.md": "# A\n\nalpha\n",
      "docs/ref/b.md": "# B\n\nbeta\n",
    };
    const readPage = ({ path }: { path: string }): string | undefined => pages[path];
    const everyPage = new Set(["AGENTS.md", "docs/ref.md", "docs/ref/a.md", "docs/ref/b.md"]);

    it("passes when the pages together keep the bulk no single page does", () => {
      expect(bodyProblems({ bodies: [tree], reachable: everyPage, read: readPage, rootPath: "AGENTS.md" })).toEqual([]);
    });

    it("fails the sum, naming the index and its page count, when the pages together were hollowed out", () => {
      const thin: MovedBody = { ...tree, minLines: 7 };
      expect(
        bodyProblems({ bodies: [thin], reachable: everyPage, read: readPage, rootPath: "AGENTS.md" }),
      ).toStrictEqual([
        {
          detail:
            "docs/ref.md and its 2 pages hold 6 non-blank lines, down from the 7 measured at the move — detail was dropped rather than relocated",
          heading: "the reference",
        },
      ]);
    });

    it("fails a missing page by name, without also reporting the sum it shortened", () => {
      const withGone: MovedBody = { ...tree, destinations: ["docs/ref.md", "docs/ref/a.md", "docs/ref/gone.md"] };
      expect(
        bodyProblems({ bodies: [withGone], reachable: everyPage, read: readPage, rootPath: "AGENTS.md" }),
      ).toStrictEqual([{ detail: "destination docs/ref/gone.md does not exist", heading: "the reference" }]);
    });

    it("fails the one page nothing links to", () => {
      const withoutB = new Set(["AGENTS.md", "docs/ref.md", "docs/ref/a.md"]);
      expect(
        bodyProblems({ bodies: [tree], reachable: withoutB, read: readPage, rootPath: "AGENTS.md" }),
      ).toStrictEqual([
        { detail: "docs/ref/b.md is not reachable from AGENTS.md within 2 link hops", heading: "the reference" },
      ]);
    });

    it("fails a page declared twice under two spellings of one path", () => {
      const aliased: MovedBody = { ...tree, destinations: ["docs/ref.md", "docs/ref/a.md", "docs/ref/../ref/./a.md"] };
      expect(
        bodyProblems({ bodies: [aliased], reachable: everyPage, read: readPage, rootPath: "AGENTS.md" })[0],
      ).toStrictEqual({ detail: "destination docs/ref/../ref/./a.md is declared twice", heading: "the reference" });
    });

    it("fails a page declared twice rather than counting it twice", () => {
      const twice: MovedBody = {
        ...tree,
        destinations: ["docs/ref.md", "docs/ref/a.md", "docs/ref/a.md"],
        minLines: 5,
      };
      expect(
        bodyProblems({ bodies: [twice], reachable: everyPage, read: readPage, rootPath: "AGENTS.md" }),
      ).toStrictEqual([
        { detail: "destination docs/ref/a.md is declared twice", heading: "the reference" },
        {
          detail:
            "docs/ref.md and its 2 pages hold 4 non-blank lines, down from the 5 measured at the move — detail was dropped rather than relocated",
          heading: "the reference",
        },
      ]);
    });
  });
});

describe("the real moves out of AGENTS.md", () => {
  const root = repoRootOf({ importMetaUrl: import.meta.url });
  const read = ({ path }: { path: string }): string | undefined => {
    const full = join(root, path);
    return existsSync(full) ? readFileSync(full, "utf8") : undefined;
  };
  const reachable = reachableDocs({ maxHops: MAX_HOPS, read, root: ROOT_DOC });

  it("declares moves at all — an empty manifest would pass vacuously", () => {
    expect(MOVED.length).toBeGreaterThan(0);
    expect(MOVED_BODIES.length).toBeGreaterThan(0);
  });

  it("reaches a non-trivial set of documents from the root", () => {
    expect(reachable.size).toBeGreaterThan(MOVED.length);
  });

  it("keeps every moved heading gone from the root, present in its destination, and reachable", () => {
    expect(moveProblems({ moves: MOVED, reachable, read, rootPath: ROOT_DOC })).toEqual([]);
  });

  it("keeps every moved body at full size and reachable", () => {
    expect(bodyProblems({ bodies: MOVED_BODIES, reachable, read, rootPath: ROOT_DOC })).toEqual([]);
  });
});
