/**
 * `submittedMessageConfirmsSend` — pure, so the measured cmux truncation behaviour is a plain call.
 *
 * The fixtures below are not invented: `CMUX_TRUNCATED_PICKUP` is the exact shape a real
 * `cmux workspace list --json` returned for a long pickup line — 240 characters ending in a
 * single U+2026. A test that only exercised short strings would pass while the production comparison could
 * never match anything real, which is precisely the trap this module was written to close.
 */
import { describe, expect, it } from "vitest";

import { CMUX_SUBMITTED_MESSAGE_MAX_CHARS, submittedMessageConfirmsSend } from "../../../cmux/sendEvidence.js";
import { APP_SESSION_SUBMITTED_TEXT_MAX_CHARS, boundedSubmittedText } from "../../../sessionHarness/appProtocol.js";

const PICKUP =
  "You are the visible agent picking up one dispatched recipe investigation. Run " +
  "`slopweaver automation slot-start --request /state/live/recipe/requests/" +
  "b3ceba011da4a6d707a27f1271c834c026d54f4706f4c6f1986fd91bc454c2dc-f99cc778-9863-4895-947b-e40b6301d0a2.json` " +
  "to load your claim and the resolved state home it names. Investigate as `skills/recipe-slot/SKILL.md` " +
  "describes, send your response with `slopweaver automation slot-post`.";

/** Exactly what cmux itself does to a long message: keep 239 characters, then append one `…`. */
const CMUX_TRUNCATED_PICKUP = `${PICKUP.slice(0, CMUX_SUBMITTED_MESSAGE_MAX_CHARS - 1)}…`;

describe("submittedMessageConfirmsSend", () => {
  it("confirms the app's own bounded head of a message longer than its submitted-text bound", () => {
    const sentText = `${PICKUP} ${"x".repeat(APP_SESSION_SUBMITTED_TEXT_MAX_CHARS)}`;
    const echoed = boundedSubmittedText({ text: sentText });
    expect(echoed.length).toBe(APP_SESSION_SUBMITTED_TEXT_MAX_CHARS);
    expect(submittedMessageConfirmsSend({ latestSubmittedMessage: echoed, sentText })).toBe(true);
  });

  it("confirms cmux's own 240-character truncation of a long pickup line", () => {
    expect(CMUX_TRUNCATED_PICKUP.length).toBe(CMUX_SUBMITTED_MESSAGE_MAX_CHARS);
    expect(submittedMessageConfirmsSend({ latestSubmittedMessage: CMUX_TRUNCATED_PICKUP, sentText: PICKUP })).toBe(
      true,
    );
  });

  it("confirms an untruncated message that matches whole", () => {
    expect(
      submittedMessageConfirmsSend({ latestSubmittedMessage: "slopweaver doctor", sentText: "slopweaver doctor" }),
    ).toBe(true);
  });

  it("refuses the boot line left behind when the pickup send never landed", () => {
    expect(
      submittedMessageConfirmsSend({
        latestSubmittedMessage: "claude --plugin-dir /checkout/slopweaver",
        sentText: PICKUP,
      }),
    ).toBe(false);
  });

  it("refuses a DIFFERENT generation's pickup line, which diverges inside the truncated window", () => {
    const other = PICKUP.replace("b3ceba01", "0000face");

    expect(
      submittedMessageConfirmsSend({
        latestSubmittedMessage: `${other.slice(0, CMUX_SUBMITTED_MESSAGE_MAX_CHARS - 1)}…`,
        sentText: PICKUP,
      }),
    ).toBe(false);
  });

  it("refuses a workspace that has never had a message submitted", () => {
    expect(submittedMessageConfirmsSend({ latestSubmittedMessage: undefined, sentText: PICKUP })).toBe(false);
  });

  it("refuses an empty message rather than matching every send trivially", () => {
    expect(submittedMessageConfirmsSend({ latestSubmittedMessage: "", sentText: PICKUP })).toBe(false);
    expect(submittedMessageConfirmsSend({ latestSubmittedMessage: "   ", sentText: PICKUP })).toBe(false);
    expect(submittedMessageConfirmsSend({ latestSubmittedMessage: "…", sentText: PICKUP })).toBe(false);
  });

  it("refuses a prefix too short to mean anything, even though it genuinely is a prefix", () => {
    expect(submittedMessageConfirmsSend({ latestSubmittedMessage: "You are…", sentText: PICKUP })).toBe(false);
  });

  it("survives the terminal rewrapping whitespace inside the observed message", () => {
    const rewrapped = `${PICKUP.slice(0, CMUX_SUBMITTED_MESSAGE_MAX_CHARS - 1).replace(/ /gu, "\n   ")}…`;

    expect(submittedMessageConfirmsSend({ latestSubmittedMessage: rewrapped, sentText: PICKUP })).toBe(true);
  });

  it("strips an ASCII three-dot truncation marker too", () => {
    expect(
      submittedMessageConfirmsSend({
        latestSubmittedMessage: `${PICKUP.slice(0, CMUX_SUBMITTED_MESSAGE_MAX_CHARS - 3)}...`,
        sentText: PICKUP,
      }),
    ).toBe(true);
  });

  it("refuses when the caller sent nothing at all", () => {
    expect(submittedMessageConfirmsSend({ latestSubmittedMessage: CMUX_TRUNCATED_PICKUP, sentText: "" })).toBe(false);
  });
});
