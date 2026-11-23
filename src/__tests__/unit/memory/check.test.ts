/**
 * The checker, proved against one valid corpus and one mutation per finding id.
 *
 * The registry test at the bottom is the one that matters. A checker that never fires looks identical to a
 * clean corpus, so asserting "the corpus is clean" proves nothing on its own — every id must be shown to FIRE
 * on a corpus that breaks it and to STAY QUIET on one that does not.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { checkMemoryCorpus, checkMemoryLeaf } from "../../../memory/check.js";
import { buildMemoryCorpus } from "../../../memory/corpus.js";
import { MEMORY_CHECK_IDS, type MemoryFinding } from "../../../memory/types.js";
import { MUTATIONS, validCorpus } from "./corpusFixture.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

/** Check a set of source files. `resolvesOutside` is irrelevant here — the fixture has no outside pointers. */
function check({ files }: { files: readonly { file: string; text: string }[] }): readonly MemoryFinding[] {
  return checkMemoryCorpus({ corpus: buildMemoryCorpus({ files }) });
}

describe("a sound corpus produces nothing", () => {
  it("reports no findings at all", () => {
    expect(check({ files: validCorpus() })).toEqual([]);
  });

  it("accepts the extra metadata keys Claude Code stamps itself", () => {
    const leaf = buildMemoryCorpus({ files: validCorpus() }).leaves.find((l) => l.file === "build_command.md")!;

    expect(checkMemoryLeaf({ leaf })).toEqual([]);
  });

  it("resolves a wikilink written as a hyphenated name against an underscored filename", () => {
    // `project.md` links `[[build-command]]`; the file is `build_command.md` with `name: build-command`.
    expect(check({ files: validCorpus() })).toEqual([]);
  });
});

