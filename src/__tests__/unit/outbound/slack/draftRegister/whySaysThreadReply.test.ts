/** `whySaysThreadReply`: which spellings of a row's why name a thread reply, and which only mention a thread. */
import { describe, expect, it } from "vitest";

import { whySaysThreadReply } from "../../../../../outbound/slack/draftThreadWhy.js";

describe("whySaysThreadReply — the why that named a thread its row never carried", () => {
  it("reads each spelling the live register used for a reply", () => {
    const whys = [
      "THREAD REPLY, not top-level",
      "thread-reply to Jonah's question",
      "post in-thread under the bugs report",
      "#defects thread_ts 1790145643.664469",
      "reply in the engineering thread",
      "replying under Jonah's thread",
    ];
    expect(whys.map((why) => whySaysThreadReply({ why }))).toEqual(whys.map(() => true));
  });

  it("does not read a top-level post that merely mentions a thread", () => {
    const whys = [
      "the entry-group question the four-group thread left open",
      "heads-up to engineering, linking the thread",
      "local E2Es heads-up",
    ];
    expect(whys.map((why) => whySaysThreadReply({ why }))).toEqual(whys.map(() => false));
  });
});
