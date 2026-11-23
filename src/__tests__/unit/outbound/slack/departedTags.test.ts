import { describe, expect, it } from "vitest";

import { departedTagRefusals, type TaggedAccount } from "../../../../outbound/slack/departedTags.js";

describe("departedTagRefusals", () => {
  it("refuses a deactivated account by its handle and id", () => {
    const accounts = new Map<string, TaggedAccount>([
      ["U0NOEL", { deleted: true, kind: "read", name: "nicholas.hairs" }],
    ]);
    expect(departedTagRefusals({ accounts })).toEqual([
      "nicholas.hairs (<@U0NOEL>) is deactivated in Slack: they have left, so a message tagging them reads as if " +
        "nobody noticed. Drop the tag, and tag whoever holds their work now.",
    ]);
  });

  it("names a deactivated account by its id alone when Slack gave no handle", () => {
    const accounts = new Map<string, TaggedAccount>([["U0GONE", { deleted: true, kind: "read", name: undefined }]]);
    expect(departedTagRefusals({ accounts })).toEqual([
      "<@U0GONE> is deactivated in Slack: they have left, so a message tagging them reads as if nobody noticed. " +
        "Drop the tag, and tag whoever holds their work now.",
    ]);
  });

  it("refuses an account Slack would not describe, naming the cause", () => {
    const accounts = new Map<string, TaggedAccount>([["U0SETH", { cause: "user_not_found", kind: "unreadable" }]]);
    expect(departedTagRefusals({ accounts })).toEqual([
      "could not read <@U0SETH> off Slack's live roster (user_not_found), so whether they still work here is " +
        "unknown and nothing goes out tagging them. Re-run once Slack answers, or drop the tag.",
    ]);
  });

  it("passes every live account, and keeps the order the ids were tagged in among the refused", () => {
    const accounts = new Map<string, TaggedAccount>([
      ["U0B", { deleted: true, kind: "read", name: "b" }],
      ["U0LIVE", { deleted: false, kind: "read", name: "live" }],
      ["U0EXT", { kind: "external", name: "partner" }],
      ["U0A", { deleted: true, kind: "read", name: "a" }],
    ]);
    expect(departedTagRefusals({ accounts }).map((line) => line.slice(0, 10))).toEqual(["b (<@U0B>)", "a (<@U0A>)"]);
  });

  it("passes another workspace's member, whose departure this roster cannot hold", () => {
    const accounts = new Map<string, TaggedAccount>([["U0ROB", { kind: "external", name: "felix.marsh" }]]);
    expect(departedTagRefusals({ accounts })).toEqual([]);
  });

  it("refuses nothing when nobody is tagged", () => {
    expect(departedTagRefusals({ accounts: new Map() })).toEqual([]);
  });
});
