/**
 * `codex plan` and `codex review` answer their help and refuse a malformed argv BEFORE any dependency is
 * reached: the client seam below records every destination it is asked for, and a preamble exit asks for none.
 */
import { describe, expect, it } from "vitest";

import type { CodexDeps } from "../../../../../cli/commands/codex/passDeps.js";
import { runCodexPlanWithDeps, runCodexReviewWithDeps } from "../../../../../cli/commands/codex/run.js";
import { EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import type { CodexDestination } from "../../../../../codex/destinations.js";
import type { DeadlineRuntime } from "../../../../../codex/runPass.js";
import { err } from "../../../../../lib/result.js";
import { testReservationPort } from "../../../../codexPassReservationFixture.js";
import { memoryFallbackRegisterPort } from "../../../../fallbackRegisterFixture.js";
import { memorySupersessionPort } from "../../../../landingRegistersFixture.js";

const RUNTIME: DeadlineRuntime = {
  nowIso: () => "2026-09-23T06:00:00.000Z",
  nowMs: () => 0,
  schedule: () => ({ cancel: () => {} }),
};

/**
 * Dependencies whose client seam only records that it was asked.
 *
 * @param asked where each requested destination is pushed
 * @returns the dependencies
 */
function recordingDeps({ asked }: { asked: CodexDestination[] }): CodexDeps {
  return {
    clientFor: ({ destination }) => {
      asked.push(destination);
      return err("a Codex thread launch blocked because the test never runs a pass");
    },
    fallbackPort: memoryFallbackRegisterPort(),
    reservationPort: testReservationPort(),
    runtime: RUNTIME,
    supersessions: memorySupersessionPort(),
  };
}

describe("codex plan and review preambles", () => {
  it("answers plan --help with success and reaches no client", async () => {
    const asked: CodexDestination[] = [];
    const code = await runCodexPlanWithDeps({
      argv: ["node", "cli", "codex", "plan", "--help"],
      deps: recordingDeps({ asked }),
    });
    expect(code).toBe(EXIT_OK);
    expect(asked).toEqual([]);
  });

  it("answers review -h with success and reaches no client", async () => {
    const asked: CodexDestination[] = [];
    const code = await runCodexReviewWithDeps({
      argv: ["node", "cli", "codex", "review", "-h"],
      deps: recordingDeps({ asked }),
    });
    expect(code).toBe(EXIT_OK);
    expect(asked).toEqual([]);
  });

  it("refuses an unknown plan flag as usage and reaches no client", async () => {
    const asked: CodexDestination[] = [];
    const code = await runCodexPlanWithDeps({
      argv: ["node", "cli", "codex", "plan", "--no-such-flag"],
      deps: recordingDeps({ asked }),
    });
    expect(code).toBe(EXIT_USAGE);
    expect(asked).toEqual([]);
  });
});
