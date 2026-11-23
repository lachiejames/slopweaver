/*
 * `slackSendLines`: what the terminal says after a send — the created message's identity, a DEGRADED delivery
 * that lost media, and the read-back file count.
 */
import { describe, expect, it } from "vitest";

import { slackSendLines } from "../../../../../../cli/commands/slack/core.js";

describe("slackSendLines", () => {
  it("reports the created message's identity", () => {
    const lines = slackSendLines({ result: { channel: "C1", fileIds: [], missingMedia: [], ok: true, ts: "1.2" } });

    expect(lines).toEqual(["sent — channel=C1 ts=1.2"]);
  });

  it("reports a DEGRADED delivery, so a media loss is never invisible in the terminal either", () => {
    const lines = slackSendLines({
      result: {
        channel: "C1",
        fileIds: [],
        missingMedia: [{ fileId: "F1", filename: "a.png", reason: "Slack never finished processing it" }],
        ok: true,
        ts: "1.2",
      },
    });

    expect(lines[1]).toBe(
      "DEGRADED — 1 image could not be attached to this message: a.png (F1) — Slack never finished processing it",
    );
  });

  it("reports the read-back file count when media rode along", () => {
    const lines = slackSendLines({
      result: { channel: "C1", fileIds: ["F1", "F2"], missingMedia: [], ok: true, ts: "1.2" },
    });

    expect(lines[1]).toBe("media attached and read back: 2 file(s)");
  });
});
