/*
 * The pure fakes the Slack fetch test files share: a throwing `files.info` stub, the recorded `history` call
 * shape, a two-channel `SlackApi` seam and the crawl window. Nothing here touches disk. They moved here when
 * `fetch.test.ts` was split by behaviour.
 */
import type { SlackApi } from "../../../../../corpus/slack/fetch.js";

/** `files.info` belongs to the live `read-thread` lane; the crawl calling it at all is a defect. */
export const unusedFilesInfo: SlackApi["filesInfo"] = async ({ fileId }) => {
  throw new Error(`the crawl must not call files.info, but it did for ${fileId}`);
};

/** Records every `history` call's window bounds, so tests can assert oldest AND latest are threaded. */
export interface HistoryCall {
  readonly channel: string;
  readonly oldest: string;
  readonly latest: string;
}

/**
 * A fake Slack seam: two channels (both enumerated regardless of membership), one threaded message.
 *
 * @returns a `SlackApi` that records each `history` call into `calls`
 */
export function fakeApi({
  calls,
  failChannel,
  replyOldest,
}: {
  calls: HistoryCall[];
  failChannel?: string;
  replyOldest?: string[];
}): SlackApi {
  return {
    filesInfo: unusedFilesInfo,
    // The crawl never resolves a single file id — `files.info` exists for the live `read-thread` lane. A
    // throwing stub keeps that an assertion rather than an assumption.
    grantedScopes: async () => ["files:read"],
    history: async ({ channel, oldest, latest }) => {
      calls.push({ channel, latest, oldest });
      if (channel === failChannel) {
        throw new Error("not_in_channel");
      }
      return channel === "C_A"
        ? {
            messages: [
              {
                files: [{ id: "F1", mimetype: "image/png", title: "pic.png", user: "U2" }],
                reactions: [{ count: 2, name: "+1" }],
                reply_count: 1,
                text: "hello team, see #12",
                ts: "1700000000.000100",
                user: "U1",
              },
            ],
          }
        : { messages: [] };
    },
    listChannels: async () => ({
      channels: [
        { id: "C_A", is_member: true, name: "alpha" },
        { id: "C_B", is_member: false, name: "beta" }, // NOT a member — must STILL be enumerated
      ],
    }),
    listUsers: async () => ({
      members: [
        { id: "U1", profile: { display_name: "Ada" }, real_name: "Ada Lovelace" },
        { id: "U2", name: "grace", profile: {} },
      ],
    }),
    replies: async ({ ts, oldest }) => {
      replyOldest?.push(oldest);
      return {
        messages: [
          { text: "parent", ts, user: "U1" },
          { text: "a reply", ts: "1700000100.000200", user: "U2" },
        ],
      };
    },
    workspaceUrl: async () => "https://acme.slack.com",
  };
}

export const window = { since: "2023-11-01", until: "2023-12-01" };
