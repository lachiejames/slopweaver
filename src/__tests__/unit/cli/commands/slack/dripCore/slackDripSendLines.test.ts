/*
 * `slackDripSendLines`: a complete drip reported complete, the files attached per message, exactly which messages
 * landed and which did not, a safe re-run after a plain failure, both ways forward on an unconfirmed message, and
 * a skipped message never reposted.
 */
import { describe, expect, it } from "vitest";

import { slackDripSendLines } from "../../../../../../cli/commands/slack/dripSendLines.js";

describe("slackDripSendLines", () => {
  it("reports a complete drip as complete", () => {
    const lines = slackDripSendLines({
      channel: "C1",
      outcomes: [
        { fileIds: [], index: 0, state: "sent", ts: "1.1" },
        { fileIds: [], index: 1, state: "sent", ts: "1.2" },
      ],
    });

    expect(lines[0]).toBe("drip complete — channel=C1, 2 sent, 0 already there");
  });

  it("reads a null permalink and a null placement off a JSON outcome as absent, the way the pre-split line did", () => {
    const lines = slackDripSendLines({
      channel: "C1",
      outcomes: JSON.parse(
        '[{"fileIds":[],"index":0,"state":"sent","ts":"1.1","permalink":null,"placement":null}]',
      ) as Parameters<typeof slackDripSendLines>[0]["outcomes"],
    });

    expect(lines).toEqual([
      "drip complete — channel=C1, 1 sent, 0 already there",
      "  1. sent — ts=1.1, render NOT CHECKED (the read-back could not answer)",
    ]);
  });

  it("states how many files were attached and read back on the message that carried them", () => {
    const lines = slackDripSendLines({
      channel: "C1",
      outcomes: [
        { fileIds: [], index: 0, state: "sent", ts: "1.1" },
        { fileIds: ["F1", "F2"], index: 1, state: "sent", ts: "1.2" },
      ],
    });

    expect(lines[1]).toBe("  1. sent — ts=1.1, render NOT CHECKED (the read-back could not answer)");
    expect(lines[2]).toBe(
      "  2. sent — ts=1.2, 2 file(s) attached and read back, render NOT CHECKED (the read-back could not answer)",
    );
  });

  it("names exactly which messages landed and which did not", () => {
    const lines = slackDripSendLines({
      channel: "C1",
      outcomes: [
        { fileIds: [], index: 0, state: "sent", ts: "1.1" },
        { error: "slack said no", index: 1, state: "failed" },
        { index: 2, reason: "earlier-failure", state: "not-attempted" },
      ],
    });

    expect(lines[0]).toContain("drip INCOMPLETE");
    expect(lines[1]).toBe("  1. sent — ts=1.1, render NOT CHECKED (the read-back could not answer)");
    expect(lines[2]).toBe("  2. FAILED — slack said no");
    expect(lines[3]).toBe("  3. not attempted — the drip stopped at the failure above");
  });

  it("tells the operator a re-run is safe after a plain failure", () => {
    const lines = slackDripSendLines({ channel: "C1", outcomes: [{ error: "x", index: 0, state: "failed" }] });

    expect(lines.some((line) => line.includes("already landed are recorded and skipped"))).toBe(true);
  });

  it("refuses to guess about an unconfirmed message, and offers BOTH ways forward", () => {
    const lines = slackDripSendLines({
      channel: "C1",
      outcomes: [{ index: 0, reservedIso: "2026-07-26T09:00:00.000Z", state: "unconfirmed" }],
    });

    expect(lines.some((line) => line.includes("message 1 is UNRESOLVED"))).toBe(true);
    expect(lines.some((line) => line.includes("it IS there"))).toBe(true);
    expect(lines.some((line) => line.includes("--resend-unconfirmed"))).toBe(true);
  });

  it("says a skipped message was NOT reposted", () => {
    const lines = slackDripSendLines({ channel: "C1", outcomes: [{ index: 0, state: "already-sent", ts: "1.9" }] });

    expect(lines[1]).toBe("  1. already sent by an earlier run — ts=1.9 (not reposted)");
  });
});