describe("each check fires on exactly the corpus that breaks it", () => {
  it("schema: a leaf with no description", () => {
    expect(check({ files: MUTATIONS["schema"]!() })).toEqual([
      { check: "schema", file: "project.md", line: null, message: "frontmatter is missing `description`" },
    ]);
  });

  it("name-format: a name that is not kebab-case", () => {
    expect(check({ files: MUTATIONS["name-format"]!() })).toEqual([
      {
        check: "name-format",
        file: "project.md",
        line: null,
        message:
          "`name: Project_Thing` is not kebab-case — lowercase words joined by single hyphens, like `decisions-go-on-the-queue`; a wikilink written the natural way will not match anything else",
      },
    ]);
  });

  it("missing-root-index: a directory that is not a memory corpus, and NOTHING else", () => {
    // Deliberately the only finding: without a root index the graph is meaningless, and reporting an orphan
    // for every file would bury the one sentence that matters — you are pointed at the wrong directory.
    expect(check({ files: MUTATIONS["missing-root-index"]!() })).toEqual([
      {
        check: "missing-root-index",
        file: "MEMORY.md",
        line: null,
        message:
          "no MEMORY.md in this directory — it is not a memory corpus, so nothing else could be checked meaningfully",
      },
    ]);
  });

  it("orphan: a leaf no index points at", () => {
    expect(check({ files: MUTATIONS["orphan"]!() })).toEqual([
      {
        check: "orphan",
        file: "project.md",
        line: null,
        message: "no index points at this memory — it is only reachable if its description happens to match",
      },
    ]);
  });

  it("dead-pointer: an index link to a file that was never written", () => {
    expect(check({ files: MUTATIONS["dead-pointer"]!() })).toEqual([
      { check: "dead-pointer", file: "MEMORY.md", line: 5, message: "points at `gone.md`, which does not exist" },
    ]);
  });

  it("double-routed: a leaf listed in two indexes", () => {
    expect(check({ files: MUTATIONS["double-routed"]!() })).toEqual([
      {
        check: "double-routed",
        file: "project.md",
        line: null,
        message: "listed in more than one index (INDEX-build.md, MEMORY.md) — pick one",
      },
    ]);
  });

  it("collision: two leaves claiming one identity", () => {
    expect(check({ files: MUTATIONS["collision"]!() })).toEqual([
      {
        check: "collision",
        file: "build_command.md",
        line: null,
        message: "`project` is claimed by build_command.md and project.md — a wikilink to it resolves arbitrarily",
      },
      {
        check: "dangling-wikilink",
        file: "project.md",
        line: 10,
        message: "`[[build-command]]` matches no memory — nothing ever revisits a link like this, so it stays dead",
      },
    ]);
  });

  it("unreachable: a leaf behind an index the root does not link", () => {
    expect(check({ files: MUTATIONS["unreachable"]!() })).toEqual([
      {
        check: "unreachable",
        file: "build_command.md",
        line: null,
        message: "routed only from an index that MEMORY.md does not link, so nothing reaches it",
      },
    ]);
  });

  it("dangling-wikilink: a link to a memory that does not exist", () => {
    expect(check({ files: MUTATIONS["dangling-wikilink"]!() })).toEqual([
      {
        check: "dangling-wikilink",
        file: "project.md",
        line: 10,
        message: "`[[nothing-here]]` matches no memory — nothing ever revisits a link like this, so it stays dead",
      },
    ]);
  });

  it("superseded-still-present: a memory claiming to supersede one that was never deleted", () => {
    expect(check({ files: MUTATIONS["superseded-still-present"]!() })).toEqual([
      {
        check: "superseded-still-present",
        file: "project.md",
        line: null,
        message:
          "supersedes `build-command`, but build_command.md is still here — delete it, or answer `compatible` if both stand",
      },
    ]);
  });

  it("superseded-still-present stays silent once the superseded memory is gone", () => {
    const files = MUTATIONS["superseded-still-present"]!()
      .filter((entry) => entry.file !== "build_command.md" && entry.file !== "INDEX-build.md")
      .map((entry) =>
        entry.file === "MEMORY.md"
          ? { file: entry.file, text: "# Index\n\n- [Project](project.md) — the project fact\n" }
          : { file: entry.file, text: entry.text.replace("Related: [[build-command]]\n", "") },
      );

    expect(check({ files })).toEqual([]);
  });

  it("dated-addendum: a paragraph whose lead-in dates an amendment", () => {
    expect(check({ files: MUTATIONS["dated-addendum"]!() })).toEqual([
      {
        check: "dated-addendum",
        file: "project.md",
        line: 12,
        message:
          "`Read-only, added 12 Sep 2026` dates an amendment — rewrite the memory in present tense as if it had always read this way; a date that anchors when the owner said something opens with the owner's words, not an amendment word",
      },
    ]);
  });

  it("dated-addendum: the single-leaf check the write hook runs reports it too", () => {
    const leaf = buildMemoryCorpus({ files: MUTATIONS["dated-addendum"]!() }).leaves.find(
      (l) => l.file === "project.md",
    )!;

    expect(checkMemoryLeaf({ leaf }).map((finding) => [finding.check, finding.line])).toEqual([["dated-addendum", 12]]);
  });

  it("why-always-loaded-missing: a root-routed memory with no Why paragraph", () => {
    expect(check({ files: MUTATIONS["why-always-loaded-missing"]!() })).toEqual([
      {
        check: "why-always-loaded-missing",
        file: "project.md",
        line: null,
        message:
          "routed from MEMORY.md, so it loads every session, but its body does not open with a **Why always-loaded:** paragraph naming the first act that would already be wrong if retrieval waited",
      },
    ]);
  });

  it("index-line-drift: an index line naming a fact its memory lacks", () => {
    expect(check({ files: MUTATIONS["index-line-drift"]!() })).toEqual([
      {
        check: "index-line-drift",
        file: "project.md",
        line: null,
        message:
          "the MEMORY.md line routing this memory says `101-7`, and nothing in the memory carries that — the line that loads every session and the memory it points at disagree",
      },
    ]);
  });

  it("amends-canon-without-row: a declared amendment naming no board row", () => {
    expect(check({ files: MUTATIONS["amends-canon-without-row"]!() })).toEqual([
      {
        check: "amends-canon-without-row",
        file: "project.md",
        line: null,
        message:
          "declares `amendsCanon` on `AGENTS.md` but names no board row landing the change — add `row: <slug>`, or nothing ever retires this memory",
      },
    ]);
  });
});

