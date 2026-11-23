/**
 * `slopweaver cmux templates` — every launch template, what it leaves out, and what it loads at launch,
 * measured off the files in this checkout rather than remembered.
 *
 * The before-and-after the owner's rightsizing ruling asks for (`src/cmux/launchTemplate.ts`): the `code` row
 * is what every seat paid before templates existed, and each other row is what that kind of seat pays now.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { alwaysOnEntry, alwaysOnPaths, UNSCOPED_RULES } from "../../../canon/alwaysOnDocs.js";
import { measureLaunchTemplates } from "../../../cmux/launchTemplate.js";
import { runningCheckoutRoot } from "../../../lib/gitRepo.js";
import { logger } from "../../../lib/logger.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";

import { cmuxUsage, parseCmuxArgs, VERB_ARG_OFFSET } from "./core.js";

/**
 * Run `cmux templates`.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export function runCmuxTemplates(argv: readonly string[]): number {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: cmuxUsage({ verb: "templates" }) });
    return EXIT_OK;
  }
  const parsed = parseCmuxArgs({ rest, verb: "templates" });
  if (parsed.isErr()) {
    parsed.error.forEach((error) => {
      logger.error({ msg: error });
    });
    return EXIT_USAGE;
  }
  const root = runningCheckoutRoot();
  const readDoc = ({ path }: { path: string }): string | undefined => {
    const full = join(root, path);
    return existsSync(full) ? readFileSync(full, "utf8") : undefined;
  };
  const entry = alwaysOnEntry({ exists: ({ path }) => existsSync(join(root, path)) });
  const paths = alwaysOnPaths({ entry, readDoc, unscopedRules: UNSCOPED_RULES });
  const alwaysOn = paths.map((path) => ({ content: readDoc({ path }), path }));
  const missing = alwaysOn.filter((doc) => doc.content === undefined).map((doc) => doc.path);
  if (missing.length > 0) {
    logger.error({ msg: `cmux templates: cannot measure — unreadable in ${root}: ${missing.join(", ")}` });
    return EXIT_ERROR;
  }
  const measured = measureLaunchTemplates({
    alwaysOn: alwaysOn.map((doc) => ({ content: doc.content!, path: doc.path })),
  });
  if (parsed.value.values["json"] === true) {
    logger.out({ line: JSON.stringify(measured) });
    return EXIT_OK;
  }
  for (const row of measured) {
    const leaves = row.excluded.length === 0 ? "nothing" : row.excluded.join(", ");
    logger.out({ line: `${row.template}\t${row.bytes} bytes ≈${row.approximateTokens} tokens\t${row.purpose}` });
    logger.out({ line: `\tleaves out: ${leaves}` });
  }
  logger.out({ line: `measured in ${root}; tokens are ceil(bytes / 4), a heuristic, not a tokenizer count` });
  logger.out({ line: "codex seats: no template applies — codex expands no @ import, so it never loads the three" });
  return EXIT_OK;
}

export const cmuxTemplatesCommand = defineCommand({ run: runCmuxTemplates });
