import { describe, expect, it } from "vitest";

import { VantaEvidenceErrors, vantaEvidenceErrorLines } from "../../../../atlas/vanta/evidenceErrors.js";

describe("VantaEvidenceErrors", () => {
  it("heads an invalid control evidence document, then one line per issue", () => {
    const error = VantaEvidenceErrors.controlEvidenceInvalid({
      issues: [{ message: "Invalid input: expected string, received undefined", path: ["tests", 0, "name"] }],
    });
    expect(error.code).toBe("CONTROL_EVIDENCE_INVALID");
    expect(vantaEvidenceErrorLines({ error })).toEqual([
      "the control evidence Vanta returned does not satisfy this package's own document schema:",
      "  tests.0.name: Invalid input: expected string, received undefined",
    ]);
  });

  it("heads an invalid controls evidence document with its own words", () => {
    const error = VantaEvidenceErrors.controlsEvidenceInvalid({
      issues: [{ message: "Too small: expected number to be >=0", path: ["total"] }],
    });
    expect(error.code).toBe("CONTROLS_EVIDENCE_INVALID");
    expect(vantaEvidenceErrorLines({ error })).toEqual([
      "the controls evidence Vanta returned does not satisfy this package's own document schema:",
      "  total: Too small: expected number to be >=0",
    ]);
  });

  it("quotes the probe's own message when the tenant probe fails", () => {
    const error = VantaEvidenceErrors.tenantProbeFailed({ detail: "net::ERR_TIMED_OUT" });
    expect(error.code).toBe("TENANT_PROBE_FAILED");
    expect(vantaEvidenceErrorLines({ error })).toEqual([
      "could not reach the Vanta web client to learn its tenant: net::ERR_TIMED_OUT",
    ]);
  });
});
