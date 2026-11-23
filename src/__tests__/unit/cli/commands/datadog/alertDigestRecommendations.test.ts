/** The recommendation lane of `datadog alert-digest`: with nothing authored, it leaves the form exactly as built. */
import { describe, expect, it } from "vitest";

import { selectDigestRecommendations } from "../../../../../cli/commands/datadog/alertDigestRecommendations.js";
import type { DigestForm } from "../../../../../outbound/artifact/digestFields.js";

const FORM: DigestForm = {
  items: [{ count: 4, severity: "red", title: "NZ push-token registration" }],
  kind: "digest",
  label: "Knock",
  window: "24h",
};

describe("selectDigestRecommendations", () => {
  it("keeps the built form and its warnings, and selects nothing, when no recommendation is authored", () => {
    const outcome = selectDigestRecommendations({
      built: { form: FORM, warnings: ["the lead was dropped"] },
      readings: [],
      recommendations: [],
    });
    expect(outcome).toEqual({
      form: FORM,
      recommendations: { dropped: [], kept: [] },
      warnings: ["the lead was dropped"],
    });
  });
});
