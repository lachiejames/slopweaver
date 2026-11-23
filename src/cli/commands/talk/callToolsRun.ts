/**
 * `slopweaver talk call-tools --call <uuid>` — one console-voice call's tool lines, each with what the model was
 * handed, secrets masked as `talk transcript` appended them, a bounded page at a time. Each call keeps every tool's answer so a
 * wrong spoken answer can be traced to what it read; this is where a session reads one back. `talk calls` never
 * carries them, so an ordinary status read stays small. A call with no file is an error, never an empty page: a typo
 * and a call that ran no tool must not read the same.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";

import { logger } from "../../../lib/logger.js";
import { safeJsonStringify } from "../../../lib/safeJson.js";
import { callsDir, readCallEntriesCounted } from "../../../talk/callStore.js";
import { type CallToolsPage, callToolsPage } from "../../../talk/callTools.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { talkHomeOf } from "./args.js";
import { parseCallToolsArgs } from "./callToolsArgs.js";
import { TALK_CALL_TOOLS_USAGE } from "./callToolsUsage.js";

/** How many argv entries precede the verb's own flags: `[node, bin, "talk", "call-tools", ...]`. */
const VERB_ARG_OFFSET = 4;

/**
 * One row as text: its header line, then what it opened, its reopen step and its answer, indented.
 *
 * @param tool the page's row
 * @returns the row's lines
 */
function toolLines({ tool }: { tool: CallToolsPage["tools"][number] }): readonly string[] {
  let state = "answered";
  if (tool.refused) {
    state = "refused";
  }
  const lines = [`[${String(tool.index)}] ${tool.atIso}  ${tool.name} (${state}) — ${tool.detail}`];
  if (typeof tool.opened === "string") {
    lines.push(`    opened ${tool.opened}`);
  }
  if (tool.reopenReminder !== undefined) {
    const { elapsedSinceArmedMs, phase, previousCallId, windowMs } = tool.reopenReminder;
    lines.push(
      `    reopen reminder: phase ${phase}; ${String(elapsedSinceArmedMs)} ms since armed; window ${String(windowMs)} ms; previous call ${previousCallId}`,
    );
  }
  if (tool.answer === null) {
    lines.push("    no answer kept: no model was handed one, or the line was written before answers were kept");
  } else {
    lines.push(...tool.answer.split("\n").map((line) => `    ${line}`));
  }
  return lines;
}

/**
 * A page as text: one header line per row, then its answer indented, exactly as kept.
 *
 * @internal — {@link runTalkCallTools} is this module's public surface; exported for its own unit test.
 * @returns the lines to print
 */
export function callToolsLines({ page }: { page: CallToolsPage }): readonly string[] {
  if (page.total === 0) {
    return [`talk call-tools: call ${page.callId} ran no tool`];
  }
  if (page.tools.length === 0) {
    return [`talk call-tools: call ${page.callId} has ${String(page.total)} tool line(s); --from is past the last`];
  }
  const shown = `${String(page.from)}–${String(page.from + page.tools.length - 1)}`;
  let next = "the last of them";
  if (page.nextFrom !== null) {
    next = `next page --from ${String(page.nextFrom)}`;
  }
  const header = `talk call-tools: call ${page.callId}, tool lines ${shown} of ${String(page.total)} — ${next}`;
  return [header, ...page.tools.flatMap((tool) => toolLines({ tool }))];
}

/**
 * Run the `talk call-tools` verb.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export function runTalkCallTools(argv: readonly string[]): number {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: TALK_CALL_TOOLS_USAGE });
    return EXIT_OK;
  }
  const parsed = parseCallToolsArgs({ rest });
  if (parsed.isErr()) {
    logger.error({ msg: parsed.error.message });
    logger.error({ msg: TALK_CALL_TOOLS_USAGE });
    return EXIT_USAGE;
  }
  const { callId, from, json, limit } = parsed.value;
  const home = talkHomeOf({ home: parsed.value.home });
  const path = join(callsDir({ home }), `${callId}.jsonl`);
  if (!existsSync(path)) {
    logger.error({ msg: `talk call-tools: no file for call ${callId} at ${path}` });
    return EXIT_ERROR;
  }
  const read = readCallEntriesCounted({ callId, home });
  if (read.isErr()) {
    logger.error({ msg: `talk call-tools: ${read.error.message}` });
    return EXIT_ERROR;
  }
  const page = callToolsPage({ callId, entries: read.value.entries, from, limit });
  if (json) {
    logger.out({ line: safeJsonStringify({ label: "talk call-tools page", value: page }) });
    return EXIT_OK;
  }
  for (const line of callToolsLines({ page })) {
    logger.out({ line });
  }
  return EXIT_OK;
}

export const talkCallToolsCommand = defineCommand({ run: runTalkCallTools });
