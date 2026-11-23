/*
 * A root whose own path the token class cannot capture in full — a `+`, a space, an escape, a backslash, a colon,
 * a `.` or `..` segment — still reads as inside that root, and a genuine sweep beside it is still named. It moved
 * here when `tripwire.test.ts` was split by behaviour.
 */
import { describe, expect, it } from "vitest";

import { foldCodexEvent, initialCodexActivity } from "../../../../codex/progress.js";
import { assessPassActivity, outsideSweeps } from "../../../../codex/tripwire.js";

/**
 * Found by this tool's own review arm judging this change (BROKEN), with the counterexample below
 * supplied verbatim. The character class is narrower than what a filesystem allows, so a root containing any
 * character outside it truncates every token under that root — and two truncated tokens plus one ordinary
 * failed command is an abort, for reads that were entirely inside an allowed root.
 */
describe("a root whose own path the token class cannot capture in full", () => {
  /**
   * Both review passes over this change broke the token comparison from a different direction, and this is
   * why the roots are now tested against the raw command at the match offset instead. One supplied the
   * `+`; another supplied the space, which no tightening of the pattern could have excluded, because
   * whitespace is a legitimate path terminator everywhere else.
   */
  function readsInside({
    repoRoot,
    workspaceRoot,
    commands,
  }: {
    repoRoot: string;
    workspaceRoot: string;
    commands: readonly { readonly command: string; readonly exitCode: number }[];
  }) {
    const activity = commands.reduce(
      (soFar, { command, exitCode }) =>
        foldCodexEvent({
          activity: soFar,
          event: { item: { command, exitCode, itemKind: "command_execution" }, kind: "item" },
        }),
      initialCodexActivity(),
    );
    return {
      assessment: assessPassActivity({ activity, elapsedMs: 30_000, repoRoot, workspaceRoot }),
      sweeps: outsideSweeps({ commands: activity.recentCommands, repoRoot, workspaceRoot }),
    };
  }

  it("reports no sweep for reads inside a root containing '+'", () => {
    const { sweeps, assessment } = readsInside({
      commands: [
        { command: "rg x /repo+root/src/a.ts", exitCode: 1 },
        { command: "sed -n 1p /scratch+root/notes.md", exitCode: 0 },
      ],
      repoRoot: "/repo+root",
      workspaceRoot: "/scratch+root",
    });

    expect(sweeps).toEqual([]);
    expect(assessment.verdict).toBe("suspect");
    expect(assessment.reasons).toEqual(["1 of 2 commands failed in the first 30s"]);
  });

  it("reports no sweep for reads inside a root containing a SPACE", () => {
    const { sweeps, assessment } = readsInside({
      commands: [
        { command: `/usr/bin/sed -n '1p' '/repo root/src/a.ts'`, exitCode: 1 },
        { command: `/bin/cat '/scratch root/notes.md'`, exitCode: 0 },
      ],
      repoRoot: "/repo root",
      workspaceRoot: "/scratch root",
    });

    expect(sweeps).toEqual([]);
    expect(assessment.verdict).toBe("suspect");
    expect(assessment.reasons).toEqual(["1 of 2 commands failed in the first 30s"]);
  });

  /** The offset comparison must not blunt the signal: a genuine sweep beside an in-root read is still named. */
  it("still names a genuine sweep alongside a read inside a space-bearing root", () => {
    expect(
      outsideSweeps({
        commands: [`cat '/repo root/a.ts'`, "ls /elsewhere/deep", "ls /other/place"],
        repoRoot: "/repo root",
        workspaceRoot: "/scratch",
      }),
    ).toEqual(["/elsewhere/deep", "/other/place"]);
  });

  it("reports no sweep when the shell ESCAPED the space in the root", () => {
    const { sweeps, assessment } = readsInside({
      commands: [
        { command: String.raw`cat /repo\ root/src/a.ts`, exitCode: 1 },
        { command: String.raw`cat /scratch\ root/notes.md`, exitCode: 0 },
      ],
      repoRoot: "/repo root",
      workspaceRoot: "/scratch root",
    });

    expect(sweeps).toEqual([]);
    expect(assessment.verdict).toBe("suspect");
    expect(assessment.reasons).toEqual(["1 of 2 commands failed in the first 30s"]);
  });

  it("reports no sweep for a root containing a literal backslash", () => {
    const { sweeps, assessment } = readsInside({
      commands: [
        { command: String.raw`cat '/repo\root/a.ts'`, exitCode: 1 },
        { command: String.raw`cat '/scratch\root/notes.md'`, exitCode: 0 },
      ],
      repoRoot: String.raw`/repo\root`,
      workspaceRoot: String.raw`/scratch\root`,
    });

    expect(sweeps).toEqual([]);
    expect(assessment.verdict).toBe("suspect");
    expect(assessment.reasons).toEqual(["1 of 2 commands failed in the first 30s"]);
  });

  /**
   * The colon case, whose mechanism differs. A colon is a legitimate character BEFORE a path, so a root
   * containing one is split and its tail starts a SECOND match at a later offset. That is what forced the
   * "starts inside an occurrence of the root" question, which covers all five shapes at once.
   */
  it("reports no sweep for a root containing a colon", () => {
    const { sweeps, assessment } = readsInside({
      commands: [
        { command: `/bin/cat '/repo:/root/a'`, exitCode: 1 },
        { command: `/bin/cat '/repo:/root/b'`, exitCode: 0 },
      ],
      repoRoot: "/repo:/root",
      workspaceRoot: "/scratch",
    });

    expect(sweeps).toEqual([]);
    expect(assessment.verdict).toBe("suspect");
    expect(assessment.reasons).toEqual(["1 of 2 commands failed in the first 30s"]);
  });

  /**
   * Empty quote pairs beside an escaped space. Nothing emits this, but it is the whole quoting
   * family in one counterexample, and answering it took one normalisation rather than one more character.
   */
  it("reports no sweep when quoting is used to spell an in-root path", () => {
    const { sweeps, assessment } = readsInside({
      commands: [
        { command: String.raw`/bin/cat /repo''\ root/a.ts`, exitCode: 1 },
        { command: String.raw`/bin/cat /scratch''\ root/b.ts`, exitCode: 0 },
      ],
      repoRoot: "/repo root",
      workspaceRoot: "/scratch root",
    });

    expect(sweeps).toEqual([]);
    expect(assessment.verdict).toBe("suspect");
    expect(assessment.reasons).toEqual(["1 of 2 commands failed in the first 30s"]);
  });

  it("reports no sweep for the other spellings of the same in-root path", () => {
    for (const command of [
      `/bin/cat '/repo root/a.ts'`,
      String.raw`/bin/cat /repo\ root/a.ts`,
      `/bin/cat "/repo root"/a.ts`,
      `/bin/cat /repo" "root/a.ts`,
    ]) {
      expect(outsideSweeps({ commands: [command], repoRoot: "/repo root", workspaceRoot: "/scratch" })).toEqual([]);
    }
  });

  /** A root ending in the splitting character, so the child slash lands exactly on the boundary. */
  it("reports no sweep for a root that ENDS in a colon", () => {
    const { sweeps, assessment } = readsInside({
      commands: [
        { command: `/bin/cat '/repo:/a'`, exitCode: 1 },
        { command: `/bin/cat '/repo:/b'`, exitCode: 0 },
      ],
      repoRoot: "/repo:",
      workspaceRoot: "/scratch/pass.scratch",
    });

    expect(sweeps).toEqual([]);
    expect(assessment.verdict).toBe("suspect");
    expect(assessment.reasons).toEqual(["1 of 2 commands failed in the first 30s"]);
  });

  /** The boundary must not swallow a genuine sweep that merely follows an in-root read on the same line. */
  it("still names a sweep that follows an in-root read on the same command line", () => {
    expect(
      outsideSweeps({ commands: ["diff /repo/a /elsewhere/b"], repoRoot: "/repo", workspaceRoot: "/scratch" }),
    ).toEqual(["/elsewhere/b"]);
  });

  /** `/sbin` is as ordinary a tool directory as `/bin`, and was simply missing from the allowlist. */
  it("does not abort a pass whose only outside paths are /sbin tools", () => {
    const { sweeps, assessment } = readsInside({
      commands: [
        { command: "/sbin/mount", exitCode: 1 },
        { command: "/sbin/umount", exitCode: 0 },
      ],
      repoRoot: "/repo",
      workspaceRoot: "/scratch/pass.scratch",
    });

    expect(sweeps).toEqual([]);
    expect(assessment.verdict).toBe("suspect");
    expect(assessment.reasons).toEqual(["1 of 2 commands failed in the first 30s"]);
  });

  /** A redundant `.` segment. In-root paths written the long way were reading as outside ones. */
  it("reports no sweep for an in-root path containing a '.' segment", () => {
    const { sweeps, assessment } = readsInside({
      commands: [
        { command: "cat /repo/./root/a", exitCode: 1 },
        { command: "cat /repo/./root/b", exitCode: 0 },
      ],
      repoRoot: "/repo/root",
      workspaceRoot: "/workspace",
    });

    expect(sweeps).toEqual([]);
    expect(assessment.verdict).toBe("suspect");
    expect(assessment.reasons).toEqual(["1 of 2 commands failed in the first 30s"]);
  });

  it("reports no sweep for an in-root path that detours through '..'", () => {
    expect(outsideSweeps({ commands: ["cat /repo/root/x/../y"], repoRoot: "/repo/root", workspaceRoot: "/w" })).toEqual(
      [],
    );
  });

  /**
   * A DOCUMENTED MISS, pinned so it stays a decision rather than becoming a surprise. A path that begins with
   * the root textually and then climbs out of it with `..` is not reported. That is the silent direction — a
   * missed sweep, never a false abort — and it predates this change; the root-prefix test has always been
   * textual. Tightening it would trade a miss for the false-abort class this whole file exists to remove.
   */
  it("does NOT name a path that starts inside the root and climbs out with '..' — an accepted miss", () => {
    expect(
      outsideSweeps({ commands: ["cat /repo/root/../../elsewhere/x"], repoRoot: "/repo/root", workspaceRoot: "/w" }),
    ).toEqual([]);
  });

  /** The converse half of the escaped-space case: an outside path whose components are not ASCII must still be SEEN. */
  it("names an outside path whose components are not ASCII", () => {
    expect(
      outsideSweeps({ commands: ["cat '/\u00e9lsewhere/secret.txt'"], repoRoot: "/repo", workspaceRoot: "/scratch" }),
    ).toEqual(["/\u00e9lsewhere/secret.txt"]);
  });

  it("still names a sweep written as a glob or followed by a line reference", () => {
    expect(
      outsideSweeps({ commands: ["rg --files -g '/elsewhere/**'"], repoRoot: "/repo", workspaceRoot: "/scratch" }),
    ).toEqual(["/elsewhere/"]);
    expect(
      outsideSweeps({ commands: ["cat /elsewhere/a.ts:12:3"], repoRoot: "/repo", workspaceRoot: "/scratch" }),
    ).toEqual(["/elsewhere/a.ts"]);
  });
});
