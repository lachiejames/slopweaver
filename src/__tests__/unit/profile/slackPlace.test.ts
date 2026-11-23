/**
 * Whether one of the owner's turns is placed on Slack: a message word, the bot by role, or the bot by one of the install's
 * own handles.
 */
import { describe, expect, it } from "vitest";

import { placesOnSlack } from "../../../profile/slackPlace.js";

/** The install's own bot handles in these tests. */
const OWN = ["acme-bot", "zoë-bot"];

describe("placesOnSlack", () => {
  it("places a turn by a message word", () => {
    expect(placesOnSlack({ botHandles: OWN, text: "that draft is too long" })).toBe(true);
    expect(placesOnSlack({ botHandles: OWN, text: "the reply was sent twice" })).toBe(true);
    expect(placesOnSlack({ botHandles: OWN, text: "the build is too long" })).toBe(false);
  });

  it("places a turn by the bot's role, never by a word merely ending in bot", () => {
    expect(placesOnSlack({ botHandles: [], text: "the bot is too verbose" })).toBe(true);
    expect(placesOnSlack({ botHandles: [], text: "too verbose, the bot." })).toBe(true);
    expect(placesOnSlack({ botHandles: OWN, text: "the robot is too verbose" })).toBe(false);
    expect(placesOnSlack({ botHandles: OWN, text: "The GitHub Actions bot is too verbose." })).toBe(false);
    expect(placesOnSlack({ botHandles: OWN, text: "the bot-helper service is too verbose" })).toBe(false);
  });

  it("places a turn by one of the install's own handles, whatever surrounds it", () => {
    expect(placesOnSlack({ botHandles: OWN, text: "acme-bot is too verbose" })).toBe(true);
    expect(placesOnSlack({ botHandles: OWN, text: "@acme-bot is too verbose" })).toBe(true);
    expect(placesOnSlack({ botHandles: OWN, text: "too verbose, acme-bot." })).toBe(true);
    expect(placesOnSlack({ botHandles: OWN, text: "acme-bot's answers are too verbose" })).toBe(true);
    expect(placesOnSlack({ botHandles: OWN, text: "(@acme-bot) too verbose" })).toBe(true);
    expect(placesOnSlack({ botHandles: OWN, text: "[acme-bot] is too verbose" })).toBe(true);
    expect(placesOnSlack({ botHandles: OWN, text: "too verbose: *acme-bot's*." })).toBe(true);
    expect(placesOnSlack({ botHandles: OWN, text: "ACME-BOT’S answer is too verbose" })).toBe(true);
    expect(placesOnSlack({ botHandles: OWN, text: "acme-bot,acme-api: too verbose" })).toBe(true);
    expect(placesOnSlack({ botHandles: OWN, text: "acme-bot/acme-api too verbose" })).toBe(true);
    expect(placesOnSlack({ botHandles: OWN, text: "zoë-bot is too verbose" })).toBe(true);
    expect(placesOnSlack({ botHandles: ["@Acme-Bot"], text: "acme-bot is too verbose" })).toBe(true);
  });

  it("refuses a `-bot` handle the install never declared as its own", () => {
    expect(placesOnSlack({ botHandles: OWN, text: "github-bot is too verbose" })).toBe(false);
    expect(placesOnSlack({ botHandles: [], text: "acme-bot is too verbose" })).toBe(false);
    expect(placesOnSlack({ botHandles: OWN, text: "@ops_team.acme-bot is too verbose" })).toBe(false);
  });

  it("refuses a handle that carries on past the bot's own", () => {
    expect(placesOnSlack({ botHandles: OWN, text: "@acme-bot-helper is too verbose" })).toBe(false);
    expect(placesOnSlack({ botHandles: OWN, text: "@acme-bot.prod is too verbose" })).toBe(false);
  });
});
