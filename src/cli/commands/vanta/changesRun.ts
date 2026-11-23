/**
 * `slopweaver atlas vanta changes [--kind <kind>] [--mark-read <at>] [--json] [--home <dir>]` — print what the
 * Vanta syncs no session has judged yet changed, or mark them judged.
 *
 * The step after a Vanta resync in a visible session (`skills/automation/reference/vanta-changes.md`):
 * read, decide what the owner would want to hear about, park a drafted post for each, then `--mark-read` the
 * `at` the listing ended on. Listing writes nothing; `--mark-read` writes only the local cursor. Nothing here
 * reaches Vanta or Slack.
 *
 * ## The exit-code contract
 *
 * | situation                                              | code |
 * | ------------------------------------------------------ | ---- |
 * | a bad flag                                             | `2`  |
 * | nothing unread                                         | `3`  |
 * | the log or cursor will not read, or `--mark-read` refused | `1`  |
 * | unread records printed, or the cursor moved            | `0`  |
 */
import { markVantaChangesRead, readUnreadVantaChanges } from "../../../atlas/vanta/changesStore.js";
import { slopweaverHome } from "../../../homeDir.js";
import { logger } from "../../../lib/logger.js";
import { safeJsonStringify } from "../../../lib/safeJson.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { verbTail } from "../../optionParsers.js";
import {
  filterVantaChangesByKind,
  parseVantaChangesOptions,
  renderUnreadVantaChangesLines,
  type VantaChangesOptions,
} from "./changesCore.js";

/** Where a Vanta verb sits: past the runtime, the script, the `atlas` noun and the `vanta` platform. */
const VANTA_VERB_INDEX = 4;

/**
 * Exported so a test can assert this equals the manifest's own copy, for the same reason
 * {@link ../vanta/syncRun.js}'s is.
 */
export const VANTA_CHANGES_USAGE =
  "usage: slopweaver atlas vanta changes [--kind <kind>] [--mark-read <at>] [--json] [--home <dir>]";

/**
 * Run the `vanta changes` verb.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export function runVantaChanges(argv: readonly string[]): number {
  const rest = verbTail({ argv, at: VANTA_VERB_INDEX, verbs: ["changes"] });
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: VANTA_CHANGES_USAGE });
    return EXIT_OK;
  }
  const parsed = parseVantaChangesOptions({ defaultHome: slopweaverHome(), rest });
  if (parsed.isErr()) {
    parsed.error.forEach((error) => {
      logger.error({ msg: error });
    });
    logger.error({ msg: VANTA_CHANGES_USAGE });
    return EXIT_USAGE;
  }
  const options = parsed.value;
  return options.mode === "mark-read" ? markRead({ options }) : listUnread({ options });
}

/** Move the cursor to the instant the session judged through, and say where it moved from. */
function markRead({ options }: { options: Extract<VantaChangesOptions, { mode: "mark-read" }> }): number {
  const marked = markVantaChangesRead({ at: options.at, home: options.home });
  if (marked.isErr()) {
    logger.error({ msg: marked.error.message });
    return EXIT_ERROR;
  }
  const was = marked.value.previous === null ? "none judged before" : `was ${marked.value.previous}`;
  logger.out({
    line: options.json
      ? safeJsonStringify({ label: "vanta changes --mark-read", value: marked.value })
      : `Vanta changes judged through ${marked.value.through} (${was})`,
  });
  return EXIT_OK;
}

/** Print every record past the cursor, narrowed to one kind when asked. */
function listUnread({ options }: { options: Extract<VantaChangesOptions, { mode: "list" }> }): number {
  const unread = readUnreadVantaChanges({ home: options.home });
  if (unread.isErr()) {
    logger.error({ msg: unread.error.message });
    return EXIT_ERROR;
  }
  const records = filterVantaChangesByKind({ kind: options.kind, records: unread.value.records });
  if (options.json) {
    logger.out({
      line: safeJsonStringify({
        label: "vanta changes",
        space: 2,
        value: { records, throughAt: unread.value.throughAt },
      }),
    });
  } else {
    for (const line of renderUnreadVantaChangesLines({
      kind: options.kind,
      records,
      throughAt: unread.value.throughAt,
    })) {
      logger.out({ line });
    }
  }
  return records.length === 0 ? EXIT_EXPECTED_EMPTY : EXIT_OK;
}

export const vantaChangesCommand = defineCommand({ run: runVantaChanges });
