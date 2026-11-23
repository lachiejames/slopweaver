/**
 * The Codex pairing floor as `github enqueue`'s own finding: the translation into one finding, the
 * acknowledgement recorded only for a raised-and-waived floor, and the re-read just before the mutation.
 */
import { describe, expect, it } from "vitest";

import type { DoorAcknowledgement } from "../../../../../admit/types.js";
import type { GithubEnqueueArgs } from "../../../../../cli/commands/github/enqueueArgs.js";
import {
  codexLoopAcknowledgement,
  codexLoopFindingFor,
  recheckedFloorWaivers,
} from "../../../../../cli/commands/github/enqueueCodexLoop.js";
import type { EnqueueFinding } from "../../../../../cli/commands/github/enqueueFindings.js";
import type { CodexLoopInspection } from "../../../../../codex/landingGate.js";

/** The parsed invocation; by default it names no subject and gives no reason. */
function args(over: Partial<GithubEnqueueArgs> = {}): GithubEnqueueArgs {
  return {
    acknowledge: [],
    acknowledgeAll: false,
    dequeue: false,
    dryRun: false,
    home: undefined,
    json: false,
    number: 41,
    owner: "acme",
    reason: undefined,
    repo: "widget",
    ...over,
  };
}

const FLOOR: EnqueueFinding = {
  detail: "no plan ran",
  kind: "codex-loop-incomplete",
  subject: "codex-loop-incomplete",
};
const CI: EnqueueFinding = { detail: "ci is red", kind: "ci-not-green", subject: "ci-not-green" };

const CLEAN: CodexLoopInspection = { failures: [], kind: "examined", leftovers: [] };
const FAILING: CodexLoopInspection = {
  failures: ["no plan ran", "the review is stale"],
  kind: "examined",
  leftovers: [],
};
/** Past the second and last review pass with one finding standing, landed only on an acknowledgement. */
const CAPPED: CodexLoopInspection = {
  failures: [],
  kind: "examined",
  leftovers: [{ artifactId: "art-7", pass: "r2", propertyId: "r2-08", summary: "the retry loses a write" }],
};
/** The detail a standing leftover raises. */
const CAPPED_DETAIL =
  "r2/r2-08 (art-7): the retry loses a write is CURRENT and BROKEN after the second and last review pass — " +
  'land it with --acknowledge codex-loop-incomplete --reason "<why it lands with this standing>"';
const UNEXAMINED: CodexLoopInspection = { kind: "not-examined", reason: "the checkout is on another branch" };

const ROLLUP_ROW: DoorAcknowledgement = { reason: "run 1 replaced it", subject: "ci-rollup-superseded" };
const STALE_FLOOR_ROW: DoorAcknowledgement = { reason: "the old waiver", subject: "codex-loop-incomplete" };
const IAC_ROW: DoorAcknowledgement = { reason: "terraform owns it", subject: "datadog-iac-managed" };

describe("codexLoopFindingFor", () => {
  it("raises nothing for an examined loop with no failures", () => {
    expect(codexLoopFindingFor({ inspection: CLEAN })).toEqual([]);
  });

  it("raises the floor for a capped loop with a leftover standing", () => {
    expect(codexLoopFindingFor({ inspection: CAPPED })).toEqual([
      { detail: CAPPED_DETAIL, kind: "codex-loop-incomplete", subject: "codex-loop-incomplete" },
    ]);
  });

  it("joins every examined failure into ONE finding's detail, in order", () => {
    expect(codexLoopFindingFor({ inspection: FAILING })).toEqual([
      {
        detail: "no plan ran; the review is stale",
        kind: "codex-loop-incomplete",
        subject: "codex-loop-incomplete",
      },
    ]);
  });

  it("raises a finding naming the reason when the loop could not be examined", () => {
    expect(codexLoopFindingFor({ inspection: UNEXAMINED })).toEqual([
      {
        detail: "the Codex loop could not be examined: the checkout is on another branch",
        kind: "codex-loop-incomplete",
        subject: "codex-loop-incomplete",
      },
    ]);
  });
});

