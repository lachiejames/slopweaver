import { describe, expect, it } from "vitest";

import { RowWriteErrors } from "../../../handover/rowEventErrors.js";
import { RulingBackfillFailures } from "../../../handover/rulingBackfillErrors.js";
import { RulingIntegrityErrors } from "../../../handover/rulingErrors.js";

describe("RulingBackfillFailures", () => {
  it("builds integrityFailed saying nothing was written, carrying the integrity refusal by reference", () => {
    const cause = RulingIntegrityErrors.sourceMissing({ sourceAtIso: "2026-10-01T00:00:00.000Z" });
    const failure = RulingBackfillFailures.integrityFailed({ cause });
    expect(failure).toEqual({
      cause,
      code: "APPEND_INTEGRITY_FAILED",
      message: `nothing was written: ${cause.message}`,
    });
    expect(failure.cause).toBe(cause);
  });

  it("prefixes the exact integrity message of an already-recorded ruling", () => {
    const cause = RulingIntegrityErrors.alreadyRecorded({ decidedIso: "2026-10-02T03:04:05.000Z" });
    expect(RulingBackfillFailures.integrityFailed({ cause }).message).toBe(
      "nothing was written: this row already records that exact ruling, decided 2026-10-02T03:04:05.000Z — a " +
        "ruling is appended once, and recording it twice would make one decision read as two",
    );
  });

  it("builds appendFailed carrying the write error and the safe rerun instruction", () => {
    const cause = RowWriteErrors.invalidEvent({ issues: ["why: required", "at: not an instant"], kind: "ruling" });
    const failure = RulingBackfillFailures.appendFailed({ cause });
    expect(failure).toEqual({
      cause,
      code: "APPEND_FAILED",
      message:
        'the append did not report success: "ruling" does not satisfy its own schema: why: required; at: not an ' +
        "instant — re-run the same manifest, which reads the journal again and appends only what is still missing",
    });
    expect(failure.cause).toBe(cause);
  });
});
