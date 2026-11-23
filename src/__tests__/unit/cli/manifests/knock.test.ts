/**
 * The `knock` noun's manifest rows quote their usage from the leaf the commands print from, and every row is a
 * read that is not door-routed — nothing in this noun can write to Knock.
 */
import { describe, expect, it } from "vitest";

import {
  KNOCK_DELIVERY_LOGS_USAGE,
  KNOCK_MESSAGE_EVENTS_USAGE,
  KNOCK_MESSAGE_USAGE,
  KNOCK_MESSAGES_USAGE,
  KNOCK_USER_MESSAGES_USAGE,
  KNOCK_VERIFY_USAGE,
} from "../../../../cli/commands/knock/usage.js";
import { knockManifest } from "../../../../cli/manifests/knock.js";

describe("knockManifest", () => {
  it("quotes each verb's usage from its leaf", () => {
    expect(knockManifest["delivery-logs"]!.meta.usage).toBe(KNOCK_DELIVERY_LOGS_USAGE);
    expect(knockManifest["message"]!.meta.usage).toBe(KNOCK_MESSAGE_USAGE);
    expect(knockManifest["message-events"]!.meta.usage).toBe(KNOCK_MESSAGE_EVENTS_USAGE);
    expect(knockManifest["messages"]!.meta.usage).toBe(KNOCK_MESSAGES_USAGE);
    expect(knockManifest["user-messages"]!.meta.usage).toBe(KNOCK_USER_MESSAGES_USAGE);
    expect(knockManifest["verify"]!.meta.usage).toBe(KNOCK_VERIFY_USAGE);
  });

  it("classifies every verb as an external read, never door-routed", () => {
    const rows = Object.values(knockManifest);
    expect(rows.length).toBe(6);
    expect(rows.filter((row) => row.meta.effect !== "external-read" || row.meta.doorRouted)).toEqual([]);
  });
});
