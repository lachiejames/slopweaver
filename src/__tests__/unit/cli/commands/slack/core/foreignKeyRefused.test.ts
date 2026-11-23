/*
 * `parseSlackForm` over a ported digest payload: every foreign key refused by name at both levels, the prose
 * impact refused as the wrong type, the fields that do exist named, and a typo's intended field suggested.
 */
import { describe, expect, it } from "vitest";

import { parseSlackForm } from "../../../../../../cli/commands/slack/core.js";
import { unwrapErr } from "../../../../../../lib/result.js";
import { slackDeliveryErrorLines } from "../../../../../../outbound/slack/deliveryErrors.js";

/**
 * The unknown-key REFUSAL at the CLI seam, and the break-glass for a ping that cannot resolve.
 *
 * Both were silent before. A ported payload's foreign keys were dropped by the digest form and the card posted
 * without them; an owner that did not resolve left a stderr warning and exit 0. These pin the loud versions.
 */
describe("parseSlackForm — a foreign key is REFUSED, not dropped", () => {
  const PORTED = JSON.stringify({
    citations: [{ id: "c9", label: "[9]", url: "https://example.invalid/q" }],
    items: [
      {
        count: 412,
        fixStep: "create the channels, then backfill",
        impact: "every registration has failed since the 4th",
        rootCause: "the two channels were never created",
        severity: "red",
        title: "token refresh failing",
      },
    ],
    kind: "digest",
    label: "Gateway",
    window: "24h",
  });

  it("refuses the ported payload instead of posting a card missing its point", () => {
    expect(unwrapErr(parseSlackForm({ json: PORTED })).code).toBe("FORM_INVALID");
    expect(slackDeliveryErrorLines({ error: unwrapErr(parseSlackForm({ json: PORTED })) })).toEqual([
      '✖ unknown field "citations" — REFUSED, not ignored. No field here is close to it, so it is probably a ' +
        "field from another schema.",
      "this form's fields are: alerts, intro, items, kind, label, lead, recommendations, window",
      '✖ unknown field "fixStep" — REFUSED, not ignored. No field here is close to it, so it is probably a ' +
        "field from another schema.",
      'unknown field "rootCause" — REFUSED, not ignored. No field here is close to it, so it is probably a ' +
        "field from another schema.",
      "this form's fields are: citationUrl, count, impact, owner, severity, state, substance, ticket, title, trend",
      "  → at items[0]",
      "✖ Invalid input: expected object, received string",
      "  → at items[0].impact",
    ]);
  });

  it("names every foreign key, at BOTH levels, in one parse", () => {
    const errors = slackDeliveryErrorLines({ error: unwrapErr(parseSlackForm({ json: PORTED })) }).join("\n");

    expect(errors).toContain('unknown field "citations"');
    expect(errors).toContain('unknown field "rootCause"');
    expect(errors).toContain('unknown field "fixStep"');
  });

  it("refuses the ported PROSE impact too, now that an alerts digest declares a measured one", () => {
    // `impact` is declared as two counted numbers, so the ported sentence is no longer a foreign key. It is
    // still refused rather than dropped — as the wrong type, at the item that carried it.
    const errors = slackDeliveryErrorLines({ error: unwrapErr(parseSlackForm({ json: PORTED })) }).join("\n");

    expect(errors).toContain("expected object, received string\n  → at items[0].impact");
  });

  it("tells the caller which fields DO exist, at the level that refused", () => {
    const errors = slackDeliveryErrorLines({ error: unwrapErr(parseSlackForm({ json: PORTED })) }).join("\n");

    expect(errors).toContain(
      "this form's fields are: alerts, intro, items, kind, label, lead, recommendations, window",
    );
    expect(errors).toContain(
      "this form's fields are: citationUrl, count, impact, owner, severity, state, substance, ticket, title, trend",
    );
  });

  it("suggests the field a typo meant, rather than only naming the typo", () => {
    const typo = JSON.stringify({
      items: [{ count: 1, sevrity: "red", title: "t" }],
      kind: "digest",
      label: "L",
      window: "24h",
    });

    expect(slackDeliveryErrorLines({ error: unwrapErr(parseSlackForm({ json: typo })) }).join("\n")).toContain(
      'Did you mean "severity"?',
    );
  });
});
