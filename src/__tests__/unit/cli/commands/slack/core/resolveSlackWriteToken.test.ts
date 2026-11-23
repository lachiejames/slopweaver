/*
 * `resolveSlackWriteToken`: the as-bot token, what to set when it is missing, and the refusal of a token whose
 * prefix says it belongs to a user.
 */
import { describe, expect, it } from "vitest";

import { resolveSlackWriteToken } from "../../../../../../cli/commands/slack/core.js";
import { unwrap, unwrapErr } from "../../../../../../lib/result.js";
import { SlackDeliveryErrors } from "../../../../../../outbound/slack/deliveryErrors.js";

describe("resolveSlackWriteToken", () => {
  it("returns a bot token for as-bot", () => {
    expect(unwrap(resolveSlackWriteToken({ actor: "bot", botToken: "xoxb-abc", userToken: undefined }))).toBe(
      "xoxb-abc",
    );
  });

  it("names exactly what to set when the token is missing", () => {
    const result = resolveSlackWriteToken({ actor: "bot", botToken: undefined, userToken: undefined });

    expect(unwrapErr(result)).toEqual(SlackDeliveryErrors.tokenAbsent({ actor: "bot" }));
    expect(unwrapErr(result).message).toContain("slopweaver secrets set slack-bot-token");
  });

  it("REFUSES a token whose prefix says it is a user token", () => {
    const result = resolveSlackWriteToken({ actor: "bot", botToken: "xoxp-abc", userToken: undefined });

    expect(unwrapErr(result)).toEqual(SlackDeliveryErrors.tokenWrongKind({ actor: "bot" }));
    expect(unwrapErr(result).message).toContain("refusing to post under an identity you did not ask for");
  });
});
