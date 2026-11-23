/**
 * The `twilio` noun's manifest rows quote their usage from the leaf the commands print from, and every row is a
 * read that is not door-routed — nothing in this noun can write to Twilio.
 */
import { describe, expect, it } from "vitest";

import {
  TWILIO_MESSAGE_USAGE,
  TWILIO_MESSAGES_USAGE,
  TWILIO_VERIFY_USAGE,
} from "../../../../cli/commands/twilio/usage.js";
import { twilioManifest } from "../../../../cli/manifests/twilio.js";

describe("twilioManifest", () => {
  it("quotes each verb's usage from its leaf", () => {
    expect(twilioManifest["message"]!.meta.usage).toBe(TWILIO_MESSAGE_USAGE);
    expect(twilioManifest["messages"]!.meta.usage).toBe(TWILIO_MESSAGES_USAGE);
    expect(twilioManifest["verify"]!.meta.usage).toBe(TWILIO_VERIFY_USAGE);
  });

  it("classifies every verb as an external read, never door-routed", () => {
    const rows = Object.values(twilioManifest);
    expect(rows.length).toBe(3);
    expect(rows.map((row) => [row.meta.effect, row.meta.doorRouted])).toEqual([
      ["external-read", false],
      ["external-read", false],
      ["external-read", false],
    ]);
  });
});
