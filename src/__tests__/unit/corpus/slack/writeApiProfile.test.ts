import { describe, expect, it } from "vitest";

import { readPresence, readProfileStatus } from "../../../../corpus/slack/writeApiProfile.js";

describe("readProfileStatus", () => {
  it("reads the three status fields off a users.profile.get body", () => {
    const held = readProfileStatus({
      result: {
        ok: true,
        profile: { status_emoji: ":palm_tree:", status_expiration: 1790344800, status_text: "Public holiday" },
      },
    });
    expect(held).toEqual({ emoji: ":palm_tree:", expirationSeconds: 1790344800, text: "Public holiday" });
  });

  it("reads an absent expiry as 0 and absent text or emoji as empty — Slack's own 'none'", () => {
    expect(readProfileStatus({ result: { ok: true, profile: {} } })).toEqual({
      emoji: "",
      expirationSeconds: 0,
      text: "",
    });
  });

  it("answers undefined for a body with no profile object", () => {
    expect(readProfileStatus({ result: { ok: true } })).toBeUndefined();
    expect(readProfileStatus({ result: "profile" })).toBeUndefined();
  });
});

describe("readPresence", () => {
  it("reads a manual away", () => {
    expect(readPresence({ result: { manual_away: true, online: true, presence: "away" } })).toEqual({
      manualAway: true,
      online: true,
      presence: "away",
    });
  });

  it("reads an automatic active presence, absent flags as false", () => {
    expect(readPresence({ result: { presence: "active" } })).toEqual({
      manualAway: false,
      online: false,
      presence: "active",
    });
  });

  it("answers undefined when Slack names neither active nor away", () => {
    expect(readPresence({ result: { presence: "dnd" } })).toBeUndefined();
    expect(readPresence({ result: null })).toBeUndefined();
  });
});
