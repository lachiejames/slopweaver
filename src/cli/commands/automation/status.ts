/**
 * `slopweaver automation status` — every automation and corpus sync, as the Automations page shows them.
 *
 * Read-only for the same reason `automation due` is: the console polls it, so it must have no effects. It differs from
 * `due` in its question. `due` answers "what should this tick run"; this answers "what is each row doing, how has it
 * gone, and what did its syncs find" — the fields `../../../automations/read.ts` derives from the stores.
 */
import { loadAtlasQuestions } from "../../../automations/atlasQuestions.js";
import { automationsLines } from "../../../automations/lines.js";
import { readAutomations } from "../../../automations/read.js";
import { productionHoldsSlot } from "../../../automations/readLedgers.js";
import { slopweaverHome } from "../../../homeDir.js";
import { logger } from "../../../lib/logger.js";
import type { Result } from "../../../lib/result.js";
import { safeJsonStringify } from "../../../lib/safeJson.js";
import { recipeHolderAlive } from "../../../live/automation/holderLiveness.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { type ParsedFlags, parseFlags } from "../../parseFlags.js";
import { RECIPE_STATUS_FLAG_SPEC, RECIPE_STATUS_USAGE } from "./statusUsage.js";

/** Where the flag tail starts: past the runtime, the script, the `recipe` noun and the `status` verb. */
const VERB_ARG_OFFSET = 4;

/**
 * The flag tail, parsed against the verb's one spec.
 *
 * @param rest the arguments after `automation status`
 * @returns the parsed flags, or the lines naming each flag it refused
 */
export function parseRecipeStatusArgs({ rest }: { rest: readonly string[] }): Result<ParsedFlags> {
  return parseFlags({
    args: rest,
    spec: { boolean: [...RECIPE_STATUS_FLAG_SPEC.boolean], string: [...RECIPE_STATUS_FLAG_SPEC.string] },
  });
}

/**
 * The verb entry point.
 *
 * @param argv the whole process argv
 * @returns the process exit code — `EXIT_OK` for any report, `EXIT_USAGE` for a bad flag
 */
export async function runRecipeStatus({ argv }: { readonly argv: readonly string[] }): Promise<number> {
  const parsed = parseRecipeStatusArgs({ rest: argv.slice(VERB_ARG_OFFSET) });
  if (parsed.isErr()) {
    parsed.error.forEach((line) => process.stderr.write(`${line}\n`));
    process.stderr.write(`${RECIPE_STATUS_USAGE}\n`);
    return EXIT_USAGE;
  }
  const homeFlag = parsed.value.values["home"];
  const home = typeof homeFlag === "string" ? homeFlag : slopweaverHome();
  const report = readAutomations({
    atlas: await loadAtlasQuestions(),
    deps: { holdsSlot: productionHoldsSlot(), processAlive: recipeHolderAlive },
    home,
    nowIso: new Date().toISOString(),
  });
  if (parsed.value.values["json"] === true) {
    logger.out({ line: safeJsonStringify({ label: "automation status", value: report }) });
    return EXIT_OK;
  }
  automationsLines({ report }).forEach((line) => {
    logger.out({ line });
  });
  return EXIT_OK;
}

export const recipeStatusCommand = defineCommand({
  run: (argv) => runRecipeStatus({ argv }),
});
