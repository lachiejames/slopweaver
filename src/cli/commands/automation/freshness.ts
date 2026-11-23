/**
 * `slopweaver automation freshness` — how current each provider's stored data is, the small report the console polls
 * on every page so it can say plainly when what the owner is looking at may be stale.
 *
 * The lightweight sibling of `automation status`: that one carries every firing and sync run for the Automations page
 * and runs to hundreds of kilobytes, this one is a row per source. The judgement is the Fleet Briefing's own
 * (`../briefing/freshnessProjection.ts`), corpus half only, projected by `../../../briefing/sourceFreshness.ts`.
 */
import { projectSourceFreshness, sourceFreshnessLines } from "../../../briefing/sourceFreshness.js";
import { slopweaverHome } from "../../../homeDir.js";
import { FETCHABLE_SOURCES } from "../../../integrations/corpusSources.js";
import { logger } from "../../../lib/logger.js";
import type { Result } from "../../../lib/result.js";
import { safeJsonStringify } from "../../../lib/safeJson.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { type ParsedFlags, parseFlags } from "../../parseFlags.js";
import { gatherCorpusFreshness } from "../briefing/freshnessProjection.js";
import { RECIPE_FRESHNESS_FLAG_SPEC, RECIPE_FRESHNESS_USAGE } from "./freshnessUsage.js";

/** Where the flag tail starts: past the runtime, the script, the `recipe` noun and the `freshness` verb. */
const VERB_ARG_OFFSET = 4;

/**
 * The flag tail, parsed against the verb's one spec.
 *
 * @param rest the arguments after `automation freshness`
 * @returns the parsed flags, or the lines naming each flag it refused
 */
export function parseRecipeFreshnessArgs({ rest }: { rest: readonly string[] }): Result<ParsedFlags> {
  return parseFlags({
    args: rest,
    spec: { boolean: [...RECIPE_FRESHNESS_FLAG_SPEC.boolean], string: [...RECIPE_FRESHNESS_FLAG_SPEC.string] },
  });
}

/**
 * The verb entry point.
 *
 * @param argv the whole process argv
 * @returns the process exit code — `EXIT_OK` for any report, `EXIT_USAGE` for a bad flag
 */
export async function runRecipeFreshness({ argv }: { readonly argv: readonly string[] }): Promise<number> {
  const parsed = parseRecipeFreshnessArgs({ rest: argv.slice(VERB_ARG_OFFSET) });
  if (parsed.isErr()) {
    parsed.error.forEach((line) => process.stderr.write(`${line}\n`));
    process.stderr.write(`${RECIPE_FRESHNESS_USAGE}\n`);
    return EXIT_USAGE;
  }
  const homeFlag = parsed.value.values["home"];
  const home = typeof homeFlag === "string" ? homeFlag : slopweaverHome();
  // ONE instant for the whole read, so every age in the report is measured against the same clock.
  const nowIso = new Date().toISOString();
  const { projection, rosterProblems } = await gatherCorpusFreshness({ home, nowIso });
  const report = projectSourceFreshness({ nowIso, rosterProblems, rows: projection.rows, sources: FETCHABLE_SOURCES });
  if (parsed.value.values["json"] === true) {
    logger.out({ line: safeJsonStringify({ label: "automation freshness", value: report }) });
    return EXIT_OK;
  }
  sourceFreshnessLines({ report }).forEach((line) => {
    logger.out({ line });
  });
  return EXIT_OK;
}

export const recipeFreshnessCommand = defineCommand({
  run: (argv) => runRecipeFreshness({ argv }),
});
