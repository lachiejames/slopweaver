/**
 * `slopweaver ruling` — the owner's ruling register, `$SLOPWEAVER_HOME/rulings.jsonl`, by category.
 *
 * `record` files one ruling in the owner's words and refuses while a current ruling in the same category stands
 * beside it undisposed, printing that earlier ruling in full so the session recording it reads the two together;
 * `list` reads the register by category; `seed` files the rulings already written in the supervisor state documents'
 * `### RULINGS` sections, exactly as written; `view` publishes the one read-only page. The register's rules are
 * `../../../ruling/registry.ts`'s; this verb parses flags, reads, prints, and writes only through
 * `../../../ruling/store.ts`'s locked append. Each verb's body is in its own file beside this one.
 */
import { randomBytes } from "node:crypto";

import { slopweaverHome } from "../../../config.js";
import { logger } from "../../../lib/logger.js";
import { productionPublishPage } from "../../../pages/productionPublish.js";
import { stateHomePaths } from "../../../stateHome.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { flagValue } from "../../optionParsers.js";
import { runList, runView } from "./read.js";
import { runRecord } from "./record.js";
import { runSeed } from "./seed.js";
import { isRulingVerb, parseRulingArgs, RULING_USAGE, type RulingDeps } from "./shared.js";

/**
 * Run a `ruling` verb over injected dependencies — the testable shell.
 *
 * @param argv the full process argv (`ruling <verb>` starts at index 2)
 * @param deps the effectful seams
 * @returns the process exit code
 */
export async function runRulingWithDeps({
  argv,
  deps,
}: {
  argv: readonly string[];
  deps: RulingDeps;
}): Promise<number> {
  const verb = argv[3];
  const rest = argv.slice(4);
  if (isRulingVerb(verb) && (rest.includes("--help") || rest.includes("-h"))) {
    deps.logger.out({ line: RULING_USAGE[verb] });
    return EXIT_OK;
  }
  const parsed = parseRulingArgs({ rest, verb });
  if (parsed.isErr()) {
    parsed.error.forEach((problem) => {
      deps.logger.error({ msg: problem });
    });
    return EXIT_USAGE;
  }
  const args = parsed.value;
  const home = homeOf({ deps, named: flagValue({ name: "home", parsed: args.parsed }) });
  const file = stateHomePaths({ home }).rulingsJsonl;
  switch (args.verb) {
    case "list":
      return runList({ args, deps, file });
    case "record":
      return runRecord({ args, deps, file, home });
    case "seed":
      return runSeed({ args, deps, file, home });
    case "view":
      return runView({ deps, file, home });
  }
}

/**
 * The state home a verb reads: the one `--home` named, else the deps' own. An early return rather than a ternary
 * or `??`, because that is the one spelling both `no-silent-fallback` and oxlint's `prefer-nullish-coalescing` pass.
 */
function homeOf({ named, deps }: { named: string | null; deps: RulingDeps }): string {
  if (named === null) {
    return deps.home();
  }
  return named;
}

/** Production dependencies. */
function productionRulingDeps(): RulingDeps {
  return {
    home: slopweaverHome,
    logger,
    newId: () => `ruling-${randomBytes(6).toString("hex")}`,
    nowIso: () => new Date().toISOString(),
    publish: productionPublishPage,
  };
}

/**
 * Run a `ruling` verb.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runRuling(argv: readonly string[]): Promise<number> {
  return runRulingWithDeps({ argv, deps: productionRulingDeps() });
}

export const rulingCommand = defineCommand({ run: runRuling });
