/**
 * The write-time gate. Three properties are proved here rather than described: it refuses exactly what can
 * never be addressed, it ALLOWS the forward-reference shape Claude Code's own memory instruction blesses,
 * and it decides an ordinary source write without touching a filesystem.
 */
import { describe, expect, it } from "vitest";

import {
  memoryLeafTargetedByWrite,
  memoryWriteRefusal,
  memoryWriteTextField,
} from "../../../admit/memoryWriteGuard.js";
import { runMemoryWriteGuard } from "../../../admit/memoryWriteGuardRunner.js";
import { parseMemoryLeaf } from "../../../memory/corpus.js";
import type { MemoryLeaf } from "../../../memory/types.js";

const HOME = "/home/someone";
const LEAF = `${HOME}/.claude/projects/-repo-slug/memory/a-fact.md`;
/** A corpus reached by its own path rather than through the `~/.claude` envelope — the symlink case. */
const LINKED_CORPUS = "/home/someone/dev/work-console-state/memory";

/**
 * The gate's one filesystem question, as a plain fake rather than a mock: only the linked corpus above
 * holds a `MEMORY.md`. Every call it receives is recorded, so a test can assert it was never ASKED.
 */
function rootIndexProbe(): {
  holdsRootIndex: (args: { dir: string }) => boolean;
  asked: readonly string[];
} {
  const asked: string[] = [];
  return {
    asked,
    holdsRootIndex: ({ dir }) => {
      asked.push(dir);
      return dir === LINKED_CORPUS;
    },
  };
}

/** No other memory and no canon, for a case whose subject is the name and link rules. */
function noOverlap(): { siblings: readonly never[]; sections: readonly never[] } {
  return { sections: [], siblings: [] };
}

/** The probe, for a case whose subject is the decision rather than the asking. */
function probe(): (args: { dir: string }) => boolean {
  return rootIndexProbe().holdsRootIndex;
}

/** A whole, valid memory file — every refusal below is this with one thing changed. */
function memory({ name, body }: { name: string; body: string }): string {
  return `---\nname: ${name}\ndescription: a fact worth keeping\nmetadata:\n  type: project\n---\n\n${body}\n`;
}

/** Decide one `Write` of a whole memory file. */
function writeRefusal({ text, filePath = LEAF }: { text: string; filePath?: string }): string | undefined {
  return memoryWriteRefusal({
    filePath,
    hatchOpen: false,
    holdsRootIndex: probe(),
    overlapContext: noOverlap,
    priorText: null,
    replaceAll: false,
    replacedText: null,
    text,
    toolName: "Write",
    userHome: HOME,
  });
}

