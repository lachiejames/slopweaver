/*
 * The text a seat cards `gmail triage` from: the totals, the cap warning, what leaving a relayed sender really leaves,
 * one named group's ids, and the document's JSON form.
 */
import { describe, expect, it } from "vitest";

import { buildGmailTriage } from "../../../../../live/gmail/triage.js";
import { renderGmailTriageJson, renderGmailTriageText } from "../../../../../live/gmail/triageRender.js";
import { EVERY_LANE_POLICY, message, READ_AT } from "./harness.js";

describe("renderGmailTriageText", () => {
  const document = buildGmailTriage({
    account: "owner@example.test",
    complete: false,
    inviteFileIds: new Set<string>(),
    repliedThreadIds: new Set<string>(),
    inboxEstimate: 9,
    policy: EVERY_LANE_POLICY,
    messages: [
      message({
        atIso: "2026-09-29T10:00:00.000Z",
        extra: [
          { name: "List-Unsubscribe", value: "<https://example.test/u>" },
          { name: "List-Unsubscribe-Post", value: "List-Unsubscribe=One-Click" },
        ],
        from: "'Othercompany Alerts' via IT Security <it-security@example.test>",
        id: "r-1",
        subject: "cert expiring",
        unread: true,
      }),
    ],
    readAtIso: READ_AT,
  });

  it("prints the totals, the cap warning, and what leaving a relayed sender really leaves", () => {
    expect(renderGmailTriageText({ carded: new Map(), document, only: undefined }).split("\n")).toEqual([
      `gmail triage: owner@example.test · read at ${READ_AT}`,
      "inbox: 1 message(s), 1 unread, in 1 sender group(s) · STOPPED at the message cap — more remain · Gmail " +
        "ESTIMATES 9 in the inbox",
      "",
      "  1  Othercompany Alerts (via IT Security) <it-security@example.test>",
      "     1 unread · 2026-09-29 · automated · unsubscribe: one-click (RFC 8058), and it leaves the IT Security group",
      "     key relay:it-security@example.test:othercompany alerts",
      '     "cert expiring"',
    ]);
  });

  it("prints the group's ids when one group was named", () => {
    const text = renderGmailTriageText({ carded: new Map(), document, only: document.groups[0]! });
    expect(text.split("\n").at(-1)).toBe("     1 id(s): r-1");
  });

  it("round-trips the document through its JSON form", () => {
    expect(JSON.parse(renderGmailTriageJson({ document }))).toEqual(JSON.parse(JSON.stringify(document)));
  });
});
