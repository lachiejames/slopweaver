/**
 * The gate's own typed failures, built the way the real code builds them.
 *
 * Per `.claude/rules/error-handling.md`: a fixture goes through the domain's own factory, so a factory that
 * stops matching its type reddens here rather than at a call site nobody runs.
 */
import { describe, expect, it } from "vitest";

import { RulingGateErrors } from "../../../handover/rulingGateErrors.js";

describe("RulingGateErrors", () => {
  it("names the malformed selector itself, so one bad entry in a list is findable", () => {
    const error = RulingGateErrors.selectorMalformed({ entry: "slack" });

    expect(error.code).toBe("GATE_SELECTOR_MALFORMED");
    expect(error.entry).toBe("slack");
    expect(error.message).toContain("there is no wildcard");
  });

  it("tells an unknown verb apart from an ungateable one, because the fixes differ", () => {
    const unknown = RulingGateErrors.verbUnknown({ noun: "slack", verb: "shout" });
    const ungateable = RulingGateErrors.verbUngateable({ noun: "handover", verb: "rule" });

    expect(unknown.code).toBe("GATE_VERB_UNKNOWN");
    expect(unknown.message).toContain("slopweaver slack shout");
    expect(ungateable.code).toBe("GATE_VERB_UNGATEABLE");
    expect(ungateable.message).toContain("can never be gated");
  });

  it("points an unreadable index at the verb that rebuilds it", () => {
    const error = RulingGateErrors.indexUnreadable({ detail: "not json", path: "/tmp/ruling-gates.json" });

    expect(error.code).toBe("GATE_INDEX_UNREADABLE");
    expect(error.path).toBe("/tmp/ruling-gates.json");
    expect(error.message).toContain("slopweaver handover gate rebuild");
  });

  it("keeps a write failure distinct from a read one, on the same path", () => {
    const error = RulingGateErrors.indexWriteFailed({ detail: "EACCES", path: "/tmp/ruling-gates.json" });

    expect(error.code).toBe("GATE_INDEX_WRITE_FAILED");
    expect(error.message).toContain("EACCES");
  });

  it("points a missing id at the verb that lists the real ones", () => {
    const error = RulingGateErrors.notFound({ id: "row#nope" });

    expect(error.code).toBe("GATE_NOT_FOUND");
    expect(error.id).toBe("row#nope");
    expect(error.message).toContain("slopweaver handover gate list");
  });

  it("says WHY a non-canonical lapse instant is refused rather than just that it is", () => {
    const error = RulingGateErrors.untilInvalid({ untilIso: "tomorrow" });

    expect(error.code).toBe("GATE_UNTIL_INVALID");
    expect(error.untilIso).toBe("tomorrow");
    expect(error.message).toContain("lapses at no time at all");
  });
});
