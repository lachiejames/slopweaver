/**
 * The repository lock a whole-repository stack verb runs under, in an explicit temp home: the body's own exit
 * code comes back unchanged, a second attempt on the same repository under a DIFFERENT casing is refused
 * with one line naming the lower-cased key and the live holder and exits with the caller's refusal code
 * without running its body, and a body that throws still releases the lock for the next caller.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { underStackRepoLock } from "../../../../../cli/commands/github/stackVerbShell.js";

const NOW = "2026-10-01T00:00:00.000Z";

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "stack-lock-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

describe("underStackRepoLock", () => {
  it("runs the body under the lock and returns its own exit code", async () => {
    const refusals: string[] = [];

    const code = await underStackRepoLock({
      body: async () => 7,
      home,
      key: "owner/repo",
      nowIso: NOW,
      onRefusal: ({ line }) => refusals.push(line),
      refusedExitCode: 9,
    });

    expect(code).toBe(7);
    expect(refusals).toEqual([]);
  });

  it("refuses a second attempt on the same repository under another casing, without running its body", async () => {
    const refusals: string[] = [];
    const ran: string[] = [];

    const outer = await underStackRepoLock({
      body: async () => {
        ran.push("outer");
        return underStackRepoLock({
          body: async () => {
            ran.push("inner");
            return 0;
          },
          home,
          key: "owner/REPO",
          nowIso: NOW,
          onRefusal: ({ line }) => refusals.push(line),
          refusedExitCode: 9,
        });
      },
      home,
      key: "Owner/Repo",
      nowIso: NOW,
      onRefusal: ({ line }) => refusals.push(line),
      refusedExitCode: 9,
    });

    expect(outer).toBe(9);
    expect(ran).toEqual(["outer"]);
    expect(refusals).toEqual([
      `refused: another stack operation is in progress on owner/repo (held by pid ${String(process.pid)} since ` +
        `${NOW} (0ms old, under the 900000ms stale threshold, and the holder answered signal 0 — it was ALIVE ` +
        `when checked at ${NOW}, so this is contention rather than a lock left behind by a dead process))`,
    ]);
  });

  it("releases the lock when the body throws, so the next attempt on the repository runs", async () => {
    const refusals: string[] = [];
    const onRefusal = ({ line }: { line: string }): void => {
      refusals.push(line);
    };

    await expect(
      underStackRepoLock({
        body: async () => {
          throw new Error("rebase failed");
        },
        home,
        key: "owner/repo",
        nowIso: NOW,
        onRefusal,
        refusedExitCode: 9,
      }),
    ).rejects.toThrow("rebase failed");

    const next = await underStackRepoLock({
      body: async () => 0,
      home,
      key: "owner/repo",
      nowIso: NOW,
      onRefusal,
      refusedExitCode: 9,
    });

    expect(next).toBe(0);
    expect(refusals).toEqual([]);
  });
});
