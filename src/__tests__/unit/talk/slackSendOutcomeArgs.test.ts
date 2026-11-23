/*
 * `talk slack-send-outcome`'s argv: a Slack link and the instant the owner asked, both required, the link bounded.
 */
import { describe, expect, it } from "vitest";

import { parseSlackSendOutcomeArgs } from "../../../cli/commands/talk/slackSendOutcomeArgs.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

/** The thread the reply went to. */
const THREAD = "https://acme.slack.com/archives/C0SYN000001/p1791351441819519";

describe("parseSlackSendOutcomeArgs", () => {
  it("takes the link, the instant, and the home and json flags", () => {
    expect(
      unwrap(
        parseSlackSendOutcomeArgs({
          rest: ["--url", THREAD, "--since", "2026-10-07T05:52:56Z", "--home", "/h", "--json"],
        }),
      ),
    ).toEqual({ home: "/h", json: true, since: "2026-10-07T05:52:56Z", url: THREAD });
  });

  it("names every missing flag at once, and refuses a link past the bound", () => {
    expect([
      unwrapErr(parseSlackSendOutcomeArgs({ rest: [] })),
      unwrapErr(parseSlackSendOutcomeArgs({ rest: ["--url", "x".repeat(2001), "--since", "2026-10-07T05:52:56Z"] })),
    ]).toEqual([
      [
        "talk slack-send-outcome needs --url <slack-message-link>",
        "talk slack-send-outcome needs --since <iso>: the moment they asked for the send",
      ],
      ["--url is over 2000 characters; pass one Slack message link"],
    ]);
  });

  it("refuses a --since that is not one instant at parse, before any state is read", () => {
    expect(
      unwrapErr(parseSlackSendOutcomeArgs({ rest: ["--url", THREAD, "--since", "definitely-not-an-instant"] })),
    ).toEqual(['--since "definitely-not-an-instant" is not an ISO instant to the millisecond']);
  });
});
