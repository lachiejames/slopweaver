/*
 * `parseSlackForm` over an update form: a valid one accepted, malformed JSON reported without throwing, and a
 * schema violation surfaced.
 */
import { describe, expect, it } from "vitest";

import { parseSlackForm } from "../../../../../../cli/commands/slack/core.js";
import { unwrap, unwrapErr } from "../../../../../../lib/result.js";
import { slackDeliveryErrorLines } from "../../../../../../outbound/slack/deliveryErrors.js";
import { VALID_FORM } from "./harness.js";

describe("parseSlackForm", () => {
  it("accepts a valid form", () => {
    const artifact = unwrap(parseSlackForm({ json: VALID_FORM })).artifact;

    expect(artifact.kind).toBe("update");
    expect(artifact.kind === "update" ? artifact.tldr : "").toBe("A short lead.");
  });

  it("reports malformed JSON without throwing", () => {
    expect(unwrapErr(parseSlackForm({ json: "{not json" })).code).toBe("FORM_NOT_JSON");
    expect(slackDeliveryErrorLines({ error: unwrapErr(parseSlackForm({ json: "{not json" })) }).join(" ")).toContain(
      "--form is not valid JSON",
    );
  });

  it("surfaces a schema violation", () => {
    const json = JSON.stringify({ citations: [], detail: [], kind: "update", media: [], tldr: "x" });

    expect(slackDeliveryErrorLines({ error: unwrapErr(parseSlackForm({ json })) }).length).toBeGreaterThan(0);
  });
});
