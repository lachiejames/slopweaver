/*
 * What the Slack projection test files share: the id-to-name maps mentions resolve through, and one public channel
 * holding a message with a file and a reply, each carrying its raw payload. They moved here when `project.test.ts`
 * was split by behaviour.
 */
import type { SlackChannelItems } from "../../../../../corpus/slack/project.js";
import type { SlackNameMaps } from "../../../../../corpus/slack/visibleProse.js";

export const maps: SlackNameMaps = {
  channelNames: { C_PUBLIC_ALPHA: "alpha", C_RELEASES: "releases" },
  userNames: { U_UPLOADER: "Linus", U1: "Ada", U2: "Grace" },
};

export const rawMessage = { rawMarker: "slack-message", text: "shipping the alpha release, see #123" };
export const rawReply = { rawMarker: "slack-reply", text: "nice, merging now" };
export const rawFile = { id: "F1", rawMarker: "slack-file", title: "diagram.png" };

export const channel: SlackChannelItems = {
  channelId: "C_PUBLIC_ALPHA",
  channelName: "alpha",
  messages: [
    {
      author: "U1",
      channelId: "C_PUBLIC_ALPHA",
      channelName: "alpha",
      files: [{ id: "F1", mimetype: "image/png", raw: rawFile, title: "diagram.png" }],
      permalink: "https://acme.slack.com/archives/C_PUBLIC_ALPHA/p1700000000000100",
      raw: rawMessage,
      reactions: [":+1: x2"],
      text: "shipping the alpha release, see #123",
      ts: "1700000000.000100",
      tsIso: "2023-11-14T22:13:20.000Z",
    },
  ],
  replies: [
    {
      author: "U2",
      channelId: "C_PUBLIC_ALPHA",
      channelName: "alpha",
      files: [],
      permalink: "https://acme.slack.com/archives/C_PUBLIC_ALPHA/p1700000100000200",
      raw: rawReply,
      text: "nice, merging now",
      threadTs: "1700000000.000100",
      ts: "1700000100.000200",
      tsIso: "2023-11-14T22:15:00.000Z",
    },
  ],
};
