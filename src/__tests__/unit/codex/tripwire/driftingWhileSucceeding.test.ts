/*
 * A late pass that fails nothing but reads other passes' orchestration artifacts is aborted; one reading its own
 * workspace or the repository is left alone. It moved here when `tripwire.test.ts` was split by behaviour.
 */
import { describe, expect, it } from "vitest";

import type { CodexActivity } from "../../../../codex/progress.js";
import { assessPassActivity } from "../../../../codex/tripwire.js";

/**
 * The blind spot the measured FATAL sweep fell through.
 *
 * That pass ran 150 commands with only 11 failures over 17.5 minutes and produced no verdict. Every existing
 * abort signature was unreachable: both are gated on failures, and both only fire inside the 60s early
 * window. It was succeeding, and it was late. What it was actually doing was `find` over
 * `$SLOPWEAVER_HOME/orchestration` — reading other passes' artifacts instead of the code under review.
 */
describe("drifting while succeeding", () => {
  const PRY_WORKSPACE = "/w/orchestration/aaaa-1111.scratch";
  const PRY_REPO = "/w/repo";

  function activityWith({ commands, failed }: { commands: readonly string[]; failed: number }): CodexActivity {
    return {
      commands: commands.length,
      failedCommands: failed,
      fileChanges: 0,
      lastAgentMessage: undefined,
      lastCommand: commands.at(-1),
      lastReportedFailure: undefined,
      recentCommands: commands,
      searches: 0,
      threadId: "t",
    };
  }

  it("aborts a late pass that is reading other passes' artifacts, with zero failed commands", () => {
    const activity = activityWith({
      commands: [
        '/bin/zsh -lc "find /w/orchestration/1f1887fe-5515-4db1-ae9c-8ccb677884cd -name artifact.md"',
        '/bin/zsh -lc "cat /w/orchestration/2426ae2a-8cbb-4990-bcff-9be0dedd0d88/artifact.md"',
      ],
      failed: 0,
    });

    const assessment = assessPassActivity({
      activity,
      elapsedMs: 900_000,
      repoRoot: PRY_REPO,
      workspaceRoot: PRY_WORKSPACE,
    });

    expect(assessment.verdict).toBe("abort");
    expect(assessment.reasons.some((r) => r.includes("lost the task"))).toBe(true);
  });

  it("leaves a pass reading its OWN workspace alone — that is where its review packet lives", () => {
    const activity = activityWith({
      commands: [
        `/bin/zsh -lc "nl -ba ${PRY_WORKSPACE}/review-packet.md"`,
        `/bin/zsh -lc "sed -n '1,80p' ${PRY_WORKSPACE}/review-packet.md"`,
      ],
      failed: 0,
    });

    expect(
      assessPassActivity({ activity, elapsedMs: 900_000, repoRoot: PRY_REPO, workspaceRoot: PRY_WORKSPACE }).verdict,
    ).toBe("ok");
  });

  it("reads a command naming no absolute path as no pry, without losing the pries around it", () => {
    const pathless = activityWith({ commands: ["git status", "ls -la"], failed: 0 });
    const mixed = activityWith({
      commands: [
        "git status",
        '/bin/zsh -lc "find /w/orchestration/1f1887fe-5515-4db1-ae9c-8ccb677884cd -name artifact.md"',
        "ls -la",
        '/bin/zsh -lc "cat /w/orchestration/2426ae2a-8cbb-4990-bcff-9be0dedd0d88/artifact.md"',
      ],
      failed: 0,
    });

    expect(
      assessPassActivity({ activity: pathless, elapsedMs: 900_000, repoRoot: PRY_REPO, workspaceRoot: PRY_WORKSPACE })
        .verdict,
    ).toBe("ok");
    expect(
      assessPassActivity({ activity: mixed, elapsedMs: 900_000, repoRoot: PRY_REPO, workspaceRoot: PRY_WORKSPACE })
        .verdict,
    ).toBe("abort");
  });

  it("does not fire on a single stray path", () => {
    const activity = activityWith({
      commands: [`/bin/zsh -lc "ls /w/orchestration/other-pass"`],
      failed: 0,
    });

    expect(
      assessPassActivity({ activity, elapsedMs: 900_000, repoRoot: PRY_REPO, workspaceRoot: PRY_WORKSPACE }).verdict,
    ).not.toBe("abort");
  });

  it("leaves an ordinary long pass reading the repository alone", () => {
    const activity = activityWith({
      commands: [`/bin/zsh -lc "rg foo ${PRY_REPO}/src"`, `/bin/zsh -lc "nl -ba ${PRY_REPO}/src/index.ts"`],
      failed: 1,
    });

    expect(
      assessPassActivity({ activity, elapsedMs: 900_000, repoRoot: PRY_REPO, workspaceRoot: PRY_WORKSPACE }).verdict,
    ).not.toBe("abort");
  });
});
