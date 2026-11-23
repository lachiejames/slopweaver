import { describe, expect, it } from "vitest";
import { preApprovedStopLine, preApprovedStopOf } from "../../../handover/preApprovedStop.js";

/**
 * The real shape of the stop this rule exists for: the failed-turn card's own bronze pull request said gold
 * "needs a recorded integration cassette, which posts to Slack for real", and the run then parked instead of
 * recording one.
 */
const REAL_STOP =
  "Gold needs a recorded integration cassette, which posts to Slack for real. Do I have permission to record it?";

describe("preApprovedStopOf", () => {
  it("matches the real stop that produced this rule", () => {
    expect(preApprovedStopOf({ question: REAL_STOP })!.id).toBe("cassette-recording");
  });

  it("names the ruling's canon section so the reader can go and read it", () => {
    expect(preApprovedStopOf({ question: REAL_STOP })!.canon).toBe(
      ".claude/rules/testing.md § Recording a cassette is pre-approved",
    );
  });

  it("matches on `cassette` with no lane word beside it", () => {
    expect(preApprovedStopOf({ question: "Should I record the Linear write cassette?" })!.id).toBe(
      "cassette-recording",
    );
  });

  it("matches `re-record` written with the hyphen", () => {
    expect(preApprovedStopOf({ question: "Is it ok to re-record the integration suite?" })!.id).toBe(
      "cassette-recording",
    );
  });

  it("matches a bare `recording` when a lane word stands beside it", () => {
    expect(preApprovedStopOf({ question: "May I go ahead with recording the live integration tests?" })!.id).toBe(
      "cassette-recording",
    );
  });

  it("is case-insensitive", () => {
    expect(preApprovedStopOf({ question: "SHOULD I RECORD THE CASSETTE?" })!.id).toBe("cassette-recording");
  });

  it("does not match a bare `record` with no lane word — the false positive that would switch this off", () => {
    expect(preApprovedStopOf({ question: "Should I record the owner's ruling on this row before landing?" })).toBe(
      undefined,
    );
  });

  it("does not match a cassette question that asks nothing", () => {
    expect(preApprovedStopOf({ question: "Which provider cassette covers the canvas write path?" })).toBe(undefined);
  });

  it("does not match a permission ask about something else entirely", () => {
    expect(preApprovedStopOf({ question: "Should I merge this into main before the owner has read it?" })).toBe(
      undefined,
    );
  });

  it("returns nothing for an empty question", () => {
    expect(preApprovedStopOf({ question: "" })).toBe(undefined);
  });
});

describe("preApprovedStopLine", () => {
  it("leads with the violation, names why it needs nobody's word, and points at the canon", () => {
    const line = preApprovedStopLine({ stop: preApprovedStopOf({ question: REAL_STOP })! });
    expect(
      line.startsWith("DOCTRINE VIOLATION — this run stopped to ask permission for something already granted"),
    ).toBe(true);
    expect(line).toContain("ALWAYS greenlit (owner ruling)");
    expect(line).toContain("cleanup, not permission");
    expect(line).toContain(".claude/rules/testing.md § Recording a cassette is pre-approved");
  });

  it("names every self-addressed target the ruling blessed, so the reader need not go and look them up", () => {
    const line = preApprovedStopLine({ stop: preApprovedStopOf({ question: REAL_STOP })! });
    expect(line).toContain("the bot's own DM");
    expect(line).toContain("the owner's own mailbox");
    expect(line).toContain("a throwaway Linear issue");
    expect(line).toContain("a private Notion page");
  });
});
