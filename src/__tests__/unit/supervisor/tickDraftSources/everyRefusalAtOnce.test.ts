/** Every malformed document reported at once, rather than the draft stopping at the first. */
import { describe, expect, it } from "vitest";

import { unwrapErr } from "../../../../lib/result.js";
import { draftTickSources } from "../../../../supervisor/tickDraftSources.js";
import { capacityDocument } from "../tickDraftDocumentsFixture.js";
import { CAPTURED, redirected, STARTED } from "../tickDraftSourcesFixture.js";

describe("draftTickSources — every refusal at once", () => {
  it("reports each malformed document rather than stopping at the first", () => {
    const refusal = unwrapErr(
      draftTickSources({
        capturedIso: CAPTURED,
        captures: {
          capacity: capacityDocument({ hold: "yes" }),
          friction: redirected({ path: "friction.json", value: { hasGap: "no" } }),
        },
        startedIso: STARTED,
      }),
    );

    expect(refusal[0]).toContain("--capacity capacity.json");
    expect(refusal.some((line) => line.includes("--friction friction.json"))).toBe(true);
  });
});
