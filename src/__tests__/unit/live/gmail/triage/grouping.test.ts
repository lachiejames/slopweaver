/*
 * `gmail triage` grouping an inbox by sender: largest group first, unread counts and date spans, a message with no
 * From held apart, the subject sample, when a group is a person's, and what a rule may cover.
 */
import { describe, expect, it } from "vitest";

import {
  buildGmailTriage,
  GMAIL_TRIAGE_SCHEMA_VERSION,
  TRIAGE_SAMPLE_SUBJECTS,
} from "../../../../../live/gmail/triage.js";
import { EVERY_LANE_POLICY, message, READ_AT } from "./harness.js";

describe("buildGmailTriage", () => {
  const inbox = [
    message({ atIso: "2026-09-28T10:00:00.000Z", from: "Jane <jane@example.test>", id: "j-1", subject: "hello" }),
    message({ atIso: "2026-09-29T10:00:00.000Z", from: "Bot <no-reply@example.test>", id: "b-1", unread: true }),
    message({ atIso: "2026-09-27T10:00:00.000Z", from: "Bot <no-reply@example.test>", id: "b-2" }),
    message({ atIso: undefined, from: "Bot <no-reply@example.test>", id: "b-3", unread: true }),
    message({ atIso: READ_AT, from: undefined, id: "x-1" }),
  ];
  const document = buildGmailTriage({
    account: "owner@example.test",
    complete: true,
    inviteFileIds: new Set<string>(),
    repliedThreadIds: new Set<string>(),
    inboxEstimate: 5,
    policy: EVERY_LANE_POLICY,
    messages: inbox,
    readAtIso: READ_AT,
  });

  it("puts the largest group first, newest message first within it, an undated one last", () => {
    expect(document.groups.map((group) => group.key)).toEqual(["from:no-reply@example.test", "from:jane@example.test"]);
    expect(document.groups[0]!.entries.map((entry) => entry.id)).toEqual(["b-1", "b-2", "b-3"]);
  });

  it("counts unread and spans the dated messages only", () => {
    const bot = document.groups[0]!;
    expect(bot.unread).toBe(2);
    expect([bot.oldestIso, bot.newestIso]).toEqual(["2026-09-27T10:00:00.000Z", "2026-09-29T10:00:00.000Z"]);
    expect(bot.automated).toBe(true);
  });

  it("holds a message with no From apart, by id, rather than dropping it", () => {
    expect(document.unkeyed).toEqual(["x-1"]);
    expect(document.messagesRead).toBe(5);
    expect(document.schemaVersion).toBe(GMAIL_TRIAGE_SCHEMA_VERSION);
  });

  it("samples at most the declared number of distinct subjects", () => {
    const many = Array.from({ length: 5 }, (_unused, index) =>
      message({
        atIso: `2026-09-2${String(index)}T00:00:00.000Z`,
        from: "a@example.test",
        id: `m-${String(index)}`,
        subject: `s${String(index)}`,
      }),
    );
    const built = buildGmailTriage({
      account: "owner@example.test",
      complete: true,
      inviteFileIds: new Set<string>(),
      repliedThreadIds: new Set<string>(),
      inboxEstimate: undefined,
      policy: EVERY_LANE_POLICY,
      messages: many,
      readAtIso: READ_AT,
    });
    expect(built.groups[0]!.subjects).toEqual(["s4", "s3", "s2"]);
    expect(built.groups[0]!.subjects.length).toBe(TRIAGE_SAMPLE_SUBJECTS);
  });

  it("makes a group a person's when ONE of its messages was written by her, list posts beside it or not", () => {
    const listed = [{ name: "List-Id", value: "<team.example.test>" }];
    const mixed = buildGmailTriage({
      account: "owner@example.test",
      complete: true,
      inviteFileIds: new Set<string>(),
      repliedThreadIds: new Set<string>(),
      inboxEstimate: undefined,
      policy: EVERY_LANE_POLICY,
      messages: [
        message({ atIso: "2026-09-29T10:00:00.000Z", extra: listed, from: "jane@example.test", id: "list-post" }),
        message({ atIso: "2026-09-28T10:00:00.000Z", from: "jane@example.test", id: "direct" }),
      ],
      readAtIso: READ_AT,
    });
    expect(mixed.groups.map((group) => [group.key, group.automated])).toEqual([["from:jane@example.test", false]]);
  });

  it("lets a rule cover a sender's list mail, never a colleague's nor a discussion list's, though all are automated", () => {
    const unsubscribe = { name: "List-Unsubscribe", value: "<https://news.example.test/u>" };
    const ruled = buildGmailTriage({
      account: "Owner@Example.test",
      complete: true,
      inviteFileIds: new Set<string>(),
      repliedThreadIds: new Set<string>(),
      inboxEstimate: undefined,
      policy: EVERY_LANE_POLICY,
      messages: [
        message({ atIso: READ_AT, extra: [unsubscribe], from: "news@vendor.example", id: "newsletter" }),
        message({
          atIso: READ_AT,
          extra: [unsubscribe, { name: "List-Post", value: "NO (posting not allowed on this list)" }],
          from: "digest@vendor.example",
          id: "announce-only",
        }),
        message({
          atIso: READ_AT,
          extra: [{ name: "List-Id", value: "<team.example.test>" }],
          from: "jane@example.test",
          id: "colleague-group-post",
        }),
        message({
          atIso: READ_AT,
          extra: [
            { name: "List-Id", value: "<users.oss.example>" },
            { name: "List-Post", value: "<mailto:users@oss.example>" },
          ],
          from: "seth@elsewhere.example",
          id: "discussion-post",
        }),
      ],
      readAtIso: READ_AT,
    });
    expect(
      ruled.groups
        .map((group) => [group.key, group.automated, group.ruleable])
        .toSorted(([left], [right]) => String(left).localeCompare(String(right))),
    ).toEqual([
      ["from:digest@vendor.example", true, true],
      ["from:jane@example.test", true, false],
      ["from:news@vendor.example", true, true],
      ["from:seth@elsewhere.example", true, false],
    ]);
  });

  it("reads an empty inbox as no groups", () => {
    const empty = buildGmailTriage({
      account: "owner@example.test",
      complete: true,
      inviteFileIds: new Set<string>(),
      repliedThreadIds: new Set<string>(),
      inboxEstimate: 0,
      policy: EVERY_LANE_POLICY,
      messages: [],
      readAtIso: READ_AT,
    });
    expect([empty.groups, empty.unkeyed, empty.fathom, empty.meetingNotes]).toEqual([[], [], [], []]);
  });
});
