/**
 * The stack-step executor's report and completeness judgement (`stackStepExec.ts`), driven directly.
 *
 * `executeStackSteps`'s rebase-and-push protocol is exercised through injected Git by the carry and sync
 * suites; here it is driven only over an empty plan, where it must touch Git not at all. The two pure exports
 * are compared whole.
 */
import { describe, expect, it } from "vitest";

import type { GithubPushDeps } from "../../../../../cli/commands/github/pushPrimitives.js";
import {
  executeStackSteps,
  type StackStepOutcome,
  stackStepOutcomeLines,
  stackStepsFullyLanded,
} from "../../../../../cli/commands/github/stackStepExec.js";
import type { GithubStackSyncStep } from "../../../../../cli/commands/github/stackSyncCore.js";
import { memoryDoorLedger } from "../../../../doorLedgerFixture.js";
import { HOME_WITHOUT_PUSH_ROOTS } from "../../../../pushRootFixture.js";

function step({ position, branch }: { position: number; branch: string }): GithubStackSyncStep {
  return {
    baseBranch: "main",
    branch,
    headSha: "1111111111111111111111111111111111111111",
    position,
    pullRequestNumber: 100 + position,
    reason: "base-moved",
    stackNumber: 9,
    worktreePath: `/wt/${branch}`,
  };
}

const BOTTOM = step({ branch: "bottom", position: 1 });
const MIDDLE = step({ branch: "middle", position: 2 });
const TOP = step({ branch: "top", position: 3 });

describe("stackStepOutcomeLines", () => {
  it("renders one line per outcome, the landed word for a landed step and kind plus reason otherwise", () => {
    const outcomes: readonly StackStepOutcome[] = [
      { kind: "landed", step: BOTTOM },
      { kind: "conflict", reason: "rebase stopped on src/a.ts", step: MIDDLE },
      { kind: "failed", reason: "lease rejected", step: TOP },
      { kind: "unconfirmed", reason: "remote reads another sha", step: TOP },
    ];

    expect(stackStepOutcomeLines({ landedWord: "carried", outcomes, prefix: "  carry: " })).toEqual([
      "  carry: carried bottom (PR #101)",
      "  carry: conflict: middle (PR #102) — rebase stopped on src/a.ts",
      "  carry: failed: top (PR #103) — lease rejected",
      "  carry: unconfirmed: top (PR #103) — remote reads another sha",
    ]);
  });

  it("renders nothing for no attempted step", () => {
    expect(stackStepOutcomeLines({ landedWord: "synced", outcomes: [], prefix: "" })).toEqual([]);
  });
});

describe("stackStepsFullyLanded", () => {
  it("is true for an empty plan with no outcomes", () => {
    expect(stackStepsFullyLanded({ outcomes: [], steps: [] })).toBe(true);
  });

  it("is true when both planned steps landed", () => {
    expect(
      stackStepsFullyLanded({
        outcomes: [
          { kind: "landed", step: BOTTOM },
          { kind: "landed", step: MIDDLE },
        ],
        steps: [BOTTOM, MIDDLE],
      }),
    ).toBe(true);
  });

  it("is false when the run stopped short, even though its one attempted step landed", () => {
    expect(stackStepsFullyLanded({ outcomes: [{ kind: "landed", step: BOTTOM }], steps: [BOTTOM, MIDDLE] })).toBe(
      false,
    );
  });

  it("is false when the last attempted step did not land", () => {
    expect(
      stackStepsFullyLanded({
        outcomes: [
          { kind: "landed", step: BOTTOM },
          { kind: "conflict", reason: "rebase stopped", step: MIDDLE },
        ],
        steps: [BOTTOM, MIDDLE],
      }),
    ).toBe(false);
  });
});

describe("executeStackSteps", () => {
  it("attempts nothing and reads no Git for an empty plan", () => {
    const calls: string[] = [];
    const readGit: GithubPushDeps["readGit"] = ({ args }) => {
      calls.push(args.join(" "));
      return "";
    };
    const writeGit: GithubPushDeps["writeGit"] = ({ args }) => {
      throw new Error(`unexpected Git write: ${args.join(" ")}`);
    };
    const git: GithubPushDeps = {
      cwd: () => "/wt",
      doorLedger: memoryDoorLedger().port,
      out: () => undefined,
      readGit,
      writeGit,
    };

    expect(executeStackSteps({ git, home: HOME_WITHOUT_PUSH_ROOTS, remote: "origin", steps: [] })).toEqual([]);
    expect(calls).toEqual([]);
  });
});
