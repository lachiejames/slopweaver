/*
 * The false-abort class: passes the tripwire once killed for reading their own repository by relative path or the
 * agent's own memory file, replayed from recorded heartbeat logs. It moved here when `tripwire.test.ts` was split
 * by behaviour.
 */
import { describe, expect, it } from "vitest";

import { foldCodexEvent, initialCodexActivity } from "../../../../codex/progress.js";
import { assessPassActivity, outsideSweeps } from "../../../../codex/tripwire.js";

/**
 * The false-abort class, replayed from the recorded history.
 *
 * Every command line below is a real one, taken verbatim from the heartbeat log of a pass that WAS aborted
 * `off-track`, with the absolute home prefix replaced (this repo is public and a home path is a leak class the
 * hygiene gate flags, test file or not). Measured over the whole recorded history: 24 `off-track` aborts, 18
 * of which could be paired to their own stream log by reproducing the record's stated evidence exactly, and 16
 * of those 18 lift under the rules these tests pin.
 *
 * Each case is a `suspect` rather than an `ok` on purpose. The failure signal was real — the pass really did
 * run a command that exited non-zero — and suppressing the suspicion would be over-correcting. What changed is
 * that a suspicion no longer becomes a kill on the strength of evidence that was not evidence.
 */
describe("passes the tripwire used to kill for reading their own repository", () => {
  // Not a home-shaped path: the hygiene gate flags an absolute home path in any tracked file, tests included.
  const HOME = "/w";
  const AGENT_MEMORY = `${HOME}/.codex/memories/MEMORY.md`;

  function replay({
    commands,
    repoRoot,
    workspaceRoot,
  }: {
    commands: readonly { readonly command: string; readonly exitCode: number }[];
    repoRoot: string;
    workspaceRoot: string;
  }) {
    const activity = commands.reduce(
      (soFar, { command, exitCode }) =>
        foldCodexEvent({
          activity: soFar,
          event: { item: { command, exitCode, itemKind: "command_execution" }, kind: "item" },
        }),
      initialCodexActivity(),
    );
    return assessPassActivity({ activity, elapsedMs: 58_000, repoRoot, workspaceRoot });
  }

  /**
   * `r1`, killed at 58 seconds. It had read its review packet in four slices, run one `rg` that matched
   * nothing, and opened two source files by RELATIVE path. Both of those relative paths were offered as
   * proof that it "began searching the machine".
   */
  it("does not abort the r1 pass whose only two sweeps were relative in-repo paths", () => {
    const assessment = replay({
      commands: [
        { command: `/bin/zsh -lc 'wc -c -l review-packet.md && shasum -a 256 review-packet.md'`, exitCode: 0 },
        { command: `/bin/zsh -lc "sed -n '1,400p' review-packet.md"`, exitCode: 0 },
        { command: `/bin/zsh -lc "sed -n '401,800p' review-packet.md"`, exitCode: 0 },
        {
          command: `/bin/zsh -lc 'rg -n "compareCoverage|gitEnv" src package.json docs AGENTS.md 2>/dev/null'`,
          exitCode: 1,
        },
        { command: `/bin/zsh -lc "sed -n '35,175p' src/devLint/coverageRatchet.ts"`, exitCode: 0 },
        { command: `/bin/zsh -lc "sed -n '1,110p' src/lib/gitRepo.ts && sed -n '45,80p' package.json"`, exitCode: 0 },
      ],
      repoRoot: `${HOME}/dev/slopweaver-wt/coverage-floor`,
      workspaceRoot: "/scratch/pass-1.scratch",
    });

    expect(assessment.verdict).toBe("suspect");
    expect(assessment.reasons).toEqual(["1 of 6 commands failed in the first 58s"]);
  });

  /**
   * `p2`, killed at 41 seconds. Its two sweeps were the agent's OWN memory file and the tail of
   * `src/devLint/boundaryResidue.ts`. The memory read is the harness starting up, and it supplied BOTH halves
   * of the evidence — the outside path and, as an `rg` that matched nothing, the non-zero exit as well.
   */
  it("does not abort the p2 pass whose sweeps were its own memory file and a relative path", () => {
    const assessment = replay({
      commands: [
        { command: `/bin/zsh -lc 'rg -n -i "rerun-linkread|providerCall" ${AGENT_MEMORY}'`, exitCode: 0 },
        { command: `/bin/zsh -lc "sed -n '600,660p' ${AGENT_MEMORY}"`, exitCode: 0 },
        { command: `/bin/zsh -lc "nl -ba src/devLint/boundaryResidue.ts | sed -n '1,320p'"`, exitCode: 1 },
      ],
      repoRoot: `${HOME}/dev/slopweaver-wt/rerun-linkread`,
      workspaceRoot: "/scratch/pass-2.scratch",
    });

    expect(assessment.verdict).toBe("suspect");
    expect(assessment.reasons).toEqual(["1 of 3 commands failed in the first 58s"]);
  });

  it("counts the agent's own memory file as neither a sweep nor a place it looked", () => {
    expect(
      outsideSweeps({
        commands: [`/bin/zsh -lc 'rg -n foo ${AGENT_MEMORY}'`],
        repoRoot: "/repo",
        workspaceRoot: "/scratch",
      }),
    ).toEqual([]);
  });

  it("does not read the tail of a relative path as an absolute one", () => {
    expect(
      outsideSweeps({
        commands: [`rg --files -g 'src/lib/providerCall.ts' -g 'src/devLint/boundaryResidue.ts'`],
        repoRoot: "/repo",
        workspaceRoot: "/scratch",
      }),
    ).toEqual([]);
  });

  it("does not read the `//` of a URL literal as a path", () => {
    expect(
      outsideSweeps({ commands: [`rg -n "https://example.test/x" /repo/src`], repoRoot: "/repo", workspaceRoot: "/w" }),
    ).toEqual([]);
  });

  /** The signal survives: a genuinely absolute path outside both roots is still named. */
  it("still names a real absolute path outside both roots", () => {
    expect(
      outsideSweeps({
        commands: [`find /elsewhere/deep -name x`, `ls /other/place`],
        repoRoot: "/repo",
        workspaceRoot: "/scratch",
      }),
    ).toEqual(["/elsewhere/deep", "/other/place"]);
  });

  /** And a bare top-level sweep is the strongest signal of all — depth is not a requirement. */
  it("still names a bare top-level directory sweep", () => {
    expect(outsideSweeps({ commands: [`rg --files /w`], repoRoot: "/repo", workspaceRoot: "/scratch" })).toEqual([
      "/w",
    ]);
  });
});
