/**
 * `slopweaver slack awaiting` — the followed Slack threads whose last HUMAN word is the owner's ask, quiet for two business
 * days or more: the worklist a seated `thread-chase` session drafts chases from
 * (`skills/automation/reference/thread-chase.md`).
 *
 * The same corpus reader `slack owed` and `session-start` use, the pure document in
 * `live/slack/awaitingDocument.ts` and the atomic store beside it, run through the shared snapshot shell. It
 * READS and never drafts or sends: every chase is parked for the owner's yes by the seated session, never by this verb.
 */

import {
  renderSlackAwaitingJson,
  renderSlackAwaitingText,
  slackAwaitingDocument,
} from "../../../live/slack/awaitingDocument.js";
import { writeSlackAwaitingDocument } from "../../../live/slack/awaitingStore.js";
import { defineCommand } from "../../defineCommand.js";
import { readSlackThreads, WINDOW_DAYS } from "../sessionStart/slackRead.js";
import { productionSlackSnapshotDeps, runSlackSnapshot, type SlackSnapshotDeps } from "./snapshotRun.js";
import { SLACK_AWAITING_USAGE } from "./verbUsage.js";

/** The argv index the `slack <verb>` tail starts at — past the runtime, the script, the noun and the verb. */
const VERB_ARG_OFFSET = 4;

/**
 * Run the verb against injected edges.
 *
 * @param rest the argv tail after `slack awaiting`
 * @param deps the injected write channels, clock and default home
 * @returns the process exit code
 */
export function runSlackAwaiting({ rest, deps }: { rest: readonly string[]; deps: SlackSnapshotDeps }): number {
  return runSlackSnapshot({
    deps,
    rest,
    snapshot: ({ home, nowIso }) => {
      const read = readSlackThreads({ home, nowIso });
      const document = slackAwaitingDocument({ nowIso, read: { ...read, windowDays: WINDOW_DAYS } });
      return {
        complete: document.status === "complete",
        json: renderSlackAwaitingJson({ document }),
        text: renderSlackAwaitingText({ document }),
        write: () => writeSlackAwaitingDocument({ document, home }),
      };
    },
    usage: SLACK_AWAITING_USAGE,
    verb: "slack awaiting",
  });
}

/** `slopweaver slack awaiting` — followed Slack threads quiet on the owner's ask two business days or more; reads, never sends. */
export const slackAwaitingCommand = defineCommand({
  run: (argv) => runSlackAwaiting({ deps: productionSlackSnapshotDeps(), rest: argv.slice(VERB_ARG_OFFSET) }),
});