describe("what the gate is scoped to", () => {
  it("names the leaf for a direct auto-memory write", () => {
    expect(memoryLeafTargetedByWrite({ filePath: LEAF, holdsRootIndex: probe(), userHome: HOME })).toBe("a-fact.md");
  });

  it("ignores an index, because nothing about one is decidable from the index alone", () => {
    const index = `${HOME}/.claude/projects/-repo-slug/memory/MEMORY.md`;
    const topic = `${HOME}/.claude/projects/-repo-slug/memory/INDEX-voice.md`;

    expect(memoryLeafTargetedByWrite({ filePath: index, holdsRootIndex: probe(), userHome: HOME })).toBe(null);
    expect(memoryLeafTargetedByWrite({ filePath: topic, holdsRootIndex: probe(), userHome: HOME })).toBe(null);
  });

  it("ignores a path outside the auto-memory envelope, however memory-shaped it looks", () => {
    const paths = [
      "/repo/src/memory/a-fact.md",
      `${HOME}/.claude/projects/-repo-slug/memory/nested/a-fact.md`,
      `${HOME}/.claude/projects/-repo-slug/notes/a-fact.md`,
      "relative/memory/a-fact.md",
    ];

    expect(
      paths.filter(
        (filePath) => memoryLeafTargetedByWrite({ filePath, holdsRootIndex: probe(), userHome: HOME }) !== null,
      ),
    ).toEqual([]);
  });

  it("names the leaf for a corpus reached by its own path rather than the `~/.claude` envelope", () => {
    // MEASURED: one of the three live corpora on this machine is a symlink into another
    // repository, so every leaf in it has a second spelling. A gate whose answer depends on which spelling
    // the caller typed is not a gate.
    const linked = `${LINKED_CORPUS}/a-fact.md`;

    expect(memoryLeafTargetedByWrite({ filePath: linked, holdsRootIndex: probe(), userHome: HOME })).toBe("a-fact.md");
  });

  it("refuses a malformed name written through that second spelling, exactly as through the first", () => {
    const linked = `${LINKED_CORPUS}/a-fact.md`;
    const text = memory({ body: "Body.", name: "Voice_Rules" });

    const refusal = writeRefusal({ filePath: linked, text })!;

    expect(refusal.split("\n")[0]).toContain("`name: Voice_Rules` is not kebab-case");
  });

  it("asks the filesystem nothing for an ordinary write, and nothing for a leaf inside the envelope", () => {
    const { asked, holdsRootIndex } = rootIndexProbe();

    memoryLeafTargetedByWrite({ filePath: "/repo/src/foo.ts", holdsRootIndex, userHome: HOME });
    memoryLeafTargetedByWrite({ filePath: "/repo/docs/architecture.md", holdsRootIndex, userHome: HOME });
    memoryLeafTargetedByWrite({ filePath: LEAF, holdsRootIndex, userHome: HOME });

    expect(asked).toEqual([]);
  });

  it("asks it exactly once for a `.md` written into some other directory called `memory`", () => {
    const { asked, holdsRootIndex } = rootIndexProbe();

    const leaf = memoryLeafTargetedByWrite({ filePath: "/repo/src/memory/a-fact.md", holdsRootIndex, userHome: HOME });

    expect(leaf).toBe(null);
    expect(asked).toEqual(["/repo/src/memory"]);
  });

  it("reads `content` for a Write, `new_string` for an Edit, and nothing for any other tool", () => {
    expect(memoryWriteTextField({ toolName: "Write" })).toBe("content");
    expect(memoryWriteTextField({ toolName: "Edit" })).toBe("new_string");
    expect(memoryWriteTextField({ toolName: "Bash" })).toBe(undefined);
  });
});

describe("what it refuses", () => {
  it("refuses a non-kebab name in the four-line shape, naming the file and the bad name", () => {
    const refusal = writeRefusal({ text: memory({ body: "Body.", name: "Voice_Rules" }) })!;
    const lines = refusal.split("\n");

    expect(lines.length).toBe(4);
    expect(lines[0]).toContain("a-fact.md — `name: Voice_Rules` is not kebab-case");
    expect(lines[1]).toContain("Legitimate exceptions may include");
    expect(lines[2]).toContain("SLOPWEAVER_ALLOW_MEMORY_WRITE=1");
    expect(lines[3]).toContain("Use good judgement");
  });

  it("refuses a redundant type prefix", () => {
    const refusal = writeRefusal({ text: memory({ body: "Body.", name: "feedback-voice-rules" }) })!;

    expect(refusal.split("\n")[0]).toContain("opens with `feedback-`");
  });

  it("refuses a wikilink pointing at a DOCUMENT — the shape measured in a live corpus", () => {
    const refusal = writeRefusal({
      text: memory({ body: "See [[skills/knowledge/reference/placement.md]].", name: "a-fact" }),
    })!;

    expect(refusal.split("\n")[0]).toContain("`[[skills/knowledge/reference/placement]]` is not a memory identity");
  });

  it("reports every defect in one refusal rather than one per run", () => {
    const refusal = writeRefusal({ text: memory({ body: "See [[Not A Name]].", name: "user-a-fact" }) })!;

    expect(refusal.split("\n")[0]).toContain("opens with `user-`");
    expect(refusal.split("\n")[0]).toContain("`[[Not A Name]]` is not a memory identity");
  });

  it("refuses a malformed name arriving through an Edit's replacement text", () => {
    const refusal = memoryWriteRefusal({
      filePath: LEAF,
      hatchOpen: false,
      holdsRootIndex: probe(),
      overlapContext: noOverlap,
      priorText: null,
      replaceAll: false,
      replacedText: null,
      text: "name: Voice_Rules",
      toolName: "Edit",
      userHome: HOME,
    })!;

    expect(refusal.split("\n")[0]).toContain("`name: Voice_Rules` is not kebab-case");
  });
});

