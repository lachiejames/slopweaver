import { describe, expect, it } from "vitest";

import { unwrap } from "../../../lib/result.js";
import { renderPrBody } from "../../../outbound/github/render.js";
import { invalidDatadogHostErrors } from "../../../prformat/invalidDatadogHost.js";
import { gatePrBody } from "../../../prformat/prBodyGate.js";
import { FIX_BODY, formOf } from "../outbound/github/fixtures.js";

/** The link the bot actually posted, but on the synthetic `ap1` site rather than the install's own. */
const OFFENDING_URL = "https://app.ap1.datadoghq.com/monitors/1000001";

describe("invalidDatadogHostErrors", () => {
  it("refuses a description linking the dead host, naming ap1.datadoghq.com", () => {
    expect(invalidDatadogHostErrors({ body: `The monitor: [1000001](${OFFENDING_URL})` })).toEqual([
      "The description links `app.ap1.datadoghq.com`, which is not a Datadog console — every link on it is dead. " +
        "Use `ap1.datadoghq.com`, or add `<!-- invalid-datadog-host-ack: <reason, 4+ words> -->` if the description has to quote it.",
    ]);
  });

  it("names each distinct dead host once", () => {
    const body = `${OFFENDING_URL} ${OFFENDING_URL} https://app.us3.datadoghq.com/logs`;
    expect(invalidDatadogHostErrors({ body }).length).toBe(2);
  });

  it("passes a description linking the real console", () => {
    expect(invalidDatadogHostErrors({ body: "https://ap1.datadoghq.com/monitors/1000001" })).toEqual([]);
  });

  it("is waived by an acknowledgement carrying a reason", () => {
    const body = `${OFFENDING_URL}\n<!-- invalid-datadog-host-ack: this PR bans the quoted host -->`;
    expect(invalidDatadogHostErrors({ body })).toEqual([]);
  });

  it("is not waived by an acknowledgement with no real reason", () => {
    expect(invalidDatadogHostErrors({ body: `${OFFENDING_URL}\n<!-- invalid-datadog-host-ack: ok -->` }).length).toBe(
      1,
    );
  });

  it("fails gatePrBody on an owned C3 description that links it", () => {
    const body = `${unwrap(renderPrBody({ form: formOf({ body: FIX_BODY }) }))}\n${OFFENDING_URL}\n`;
    expect(gatePrBody({ body, owned: true }).errors).toEqual(invalidDatadogHostErrors({ body: OFFENDING_URL }));
  });
});
