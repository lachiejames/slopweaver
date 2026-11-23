/*
 * `resolveSlackWriteToken`: the as-me lane takes the USER token, names the secret when it is absent, and refuses
 * a token of the wrong kind for either actor rather than posting under the wrong identity.
 */
import { describe, expect, it } from "vitest";

import { resolveSlackWriteToken } from "../../../../../../cli/commands/slack/writeToken.js";
import { unwrap, unwrapErr } from "../../../../../../lib/result.js";
import { SlackDeliveryErrors, slackDeliveryErrorLines } from "../../../../../../outbound/slack/deliveryErrors.js";

describe("resolveSlackWriteToken — the as-me lane is routed, not refused", () => {
  it("returns the USER token for --as me", () => {
    const token = resolveSlackWriteToken({ actor: "me", botToken: "xoxb-b", userToken: "xoxp-u" });

    expect(unwrap(token)).toBe("xoxp-u");
  });

  it("names the user-token secret when it is absent", () => {
    expect(unwrapErr(resolveSlackWriteToken({ actor: "me", botToken: "xoxb-b", userToken: undefined }))).toEqual(
      SlackDeliveryErrors.tokenAbsent({ actor: "me" }),
    );
    const errors = slackDeliveryErrorLines({
      error: unwrapErr(resolveSlackWriteToken({ actor: "me", botToken: "xoxb-b", userToken: undefined })),
    });

    expect(errors[0]).toContain("slopweaver secrets set slack-user-token");
  });

  it("REFUSES a bot token for --as me rather than posting under the wrong identity", () => {
    expect(unwrapErr(resolveSlackWriteToken({ actor: "me", botToken: "xoxb-b", userToken: "xoxb-b" }))).toEqual(
      SlackDeliveryErrors.tokenWrongKind({ actor: "me" }),
    );
    const errors = slackDeliveryErrorLines({
      error: unwrapErr(resolveSlackWriteToken({ actor: "me", botToken: "xoxb-b", userToken: "xoxb-b" })),
    });

    expect(errors[0]).toContain("cannot post under your name");
  });

  it("still refuses a user token for --as bot", () => {
    expect(unwrapErr(resolveSlackWriteToken({ actor: "bot", botToken: "xoxp-u", userToken: "xoxp-u" }))).toEqual(
      SlackDeliveryErrors.tokenWrongKind({ actor: "bot" }),
    );
    const errors = slackDeliveryErrorLines({
      error: unwrapErr(resolveSlackWriteToken({ actor: "bot", botToken: "xoxp-u", userToken: "xoxp-u" })),
    });

    expect(errors[0]).toContain("requires a bot token");
  });
});
