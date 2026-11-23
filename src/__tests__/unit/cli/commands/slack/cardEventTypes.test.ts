import { describe, expect, it } from "vitest";

import { cardEventTypes } from "../../../../../cli/commands/slack/lifecycleCore.js";

/**
 * The migration guarantee. The ownership guard recognises its own cards BY `metadata.event_type`, so renaming
 * the configured type — which an operator does to keep this tool's name out of a message their team reads —
 * must not strand every card already posted under the stock name.
 */
describe("cardEventTypes", () => {
  it("accepts the configured type AND the stock one, so a rename strands nothing", () => {
    const types = cardEventTypes({
      configuredEventType: "acme_bot_card_v1",
      stockEventType: "slopweaver_card_v1",
    });

    expect(types).toEqual(["acme_bot_card_v1", "slopweaver_card_v1"]);
  });

  it("collapses to ONE type on an unconfigured profile, rather than listing a duplicate", () => {
    const types = cardEventTypes({
      configuredEventType: "slopweaver_card_v1",
      stockEventType: "slopweaver_card_v1",
    });

    expect(types).toEqual(["slopweaver_card_v1"]);
  });

  it("puts the configured type first, so the common case matches on the first comparison", () => {
    const types = cardEventTypes({ configuredEventType: "a", stockEventType: "b" });

    expect(types[0]).toBe("a");
  });
});
