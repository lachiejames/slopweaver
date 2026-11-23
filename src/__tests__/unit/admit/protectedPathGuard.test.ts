import { describe, expect, it } from "vitest";

import { evaluateProtectedPathBash } from "../../../admit/protectedPathBash.js";
import { evaluateProtectedPathTool, fileToolTarget } from "../../../admit/protectedPathGuard.js";
import { protectedEntries, runProtectedPathGuard } from "../../../admit/protectedPathGuardRunner.js";
import type { ProtectedPath } from "../../../protectedPaths/registry.js";
import { renderProtectedPaths } from "../../../protectedPaths/registry.js";

/** Synthetic roots only: no real protected path of any install appears in a test. */
const READ_ONLY: ProtectedPath = {
  addedIso: "2026-01-01T00:00:00.000Z",
  mode: "read-only",
  path: "/Users/example/protected-state",
  why: "a synthetic read-only store",
};
const NO_ACCESS: ProtectedPath = {
  addedIso: "2026-01-01T00:00:00.000Z",
  mode: "no-access",
  path: "/Users/example/private",
  why: "a synthetic private folder",
};
const ENTRIES = [READ_ONLY, NO_ACCESS];
const ENV = { HOME: "/Users/example" };
const WORK = "/Users/example/work";
const HOME = "/Users/example/.sw-home";

/** The Bash verdict for one command run from the work directory. */
function bash({
  command,
  cwd = WORK,
}: {
  command: string;
  cwd?: string;
}): ReturnType<typeof evaluateProtectedPathBash> {
  return evaluateProtectedPathBash({ command, cwd, entries: ENTRIES, env: ENV });
}

describe("fileToolTarget", () => {
  it("reads each tool's own path field, resolving a relative one", () => {
    expect(fileToolTarget({ cwd: WORK, toolInput: { file_path: "a.ts" }, toolName: "Edit" })).toEqual({
      access: "write",
      target: "/Users/example/work/a.ts",
    });
    expect(fileToolTarget({ cwd: WORK, toolInput: { notebook_path: "/x/n.ipynb" }, toolName: "NotebookEdit" })).toEqual(
      { access: "write", target: "/x/n.ipynb" },
    );
    expect(fileToolTarget({ cwd: WORK, toolInput: { pattern: "x" }, toolName: "Grep" })).toEqual({
      access: "search",
      target: WORK,
    });
    expect(fileToolTarget({ cwd: WORK, toolInput: { file_path: "a" }, toolName: "WebFetch" })).toBe(undefined);
  });
});

describe("evaluateProtectedPathTool", () => {
  const none = (): readonly string[] => [];

  it("refuses an Edit inside a read-only path and allows a Read of it", () => {
    const edit = { file_path: "/Users/example/protected-state/x.md" };
    expect(
      evaluateProtectedPathTool({ cwd: WORK, entries: ENTRIES, spellings: none, toolInput: edit, toolName: "Edit" })
        ?.entry,
    ).toBe(READ_ONLY);
    expect(
      evaluateProtectedPathTool({ cwd: WORK, entries: ENTRIES, spellings: none, toolInput: edit, toolName: "Read" }),
    ).toBe(undefined);
  });

  it("refuses a Read of a no-access path, and a Grep from above it", () => {
    const read = { file_path: "/Users/example/private/diary.txt" };
    expect(
      evaluateProtectedPathTool({ cwd: WORK, entries: ENTRIES, spellings: none, toolInput: read, toolName: "Read" })!
        .access,
    ).toBe("read");
    expect(
      evaluateProtectedPathTool({
        cwd: WORK,
        entries: ENTRIES,
        spellings: none,
        toolInput: { path: "/Users/example/private/notes", pattern: "**/*.md" },
        toolName: "Glob",
      })!.access,
    ).toBe("search");
    expect(
      evaluateProtectedPathTool({
        cwd: "/Users/example",
        entries: ENTRIES,
        spellings: none,
        toolInput: { pattern: "x" },
        toolName: "Grep",
      })!.entry,
    ).toBe(NO_ACCESS);
  });

  it("still judges Grep and Glob at an ANCESTOR of a no-access path as a search, never the walk-only list", () => {
    // `list` is allowed above a no-access entry because its caller judges every child; a tool search does not, so
    // the hook must keep asking `search`, which refuses the ancestor.
    for (const toolName of ["Grep", "Glob"]) {
      expect(
        evaluateProtectedPathTool({
          cwd: WORK,
          entries: ENTRIES,
          spellings: none,
          toolInput: { path: "/Users/example", pattern: "**/*" },
          toolName,
        }),
      ).toEqual({ access: "search", entry: NO_ACCESS, target: "/Users/example" });
    }
  });

  it("refuses a path that only its resolved spelling places inside a no-access path", () => {
    expect(
      evaluateProtectedPathTool({
        cwd: WORK,
        entries: ENTRIES,
        spellings: () => ["/Users/example/private/real.txt"],
        toolInput: { file_path: "/Users/example/work/link.txt" },
        toolName: "Read",
      })!.entry,
    ).toBe(NO_ACCESS);
  });
});

