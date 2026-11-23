/**
 * The exit code a batch of `codex plan`/`codex review` invocations adds up to, on the paths that print nothing:
 * an empty batch, and a pass no destination could take.
 */
import { describe, expect, it } from "vitest";

import { reportInvocations } from "../../../../../cli/commands/codex/passReport.js";
import { EXIT_USAGE } from "../../../../../cli/exitCodes.js";

describe("reportInvocations", () => {
  it("exits usage on a batch with no completed pass", () => {
    expect(reportInvocations({ invocations: [] })).toBe(EXIT_USAGE);
  });

  it("exits with the routing refusal's own code when a pass could not be routed", () => {
    expect(reportInvocations({ invocations: [{ exitCode: 7, kind: "unrouted" }] })).toBe(7);
  });
});
