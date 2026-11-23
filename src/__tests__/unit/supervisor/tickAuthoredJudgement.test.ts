/**
 * The judgement shape the chair authors in `tick.json`: the ledger's own less `recordedIso`, which `tick close`
 * stamps — so a draft without one parses, and a draft carrying one is refused as an unknown key.
 */
import { describe, expect, it } from "vitest";

import { authoredJudgementSchema } from "../../../supervisor/tickAuthoredJudgement.js";
import { judgementSchema } from "../../../supervisor/tickSchema.js";

/** One judgement exactly as the chair writes it. */
const drafted = {
  claim: "waits on Smith's review",
  judgementId: "j-1",
  kind: "hold-rationale",
  subject: { id: "land-2173", kind: "handover", label: "land-2173" },
  whyNotDerived: "risk-call",
  witness: { kind: "command", ref: "slopweaver handover list" },
};

describe("authoredJudgementSchema", () => {
  it("accepts a drafted judgement the ledger row schema refuses for its missing recordedIso", () => {
    expect([authoredJudgementSchema.safeParse(drafted).success, judgementSchema.safeParse(drafted).success]).toEqual([
      true,
      false,
    ]);
  });

  it("refuses a drafted judgement carrying recordedIso, the instant tick close stamps", () => {
    const stamped = authoredJudgementSchema.safeParse({ ...drafted, recordedIso: "2026-10-13T00:00:00.000Z" });

    expect(stamped.error!.issues.map((issue) => issue.code)).toEqual(["unrecognized_keys"]);
  });
});
