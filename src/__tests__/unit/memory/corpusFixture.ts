/**
 * One valid synthetic corpus, and one mutation per finding id.
 *
 * Everything here is invented — no organisation, person, repository or path from anywhere real, because this is
 * a public repository and fixtures are the easiest place for a private string to leak in unnoticed.
 *
 * The corpus is deliberately the SMALLEST shape that exercises every rule: a root index, one topic index, a
 * leaf routed from the root, and a leaf routed only from the topic index. That last one is what makes
 * `unreachable` expressible at all.
 *
 * Line numbers are load-bearing — several expected findings assert one — so each file's lines are commented.
 */
import type { MemorySourceFile } from "../../../memory/types.js";

/** `# Index`(1), blank(2), project link(3), topic-index link(4). */
const ROOT = `# Index

- [Project](project.md) — the project fact
- [Build](INDEX-build.md) — build notes
`;

/** `# Build`(1), blank(2), leaf link(3). */
const TOPIC = `# Build

- [Build command](build_command.md) — how to build
`;

/**
 * frontmatter(1-6), blank(7), why-always-loaded(8), blank(9), wikilink(10). Routed from the root index, so it
 * opens with the paragraph every always-loaded memory carries.
 */
const PROJECT = `---
name: project
description: what the project is
metadata:
  type: project
---

**Why always-loaded:** the first build would already be wrong if retrieval waited.

Related: [[build-command]]
`;

/**
 * Carries the extra keys Claude Code stamps of its own accord — `node_type`, `originSessionId`, `modified`.
 * They must NOT produce a finding: a schema that rejected unknown metadata would reject the tool's own output.
 * Also names itself with a hyphen while its filename uses an underscore, exactly as Claude Code does.
 */
const BUILD_COMMAND = `---
name: build-command
description: the command that builds this project
metadata:
  node_type: memory
  type: reference
  originSessionId: 00000000-0000-4000-8000-000000000000
  modified: 2026-01-01T00:00:00.000Z
---

Run the build.
`;

/**
 * The valid corpus. Every mutation below starts from this and changes exactly one thing.
 *
 * @returns the corpus files, valid in every respect — so a test that fails has exactly one cause
 */
export function validCorpus(): readonly MemorySourceFile[] {
  return [
    { file: "MEMORY.md", text: ROOT },
    { file: "INDEX-build.md", text: TOPIC },
    { file: "project.md", text: PROJECT },
    { file: "build_command.md", text: BUILD_COMMAND },
  ];
}

/** Replace one file's text in a copy of the corpus. */
function withFile({
  files,
  file,
  text,
}: {
  files: readonly MemorySourceFile[];
  file: string;
  text: string;
}): readonly MemorySourceFile[] {
  return files.map((entry) => (entry.file === file ? { file, text } : entry));
}

/** Drop one file from a copy of the corpus. */
function withoutFile({
  files,
  file,
}: {
  files: readonly MemorySourceFile[];
  file: string;
}): readonly MemorySourceFile[] {
  return files.filter((entry) => entry.file !== file);
}

/**
 * One mutation per finding id — each breaks exactly one rule, so the expected finding array is exact rather
 * than "contains". A mutation that tripped two checks would let a wrong implementation pass by accident.
 */
export const MUTATIONS: Readonly<Record<string, () => readonly MemorySourceFile[]>> = {
  collision: () =>
    withFile({
      file: "build_command.md",
      files: validCorpus(),
      // Claims the identity `project`, which project.md already owns by filename.
      text: BUILD_COMMAND.replace("name: build-command", "name: project"),
    }),
  // Declares an amendment and names no row — the half that fires with no board, so a pure caller sees it.
  "amends-canon-without-row": () =>
    withFile({
      file: "project.md",
      files: validCorpus(),
      text: PROJECT.replace(
        "  type: project\n",
        "  type: project\n  slopweaver:\n    amendsCanon:\n      target: AGENTS.md\n",
      ),
    }),
  "dangling-wikilink": () =>
    withFile({
      file: "project.md",
      files: validCorpus(),
      text: PROJECT.replace("[[build-command]]", "[[nothing-here]]"),
    }),
  "dated-addendum": () =>
    withFile({
      file: "project.md",
      files: validCorpus(),
      text: `${PROJECT}\n- **Read-only, added 12 Sep 2026** — a rule.\n`,
    }),
  "dead-pointer": () =>
    withFile({ file: "MEMORY.md", files: validCorpus(), text: `${ROOT}- [Gone](gone.md) — never written\n` }),
  "double-routed": () =>
    withFile({
      file: "INDEX-build.md",
      files: validCorpus(),
      text: `${TOPIC}- [Project again](project.md) — already routed from the root\n`,
    }),
  // The index line names an identifier — an owner turn id — that the memory it routes does not carry.
  "index-line-drift": () =>
    withFile({
      file: "MEMORY.md",
      files: validCorpus(),
      text: ROOT.replace("the project fact", "the project fact, ruled in 101-7"),
    }),
  "missing-root-index": () => withoutFile({ file: "MEMORY.md", files: validCorpus() }),
  // Breaks the kebab grammar and nothing else: the FILENAME stem is what routes and what the other leaf’s
  // wikilink resolves against, so nothing in the graph moves.
  "name-format": () =>
    withFile({
      file: "project.md",
      files: validCorpus(),
      text: PROJECT.replace("name: project", "name: Project_Thing"),
    }),
  orphan: () =>
    withFile({
      file: "MEMORY.md",
      files: validCorpus(),
      text: ROOT.replace("- [Project](project.md) — the project fact\n", ""),
    }),
  schema: () =>
    withFile({
      file: "project.md",
      files: validCorpus(),
      text: PROJECT.replace("description: what the project is\n", ""),
    }),
  // Says it supersedes build-command, which is still in the corpus. `[[build-command]]` still resolves, so
  // nothing in the graph moves.
  "superseded-still-present": () =>
    withFile({
      file: "project.md",
      files: validCorpus(),
      text: PROJECT.replace(
        "  type: project\n",
        "  type: project\n  slopweaver:\n    overlaps:\n      build-command: supersedes\n",
      ),
    }),
  unreachable: () =>
    withFile({
      file: "MEMORY.md",
      files: validCorpus(),
      // build_command.md is still routed from INDEX-build.md, but nothing reaches that index any more.
      text: ROOT.replace("- [Build](INDEX-build.md) — build notes\n", ""),
    }),
  "why-always-loaded-missing": () =>
    withFile({
      file: "project.md",
      files: validCorpus(),
      text: PROJECT.replace(
        "**Why always-loaded:** the first build would already be wrong if retrieval waited.\n\n",
        "",
      ),
    }),
};