describe("evaluateProtectedPathBash", () => {
  it("refuses removing, redirecting into or appending to a read-only path", () => {
    expect(bash({ command: "rm -rf ~/protected-state/x" })!.access).toBe("write");
    expect(bash({ command: "echo hi > /Users/example/protected-state/a" })!.access).toBe("write");
    expect(bash({ command: "echo hi >> /Users/example/protected-state/a" })!.access).toBe("write");
    expect(bash({ command: "echo hi | tee -a /Users/example/protected-state/a" })!.access).toBe("write");
    expect(bash({ command: "touch /Users/example/protected-state/new" })!.access).toBe("write");
  });

  it("refuses copying, moving, linking or dd-ing INTO a read-only path, a no-clobber copy included", () => {
    expect(bash({ command: "cp -n /tmp/source /Users/example/protected-state/new" })!.access).toBe("write");
    expect(bash({ command: "cp -t /Users/example/protected-state /tmp/a /tmp/b" })!.access).toBe("write");
    expect(bash({ command: "mv /tmp/a /Users/example/protected-state/" })!.access).toBe("write");
    expect(bash({ command: "ln -s /tmp/a /Users/example/protected-state/link" })!.access).toBe("write");
    expect(bash({ command: "rsync -a /tmp/a/ /Users/example/protected-state/" })!.access).toBe("write");
    expect(bash({ command: "dd if=/dev/zero of=/Users/example/protected-state/z count=1" })!.access).toBe("write");
  });

  it("allows copying OUT of a read-only path", () => {
    expect(bash({ command: "cp /Users/example/protected-state/a /tmp/a" })).toBeUndefined();
    expect(bash({ command: "dd if=/Users/example/protected-state/a of=/tmp/a" })).toBeUndefined();
  });

  it("expands ~ in git -C before judging where the git writes", () => {
    expect(bash({ command: "git -C ~/protected-state add ." })!.access).toBe("write");
  });

  it("expands ~ in a WRAPPED git's -C, which only the git grammar reads", () => {
    // The segment-target resolver applies `-C` only when `git` is the first word, so behind a wrapper the git
    // grammar's own `-C` read is the only one, and an unexpanded `~` resolved it to `<cwd>/~/protected-state`.
    expect(bash({ command: "nohup git -C ~/protected-state add ." })!.access).toBe("write");
    expect(bash({ command: "env git -C ~/protected-state commit -m x" })!.access).toBe("write");
  });
  it("reads a leading git's relative -C once, from the shell's own directory", () => {
    // `-C ..` from `protected-state/sub` lands git in `protected-state`; applied a second time from there it read
    // `/Users/example`, outside the entry, and the write was allowed.
    const sub = "/Users/example/protected-state/sub";
    expect(bash({ command: "git -C .. add .", cwd: sub })!.operand).toBe("/Users/example/protected-state");
    expect(bash({ command: "cd sub && git -C .. add .", cwd: "/Users/example/protected-state" })!.operand).toBe(
      "/Users/example/protected-state",
    );
    expect(bash({ command: "git -C ../.. add .", cwd: sub })).toBe(undefined);
    expect(bash({ command: "git -C ../.. log", cwd: sub })).toBe(undefined);
  });

  it("reads a repeated relative -C once each, in order", () => {
    const deep = "/Users/example/protected-state/a/b";
    expect(bash({ command: "git -C .. -C .. add .", cwd: deep })!.operand).toBe("/Users/example/protected-state");
    expect(bash({ command: "git -C ../protected-state -C sub add .", cwd: WORK })!.operand).toBe(
      "/Users/example/protected-state/sub",
    );
    expect(bash({ command: "git -C .. -C ../.. add .", cwd: deep })).toBe(undefined);
  });

  it("reads a WRAPPED git's relative -C once, from the shell's own directory", () => {
    const sub = "/Users/example/protected-state/sub";
    expect(bash({ command: "env git -C .. add .", cwd: sub })!.operand).toBe("/Users/example/protected-state");
    expect(bash({ command: "nice git -C .. -C .. commit -m x", cwd: `${sub}/deep` })!.operand).toBe(
      "/Users/example/protected-state",
    );
    expect(bash({ command: "env git -C ../.. add .", cwd: sub })).toBe(undefined);
  });

  it("resolves a git segment's redirection from the shell's directory, never from git's -C", () => {
    // The shell opens `notes.txt` before git runs, so its `-C` moves git and never the file.
    expect(bash({ command: "git -C /tmp log > notes.txt", cwd: "/Users/example/protected-state" })!.operand).toBe(
      "/Users/example/protected-state/notes.txt",
    );
    expect(bash({ command: "git -C /tmp log >> notes.txt", cwd: "/Users/example/protected-state" })!.operand).toBe(
      "/Users/example/protected-state/notes.txt",
    );
    expect(bash({ command: "git -C ../protected-state log > notes.txt" })).toBe(undefined);
    expect(bash({ command: "git -C /tmp apply < private/fix.patch", cwd: "/Users/example" })!.operand).toBe(
      "/Users/example/private/fix.patch",
    );
    expect(bash({ command: "git -C .. status > f", cwd: "/Users/example/protected-state/sub" })!.operand).toBe(
      "/Users/example/protected-state/sub/f",
    );
  });

  it("reads a git's -C into a no-access path as a read of it, wrapped or not, and each -C value from where it applies", () => {
    expect(bash({ command: "nice git -C ../private log" })!.operand).toBe("/Users/example/private");
    expect(bash({ command: "git -C ../private log" })!.operand).toBe("/Users/example/private");
    // The first `-C` names the no-access path on the way to a directory outside it.
    const named = bash({ command: "git -C ../../private -C ../work status", cwd: "/Users/example/work/sub" })!;
    expect([named.access, named.operand]).toEqual(["read", "/Users/example/private"]);
    // A pathspec is git's, read from its `-C` directory.
    expect(bash({ command: "git -C /Users/example log -- private/diary.txt", cwd: "/tmp" })!.operand).toBe(
      "/Users/example/private/diary.txt",
    );
  });

  it("reads a wrapper's own chdir before the program's operands and a git's -C, never before a redirection", () => {
    const sub = "/Users/example/work/sub";
    expect(bash({ command: "env -C ../../protected-state git add .", cwd: sub })!.operand).toBe(
      "/Users/example/protected-state",
    );
    expect(bash({ command: "env -C ../.. git -C protected-state commit -m x", cwd: sub })!.operand).toBe(
      "/Users/example/protected-state",
    );
    expect(bash({ command: "env -C ../../protected-state touch x", cwd: sub })!.operand).toBe(
      "/Users/example/protected-state/x",
    );
    expect(bash({ command: "sudo -D ../../protected-state mkdir y", cwd: sub })!.operand).toBe(
      "/Users/example/protected-state/y",
    );
    expect(bash({ command: "env --chdir=../../private cat diary.txt", cwd: sub })!.operand).toBe(
      "/Users/example/private",
    );
    // The destruction half judges the removed file itself, now read once from git's `-C`.
    expect(bash({ command: "A=1 git -C ../../protected-state rm -f -- x", cwd: sub })!.operand).toBe(
      "/Users/example/protected-state/x",
    );
    // A valued option's value names no wrapper: `-u sudo` unsets a variable called `sudo`, and env still moves.
    expect(
      bash({ command: "env -u sudo -C /Users/example/protected-state git -C . add .", cwd: "/tmp" })!.operand,
    ).toBe("/Users/example/protected-state");
    // The shell opens `x` where it stands: env's chdir moves only the program.
    expect(bash({ command: "env -C ../../protected-state echo > x", cwd: sub })).toBe(undefined);
  });

  it("moves nothing for an attached -C<dir>, which git refuses before it writes", () => {
    expect(bash({ command: "git -C../protected-state add ." })).toBe(undefined);
    expect(bash({ command: "env git -C../protected-state add ." })).toBe(undefined);
  });

  it("refuses removing an ancestor of a protected path", () => {
    expect(bash({ command: "rm -rf /Users/example" })!.entry.path).toBe("/Users/example/protected-state");
  });

  it("refuses a git write run inside a read-only path, and allows a git read", () => {
    expect(bash({ command: "git commit -m x", cwd: "/Users/example/protected-state" })!.access).toBe("write");
    expect(bash({ command: "git -C /Users/example/protected-state add ." })!.access).toBe("write");
    expect(bash({ command: "git log --oneline", cwd: "/Users/example/protected-state" })).toBe(undefined);
    expect(bash({ command: "git branch", cwd: "/Users/example/protected-state" })).toBe(undefined);
    expect(bash({ command: "git branch topic", cwd: "/Users/example/protected-state" })!.access).toBe("write");
  });

  it("allows reading a read-only path", () => {
    expect(bash({ command: "cat /Users/example/protected-state/a" })).toBe(undefined);
  });

  it("refuses any mention of a no-access path, or running inside one", () => {
    expect(bash({ command: "cat ~/private/diary.txt" })!.access).toBe("read");
    expect(bash({ command: "wc -l < /Users/example/private/diary.txt" })!.access).toBe("read");
    expect(bash({ command: "cd /Users/example/private && ls" })!.access).toBe("read");
    expect(bash({ command: "ls", cwd: "/Users/example/private/sub" })!.access).toBe("read");
  });

  it("allows naming an ancestor of a no-access path, and a sibling of it", () => {
    expect(bash({ command: "ls ~" })).toBe(undefined);
    expect(bash({ command: "cat /Users/example/privateer/a" })).toBe(undefined);
  });

  it("lets the protect verb name a protected path, and an inline hatch arm one segment", () => {
    expect(bash({ command: "slopweaver protect check /Users/example/private" })).toBe(undefined);
    expect(bash({ command: "SLOPWEAVER_ALLOW_PROTECTED_PATH=1 cat /Users/example/private/a" })).toBe(undefined);
  });

  it("judges nothing when the registry is empty", () => {
    expect(evaluateProtectedPathBash({ command: "rm -rf /", cwd: WORK, entries: [], env: ENV })).toBe(undefined);
  });
});

