/**
 * The effectful shell for `outlook attachment`: parse (pure), bind a read session, fetch one file attachment
 * into the home owner-only, and print where it landed. Apart from `readRun.ts` because it is the one read that
 * WRITES — bytes under `live/outlook/attachments/`.
 */
import { fetchOutlookAttachment } from "../../../live/outlook/attachments.js";
import { renderOutlookAttachmentText } from "../../../live/outlook/render.js";
import { stateHomePaths } from "../../../stateHome.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK } from "../../exitCodes.js";
import { parseOutlookAttachmentArgs } from "./core.js";
import { jsonOut, type OutlookShellDeps, productionOutlookShellDeps, refuseUsage, shellHome } from "./shell.js";

const VERB_ARG_OFFSET = 4;

/**
 * Run `outlook attachment`.
 *
 * @param rest argv after `outlook attachment`
 * @returns the process exit code
 */
export async function runOutlookAttachment({
  rest,
  deps,
}: {
  rest: readonly string[];
  deps: OutlookShellDeps;
}): Promise<number> {
  const parsed = parseOutlookAttachmentArgs({ rest });
  if (parsed.isErr()) {
    return refuseUsage({ deps, error: parsed.error });
  }
  const { home: named, json, maxBytes, messageId, selector } = parsed.value;
  const home = shellHome({ deps, named });
  const session = await deps.session({ home, verb: "attachment" });
  if (session.isErr()) {
    deps.warn(session.error.message);
    return EXIT_ERROR;
  }
  const saved = await fetchOutlookAttachment({
    api: session.value.api,
    maxBytes,
    messageId,
    root: stateHomePaths({ home }).live.outlook.attachments,
    selector,
    writeBytes: deps.writeBytes,
  });
  if (saved.isErr()) {
    deps.warn(saved.error.message);
    return EXIT_ERROR;
  }
  deps.out(json ? jsonOut({ value: saved.value }) : renderOutlookAttachmentText({ saved: saved.value }));
  return EXIT_OK;
}

/** `slopweaver outlook attachment`. */
export const outlookAttachmentCommand = defineCommand({
  run: (argv) => runOutlookAttachment({ deps: productionOutlookShellDeps(), rest: argv.slice(VERB_ARG_OFFSET) }),
});
