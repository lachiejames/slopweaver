/**
 * The hook's decision core, including the sequence that motivated the whole design.
 *
 * Saving one memory is TWO writes — the leaf, then its route into the index. A whole-corpus check fired after
 * the first one necessarily sees an unrouted leaf. The replay at the bottom proves that window is closed, and
 * it first proves the fixture is CAPABLE of exposing it: a test that only asserts silence would pass just as
 * well against a checker that never looks at anything.
 *
 * Plain injected fakes throughout — no mocks.
 */
import { describe, expect, it } from "vitest";

import { type MemoryHookDeps, memoryHookOutput, runMemoryHook } from "../../../cli/commands/memory/run.js";
import { OwnerDirectiveErrors } from "../../../judgement/ownerDirective.errors.js";
import { err, ok } from "../../../lib/result.js";
import { checkMemoryCorpus } from "../../../memory/check.js";
import { buildMemoryCorpus, parseMemoryLeaf } from "../../../memory/corpus.js";
import {
  autoMemoryDirFromWritePath,
  decodeMemoryHookPayload,
  hookCorpusDir,
  memoryLeafBasename,
} from "../../../memory/hookPayload.js";
import type { MemoryLeaf, MemorySourceFile } from "../../../memory/types.js";
import { validCorpus } from "./corpusFixture.js";

const DIR = "/corpus/memory";

/** A fake dependency set over an in-memory corpus. `ageMillis` drives the quiet-period guard. */
function deps({
  files,
  payload,
  ageMillis = 60_000,
  emitted,
  syncFailures = [],
  synced = [],
}: {
  files: readonly MemorySourceFile[];
  payload: string;
  ageMillis?: number;
  emitted: string[];
  syncFailures?: readonly string[];
  synced?: MemoryLeaf[][];
}): MemoryHookDeps {
  return {
    lastChangeMillis: () => ageMillis,
    out: (line) => {
      emitted.push(line);
    },
    readCorpus: () => ok(buildMemoryCorpus({ files })),
    readLeaf: ({ basename }) =>
      ok(parseMemoryLeaf({ file: basename, text: files.find((f) => f.file === basename)!.text })),
    readStdin: () => Promise.resolve(payload),
    resolveAmendsRows: ({ corpus }) => Promise.resolve(corpus),
    resolvePath: ({ path }) => path,
    syncOwnerDirectives: ({ leaves }) => {
      synced.push([...leaves]);
      return Promise.resolve(
        syncFailures.length === 0
          ? ok({ directiveCount: 0, kind: "unchanged" })
          : err(
              OwnerDirectiveErrors.storeUnavailable({
                doing: "record a memory's owner directives",
                reason: syncFailures.join("; "),
              }),
            ),
      );
    },
    userHome: () => "/owner",
    warn: () => {
      /* diagnostics are not part of the protocol */
    },
  };
}

const FRESH_LEAF: MemorySourceFile = {
  file: "fresh.md",
  // Opens with the paragraph a root-routed memory carries, so the settled save below is sound in every respect.
  text: "---\nname: fresh\ndescription: a memory written a moment ago\nmetadata:\n  type: reference\n---\n\n**Why always-loaded:** it is needed at boot.\n\nBody.\n",
};

function writePayload({ file }: { file: string }): string {
  return JSON.stringify({
    hook_event_name: "PostToolUse",
    tool_input: { file_path: `${DIR}/${file}` },
    tool_name: "Write",
  });
}

const SESSION_START = JSON.stringify({ hook_event_name: "SessionStart", source: "startup" });

