/**
 * The audit verb's refuse-or-report decision.
 *
 * The case that matters most here is the one that used to pass silently: a FAILED read must not produce the
 * same answer as an empty corpus. Both are "no records" to a careless caller, and only one of them is true.
 */
import { describe, expect, it } from "vitest";

import { auditableFrom } from "../../../audit/auditCore.js";
import { err, ok } from "../../../lib/result.js";

describe("auditableFrom", () => {
  it("REFUSES a failed read rather than reporting it as an empty corpus", () => {
    const verdict = auditableFrom({
      read: err({ message: "corpus at /x/bronze is too large for this process's heap ceiling" }),
    });

    expect("refusal" in verdict).toBe(true);
    const refusal = "refusal" in verdict ? verdict.refusal : "";
    expect(refusal).toContain("refusing to audit: the corpus could not be read");
    expect(refusal).toContain('zeros here would read as "your world model is empty"');
    expect(refusal).toContain("too large for this process's heap ceiling");
  });

  it("reports zeros for a genuinely EMPTY corpus, which is a true answer", () => {
    const verdict = auditableFrom({ read: ok({ records: [], unreadable: [] }) });

    expect("auditable" in verdict).toBe(true);
    expect("auditable" in verdict ? verdict.auditable.records : ["not empty"]).toEqual([]);
  });

  it("refuses a partial read, naming how many paths were unreadable", () => {
    const verdict = auditableFrom({
      read: ok({ records: [], unreadable: ["/x/bronze/slack/w1.jsonl", "/x/bronze/slack/w2.jsonl"] }),
    });

    const refusal = "refusal" in verdict ? verdict.refusal : "";
    expect(refusal).toContain("2 corpus path(s) could not be read");
    expect(refusal).toContain("/x/bronze/slack/w1.jsonl");
  });

  it("passes the read straight through on a clean read", () => {
    const records = [{ sourceId: "m1" }, { sourceId: "m2" }] as never;
    const verdict = auditableFrom({ read: ok({ records, unreadable: [] }) });

    expect("auditable" in verdict ? verdict.auditable.records : []).toHaveLength(2);
  });
});
