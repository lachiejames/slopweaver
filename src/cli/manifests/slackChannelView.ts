/**
 * `slack channel-view`, spread into `slackManifest` in `./slack.ts` and held apart so that file stays under its
 * file-size ceiling. A live READ of one channel's newest page for the console's hover window: nothing leaves for
 * Slack, and it keeps each picture's preview under the home, which is why the effect is `local-state`.
 */
import { SLACK_CHANNEL_VIEW_USAGE } from "../commands/slack/verbUsage.js";
import { lazy, type VerbManifestEntry } from "../manifest.js";

export const slackChannelViewManifest: Readonly<Record<string, VerbManifestEntry>> = {
  "channel-view": lazy({
    load: () => import("../commands/slack/channelViewRun.js").then((m) => m.slackChannelViewCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: true,
      effect: "local-state",
      example: "slopweaver slack channel-view C0SYN123ABCD --json",
      parseRejectIsIoFree: true,
      summary:
        "Read a channel as it is NOW — its newest page live, pictures fetched as Slack's previews — the window " +
        "the console opens when the owner hovers a channel on the Workstreams page",
      usage: SLACK_CHANNEL_VIEW_USAGE,
    },
  }),
};