describe("the payload decoder only acts on what it can answer", () => {
  it("acts on a Write", () => {
    expect(decodeMemoryHookPayload({ payload: JSON.parse(writePayload({ file: "a.md" })) })).toEqual({
      filePath: `${DIR}/a.md`,
      kind: "check-leaf",
    });
  });

  it("asks for the whole corpus on a session start", () => {
    expect(decodeMemoryHookPayload({ payload: JSON.parse(SESSION_START) })).toEqual({ kind: "check-corpus" });
  });

  it("ignores an Edit, because a logical change can span several of them", () => {
    const payload = { hook_event_name: "PostToolUse", tool_input: { file_path: `${DIR}/a.md` }, tool_name: "Edit" };

    expect(decodeMemoryHookPayload({ payload })).toEqual({ kind: "ignore" });
  });

  it("ignores a payload that is not an object", () => {
    expect(decodeMemoryHookPayload({ payload: "nonsense" })).toEqual({ kind: "ignore" });
  });

  it("ignores a Write with no file path", () => {
    const payload = { hook_event_name: "PostToolUse", tool_input: {}, tool_name: "Write" };

    expect(decodeMemoryHookPayload({ payload })).toEqual({ kind: "ignore" });
  });
});

describe("deciding whether a written path belongs to the corpus", () => {
  it("accepts a leaf directly inside it", () => {
    expect(memoryLeafBasename({ resolvedDir: DIR, resolvedFile: `${DIR}/thing.md` })).toBe("thing.md");
  });

  it("refuses the root index, which nothing local can judge", () => {
    expect(memoryLeafBasename({ resolvedDir: DIR, resolvedFile: `${DIR}/MEMORY.md` })).toBeNull();
  });

  it("refuses a topic index for the same reason", () => {
    expect(memoryLeafBasename({ resolvedDir: DIR, resolvedFile: `${DIR}/INDEX-build.md` })).toBeNull();
  });

  it("refuses a file in a subdirectory", () => {
    expect(memoryLeafBasename({ resolvedDir: DIR, resolvedFile: `${DIR}/nested/thing.md` })).toBeNull();
  });

  it("refuses a file somewhere else entirely", () => {
    expect(memoryLeafBasename({ resolvedDir: DIR, resolvedFile: "/somewhere/else/thing.md" })).toBeNull();
  });

  it("refuses a non-markdown file", () => {
    expect(memoryLeafBasename({ resolvedDir: DIR, resolvedFile: `${DIR}/notes.txt` })).toBeNull();
  });

  it("tolerates a trailing slash on the configured directory", () => {
    expect(memoryLeafBasename({ resolvedDir: `${DIR}/`, resolvedFile: `${DIR}/thing.md` })).toBe("thing.md");
  });
});

describe("deriving a directory from the actual Write payload", () => {
  it("accepts one direct leaf under a Claude auto-memory project directory", () => {
    expect(
      autoMemoryDirFromWritePath({
        filePath: "/owner/.claude/projects/project-key/memory/standing.md",
        userHome: "/owner",
      }),
    ).toBe("/owner/.claude/projects/project-key/memory");
  });

  it("refuses an ordinary repository markdown write", () => {
    expect(autoMemoryDirFromWritePath({ filePath: "/work/repo/standing.md", userHome: "/owner" })).toBeNull();
  });

  it("refuses a nested file under an auto-memory directory", () => {
    expect(
      autoMemoryDirFromWritePath({
        filePath: "/owner/.claude/projects/project-key/memory/nested/standing.md",
        userHome: "/owner",
      }),
    ).toBeNull();
  });
});

describe("hookCorpusDir", () => {
  const leafWrite = { filePath: "/owner/.claude/projects/project-key/memory/standing.md", kind: "check-leaf" } as const;

  it("checks the configured --dir over anything the payload names", () => {
    expect(hookCorpusDir({ dir: "/configured", request: leafWrite, userHome: () => "/owner" })).toBe("/configured");
  });

  it("derives the corpus from a leaf write when no --dir is configured", () => {
    expect(hookCorpusDir({ dir: null, request: leafWrite, userHome: () => "/owner" })).toBe(
      "/owner/.claude/projects/project-key/memory",
    );
  });

  it("checks nothing on a session start with no --dir, since there is no path to derive one from", () => {
    expect(hookCorpusDir({ dir: null, request: { kind: "check-corpus" }, userHome: () => "/owner" })).toBeNull();
  });
});

