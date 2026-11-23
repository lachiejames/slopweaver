/**
 * The value-sample domain's failures: each factory stamps its own code and says, in its message, what failed and
 * what the reader can do about it.
 */
import { describe, expect, it } from "vitest";

import { ValueErrors } from "../../../value/errors.js";

describe("ValueErrors", () => {
  it("refuses a second answer, naming both and never replacing the first", () => {
    const error = ValueErrors.answerConflict({ offered: "unused", recorded: "used", slug: "acme-ask" });
    expect(error).toEqual({
      code: "ANSWER_CONFLICT",
      message: "acme-ask is already answered used; refusing unused — a recorded answer is never replaced",
      recorded: "used",
      slug: "acme-ask",
    });
  });

  it("names the week whose sample did not draw the ask", () => {
    expect(ValueErrors.askNotSampled({ slug: "acme-ask", week: "2026-W48" })).toEqual({
      code: "ASK_NOT_SAMPLED",
      message: "acme-ask is not one of the asks the 2026-W48 sample drew",
      slug: "acme-ask",
      week: "2026-W48",
    });
  });

  it("points a week with no sample at the verb that draws one", () => {
    expect(ValueErrors.noSample({ week: "2026-W48" })).toEqual({
      code: "NO_SAMPLE",
      message: "no value sample was drawn for 2026-W48 — `slopweaver value sample` draws one",
      week: "2026-W48",
    });
  });

  it("names the file and what was wrong with it for a sample that is not one", () => {
    expect(ValueErrors.sampleInvalid({ detail: "week: required", path: "/h/value/2026-W48.json" })).toEqual({
      code: "SAMPLE_INVALID",
      message: "/h/value/2026-W48.json is not a value sample: week: required",
      path: "/h/value/2026-W48.json",
    });
  });

  it("carries a thrown Error's message for a read that failed", () => {
    const error = ValueErrors.sampleUnreadable({ cause: new Error("EACCES"), path: "/h/value/2026-W48.json" });
    expect([error.code, error.message]).toEqual([
      "SAMPLE_UNREADABLE",
      "/h/value/2026-W48.json could not be read: EACCES",
    ]);
  });

  it("carries a thrown non-Error as text for a write that failed", () => {
    const error = ValueErrors.sampleUnwritable({ cause: "disk full", path: "/h/value/2026-W48.json" });
    expect([error.code, error.message]).toEqual([
      "SAMPLE_UNWRITABLE",
      "/h/value/2026-W48.json could not be written: disk full",
    ]);
  });
});
