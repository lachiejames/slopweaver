import { describe, expect, it } from "vitest";

import { GithubVerbErrors } from "../../../../../cli/commands/github/errors.js";
import { readMessageOf } from "../../../../../cli/commands/github/reviewerSlackRead.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

/** A thread of three: the owner's root about one pull request, a reply linking another, and the reply a permalink named. */
const MESSAGES = [
  { text: "root about #16541", ts: "1788490000.000100", tsIso: "2026-09-04T01:26:40.000Z" },
  {
    text: "<https://github.com/acme/acme-admin/pull/16367|#16367>",
    ts: "1788491667.136499",
    tsIso: "2026-09-04T01:54:27.000Z",
  },
  { text: "<@U9> thoughts?", ts: "1788491238.904859", tsIso: "2026-09-04T01:47:18.000Z" },
];

describe("readMessageOf", () => {
  it("answers the addressed message with every OTHER message of the thread beside it", () => {
    const read = readMessageOf({
      messages: MESSAGES,
      thread: { addressedTs: "1788491238.904859", channel: "C0SYN000002" },
    });
    expect(read.isOk()).toBe(true);
    expect(unwrap(read)).toEqual({
      atIso: "2026-09-04T01:47:18.000Z",
      channelId: "C0SYN000002",
      text: "<@U9> thoughts?",
      threadTexts: ["root about #16541", "<https://github.com/acme/acme-admin/pull/16367|#16367>"],
      ts: "1788491238.904859",
    });
  });

  it("answers a lone message with an empty thread", () => {
    const read = readMessageOf({
      messages: [MESSAGES[0]!],
      thread: { addressedTs: "1788490000.000100", channel: "D0SYN000004" },
    });
    expect(unwrap(read).threadTexts).toEqual([]);
  });

  it("refuses a read that did not return the addressed message, naming its ts", () => {
    const read = readMessageOf({
      messages: MESSAGES,
      thread: { addressedTs: "1788499999.000000", channel: "C0SYN000002" },
    });
    expect(unwrapErr(read)).toEqual(GithubVerbErrors.slackMessageMissing({ ts: "1788499999.000000" }));
  });
});