describe("what the hook emits", () => {
  it("says nothing at all about a sound corpus", async () => {
    const emitted: string[] = [];

    expect(
      await memoryHookOutput({ deps: deps({ emitted, files: validCorpus(), payload: SESSION_START }), dir: DIR }),
    ).toBeNull();
  });

  it("reports a leaf's own schema defect as PostToolUse context", async () => {
    const broken: MemorySourceFile = { file: "broken.md", text: "---\nname: broken\n---\n\nBody.\n" };
    const emitted: string[] = [];

    const output = await memoryHookOutput({
      deps: deps({ emitted, files: [...validCorpus(), broken], payload: writePayload({ file: "broken.md" }) }),
      dir: DIR,
    });

    expect(JSON.parse(output!)).toEqual({
      hookSpecificOutput: {
        additionalContext:
          "The memory corpus has integrity problems. Fix these before moving on:\n\nmemory: 1 problem(s)\n  [schema] broken.md — frontmatter is missing `description`",
        hookEventName: "PostToolUse",
      },
    });
  });

  it("says nothing when a malformed payload arrives", async () => {
    const emitted: string[] = [];

    expect(
      await memoryHookOutput({ deps: deps({ emitted, files: validCorpus(), payload: "{not json" }), dir: DIR }),
    ).toBeNull();
  });

  it("declines to judge a corpus another session may be mid-save on", async () => {
    const files = [...validCorpus(), FRESH_LEAF];
    const emitted: string[] = [];

    const output = await memoryHookOutput({
      deps: deps({ ageMillis: 200, emitted, files, payload: SESSION_START }),
      dir: DIR,
    });

    expect(output).toBeNull();
  });

  it("hands a written tagged feedback leaf to the current-owner sync edge in the same event", async () => {
    const tagged: MemorySourceFile = {
      file: "standing.md",
      text:
        "---\nname: standing\ndescription: act on this ruling\nmetadata:\n  type: feedback\n" +
        "  slopweaver:\n    ownerDirective: true\n---\n",
    };
    const emitted: string[] = [];
    const synced: MemoryLeaf[][] = [];

    expect(
      await memoryHookOutput({
        deps: deps({
          emitted,
          files: [...validCorpus(), tagged],
          payload: writePayload({ file: "standing.md" }),
          synced,
        }),
        dir: DIR,
      }),
    ).toBeNull();
    expect(synced).toHaveLength(1);
    expect(synced[0]!.map((leaf) => ({ file: leaf.file, ownerDirective: leaf.ownerDirective }))).toEqual([
      { file: "standing.md", ownerDirective: true },
    ]);
  });

  it("runs that same sync from the plugin's payload-derived hook without a configured corpus path", async () => {
    const tagged: MemorySourceFile = {
      file: "standing.md",
      text:
        "---\nname: standing\ndescription: act on this ruling\nmetadata:\n  type: feedback\n" +
        "  slopweaver:\n    ownerDirective: true\n---\n",
    };
    const emitted: string[] = [];
    const synced: MemoryLeaf[][] = [];
    const payload = JSON.stringify({
      hook_event_name: "PostToolUse",
      tool_input: { file_path: "/owner/.claude/projects/project-key/memory/standing.md" },
      tool_name: "Write",
    });

    expect(await memoryHookOutput({ deps: deps({ emitted, files: [tagged], payload, synced }), dir: null })).toBeNull();
    expect(synced).toHaveLength(1);
    expect(synced[0]!.map((leaf) => leaf.file)).toEqual(["standing.md"]);
  });

  it("surfaces a current-owner sync failure even when the memory itself is structurally sound", async () => {
    const emitted: string[] = [];

    const output = await memoryHookOutput({
      deps: deps({
        emitted,
        files: validCorpus(),
        payload: writePayload({ file: "project.md" }),
        syncFailures: ["connection refused"],
      }),
      dir: DIR,
    });

    expect(JSON.parse(output!)).toEqual({
      hookSpecificOutput: {
        additionalContext:
          "The current-owner directive fast path failed. Fix this before relying on the next live turn:\n\n" +
          "  the store could not record a memory's owner directives for owner directives: connection refused",
        hookEventName: "PostToolUse",
      },
    });
  });
});

