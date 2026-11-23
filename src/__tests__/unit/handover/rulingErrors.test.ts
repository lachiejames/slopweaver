/**
 * `RulingIntegrityErrors`: each factory's code, the fields a caller prints beside it, and the one fact its
 * message must carry (the instant, or the count) so a caller never reconstructs it from the fields.
 */
import { describe, expect, it } from "vitest";

import { RulingIntegrityErrors } from "../../../handover/rulingErrors.js";

const SOURCE = "2026-10-01T09:00:00.000Z";
const DECIDED = "2026-10-02T10:30:00.000Z";

describe("RulingIntegrityErrors", () => {
  it("alreadyRecorded carries the standing ruling's decision instant", () => {
    const error = RulingIntegrityErrors.alreadyRecorded({ decidedIso: DECIDED });

    expect(error.code).toBe("RULING_ALREADY_RECORDED");
    expect(error.decidedIso).toBe(DECIDED);
    expect(error.message).toContain(`decided ${DECIDED}`);
  });

  it("sourceAlreadyRecorded names the source answer it was reconstructed from", () => {
    const error = RulingIntegrityErrors.sourceAlreadyRecorded({ sourceAtIso: SOURCE });

    expect(error.code).toBe("RULING_SOURCE_ALREADY_RECORDED");
    expect(error.sourceAtIso).toBe(SOURCE);
    expect(error.message).toContain(`the answer of ${SOURCE}`);
  });

  it("sourceAmbiguous carries how many answered events share the instant", () => {
    const error = RulingIntegrityErrors.sourceAmbiguous({ found: 3, sourceAtIso: SOURCE });

    expect(error.code).toBe("RULING_SOURCE_AMBIGUOUS");
    expect(error.found).toBe(3);
    expect(error.sourceAtIso).toBe(SOURCE);
    expect(error.message.startsWith(`3 answered events on this row share the instant ${SOURCE}`)).toBe(true);
  });

  it("sourceMissing names the instant no answered event carries", () => {
    const error = RulingIntegrityErrors.sourceMissing({ sourceAtIso: SOURCE });

    expect(error.code).toBe("RULING_SOURCE_MISSING");
    expect(error.sourceAtIso).toBe(SOURCE);
    expect(error.message.startsWith(`no answered event on this row carries the instant ${SOURCE}`)).toBe(true);
  });

  it("sourceTimeInvalid states the instant it must be and the one it was given", () => {
    const error = RulingIntegrityErrors.sourceTimeInvalid({ decidedIso: DECIDED, sourceAtIso: SOURCE });

    expect(error.code).toBe("RULING_SOURCE_TIME_INVALID");
    expect(error.decidedIso).toBe(DECIDED);
    expect(error.sourceAtIso).toBe(SOURCE);
    expect(error.message).toContain(`decidedIso must be ${SOURCE}, not ${DECIDED}`);
  });

  it("sourceWordsMismatch names the answered event whose words differ", () => {
    const error = RulingIntegrityErrors.sourceWordsMismatch({ sourceAtIso: SOURCE });

    expect(error.code).toBe("RULING_SOURCE_WORDS_MISMATCH");
    expect(error.sourceAtIso).toBe(SOURCE);
    expect(error.message).toContain(`the answered event of ${SOURCE} recorded`);
  });
});