describe("codexLoopAcknowledgement", () => {
  const waiving = args({ acknowledge: ["codex-loop-incomplete"], reason: "codex is capped until 14:00" });

  it("records nothing when the floor was never raised, even with waiving flags", () => {
    expect(codexLoopAcknowledgement({ args: waiving, findings: [CI], unacknowledged: [] })).toBeUndefined();
  });

  it("records nothing while the floor finding is still standing", () => {
    expect(codexLoopAcknowledgement({ args: waiving, findings: [FLOOR, CI], unacknowledged: [FLOOR] })).toBeUndefined();
  });

  it("records the named waiver with its literal reason once the floor was raised and cleared", () => {
    expect(codexLoopAcknowledgement({ args: waiving, findings: [FLOOR, CI], unacknowledged: [CI] })).toEqual({
      reason: "codex is capped until 14:00",
      subject: "codex-loop-incomplete",
    });
  });

  it("records the waiver under --acknowledge-all with a reason", () => {
    expect(
      codexLoopAcknowledgement({
        args: args({ acknowledgeAll: true, reason: "landing the hotfix" }),
        findings: [FLOOR],
        unacknowledged: [],
      }),
    ).toEqual({ reason: "landing the hotfix", subject: "codex-loop-incomplete" });
  });

  it("records nothing for a raised-and-cleared floor when no reason was given", () => {
    expect(
      codexLoopAcknowledgement({
        args: args({ acknowledge: ["codex-loop-incomplete"] }),
        findings: [FLOOR],
        unacknowledged: [],
      }),
    ).toBeUndefined();
  });
});

describe("recheckedFloorWaivers", () => {
  it("drops only the stale floor row and prints nothing when the re-read is clean", () => {
    const lines: string[] = [];
    const result = recheckedFloorWaivers({
      acknowledgements: [ROLLUP_ROW, STALE_FLOOR_ROW, IAC_ROW],
      args: args({ acknowledge: ["codex-loop-incomplete"], reason: "codex is capped" }),
      inspection: CLEAN,
      write: (line) => lines.push(line),
    });
    expect(result).toEqual([ROLLUP_ROW, IAC_ROW]);
    expect(lines).toEqual([]);
  });

  /** No description names a leftover, so a capped loop lands only on the acknowledgement with its reason. */
  it("refuses a capped loop with no acknowledgement, printing the leftover", () => {
    const lines: string[] = [];
    const result = recheckedFloorWaivers({
      acknowledgements: [ROLLUP_ROW],
      args: args(),
      inspection: CAPPED,
      write: (line) => lines.push(line),
    });
    expect(result).toBeUndefined();
    expect(lines).toEqual([`refused: codex-loop-incomplete: ${CAPPED_DETAIL}`]);
  });

  it("lands a capped loop acknowledged with a reason, recording that reason", () => {
    const lines: string[] = [];
    const result = recheckedFloorWaivers({
      acknowledgements: [ROLLUP_ROW],
      args: args({ acknowledge: ["codex-loop-incomplete"], reason: "the retry race is tracked separately" }),
      inspection: CAPPED,
      write: (line) => lines.push(line),
    });
    expect(result).toEqual([
      ROLLUP_ROW,
      { reason: "the retry race is tracked separately", subject: "codex-loop-incomplete" },
    ]);
    expect(lines).toEqual([`ACKNOWLEDGED: codex-loop-incomplete: ${CAPPED_DETAIL}`]);
  });

  it("refuses a standing unwaived floor and prints every detail as refused", () => {
    const lines: string[] = [];
    const result = recheckedFloorWaivers({
      acknowledgements: [ROLLUP_ROW, STALE_FLOOR_ROW],
      args: args(),
      inspection: FAILING,
      write: (line) => lines.push(line),
    });
    expect(result).toBeUndefined();
    expect(lines).toEqual([
      "refused: codex-loop-incomplete: no plan ran",
      "refused: codex-loop-incomplete: the review is stale",
    ]);
  });

  it("appends exactly one fresh floor waiver after every other row and prints each detail ACKNOWLEDGED", () => {
    const lines: string[] = [];
    const result = recheckedFloorWaivers({
      acknowledgements: [STALE_FLOOR_ROW, ROLLUP_ROW, IAC_ROW],
      args: args({ acknowledge: ["codex-loop-incomplete"], reason: "codex is capped" }),
      inspection: FAILING,
      write: (line) => lines.push(line),
    });
    expect(result).toEqual([ROLLUP_ROW, IAC_ROW, { reason: "codex is capped", subject: "codex-loop-incomplete" }]);
    expect(lines).toEqual([
      "ACKNOWLEDGED: codex-loop-incomplete: no plan ran",
      "ACKNOWLEDGED: codex-loop-incomplete: the review is stale",
    ]);
  });

  it("treats an unexamined re-read as a standing floor and prints its reason", () => {
    const lines: string[] = [];
    const result = recheckedFloorWaivers({
      acknowledgements: [],
      args: args(),
      inspection: UNEXAMINED,
      write: (line) => lines.push(line),
    });
    expect(result).toBeUndefined();
    expect(lines).toEqual([
      "refused: codex-loop-incomplete: the Codex loop could not be examined: the checkout is on another branch",
    ]);
  });
});
