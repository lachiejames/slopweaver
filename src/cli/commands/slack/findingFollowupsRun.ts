/**
 * `slopweaver slack finding-followups` — the team-facing findings they shared that come back to them as ONE follow-up
 * card each: the worklist the seated `thread-chase` session parks those cards from
 * (`skills/automation/reference/thread-chase.md`, `skills/slack/reference/finding-followups.md`).
 *
 * The register-and-corpus reader beside it, the pure document in `live/slack/findingFollowupsDocument.ts` and the
 * atomic store beside that, run through the shared snapshot shell. It READS and never drafts or sends.
 */

import {
  findingFollowupsDocument,
  renderFindingFollowupsJson,
  renderFindingFollowupsText,
} from "../../../live/slack/findingFollowupsDocument.js";
import { writeFindingFollowupsDocument } from "../../../live/slack/findingFollowupsStore.js";
import { defineCommand } from "../../defineCommand.js";
import { readFindingFollowups } from "./findingFollowupsRead.js";
import { productionSlackSnapshotDeps, runSlackSnapshot, type SlackSnapshotDeps } from "./snapshotRun.js";
import { SLACK_FINDING_FOLLOWUPS_USAGE } from "./verbUsage.js";

/** The argv index the `slack <verb>` tail starts at — past the runtime, the script, the noun and the verb. */
const VERB_ARG_OFFSET = 4;

/**
 * Run the verb against injected edges.
 *
 * @param rest the argv tail after `slack finding-followups`
 * @param deps the injected write channels, clock and default home
 * @returns the process exit code
 */
export function runSlackFindingFollowups({ rest, deps }: { rest: readonly string[]; deps: SlackSnapshotDeps }): number {
  return runSlackSnapshot({
    deps,
    rest,
    snapshot: ({ home, nowIso }) => {
      const document = findingFollowupsDocument({ nowIso, read: readFindingFollowups({ home, nowIso }) });
      return {
        complete: document.status === "complete",
        json: renderFindingFollowupsJson({ document }),
        text: renderFindingFollowupsText({ document }),
        write: () => writeFindingFollowupsDocument({ document, home }),
      };
    },
    usage: SLACK_FINDING_FOLLOWUPS_USAGE,
    verb: "slack finding-followups",
  });
}

/** `slopweaver slack finding-followups` — shared findings owed their one follow-up card; reads, never sends. */
export const slackFindingFollowupsCommand = defineCommand({
  run: (argv) => runSlackFindingFollowups({ deps: productionSlackSnapshotDeps(), rest: argv.slice(VERB_ARG_OFFSET) }),
});
