/**
 * The `github merge` effectful shell under a standing merge hold. Fast tests inject plain fake edges (no mocks).
 */
import { describe, expect, it } from "vitest";
import { type GithubMergeDeps, runGithubMerge } from "../../../../../../cli/commands/github/mergeRun.js";
import { EXIT_ERROR, EXIT_OK } from "../../../../../../cli/exitCodes.js";
import { unmeasurable } from "../../../../../../measurement/status.js";
import { DEFAULT_HOLD_STALE_MINUTES, type MergeHold } from "../../../../../../outbound/github/mergeHold.js";
import { capturingOut, depsWith, VERB_ARGV } from "./harness.js";

/** The hold the merge-hold cases start from — one pull request of `owner/name`, placed five minutes before the test clock. */
function heldPr32(): MergeHold {
  return {
    atIso: "2026-08-28T01:55:00.000Z",
    holder: "another-session",
    pr: 32,
    repo: "owner/name",
    staleMinutes: DEFAULT_HOLD_STALE_MINUTES,
    staleWarnedAtIso: undefined,
    why: "rebase hell — main moved twice under it",
  };
}

/**
 * The hold edges over one standing hold, with the write and publish seams failing loudly.
 *
 * Loudly on purpose: the hold in these cases is FRESH, so a merge that reads it must neither warn about it
 * nor rewrite the document. A silent fake would let either regress unnoticed.
 */
function holdDepsWith({ holds }: { holds: readonly MergeHold[] }): GithubMergeDeps["hold"] {
  return {
    appendLedgerRow: () => {
      throw new Error("a fresh hold journals nothing");
    },
    holderLive: () => unmeasurable<boolean>({ why: "this fake asks no registry" }),
    nowIso: () => "2026-08-28T02:00:00.000Z",
    out: () => undefined,
    publish: () => {
      throw new Error("a fresh hold publishes nothing");
    },
    readHolds: () => holds,
    readLedgerRows: () => [],
    sessionId: () => undefined,
    writeHolds: () => {
      throw new Error("consulting a fresh hold must not rewrite the document");
    },
  };
}

describe("the merge hold", () => {
  it("refuses a merge for a pull request the hold does not name, before resolving the repository", async () => {
    const captured = capturingOut();
    const code = await runGithubMerge({
      argv: [...VERB_ARGV, "--number", "41"],
      deps: depsWith({
        hold: holdDepsWith({ holds: [heldPr32()] }),
        out: captured.out,
        resolveRepoRoot: () => {
          throw new Error("the hold refuses before any git work happens");
        },
      }),
    });

    expect(code).toBe(EXIT_ERROR);
    expect(captured.lines[0]).toContain("owner/name#32 owns the merge queue, and this invocation is for #41");
    expect(captured.lines[1]).toBe("refused: why: rebase hell — main moved twice under it");
  });

  it("refuses a report that names no pull request, since it cannot be shown to be the held one", async () => {
    const captured = capturingOut();
    const code = await runGithubMerge({
      argv: [...VERB_ARGV],
      deps: depsWith({ hold: holdDepsWith({ holds: [heldPr32()] }), out: captured.out }),
    });

    expect(code).toBe(EXIT_ERROR);
    expect(captured.lines.some((line) => line.includes("--number <n>"))).toBe(true);
  });

  it("lets the HELD pull request through, and says the hold is not blocking it", async () => {
    const captured = capturingOut();
    const code = await runGithubMerge({
      argv: [...VERB_ARGV, "--number", "32"],
      deps: depsWith({ hold: holdDepsWith({ holds: [heldPr32()] }), out: captured.out }),
    });

    expect(code).toBe(EXIT_OK);
    expect(captured.lines[0]).toContain("this IS the held pull request owner/name#32");
    expect(captured.lines.some((line) => line.startsWith("clean:"))).toBe(true);
  });

  it("leaves a merge in a DIFFERENT repository untouched", async () => {
    const captured = capturingOut();
    const code = await runGithubMerge({
      argv: [...VERB_ARGV, "--number", "41"],
      deps: depsWith({
        hold: holdDepsWith({ holds: [{ ...heldPr32(), repo: "owner/other" }] }),
        out: captured.out,
      }),
    });

    expect(code).toBe(EXIT_OK);
    expect(captured.lines[0]).toBe("slopweaver github merge — owner/name  feature -> main");
  });

  it("says nothing at all about a hold when none stands", async () => {
    const captured = capturingOut();
    const code = await runGithubMerge({
      argv: [...VERB_ARGV, "--number", "41"],
      deps: depsWith({ out: captured.out }),
    });

    expect(code).toBe(EXIT_OK);
    expect(captured.lines.some((line) => line.includes("merge hold"))).toBe(false);
  });
});
