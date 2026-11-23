/**
 * `slopweaver talk attach` — keep a copy of a file they attached in the console's Messenger under the home, so the
 * thinking model's `file_read` can read it.
 *
 * The owner decides what to share with the voice, so files can be uploaded to it. The console route (`site/app/api/talk/attach/route.ts`) stages the
 * file and runs this; the Messenger then sends their message with one line naming the kept path. The rules are
 * `src/talk/attachment.ts`'s, the disk is `src/talk/attachmentStore.ts`'s. Nothing here reaches a provider.
 *
 * With `--json` a refusal is printed on stdout too, as `{"refused":{"code","message"}}`, so the route can show them the
 * reason rather than an exit code.
 */
import { randomUUID } from "node:crypto";

import { slopweaverHome } from "../../../homeDir.js";
import { logger } from "../../../lib/logger.js";
import { keepAttachment } from "../../../talk/attachmentStore.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { parseAttachArgs } from "./attachArgs.js";
import { TALK_ATTACH_USAGE } from "./usage.js";

/** How many argv entries precede the verb's own flags: `[node, bin, "talk", "attach", ...]`. */
const VERB_ARG_OFFSET = 4;

/**
 * Run the `talk attach` verb.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export function runTalkAttach(argv: readonly string[]): number {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: TALK_ATTACH_USAGE });
    return EXIT_OK;
  }
  const parsed = parseAttachArgs({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((message) => {
      logger.error({ msg: message });
    });
    logger.error({ msg: TALK_ATTACH_USAGE });
    return EXIT_USAGE;
  }
  const args = parsed.value;
  const home = typeof args.home === "string" ? args.home : slopweaverHome();
  const kept = keepAttachment({ home, name: args.name, newId: randomUUID, stagedPath: args.file });
  if (kept.isErr()) {
    logger.error({ msg: `talk attach: ${kept.error.message}` });
    if (args.json) {
      logger.out({ line: JSON.stringify({ refused: { code: kept.error.code, message: kept.error.message } }) });
    }
    return EXIT_ERROR;
  }
  if (args.json) {
    logger.out({ line: JSON.stringify(kept.value) });
    return EXIT_OK;
  }
  logger.out({
    line: `kept ${kept.value.kind} ${kept.value.name} (${String(kept.value.bytes)} bytes) at ${kept.value.path}`,
  });
  return EXIT_OK;
}

export const talkAttachCommand = defineCommand({ run: runTalkAttach });
