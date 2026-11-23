/**
 * `slack replied`, spread into `slackManifest` in `./slack.ts` and held apart so that file stays under its file-size
 * ceiling. A live READ of one thread that answers whether the owner has posted since a message — an ask's mechanical
 * done-check. It reads Slack and writes nothing, so `external-read` with no door.
 */
import { SLACK_REPLIED_USAGE } from "../commands/slack/repliedUsage.js";
import { lazy, type VerbManifestEntry } from "../manifest.js";

export const slackRepliedManifest: Readonly<Record<string, VerbManifestEntry>> = {
  replied: lazy({
    load: () => import("../commands/slack/repliedRun.js").then((m) => m.slackRepliedCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: true,
      doorRouted: false,
      dryParseSafe: true,
      effect: "external-read",
      example: "slopweaver slack replied --url https://acme.slack.com/archives/C123/p1785114398557099",
      parseRejectIsIoFree: true,
      summary:
        "Whether you have posted in a thread since the message a link names — exit 0 replied (with the reply's " +
        "link), 3 not yet, 1 could not check; an ask's mechanical done-check",
      usage: SLACK_REPLIED_USAGE,
    },
  }),
};
