/**
 * The `knock` verbs' parsers: every refusal collected before a credential or the network is touched, ids held to
 * the transport's one-path-segment rule, statuses to the ones Knock's list filters on, instants to UTC, and
 * `--limit` bounded to what one read follows.
 */
import { describe, expect, it } from "vitest";

import {
  KNOCK_DEFAULT_LIMIT,
  parseKnockMessageOptions,
  parseKnockMessagesOptions,
  parseKnockVerifyOptions,
} from "../../../../cli/commands/knock/core.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

const NO_FILTER = {
  channelId: null,
  insertedAfter: null,
  insertedBefore: null,
  source: null,
  statuses: [],
  tenant: null,
  workflowRecipientRunId: null,
  workflowRunId: null,
};

describe("parseKnockVerifyOptions", () => {
  it("reads --home and --json", () => {
    expect(unwrap(parseKnockVerifyOptions({ rest: ["--home", "/h", "--json"] }))).toEqual({ home: "/h", json: true });
  });

  it("refuses a flag it does not take", () => {
    expect(unwrapErr(parseKnockVerifyOptions({ rest: ["--status", "sent"] })).join("\n")).toContain("--status");
  });
});

describe("parseKnockMessagesOptions", () => {
  it("defaults to no filter and the stated limit", () => {
    expect(unwrap(parseKnockMessagesOptions({ rest: [], withUser: false }))).toEqual({
      filter: NO_FILTER,
      home: null,
      json: false,
      limit: KNOCK_DEFAULT_LIMIT,
      userId: null,
    });
  });

  it("reads every filter, statuses repeated in order", () => {
    expect(
      unwrap(
        parseKnockMessagesOptions({
          rest: [
            "--status",
            "undelivered",
            "--status",
            "bounced",
            "--channel-id",
            "chan-sms",
            "--source",
            "booking-reminder",
            "--tenant",
            "t-1",
            "--workflow-run-id",
            "wr-1",
            "--workflow-recipient-run-id",
            "wrr-1",
            "--inserted-after",
            "2026-10-11T00:00:00Z",
            "--inserted-before",
            "2026-10-12T00:00:00.500Z",
            "--limit",
            "200",
            "--json",
          ],
          withUser: false,
        }),
      ),
    ).toEqual({
      filter: {
        channelId: "chan-sms",
        insertedAfter: "2026-10-11T00:00:00Z",
        insertedBefore: "2026-10-12T00:00:00.500Z",
        source: "booking-reminder",
        statuses: ["undelivered", "bounced"],
        tenant: "t-1",
        workflowRecipientRunId: "wrr-1",
        workflowRunId: "wr-1",
      },
      home: null,
      json: true,
      limit: 200,
      userId: null,
    });
  });

  it("collects every refusal at once", () => {
    expect(
      unwrapErr(
        parseKnockMessagesOptions({
          rest: ["--status", "opened", "--inserted-after", "2026-10-11", "--channel-id", "a/b", "--limit", "1001"],
          withUser: false,
        }),
      ),
    ).toEqual([
      "--status must be one of queued, sent, delivered, delivery_attempted, undelivered, not_sent, bounced (got opened)",
      "--channel-id must be one id with no slash, ?, #, %, space or control character",
      "--inserted-after must be a UTC instant such as 2026-10-11T00:00:00Z",
      "--limit must be at most 1000 — narrow the window or the filters instead",
    ]);
  });

  it("refuses --user-id on the environment list", () => {
    expect(
      unwrapErr(parseKnockMessagesOptions({ rest: ["--user-id", "user_1"], withUser: false })).join("\n"),
    ).toContain("--user-id");
  });

  it("requires --user-id on the user list and reads it", () => {
    expect(unwrapErr(parseKnockMessagesOptions({ rest: [], withUser: true }))).toEqual([
      "--user-id is required: the application's own user id, as Knock was told it",
    ]);
    expect(unwrap(parseKnockMessagesOptions({ rest: ["--user-id", "user_0123"], withUser: true })).userId).toBe(
      "user_0123",
    );
  });

  it("refuses a user id that could change the route", () => {
    expect(unwrapErr(parseKnockMessagesOptions({ rest: ["--user-id", "../workflows"], withUser: true }))).toEqual([
      "--user-id must be one id with no slash, ?, #, %, space or control character",
    ]);
  });
});

describe("parseKnockMessageOptions", () => {
  it("reads --id, refusing --limit on the single read", () => {
    expect(unwrap(parseKnockMessageOptions({ rest: ["--id", "m-1"], withLimit: false }))).toEqual({
      home: null,
      json: false,
      limit: KNOCK_DEFAULT_LIMIT,
      messageId: "m-1",
    });
    expect(
      unwrapErr(parseKnockMessageOptions({ rest: ["--id", "m-1", "--limit", "5"], withLimit: false })).join("\n"),
    ).toContain("--limit");
  });

  it("reads --limit on a per-message list", () => {
    expect(unwrap(parseKnockMessageOptions({ rest: ["--id", "m-1", "--limit", "5"], withLimit: true })).limit).toBe(5);
  });

  it("requires --id and refuses one that could change the route", () => {
    expect(unwrapErr(parseKnockMessageOptions({ rest: [], withLimit: true }))).toEqual([
      "--id is required: the Knock message id from a `knock messages` row",
    ]);
    expect(unwrapErr(parseKnockMessageOptions({ rest: ["--id", "batch"], withLimit: false }))).toEqual([
      "--id must be one message id with no slash, ?, #, %, space or control character",
    ]);
  });
});