describe("what it allows — the half that keeps it usable", () => {
  it("allows a wikilink to a memory that does not exist yet", () => {
    // Claude Code's own memory instruction: "a `[[name]]` that doesn't match an existing memory yet is
    // fine; it marks something worth writing later, not an error." This gate must not contradict it.
    expect(writeRefusal({ text: memory({ body: "See [[not-written-yet]].", name: "a-fact" }) })).toBe(undefined);
  });

  it("allows `[[thing.md]]`, which the checker already treats as `[[thing]]`", () => {
    expect(writeRefusal({ text: memory({ body: "See [[not-written-yet.md]].", name: "a-fact" }) })).toBe(undefined);
  });

  it("allows a document pointer written as a markdown link rather than a wikilink", () => {
    expect(
      writeRefusal({ text: memory({ body: "See [placement](skills/knowledge/placement.md).", name: "a-fact" }) }),
    ).toBe(undefined);
  });

  it("allows a malformed wikilink inside a fenced block or an HTML comment", () => {
    const fenced = memory({ body: "```\n[[Not A Name]]\n```", name: "a-fact" });
    const commented = memory({ body: "<!-- [[Not A Name]] -->", name: "a-fact" });

    expect(writeRefusal({ text: fenced })).toBe(undefined);
    expect(writeRefusal({ text: commented })).toBe(undefined);
  });

  it("says nothing about a file with no frontmatter at all — that is `schema`'s finding, after the write", () => {
    expect(writeRefusal({ text: "# Just a document\n\nNo frontmatter here.\n" })).toBe(undefined);
  });

  it("allows everything when the hatch is open", () => {
    const refusal = memoryWriteRefusal({
      filePath: LEAF,
      hatchOpen: true,
      holdsRootIndex: probe(),
      overlapContext: noOverlap,
      priorText: null,
      replaceAll: false,
      replacedText: null,
      text: memory({ body: "Body.", name: "Voice_Rules" }),
      toolName: "Write",
      userHome: HOME,
    });

    expect(refusal).toBe(undefined);
  });
});

