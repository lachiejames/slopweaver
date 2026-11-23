/*
 * The still-real row says what happened in the owner's terms: a card's "confirmed 2.4 days ago"
 * alone does not say who confirmed it, so the lead names who raised it and when the fleet last checked.
 */
import { describe, expect, it } from "vitest";

import { stillRealLead } from "../../lib/stillRealLead";

describe("stillRealLead", () => {
  it("names the owner's call and the check as one event when they read the same age", () => {
    const lead = stillRealLead({ checkedAge: "2.4d ago", raised: { age: "2.4d ago", where: "call" } });
    expect(lead).toBe("you raised this on a console call 2.4d ago, and the fleet checked it then");
  });

  it("names both events when the fleet checked it after the owner raised it", () => {
    const lead = stillRealLead({ checkedAge: "3.0h ago", raised: { age: "2.4d ago", where: "console-voice" } });
    expect(lead).toBe("you raised this to the console voice 2.4d ago; the fleet last checked it 3.0h ago");
  });

  it("says where the owner raised it in the source block's own words, for a typed turn and a session", () => {
    expect([
      stillRealLead({ checkedAge: "1m ago", raised: { age: "1m ago", where: "console-typed" } }),
      stillRealLead({ checkedAge: "1m ago", raised: { age: "1m ago", where: "session" } }),
    ]).toEqual([
      "you raised this to the console voice 1m ago, and the fleet checked it then",
      "you raised this in a Claude session 1m ago, and the fleet checked it then",
    ]);
  });

  it("says nothing records the check when only the owner's words are dated", () => {
    const lead = stillRealLead({ checkedAge: undefined, raised: { age: "2.4d ago", where: "call-landing" } });
    expect(lead).toBe("you raised this on a console call 2.4d ago; nothing records when the fleet last checked it");
  });

  it("names the check alone for a card that carries no words of the owner's", () => {
    expect(stillRealLead({ checkedAge: "5m ago", raised: undefined })).toBe("the fleet last checked this 5m ago");
  });

  it("says nothing records either when neither is dated", () => {
    expect(stillRealLead({ checkedAge: undefined, raised: undefined })).toBe(
      "nothing records when the fleet last checked this",
    );
  });
});
