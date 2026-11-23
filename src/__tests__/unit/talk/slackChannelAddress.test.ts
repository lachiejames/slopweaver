/**
 * What `talk slack-channel --channel` accepts: a name as the screen shows it, a Slack link, or an id — and every
 * other shape refused with a reason, before anything reaches Slack.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../lib/result.js";
import { parseSlackChannelAddress } from "../../../talk/slackChannelAddress.js";

/** The refusal for an input that must be refused; throws when it parses. */
function refusal({ input }: { input: string }): { code: string; message: string } {
  return unwrapErr(parseSlackChannelAddress({ input }));
}

describe("parseSlackChannelAddress", () => {
  it("reads a name as the Slack app shows it, with or without its #, mixed or upper case lowered, trimmed", () => {
    expect(unwrap(parseSlackChannelAddress({ input: "#SQUAD-PLATFORM" }))).toEqual({
      kind: "name",
      name: "squad-platform",
    });
    expect(unwrap(parseSlackChannelAddress({ input: "squad-platform" }))).toEqual({
      kind: "name",
      name: "squad-platform",
    });
    expect(unwrap(parseSlackChannelAddress({ input: "#squad-platform" }))).toEqual({
      kind: "name",
      name: "squad-platform",
    });
    expect(unwrap(parseSlackChannelAddress({ input: "  #Squad-Platform \n" }))).toEqual({
      kind: "name",
      name: "squad-platform",
    });
  });

  it("reads a workspace link to a channel or a message in it as that channel, keeping the workspace", () => {
    expect(unwrap(parseSlackChannelAddress({ input: "https://acme.slack.com/archives/C0SYNPLAT1234" }))).toEqual({
      channel: "C0SYNPLAT1234",
      kind: "id",
      workspace: "https://acme.slack.com",
    });
    expect(
      unwrap(
        parseSlackChannelAddress({
          input: "https://acme.slack.com/archives/C0SYNPLAT1234/p1791000000000100?thread_ts=1791000000.000100",
        }),
      ),
    ).toEqual({ channel: "C0SYNPLAT1234", kind: "id", workspace: "https://acme.slack.com" });
  });

  it("reads an app.slack.com client link as the channel, with no workspace to keep", () => {
    expect(
      unwrap(parseSlackChannelAddress({ input: "https://app.slack.com/client/T0SYNACME1234/C0SYNPLAT1234" })),
    ).toEqual({
      channel: "C0SYNPLAT1234",
      kind: "id",
    });
  });

  it("reads a bare channel, private group or DM id as an id", () => {
    expect(unwrap(parseSlackChannelAddress({ input: "C0SYNPLAT1234" }))).toEqual({
      channel: "C0SYNPLAT1234",
      kind: "id",
    });
    expect(unwrap(parseSlackChannelAddress({ input: "G0SYNPRIV1234" }))).toEqual({
      channel: "G0SYNPRIV1234",
      kind: "id",
    });
    expect(unwrap(parseSlackChannelAddress({ input: "D0SYNDIRECT12" }))).toEqual({
      channel: "D0SYNDIRECT12",
      kind: "id",
    });
  });

  it("refuses an empty input and a bare #", () => {
    expect(refusal({ input: "   " }).message).toBe(
      '"   " names no Slack channel: it is empty. Pass the channel\'s name as the screen shows it, or a Slack link to it',
    );
    expect(refusal({ input: "#" }).message).toContain("it is a # with no name");
  });

  it("refuses words with spaces, which no channel name has, and a name past Slack's 80 characters", () => {
    expect(refusal({ input: "team platform" }).code).toBe("CHANNEL_ADDRESS_INVALID");
    expect(refusal({ input: "team platform" }).message).toContain("a channel name has no spaces");
    expect(refusal({ input: "x".repeat(81) }).message).toContain("a channel name is at most 80 characters");
    expect(unwrap(parseSlackChannelAddress({ input: "x".repeat(80) }))).toEqual({ kind: "name", name: "x".repeat(80) });
  });

  it("refuses a path, another scheme or punctuation as a name, keeping Japanese, Arabic, Cyrillic and accented letters", () => {
    const why = "a channel name holds only letters, numbers, hyphens and underscores";
    expect(refusal({ input: "/tmp/a-home" }).message).toContain(why);
    expect(refusal({ input: "file:///etc/passwd" }).message).toContain(why);
    expect(refusal({ input: "../squad-platform" }).message).toContain(why);
    expect(
      ["#チーム_2", "#فريق_2", "#команда-2", "#équipe-2"].map((input) => unwrap(parseSlackChannelAddress({ input }))),
    ).toEqual([
      { kind: "name", name: "チーム_2" },
      { kind: "name", name: "فريق_2" },
      { kind: "name", name: "команда-2" },
      { kind: "name", name: "équipe-2" },
    ]);
  });

  it("refuses a Slack-host link on another port, carrying credentials or written with backslashes", () => {
    expect(refusal({ input: "https://acme.slack.com:444/archives/C0SYNPLAT1234" }).message).toContain(
      "a Slack link carries no port",
    );
    const why = "a Slack link carries no spaces, control characters, backslashes or @";
    expect(refusal({ input: "https://someone@acme.slack.com/archives/C0SYNPLAT1234" }).message).toContain(why);
    expect(refusal({ input: "https://a:b@acme.slack.com/archives/C0SYNPLAT1234" }).message).toContain(why);
    // The URL parser strips a tab and a newline, which left this an empty user name and a clean link.
    expect(refusal({ input: "https://\t:\n@acme.slack.com/archives/C0SYNPLAT1234" }).message).toContain(why);
    expect(refusal({ input: "https://acme.slack.com/archives/C0PL\tAT1234" }).message).toContain(why);
    // The URL parser reads a backslash as a slash, which made this the link it is not.
    expect(refusal({ input: "https://acme.slack.com\\archives\\C0SYNPLAT1234" }).message).toContain(why);
    expect(unwrap(parseSlackChannelAddress({ input: "https://acme.slack.com:443/archives/C0SYNPLAT1234" }))).toEqual({
      channel: "C0SYNPLAT1234",
      kind: "id",
      workspace: "https://acme.slack.com",
    });
  });

  it("refuses a link that is not https on slack.com, or that names no conversation", () => {
    expect(refusal({ input: "http://acme.slack.com/archives/C0SYNPLAT1234" }).message).toContain(
      "it is not an https link on slack.com",
    );
    expect(refusal({ input: "https://example.com/archives/C0SYNPLAT1234" }).message).toContain(
      "it is not an https link on slack.com",
    );
    expect(refusal({ input: "https://slack.com.example.com/archives/C0SYNPLAT1234" }).message).toContain(
      "it is not an https link on slack.com",
    );
    expect(refusal({ input: "https://.slack.com/archives/C0SYNPLAT1234" }).message).toContain(
      "it is not an https link on slack.com",
    );
    expect(refusal({ input: "https://-acme.slack.com/archives/C0SYNPLAT1234" }).message).toContain(
      "it is not an https link on slack.com",
    );
    expect(
      unwrap(parseSlackChannelAddress({ input: "https://acme.enterprise.slack.com/archives/C0SYNPLAT1234" })),
    ).toEqual({ channel: "C0SYNPLAT1234", kind: "id", workspace: "https://acme.enterprise.slack.com" });
    expect(refusal({ input: "https://acme.slack.com/team/U0SYNOWNER1234" }).message).toContain(
      "the link names no conversation",
    );
    expect(refusal({ input: "https://acme.slack.com/archives/general" }).message).toContain(
      "the link names no conversation",
    );
  });
});
