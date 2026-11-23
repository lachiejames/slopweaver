/* `escapeMrkdwn` escapes only mrkdwn's control characters. */
import { describe, expect, it } from "vitest";

import { escapeMrkdwn } from "../../../../../outbound/slack/render.js";

describe("escapeMrkdwn", () => {
  it("escapes only the mrkdwn control characters", () => {
    expect(escapeMrkdwn({ text: "a & b < c > d" })).toBe("a &amp; b &lt; c &gt; d");
  });

  it("leaves ordinary prose, asterisks and em-dashes alone", () => {
    expect(escapeMrkdwn({ text: "an *asterisked* — dash" })).toBe("an *asterisked* — dash");
  });
});
