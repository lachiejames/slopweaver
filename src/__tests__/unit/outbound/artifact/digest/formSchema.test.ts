import { describe, expect, it } from "vitest";
import { z } from "zod";

import { digestFormSchema } from "../../../../../outbound/artifact/digest.js";
import { DIGEST_LEAD_VISIBLE_MAX } from "../../../../../outbound/artifact/digestFields.js";
import { TABLE_MAX_ROWS } from "../../../../../outbound/artifact/schema.js";
import { knockForm } from "./harness.js";

describe("digestFormSchema — facts are required, layout is unexpressible", () => {
  it("accepts the real digest", () => {
    expect(digestFormSchema.safeParse(knockForm()).success).toBe(true);
  });

  it("rejects an unknown severity rather than defaulting it", () => {
    const form = { ...knockForm(), items: [{ count: 1, severity: "purple", title: "x" }] };

    expect(digestFormSchema.safeParse(form).success).toBe(false);
  });

  it("rejects an empty digest — there is nothing to report", () => {
    expect(digestFormSchema.safeParse({ ...knockForm(), items: [] }).success).toBe(false);
  });

  it("rejects more items than the table can hold", () => {
    const items = Array.from({ length: TABLE_MAX_ROWS + 1 }, () => ({
      count: 1,
      severity: "green" as const,
      title: "x",
    }));

    expect(digestFormSchema.safeParse({ ...knockForm(), items }).success).toBe(false);
  });

  it("rejects a lead past its cap, which is what keeps the derived TL;DR provably in bounds", () => {
    const form = { ...knockForm(), lead: "z".repeat(DIGEST_LEAD_VISIBLE_MAX + 1) };

    expect(digestFormSchema.safeParse(form).success).toBe(false);
  });

  it("REFUSES an attempt to smuggle layout in, rather than dropping it silently", () => {
    // This test used to assert the opposite — that `index` was accepted and stripped — and that behaviour is the
    // bug this change removes. Someone who hand-writes an `index` believes they decided the layout; being told
    // nothing and getting a derived one is worse than being told the field does not exist.
    const parsed = digestFormSchema.safeParse({ ...knockForm(), index: [[{ text: "hand-written", type: "text" }]] });

    expect(parsed.success).toBe(false);
    expect(z.prettifyError(parsed.error!)).toContain('unknown field "index"');
  });
});