describe("the two-write save cannot produce a false orphan", () => {
  const midSave = [...validCorpus(), FRESH_LEAF];

  it("first proves the fixture CAN expose the race", () => {
    // The leaf has landed; its route has not. A whole-corpus check here reports the orphan.
    expect(checkMemoryCorpus({ corpus: buildMemoryCorpus({ files: midSave }) })).toEqual([
      {
        check: "orphan",
        file: "fresh.md",
        line: null,
        message: "no index points at this memory — it is only reachable if its description happens to match",
      },
    ]);
  });

  it("write 1 of 2: the leaf write reports nothing about routing", async () => {
    const emitted: string[] = [];

    const output = await memoryHookOutput({
      deps: deps({ emitted, files: midSave, payload: writePayload({ file: "fresh.md" }) }),
      dir: DIR,
    });

    expect(output).toBeNull();
  });

  it("write 2 of 2: the index write is ignored, so no graph check runs mid-save either", async () => {
    const emitted: string[] = [];

    const output = await memoryHookOutput({
      deps: deps({ emitted, files: midSave, payload: writePayload({ file: "MEMORY.md" }) }),
      dir: DIR,
    });

    expect(output).toBeNull();
  });

  it("a later settled session start sees the completed save and reports nothing", async () => {
    const settled = midSave.map((entry) =>
      entry.file === "MEMORY.md"
        ? { file: entry.file, text: `${entry.text}- [Fresh](fresh.md) — routed now\n` }
        : entry,
    );
    const emitted: string[] = [];

    const output = await memoryHookOutput({
      deps: deps({ emitted, files: settled, payload: SESSION_START }),
      dir: DIR,
    });

    expect(output).toBeNull();
  });

  it("but a genuinely abandoned leaf IS reported at the next settled session start", async () => {
    const emitted: string[] = [];

    const output = await memoryHookOutput({
      deps: deps({ emitted, files: midSave, payload: SESSION_START }),
      dir: DIR,
    });

    expect(JSON.parse(output!).hookSpecificOutput.hookEventName).toBe("SessionStart");
  });
});

describe("the verb cannot return a non-zero code, whatever the streams do", () => {
  /**
   * `EXIT_USAGE` is 2, and 2 is the one code Claude Code reads as a hook error to surface to the model. So this
   * verb must return 0 on every path — including when the act of REPORTING a problem is itself what fails.
   *
   * A throwing `process.stderr.write` is exactly what an EPIPE looks like when the hook's reader has gone away.
   * A plain function replaces the write and is restored afterwards; nothing here is a mock.
   */
  async function exitCodeWithBrokenStreams({ argv }: { argv: readonly string[] }): Promise<number | string> {
    const realErr = process.stderr.write.bind(process.stderr);
    const realOut = process.stdout.write.bind(process.stdout);
    const thrower = (): never => {
      throw new Error("EPIPE");
    };
    process.stderr.write = thrower;
    process.stdout.write = thrower;
    try {
      return await runMemoryHook(argv);
    } catch (error: unknown) {
      return `REJECTED: ${String(error)}`;
    } finally {
      process.stderr.write = realErr;
      process.stdout.write = realOut;
    }
  }

  it("returns 0 on an unknown flag even when writing the usage message throws", async () => {
    expect(await exitCodeWithBrokenStreams({ argv: ["node", "cli", "memory", "hook", "--bogus"] })).toBe(0);
  });

  it("returns 0 on --help even when writing to stdout throws", async () => {
    expect(await exitCodeWithBrokenStreams({ argv: ["node", "cli", "memory", "hook", "--help"] })).toBe(0);
  });

  it("returns 0 when --dir is missing and the diagnostic cannot be written", async () => {
    expect(await exitCodeWithBrokenStreams({ argv: ["node", "cli", "memory", "hook"] })).toBe(0);
  });
});
