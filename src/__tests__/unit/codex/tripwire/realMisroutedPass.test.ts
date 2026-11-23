/*
 * A real misrouted pass, replayed command by command: the outside-sweep signature aborts it where the
 * exit codes alone could not. It moved here when `tripwire.test.ts` was split by behaviour.
 */
import { describe, expect, it } from "vitest";

import { foldCodexEvent, initialCodexActivity } from "../../../../codex/progress.js";
import { assessPassActivity, EARLY_WINDOW_MS, tripwireExplanation } from "../../../../codex/tripwire.js";

/**
 * THE CASE THAT GOT AWAY.
 *
 * A real pass was pointed at four files that do not exist. The exit-code signal alone was too weak
 * to catch it — Codex probed broadly and only 2 of 5 commands failed — so it ran for 1m29s before giving up
 * on its own. These are its ACTUAL command lines, in order, and the abort must fire on them.
 *
 * The signature the exit codes missed is the sweep: having missed once, it started searching `~/dev` and then
 * `/private/tmp`, neither of which is the workspace or the repository. That is what "the document names
 * something that is not there" looks like from the outside.
 */
describe("the real misrouted pass", () => {
  // Shape-identical to the real run, with the home path replaced — this repo is public and an
  // absolute home path is a leak class the hygiene gate flags, test file or not.
  const REAL_REPO = "/w/personal/slopweaver-codex";
  const REAL_SCRATCH = "/w/.slopweaver/orchestration/31e5d5fd.scratch";

  /** The four commands it actually ran, with the exit codes it actually got. */
  const REAL_RUN: readonly { readonly command: string; readonly exitCode: number }[] = [
    { command: `rg -n -i "slopweaver-codex|NOWHERE-1|alpha.md" ${REAL_REPO}`, exitCode: 1 },
    { command: `git -C ${REAL_REPO} ls-files`, exitCode: 0 },
    { command: `rg --files /w | rg 'alpha|beta'`, exitCode: 1 },
    { command: `find /private/tmp /private/var/folders/2g/5dkp6y0n -name 'alpha.md'`, exitCode: 0 },
  ];

  function realActivity({ upTo }: { upTo: number }) {
    return REAL_RUN.slice(0, upTo).reduce(
      (activity, { command, exitCode }) =>
        foldCodexEvent({
          activity,
          event: { item: { command, exitCode, itemKind: "command_execution" }, kind: "item" },
        }),
      initialCodexActivity(),
    );
  }

  function assessReal({ upTo, elapsedMs }: { upTo: number; elapsedMs: number }) {
    return assessPassActivity({
      activity: realActivity({ upTo }),
      elapsedMs,
      repoRoot: REAL_REPO,
      workspaceRoot: REAL_SCRATCH,
    });
  }

  it("ABORTS by the fourth command, at 31 seconds — the run that used to cost 1m29s", () => {
    const assessment = assessReal({ elapsedMs: 31_000, upTo: 4 });

    expect(assessment.verdict).toBe("abort");
    expect(assessment.reasons.join(" ")).toContain("began searching the machine");
  });

  it("names both sweeps, so the abort is actionable", () => {
    const assessment = assessReal({ elapsedMs: 31_000, upTo: 4 });

    expect(tripwireExplanation({ assessment })).toContain("/w");
    expect(tripwireExplanation({ assessment })).toContain("/private/tmp");
  });

  it("does NOT abort on the first miss alone — one failed grep inside the repo is ordinary", () => {
    expect(assessReal({ elapsedMs: 6_000, upTo: 1 }).verdict).toBe("suspect");
  });

  it("does NOT abort on the first sweep alone — two are a search, one is a lookup", () => {
    expect(assessReal({ elapsedMs: 22_000, upTo: 3 }).verdict).toBe("suspect");
  });

  it("still would not abort after the early window, however bad it looks", () => {
    expect(assessReal({ elapsedMs: EARLY_WINDOW_MS + 1, upTo: 4 }).verdict).toBe("suspect");
  });
});
