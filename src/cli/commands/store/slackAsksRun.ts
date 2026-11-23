/**
 * `slopweaver store slack-asks` — which Slack asks the bot answered and which it stranded, read from the STORE.
 *
 * The ask-lifecycle ledger is authored state in `live/`, imported by `store import-fleet --only authored`.
 * This reads its newest stored version and never the disk copy, so the answer survives the home: after a wipe
 * and a `store restore`, it is what says which asks were left without an answer. The seams are
 * `./authoredDeps.ts`'s; the fold is `./slackAsksCore.ts`.
 */
import { safeJsonStringify } from "#lib/safeJson.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK } from "../../exitCodes.js";

import { type AuthoredVerbDeps, productionAuthoredVerbDeps } from "./authoredDeps.js";
import { authoredHomeOf, newestAuthoredBody, openAuthoredStore, refuseAuthoredUsage } from "./authoredShell.js";
import { SLACK_ASKS_USAGE } from "./authoredUsage.js";
import { storeTail } from "./core.js";
import {
  parseSlackAsksArgs,
  SLACK_ASKS_RELATIVE_PATH,
  slackAskLine,
  slackAsksReport,
  slackAsksSummaryLines,
} from "./slackAsksCore.js";

/**
 * Run `store slack-asks` against injected seams.
 *
 * @param rest the argv after `store slack-asks`
 * @returns the process exit code
 */
export async function runStoreSlackAsks({
  rest,
  deps,
}: {
  rest: readonly string[];
  deps: AuthoredVerbDeps;
}): Promise<number> {
  const args = parseSlackAsksArgs({ rest });
  if (args.isErr()) {
    return refuseAuthoredUsage({ deps, problems: args.error, usage: SLACK_ASKS_USAGE, verb: "slack-asks" });
  }
  const home = authoredHomeOf({ deps, named: args.value.home });
  const opened = await openAuthoredStore({ deps, home, verb: "slack-asks" });
  if (opened.kind === "exit") {
    return opened.code;
  }
  try {
    const bytes = await newestAuthoredBody({ relativePath: SLACK_ASKS_RELATIVE_PATH, session: opened.session });
    if (bytes.isErr()) {
      deps.writeDiagnostic(`store slack-asks: ${bytes.error.message}`);
      return EXIT_ERROR;
    }
    const report = slackAsksReport({ text: bytes.value.toString("utf8") });
    const asks = report.asks.filter((ask) => !args.value.stranded || ask.stranded);
    if (args.value.json) {
      deps.writeOut(safeJsonStringify({ label: "store slack-asks --json", value: { ...report, asks } }));
    } else {
      asks.forEach((row) => {
        deps.writeOut(slackAskLine({ row }));
      });
    }
    slackAsksSummaryLines({ report }).forEach((line) => {
      deps.writeDiagnostic(line);
    });
    return EXIT_OK;
  } finally {
    await opened.session.close();
  }
}

/** `slopweaver store slack-asks`. */
export const storeSlackAsksCommand = defineCommand({
  run: (argv) => runStoreSlackAsks({ deps: productionAuthoredVerbDeps(), rest: storeTail({ argv }) }),
});
