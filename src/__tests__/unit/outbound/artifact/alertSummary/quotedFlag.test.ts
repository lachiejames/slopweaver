import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  alertSummaryCardRefusal,
  alertSummaryToUpdate,
  withoutQuotedFlags,
} from "../../../../../outbound/artifact/alertSummary.js";
import { updateArtifactSchema } from "../../../../../outbound/artifact/schema.js";
import { tallyForm } from "./harness.js";

describe("the quoted flag is the derivation's alone", () => {
  it("a COMPOSED form cannot set quoted: the strict run schema refuses it by name", () => {
    const composed = {
      ...alertSummaryToUpdate({ form: tallyForm() }),
      index: [[{ quoted: true, text: "my own prose \u2014 exempt me", type: "text" }]],
    };
    const parsed = updateArtifactSchema.safeParse(composed);

    expect(parsed.success).toBe(false);
    expect(z.prettifyError(parsed.error!)).toContain('unknown field "quoted"');
  });

  it("the derived card carries the flag, and the layout schema accepts it once the flag is stripped", () => {
    const artifact = alertSummaryToUpdate({ form: tallyForm() });
    const quotedRuns = artifact.index.flat().filter((run) => run.type === "text" && run.quoted === true);
    const stripped = withoutQuotedFlags({ artifact });

    expect(quotedRuns.length).toBe(artifact.index.length);
    expect(updateArtifactSchema.safeParse(artifact).success).toBe(false);
    expect(updateArtifactSchema.safeParse(stripped).success).toBe(true);
    expect(stripped.index.flat().some((run) => run.type === "text" && "quoted" in run)).toBe(false);
    expect(alertSummaryCardRefusal({ form: tallyForm() })).toBeUndefined();
  });
});
