/**
 * `slopweaver slack owed` — the corpus reader `session-start` already uses, the pure document in
 * `live/slack/owedDocument.ts` and the atomic store beside it, run through the shared snapshot shell
 * (`./snapshotRun.ts`).
 *
 * It READS and never drafts or sends: no Slack client, no model, no queue card, no outbound module. An
 * unasked reply to a person is a queue card drafted in a visible session, never an act of this verb.
 */

import { renderSlackOwedJson, renderSlackOwedText, slackOwedDocument } from "../../../live/slack/owedDocument.js";
import { writeSlackOwedDocument } from "../../../live/slack/owedStore.js";
import { defineCommand } from "../../defineCommand.js";
import { readSlackThreads, WINDOW_DAYS } from "../sessionStart/slackRead.js";
import { productionSlackSnapshotDeps, runSlackSnapshot, type SlackSnapshotDeps } from "./snapshotRun.js";
import { SLACK_OWED_USAGE } from "./verbUsage.js";

/** The argv index the `slack <verb>` tail starts at — past the runtime, the script, the noun and the verb. */
const VERB_ARG_OFFSET = 4;

/**
 * Run the verb against injected edges.
 *
 * @param rest the argv tail after `slack owed`
 * @param deps the injected write channels, clock and default home
 * @returns the process exit code
 */
export function runSlackOwed({ rest, deps }: { rest: readonly string[]; deps: SlackSnapshotDeps }): number {
  return runSlackSnapshot({
    deps,
    rest,
    snapshot: ({ home, nowIso }) => {
      const read = readSlackThreads({ home, nowIso });
      const document = slackOwedDocument({ nowIso, read: { ...read, windowDays: WINDOW_DAYS } });
      return {
        complete: document.status === "complete",
        json: renderSlackOwedJson({ document }),
        text: renderSlackOwedText({ document }),
        write: () => writeSlackOwedDocument({ document, home }),
      };
    },
    usage: SLACK_OWED_USAGE,
    verb: "slack owed",
  });
}

/** `slopweaver slack owed` — followed Slack threads whose last word is somebody else's; reads, never sends. */
export const slackOwedCommand = defineCommand({
  run: (argv) => runSlackOwed({ deps: productionSlackSnapshotDeps(), rest: argv.slice(VERB_ARG_OFFSET) }),
});
