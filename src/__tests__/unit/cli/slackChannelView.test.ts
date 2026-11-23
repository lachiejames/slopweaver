import { describe, expect, it } from "vitest";
import {
  parseSlackChannelViewArgs,
  SLACK_CHANNEL_VIEW_FLAG_NAMES,
} from "../../../cli/commands/slack/channelViewCore.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

describe("parseSlackChannelViewArgs", () => {
  it("reads one channel id and the output flags", () => {
    expect(unwrap(parseSlackChannelViewArgs({ rest: ["C0SYN123ABCD", "--json", "--home", "/h"] }))).toEqual({
      channel: "C0SYN123ABCD",
      home: "/h",
      json: true,
    });
    expect(unwrap(parseSlackChannelViewArgs({ rest: ["G0SYNPRIVATE"] }))).toEqual({
      channel: "G0SYNPRIVATE",
      home: undefined,
      json: false,
    });
  });

  it("refuses a missing, doubled or malformed channel id by name", () => {
    expect(unwrapErr(parseSlackChannelViewArgs({ rest: [] })).message).toBe("a Slack channel id is required");
    expect(unwrapErr(parseSlackChannelViewArgs({ rest: ["C0ONE", "C0TWO"] })).message).toBe(
      "expected one channel id, got 2: C0ONE C0TWO",
    );
    expect(unwrapErr(parseSlackChannelViewArgs({ rest: ["proj-monitoring"] })).message).toBe(
      "a channel id looks like C0SYN123ABCD (or G…/D…), got proj-monitoring",
    );
    expect(unwrapErr(parseSlackChannelViewArgs({ rest: ["U0PERSON"] })).code).toBe("INVALID_FLAG_VALUE");
  });

  it("carries the workspace the link named, and refuses one that is not a Slack host", () => {
    expect(unwrap(parseSlackChannelViewArgs({ rest: ["C0ONE", "--workspace", "acme.slack.com"] })).workspace).toBe(
      "acme.slack.com",
    );
    expect(unwrap(parseSlackChannelViewArgs({ rest: ["C0ONE"] })).workspace).toBe(undefined);
    expect(unwrapErr(parseSlackChannelViewArgs({ rest: ["C0ONE", "--workspace", "evil.example"] })).message).toBe(
      "--workspace is a Slack host such as acme.slack.com, got evil.example",
    );
  });

  it("refuses a flag it does not accept", () => {
    expect(unwrapErr(parseSlackChannelViewArgs({ rest: ["C0ONE", "--limit", "5"] })).code).toBe("FLAGS_INVALID");
  });

  it("accepts exactly the flags its usage names", () => {
    expect(SLACK_CHANNEL_VIEW_FLAG_NAMES).toEqual(["--home", "--json", "--workspace"]);
  });
});