describe("the runner", () => {
  /** Run the guard over one payload, capturing what it wrote. */
  async function run({
    payload,
    env = {},
    leaf = null,
    siblings = [],
    asked = [],
  }: {
    payload: string;
    env?: Record<string, string | undefined>;
    leaf?: string | null;
    siblings?: readonly MemoryLeaf[];
    asked?: string[];
  }): Promise<{ code: number; written: string[] }> {
    const written: string[] = [];
    const code = await runMemoryWriteGuard({
      env,
      holdsRootIndex: probe(),
      readCanon: ({ cwd }) => {
        asked.push(`canon ${cwd}`);
        return [];
      },
      readLeaf: () => leaf,
      readSiblings: ({ dir }) => {
        asked.push(`siblings ${dir}`);
        return siblings;
      },
      readStdin: async () => payload,
      userHome: HOME,
      writeError: (line) => {
        written.push(line);
      },
    });
    return { code, written };
  }

  it("blocks with 2 and writes the refusal to stderr", async () => {
    const result = await run({
      payload: JSON.stringify({
        tool_input: { content: memory({ body: "Body.", name: "Voice_Rules" }), file_path: LEAF },
        tool_name: "Write",
      }),
    });

    expect(result.code).toBe(2);
    expect(result.written.length).toBe(1);
    expect(result.written[0]).toContain("blocked because");
  });

  it("allows an ordinary source write with 0 and says nothing", async () => {
    const result = await run({
      payload: JSON.stringify({
        tool_input: { content: "export const x = 1;\n", file_path: "/repo/src/thing.ts" },
        tool_name: "Write",
      }),
    });

    expect(result.code).toBe(0);
    expect(result.written).toEqual([]);
  });

  it("opens on the ambient hatch", async () => {
    const result = await run({
      env: { SLOPWEAVER_ALLOW_MEMORY_WRITE: "1" },
      payload: JSON.stringify({
        tool_input: { content: memory({ body: "Body.", name: "Voice_Rules" }), file_path: LEAF },
        tool_name: "Write",
      }),
    });

    expect(result.code).toBe(0);
    expect(result.written).toEqual([]);
  });

  it("refuses a memory overlapping another until it answers, reading the corpus it lands in and the cwd's canon", async () => {
    const sibling = parseMemoryLeaf({
      file: "kestrel-reviews.md",
      text: "---\nname: kestrel-reviews\ndescription: backend pull request reviews go to kestrel\n---\n\nBody.\n",
    });
    const overlapping =
      "---\nname: a-fact\ndescription: backend pull request reviews go to plover, not kestrel\n---\n\nBody.\n";
    const asked: string[] = [];
    const result = await run({
      asked,
      payload: JSON.stringify({
        cwd: "/repo",
        tool_input: { content: overlapping, file_path: LEAF },
        tool_name: "Write",
      }),
      siblings: [sibling],
    });

    expect(result.code).toBe(2);
    expect(result.written[0]).toContain("overlaps the memory `kestrel-reviews`");
    expect(asked).toEqual(["canon /repo", `siblings ${HOME}/.claude/projects/-repo-slug/memory`]);
  });

  it("allows the same memory once its frontmatter answers the overlap", async () => {
    const sibling = parseMemoryLeaf({
      file: "kestrel-reviews.md",
      text: "---\nname: kestrel-reviews\ndescription: backend pull request reviews go to kestrel\n---\n\nBody.\n",
    });
    const answered =
      "---\nname: a-fact\ndescription: backend pull request reviews go to plover, not kestrel\nmetadata:\n" +
      "  slopweaver:\n    overlaps:\n      kestrel-reviews: supersedes\n---\n\nBody.\n";
    const result = await run({
      payload: JSON.stringify({ cwd: "/repo", tool_input: { content: answered, file_path: LEAF }, tool_name: "Write" }),
      siblings: [sibling],
    });

    expect(result.code).toBe(0);
    expect(result.written).toEqual([]);
  });

  it("reads no corpus and no canon for an ordinary source write", async () => {
    const asked: string[] = [];
    await run({
      asked,
      payload: JSON.stringify({
        cwd: "/repo",
        tool_input: { content: "export const x = 1;\n", file_path: "/repo/src/thing.ts" },
        tool_name: "Write",
      }),
    });

    expect(asked).toEqual([]);
  });

  it("reads no canon when the payload carries no cwd, and still judges the corpus", async () => {
    const asked: string[] = [];
    await run({
      asked,
      payload: JSON.stringify({
        tool_input: { content: memory({ body: "Body.", name: "a-fact" }), file_path: LEAF },
        tool_name: "Write",
      }),
    });

    expect(asked).toEqual([`siblings ${HOME}/.claude/projects/-repo-slug/memory`]);
  });

  it("fails OPEN on every payload it cannot resolve", async () => {
    const payloads = [
      "not json at all",
      JSON.stringify([1, 2, 3]),
      JSON.stringify({ tool_name: "Write" }),
      JSON.stringify({ tool_input: { file_path: LEAF }, tool_name: "Write" }),
      JSON.stringify({ tool_input: { content: "x", file_path: 42 }, tool_name: "Write" }),
      JSON.stringify({ tool_input: { command: "ls" }, tool_name: "Bash" }),
    ];
    const codes: number[] = [];
    for (const payload of payloads) {
      codes.push((await run({ payload })).code);
    }

    expect(codes).toEqual([0, 0, 0, 0, 0, 0]);
  });
});