describe("things that look like defects and are not", () => {
  it("does not call two links to one leaf from the SAME index double-routing", () => {
    const files = validCorpus().map((entry) =>
      entry.file === "MEMORY.md"
        ? { file: entry.file, text: `${entry.text}- [Project once more](project.md) — same index\n` }
        : entry,
    );

    expect(check({ files })).toEqual([]);
  });

  it("does not treat a pointer inside a fenced code block as a route", () => {
    const files = validCorpus().map((entry) =>
      entry.file === "MEMORY.md"
        ? { file: entry.file, text: `${entry.text}\n\`\`\`markdown\n- [Example](deleted.md) — documentation\n\`\`\`\n` }
        : entry,
    );

    expect(check({ files })).toEqual([]);
  });

  it("does not treat a wikilink inside an HTML comment as an edge", () => {
    const files = validCorpus().map((entry) =>
      entry.file === "project.md"
        ? { file: entry.file, text: `${entry.text}\n<!-- see [[not-written-yet]] -->\n` }
        : entry,
    );

    expect(check({ files })).toEqual([]);
  });

  it("treats `_` and `-` names as DIFFERENT memories rather than colliding aliases", () => {
    const files = [
      ...validCorpus(),
      {
        file: "other_thing.md",
        text: "---\nname: other-thing\ndescription: a distinct memory\nmetadata:\n  type: reference\n---\n\nBody.\n",
      },
      { file: "MEMORY.md", text: "" },
    ]
      .filter((entry, index, all) => all.findIndex((e) => e.file === entry.file) === index)
      .map((entry) =>
        entry.file === "MEMORY.md"
          ? {
              file: entry.file,
              text: `# Index\n\n- [Project](project.md) — a\n- [Build](INDEX-build.md) — b\n- [Other](other_thing.md) — c\n`,
            }
          : entry,
      );

    // `other_thing` (stem) and `other-thing` (name) belong to ONE leaf, so nothing collides.
    expect(check({ files }).filter((f) => f.check === "collision")).toEqual([]);
  });
});

describe("the canonical order within one file", () => {
  it("orders two findings of one check by line before message", () => {
    // `[[zzz-later]]` sits on an earlier line than `[[aaa-later]]`, so line order and message order disagree.
    const files = validCorpus().map((entry) =>
      entry.file === "project.md"
        ? { file: entry.file, text: entry.text.replace("[[build-command]]", "[[zzz-later]]\n\n[[aaa-later]]") }
        : entry,
    );

    expect(check({ files }).map((finding) => [finding.check, finding.line, finding.message.slice(0, 15)])).toEqual([
      ["dangling-wikilink", 10, "`[[zzz-later]]`"],
      ["dangling-wikilink", 12, "`[[aaa-later]]`"],
    ]);
  });
});

describe("the registry is complete, so no check can be vacuous", () => {
  it("has a mutation for every published check id", () => {
    expect(Object.keys(MUTATIONS).toSorted()).toEqual([...MEMORY_CHECK_IDS].toSorted());
  });

  it("fires every check id on its own mutation", () => {
    const notFired = MEMORY_CHECK_IDS.filter(
      (id) => !check({ files: MUTATIONS[id]!() }).some((finding) => finding.check === id),
    ).toSorted();

    expect(notFired).toEqual([]);
  });

  it("documents every check id in the skill's checks reference, so the next id cannot land undocumented", () => {
    const page = readFileSync(join(REPO_ROOT, "skills/memory/reference/checks.md"), "utf8");

    expect(MEMORY_CHECK_IDS.length).toBeGreaterThan(0);
    expect(MEMORY_CHECK_IDS.filter((id) => !page.includes(`| \`${id}\``))).toEqual([]);
  });

  it("fires no check id on the clean control", () => {
    const fired = check({ files: validCorpus() }).map((finding) => finding.check);

    expect(fired).toEqual([]);
  });
});
