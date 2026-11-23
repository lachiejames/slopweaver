/**
 * The `slack` delivery refusals: each factory raises the exact value a send lane used to author as a string,
 * and the lines helper prints a list-carrying refusal one problem per line and every other as its message.
 */
import { describe, expect, it } from "vitest";

import { SlackDeliveryErrors, slackDeliveryErrorLines } from "../../../../outbound/slack/deliveryErrors.js";

describe("SlackDeliveryErrors", () => {
  it("says which form was not JSON, and what the parser said", () => {
    expect(SlackDeliveryErrors.formNotJson({ reason: "Unexpected token n" })).toEqual({
      code: "FORM_NOT_JSON",
      message: "--form is not valid JSON: Unexpected token n",
      reason: "Unexpected token n",
      subject: "--form",
    });
  });

  it("reads a thrown Error's own message for the poll form", () => {
    expect(SlackDeliveryErrors.pollFormNotJson({ cause: new Error("bad token") })).toEqual({
      code: "FORM_NOT_JSON",
      message: "the poll form is not valid JSON: bad token",
      reason: "bad token",
      subject: "the poll form",
    });
  });

  it("states a thrown non-Error as text rather than dropping it", () => {
    expect(SlackDeliveryErrors.pollFormUnreadable({ cause: "EOF" })).toEqual({
      code: "FORM_UNREADABLE",
      message: "cannot read the poll form: EOF",
      reason: "EOF",
    });
  });

  it("tells a bot send with no token exactly what to set", () => {
    expect(SlackDeliveryErrors.tokenAbsent({ actor: "bot" })).toEqual({
      actor: "bot",
      code: "TOKEN_ABSENT",
      message:
        "--as bot needs a Slack bot token: run `slopweaver secrets set slack-bot-token` (or set SLACK_BOT_TOKEN), " +
        "then confirm it with `slopweaver connect slack --check`",
    });
  });

  it("refuses the other identity's token for an as-me send", () => {
    expect(SlackDeliveryErrors.tokenWrongKind({ actor: "me" }).message).toBe(
      "--as me requires a user token (`xoxp-…`), but the configured user token is not one — refusing to post " +
        "under an identity you did not ask for. A bot token cannot post under your name",
    );
  });

  it("heads a derived-card refusal with the kind and the remedy, then each violation", () => {
    const error = SlackDeliveryErrors.derivedCardInvalid({
      kind: "digest",
      remedy: "Shorten the label.",
      violations: ["tldr: too long"],
    });

    expect(error.reasons).toEqual([
      "this digest's fields are each within their own limits, but together they derive a card that is not. " +
        "Shorten the label. If nothing below matches a field you can change, that IS a slopweaver bug — please " +
        "report it with the form. Details:",
      "tldr: too long",
    ]);
  });

  it("refuses --no-picture-because on a no-fold send by name", () => {
    expect(SlackDeliveryErrors.noFoldPictureReasonRefused()).toEqual({
      code: "FLAG_REFUSED",
      flag: "--no-picture-because",
      message: "--no-picture-because answers a question a no-fold message is never asked. Remove it.",
    });
  });
});

describe("slackDeliveryErrorLines", () => {
  it("prints a schema refusal one violation per line", () => {
    const error = SlackDeliveryErrors.formInvalid({ reasons: ["tldr: Required", "detail: Required"] });

    expect(slackDeliveryErrorLines({ error })).toEqual(["tldr: Required", "detail: Required"]);
  });

  it("prints forwarded refusals one per line, in the order they were asked", () => {
    const error = SlackDeliveryErrors.upstreamRefused({ reasons: ["first", "second"] });

    expect(slackDeliveryErrorLines({ error })).toEqual(["first", "second"]);
  });

  it("prints a derived-card refusal as its header then each violation", () => {
    const error = SlackDeliveryErrors.derivedCardInvalid({ kind: "poll", remedy: "Fix it.", violations: ["a", "b"] });

    expect(slackDeliveryErrorLines({ error })).toHaveLength(3);
  });

  it("prints a single refusal as its message alone", () => {
    expect(
      slackDeliveryErrorLines({ error: SlackDeliveryErrors.pollFormUnreadable({ cause: new Error("gone") }) }),
    ).toEqual(["cannot read the poll form: gone"]);
  });
});
