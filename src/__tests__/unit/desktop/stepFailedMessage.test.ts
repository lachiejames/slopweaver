/**
 * A failed install step's message, as the owner's update card reads it: the error first, the command after, and both
 * still there once the update record clips the message.
 */
import { describe, expect, it } from "vitest";

import { DesktopInstallErrors, STEP_COMMAND_MAX, STEP_DETAIL_MAX } from "../../../desktop/errors.js";
import { clipOutcomeMessage, OUTCOME_MESSAGE_MAX } from "../../../desktop/updateOutcome.js";

describe("DesktopInstallErrors.stepFailed", () => {
  it("leads with the error and names the command after it", () => {
    const failed = DesktopInstallErrors.stepFailed({
      command: "yarn app",
      detail: "bash: ../scripts/tsc-owner.sh: No such file or directory (exit 127)",
    });
    expect(failed.message).toBe(
      "bash: ../scripts/tsc-owner.sh: No such file or directory (exit 127) — from `yarn app`",
    );
  });

  it("keeps the end of a long error and the start of a long command, so the record's clip cuts neither", () => {
    const detail = `${"E".repeat(5000)} (exit 1)`;
    const command = `yarn app ${"--config.x=y ".repeat(200)}`;
    const failed = DesktopInstallErrors.stepFailed({ command, detail });
    expect(failed.message.length).toBeLessThanOrEqual(OUTCOME_MESSAGE_MAX);
    expect(clipOutcomeMessage({ message: failed.message })).toBe(failed.message);
    expect(failed.message.startsWith(`…${"E".repeat(STEP_DETAIL_MAX - 10)} (exit 1) — from \`yarn app `)).toBe(true);
    expect(failed.message.endsWith("…`")).toBe(true);
    expect(failed.message.length).toBe(STEP_DETAIL_MAX + " — from `".length + STEP_COMMAND_MAX + "`".length);
  });
});
