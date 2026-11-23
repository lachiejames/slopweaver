/**
 * The apply half's memory of which trees it already tried, kept so a tree git keeps declining is not retried
 * ahead of the trees still waiting.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  forgetUnregistered,
  readApplyMemory,
  writeApplyMemory,
} from "../../../cli/commands/worktree/pruneApplyMemory.js";
import { rememberAttempt } from "../../../cli/commands/worktree/pruneApplyPass.js";
import { memoryKey } from "../../../worktree/pruneOrder.js";

describe("apply memory", () => {
  let home = "";

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "kept-attempts-"));
  });

  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  it("reads back what an apply wrote", () => {
    const memory = {
      kept: [
        {
          attemptedAtMs: 1_758_000_000_000,
          path: "/dev/acme-admin/.claude/worktrees.noindex/a",
          repoRoot: "/dev/acme-admin",
        },
      ],
      repos: [{ lastAttemptMs: 1_758_000_000_000, repoRoot: "/dev/acme-admin" }],
    };
    writeApplyMemory({ home, memory });
    expect(readApplyMemory({ home })).toEqual(memory);
  });

  it("reports a memory it cannot write rather than throwing, so the attempt it precedes still runs", () => {
    writeFileSync(join(home, "worktree-bundles"), "a file where the directory belongs");

    expect(writeApplyMemory({ home, memory: { kept: [], repos: [] } })).toBe(false);
    expect(readApplyMemory({ home })).toEqual({ kept: [], repos: [] });
  });

  it("reads nothing attempted from a home that never wrote any, or from a malformed record", () => {
    expect(readApplyMemory({ home })).toEqual({ kept: [], repos: [] });
    mkdirSync(join(home, "worktree-bundles"));
    writeFileSync(join(home, "worktree-bundles", "apply-memory.json"), '{"kept":[{"path":1}],"repos":[]}\n');
    expect(readApplyMemory({ home })).toEqual({ kept: [], repos: [] });
  });

  it("reads a torn record that is not JSON at all as nothing attempted, rather than throwing out of the run", () => {
    mkdirSync(join(home, "worktree-bundles"));
    writeFileSync(join(home, "worktree-bundles", "apply-memory.json"), "{");
    expect(readApplyMemory({ home })).toEqual({ kept: [], repos: [] });
  });

  it("records into the memory on disk NOW, so a stalled apply returning keeps what the newer one wrote", () => {
    const listed = new Set(["/r"]);
    const registered = new Set(["/r/newer", "/r/stalled"].map((path) => memoryKey({ path, repoRoot: "/r" })));
    const load = (): ReturnType<typeof readApplyMemory> => readApplyMemory({ home });
    const persist = ({ memory }: { memory: ReturnType<typeof readApplyMemory> }): void => {
      writeApplyMemory({ home, memory });
    };
    // The stalled apply read an empty memory before the newer one took its lease and recorded a kept tree.
    writeApplyMemory({
      home,
      memory: {
        kept: [{ attemptedAtMs: 5, path: "/r/newer", repoRoot: "/r" }],
        repos: [{ lastAttemptMs: 5, repoRoot: "/r" }],
      },
    });
    rememberAttempt({
      attempt: { atMs: 3, path: "/r/stalled", removed: false, repoRoot: "/r" },
      listed,
      load,
      persist,
      registered,
    });
    expect(readApplyMemory({ home })).toEqual({
      kept: [
        { attemptedAtMs: 5, path: "/r/newer", repoRoot: "/r" },
        { attemptedAtMs: 3, path: "/r/stalled", repoRoot: "/r" },
      ],
      repos: [{ lastAttemptMs: 5, repoRoot: "/r" }],
    });
  });
});

describe("forgetUnregistered", () => {
  const memory = {
    kept: [
      { attemptedAtMs: 1, path: "/r/gone", repoRoot: "/r" },
      { attemptedAtMs: 2, path: "/r/stays", repoRoot: "/r" },
      { attemptedAtMs: 3, path: "/q/unread", repoRoot: "/q" },
    ],
    repos: [
      { lastAttemptMs: 2, repoRoot: "/r" },
      { lastAttemptMs: 3, repoRoot: "/q" },
    ],
  };

  it("drops a kept tree git no longer registers once the stale records are cleared, with no attempt after", () => {
    const next = forgetUnregistered({ list: () => ["/r", "/r/stays"], previous: memory, repos: new Set(["/r"]) });
    expect(next.kept.map((entry) => entry.path)).toEqual(["/r/stays", "/q/unread"]);
  });

  it("carries every kept tree of a repository whose list cannot be read now", () => {
    const next = forgetUnregistered({
      list: ({ repoRoot }) => {
        if (repoRoot === "/q") {
          throw new Error("git worktree list failed");
        }
        return ["/r", "/r/stays"];
      },
      previous: memory,
      repos: new Set(["/r", "/q"]),
    });
    expect(next.kept.map((entry) => entry.path)).toEqual(["/r/stays", "/q/unread"]);
  });

  it("keeps every repository's last-attempt time, which a clear does not change", () => {
    const next = forgetUnregistered({ list: () => [], previous: memory, repos: new Set(["/r"]) });
    expect(next.repos).toEqual(memory.repos);
  });
});
