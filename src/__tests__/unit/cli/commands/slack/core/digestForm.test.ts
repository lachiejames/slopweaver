/*
 * `parseSlackForm` over the digest form: a card derived from domain data, an unresolved owner reported rather
 * than refused, the warning that names the consequence, and violations reported against the digest's own paths.
 */
import { describe, expect, it } from "vitest";

import { parseSlackForm, unresolvedOwnerWarnings } from "../../../../../../cli/commands/slack/core.js";
import { unwrap, unwrapErr } from "../../../../../../lib/result.js";
import { slackDeliveryErrorLines } from "../../../../../../outbound/slack/deliveryErrors.js";

describe("parseSlackForm — the digest form", () => {
  const DIGEST = JSON.stringify({
    items: [
      {
        count: 706,
        owner: { ask: "can you take a look?", person: "arlo" },
        severity: "red",
        title: "NZ push-token registration",
        trend: "rising",
      },
    ],
    kind: "digest",
    label: "Knock",
    window: "24h",
  });

  it("derives a card from DOMAIN data, with no layout in the input", () => {
    const parsed = unwrap(parseSlackForm({ isKnownPerson: () => true, json: DIGEST }));

    const card = parsed.artifact;

    expect(card.kind).toBe("update");
    expect(card.kind === "update" ? card.tldr : "").toBe("Knock 24h · 1 red.");
    expect(card.kind === "update" ? card.index.length : -1).toBe(1);
  });

  it("reports an unresolved owner instead of refusing the send", () => {
    const parsed = unwrap(parseSlackForm({ isKnownPerson: () => false, json: DIGEST }));

    expect(parsed.unresolvedOwners).toEqual(["arlo"]);
  });

  it("names the consequence in the warning — that nobody was pinged", () => {
    const warnings = unresolvedOwnerWarnings({ unresolvedOwners: ["arlo"] });

    expect(warnings.length).toBe(1);
    expect(warnings[0]!).toContain("were NOT pinged");
    expect(warnings[0]!).toContain("still went out");
  });

  it("says nothing when every owner resolved", () => {
    expect(unresolvedOwnerWarnings({ unresolvedOwners: [] })).toEqual([]);
  });

  it("reports a digest-form violation against the DIGEST paths, not card paths", () => {
    const json = JSON.stringify({
      items: [{ count: 1, severity: "purple", title: "x" }],
      kind: "digest",
      label: "K",
      window: "24h",
    });

    expect(slackDeliveryErrorLines({ error: unwrapErr(parseSlackForm({ json })) }).join("\n")).toContain("severity");
  });

  it("leaves an update form's mentions alone — those still refuse later, rather than degrading here", () => {
    const json = JSON.stringify({
      detail: [{ runs: [{ person: "nobody", type: "mention" }], type: "paragraph" }],
      kind: "update",
      tldr: "A lead.",
    });
    const parsed = unwrap(parseSlackForm({ isKnownPerson: () => false, json }));

    expect(parsed.unresolvedOwners).toEqual([]);
    expect(JSON.stringify(parsed.artifact)).toContain('{"person":"nobody","type":"mention"}');
  });
});
