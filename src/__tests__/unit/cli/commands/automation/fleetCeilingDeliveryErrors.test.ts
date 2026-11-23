/**
 * `FleetCeilingDeliveryErrors.artifactFailed` and `withdrawReceipt` — the fleet-ceiling card's page leg and
 * yesterday's-card withdrawal run in process, so what the firing's record says carries that leg's closing stderr,
 * or the record says only an exit code.
 */
import { describe, expect, it } from "vitest";

import {
  FleetCeilingDeliveryErrors,
  withdrawReceipt,
} from "../../../../../cli/commands/automation/fleetCeilingDeliveryErrors.js";

describe("FleetCeilingDeliveryErrors.artifactFailed", () => {
  it("ends its message with what handover artifact wrote to stderr", () => {
    expect(
      FleetCeilingDeliveryErrors.artifactFailed({
        code: 1,
        diagnostics: "handover artifact: no board row fleet-ceiling-2026-09-08\n",
        slug: "fleet-ceiling-2026-09-08",
      }).message,
    ).toBe(
      "the card fleet-ceiling-2026-09-08 was placed, and handover artifact exited 1 attaching its page" +
        " · why: handover artifact: no board row fleet-ceiling-2026-09-08",
    );
  });

  it("says only the exit when the leg wrote nothing to stderr", () => {
    expect(
      FleetCeilingDeliveryErrors.artifactFailed({ code: 1, diagnostics: "", slug: "fleet-ceiling-2026-09-08" }).message,
    ).toBe("the card fleet-ceiling-2026-09-08 was placed, and handover artifact exited 1 attaching its page");
  });
});

describe("withdrawReceipt", () => {
  it("ends a failed withdrawal's why with what handover withdraw wrote to stderr", () => {
    expect(
      withdrawReceipt({ code: 1, diagnostics: "handover withdraw: fleet-ceiling-2026-09-07 has no recorded holder\n" }),
    ).toEqual({
      kind: "withdraw-failed",
      why: "handover withdraw exited 1 · why: handover withdraw: fleet-ceiling-2026-09-07 has no recorded holder",
    });
  });

  it("never annotates a withdrawal that worked, whatever the leg wrote on the way", () => {
    expect(withdrawReceipt({ code: 0, diagnostics: "handover withdraw: progress\n" })).toEqual({ kind: "withdrawn" });
  });
});