describe("protectedEntries", () => {
  it("holds each registry file read-only even when it is absent or malformed", () => {
    const absent = protectedEntries({ homes: [HOME], readText: () => undefined });
    expect(absent.map((entry) => [entry.path, entry.mode])).toEqual([[`${HOME}/protected-paths.json`, "read-only"]]);
    const malformed = protectedEntries({ homes: [HOME], readText: () => "{" });
    expect(malformed.length).toBe(1);
  });

  it("adds every entry a valid registry holds", () => {
    const text = renderProtectedPaths({ registry: { paths: ENTRIES, schemaVersion: 1 } });
    expect(protectedEntries({ homes: [HOME, HOME], readText: () => text }).length).toBe(3);
  });
});

describe("runProtectedPathGuard", () => {
  const text = renderProtectedPaths({ registry: { paths: ENTRIES, schemaVersion: 1 } });

  /** Run the guard over one payload against the synthetic registry, capturing what it wrote. */
  async function run({ payload, env = ENV }: { payload: unknown; env?: Record<string, string> }): Promise<{
    code: number;
    written: string;
  }> {
    let written = "";
    const code = await runProtectedPathGuard({
      env,
      homes: [HOME],
      readStdin: () => Promise.resolve(JSON.stringify(payload)),
      readText: () => text,
      writeError: (line) => {
        written += line;
      },
    });
    return { code, written };
  }

  it("refuses with the four-line refusal naming the path, its mode and the owner's reason", async () => {
    const result = await run({
      payload: { cwd: WORK, tool_input: { file_path: "/Users/example/private/a" }, tool_name: "Read" },
    });
    expect(result.code).toBe(2);
    expect(result.written).toContain("a Read call would read /Users/example/private/a");
    expect(result.written).toContain("that list changes only through the slopweaver protect verb");
    expect(result.written).toContain("protected no-access: a synthetic private folder");
    expect(result.written).toContain("SLOPWEAVER_ALLOW_PROTECTED_PATH=1");
  });

  it("refuses a Write to the registry file itself", async () => {
    const result = await run({
      payload: {
        cwd: WORK,
        tool_input: { content: "{}", file_path: `${HOME}/protected-paths.json` },
        tool_name: "Write",
      },
    });
    expect(result.code).toBe(2);
  });

  it("allows an unrelated call, a malformed payload and an open hatch", async () => {
    expect((await run({ payload: { cwd: WORK, tool_input: { command: "ls" }, tool_name: "Bash" } })).code).toBe(0);
    expect((await run({ payload: "not an object" })).code).toBe(0);
    const hatched = await run({
      env: { ...ENV, SLOPWEAVER_ALLOW_PROTECTED_PATH: "1" },
      payload: { cwd: WORK, tool_input: { file_path: "/Users/example/private/a" }, tool_name: "Read" },
    });
    expect(hatched.code).toBe(0);
  });
});
