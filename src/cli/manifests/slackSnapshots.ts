/**
 * The three Slack corpus snapshots, spread into `slackManifest` in `./slack.ts`: `owed`, `awaiting` and
 * `finding-followups`. They share one flag set and one shell (`../commands/slack/snapshotRun.ts`), and are held apart
 * so `./slack.ts` stays under its file-size ceiling.
 *
 * Both are READS of the local corpus that never draft or send. `local-state` rather than `external-read` because
 * `--write` persists one document under the home; nothing leaves for Slack, so no door.
 */
import { SLACK_AWAITING_USAGE, SLACK_FINDING_FOLLOWUPS_USAGE, SLACK_OWED_USAGE } from "../commands/slack/verbUsage.js";
import { lazy, type VerbManifestEntry } from "../manifest.js";

/** Every field both snapshot verbs declare alike. */
const snapshotMeta = {
  createsWorkItem: false,
  diagnostic: true,
  doorRouted: false,
  dryParseSafe: true,
  effect: "local-state",
  parseRejectIsIoFree: true,
} as const;

/** `slack owed`, `slack awaiting` and `slack finding-followups`. */
export const slackSnapshotsManifest: Readonly<Record<string, VerbManifestEntry>> = {
  // The inverse of `owed`: the threads quiet on the owner's ask. The standing `thread-chase-daily` row is `read`: its seat
  // parks the drafts, which this verb never does.
  awaiting: lazy({
    load: () => import("../commands/slack/awaitingRun.js").then((m) => m.slackAwaitingCommand),
    meta: {
      ...snapshotMeta,
      example: "slopweaver slack awaiting --write",
      summary:
        "Read the Slack threads where your ask has had no reply from a person for two business days or more, from " +
        "the local corpus, and optionally persist the chase worklist — drafts and sends nothing",
      usage: SLACK_AWAITING_USAGE,
    },
  }),
  // The shared findings owed their one follow-up card, read by the same `thread-chase-daily` seat, which parks each card.
  "finding-followups": lazy({
    load: () => import("../commands/slack/findingFollowupsRun.js").then((m) => m.slackFindingFollowupsCommand),
    meta: {
      ...snapshotMeta,
      example: "slopweaver slack finding-followups --json",
      summary:
        "Read the team-facing findings you shared that are owed their one follow-up card — no reply for a full " +
        "business day, only an untimed acknowledgement, or a claimed fix — and optionally persist the worklist; " +
        "drafts and sends nothing",
      usage: SLACK_FINDING_FOLLOWUPS_USAGE,
    },
  }),
  // The standing `slack-owed-daily` row declares `effect: "read"`, which `live/automation/verbRun.ts` lets run a
  // `local-state` verb. Its kind is `owed-reply`: its seat parks the reply drafts, which this verb never does.
  owed: lazy({
    load: () => import("../commands/slack/owedRun.js").then((m) => m.slackOwedCommand),
    meta: {
      ...snapshotMeta,
      example: "slopweaver slack owed --write",
      summary:
        "Read the Slack threads you spoke in whose last word is somebody else's, from the local corpus, and " +
        "optionally persist the bounded reading — drafts and sends nothing",
      usage: SLACK_OWED_USAGE,
    },
  }),
};
