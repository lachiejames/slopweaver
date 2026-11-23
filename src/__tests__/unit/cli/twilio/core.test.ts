/**
 * The `twilio` verbs' parsers: every refusal collected before a credential or the network is touched, phone
 * numbers and dates validated to the shapes Twilio documents, and `--limit` bounded to what one read follows.
 */
import { describe, expect, it } from "vitest";

import {
  parseTwilioMessageOptions,
  parseTwilioMessagesOptions,
  parseTwilioVerifyOptions,
  TWILIO_DEFAULT_LIMIT,
} from "../../../../cli/commands/twilio/core.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

const SID = `SM${"1".repeat(32)}`;

describe("parseTwilioVerifyOptions", () => {
  it("reads --home and --json", () => {
    expect(unwrap(parseTwilioVerifyOptions({ rest: ["--home", "/h", "--json"] }))).toEqual({ home: "/h", json: true });
  });

  it("refuses an unknown flag", () => {
    expect(unwrapErr(parseTwilioVerifyOptions({ rest: ["--to", "+61400000000"] })).length).toBeGreaterThan(0);
  });
});

describe("parseTwilioMessagesOptions", () => {
  it("defaults to no filter and the stated limit", () => {
    expect(unwrap(parseTwilioMessagesOptions({ rest: [] }))).toEqual({
      filter: { from: null, sentAfter: null, sentBefore: null, to: null },
      home: null,
      json: false,
      limit: TWILIO_DEFAULT_LIMIT,
    });
  });

  it("reads every filter in the shapes Twilio documents", () => {
    expect(
      unwrap(
        parseTwilioMessagesOptions({
          rest: [
            "--to",
            "whatsapp:+61400000123",
            "--from",
            "Acme",
            "--sent-after",
            "2026-10-11",
            "--sent-before",
            "2026-10-11T23:59:59Z",
            "--limit",
            "200",
          ],
        }),
      ),
    ).toEqual({
      filter: {
        from: "Acme",
        sentAfter: "2026-10-11",
        sentBefore: "2026-10-11T23:59:59Z",
        to: "whatsapp:+61400000123",
      },
      home: null,
      json: false,
      limit: 200,
    });
  });

  it("collects every refusal at once", () => {
    expect(
      unwrapErr(
        parseTwilioMessagesOptions({
          rest: [
            "--to",
            "0400000123",
            "--from",
            "not a sender!",
            "--sent-after",
            "11/10/2026",
            "--sent-before",
            "2026-02-30T00:00:00",
            "--limit",
            "5001",
          ],
        }),
      ),
    ).toEqual([
      "--to must be an E.164 number such as +61400000000 (optionally whatsapp:+61…)",
      "--from must be an E.164 number, a short code or an alphanumeric sender id of up to 11 characters",
      "--sent-after must be a day (2026-10-11) or a UTC instant (2026-10-11T03:00:00Z)",
      "--sent-before must be a day (2026-10-11) or a UTC instant (2026-10-11T03:00:00Z)",
      "--limit must be at most 5000 — narrow the window or the number instead",
    ]);
  });

  it("refuses a limit of zero", () => {
    expect(unwrapErr(parseTwilioMessagesOptions({ rest: ["--limit", "0"] })).length).toBe(1);
  });
});

describe("parseTwilioMessageOptions", () => {
  it("reads a message SID", () => {
    expect(unwrap(parseTwilioMessageOptions({ rest: ["--sid", SID, "--json"] }))).toEqual({
      home: null,
      json: true,
      sid: SID,
    });
  });

  it("refuses a missing --sid, saying where one comes from", () => {
    expect(unwrapErr(parseTwilioMessageOptions({ rest: [] }))).toEqual([
      "--sid is required: the message SID (SM… or MM…) from a `twilio messages` row",
    ]);
  });

  it("refuses a value that is not a message SID", () => {
    expect(unwrapErr(parseTwilioMessageOptions({ rest: ["--sid", "CA123"] }))).toEqual([
      "--sid must be a message SID: SM or MM followed by 32 lower-case hex characters",
    ]);
  });
});
