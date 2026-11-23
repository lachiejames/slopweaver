/**
 * `slopweaver github press-reseal` — the effectful shell. Every decision lives in `../../../review/pressReseal.ts`;
 * this file parses argv, resolves the home, reads the clock and prints what the preview or the apply answered.
 *
 * The preview prints the exact apply line, digest included, so the apply is a copy of what was read rather than
 * a command composed by hand.
 */
import { logger } from "#lib/logger.js";
import { safeJsonStringify } from "#lib/safeJson.js";

import {
  applyPressReseal,
  type PressResealPlan,
  type PressResealSeams,
  previewPressReseal,
} from "../../../review/pressReseal.js";
import { productionPressResealSeams } from "../../../review/pressResealStoreRows.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";
import { parseGithubPressResealArgs } from "./pressResealArgs.js";
import { GITHUB_PRESS_RESEAL_USAGE } from "./pressResealUsage.js";

/** Where this verb's own arguments start in `process.argv`: after node, the script, the noun and the verb. */
const VERB_ARG_OFFSET = 4;

/** How many old -> new pairs a human-readable preview prints; `--json` carries every one. */
const SAMPLE_PAIRS = 5;

/** The edges the verb runs over. */
export interface PressResealDeps {
  readonly seams: PressResealSeams;
  readonly nowIso: () => string;
  readonly out: (request: { readonly line: string }) => void;
}

/**
 * The production edges.
 *
 * @returns the real store, the real clock and stdout
 */
function productionDeps(): PressResealDeps {
  return {
    nowIso: () => new Date().toISOString(),
    out: ({ line }) => {
      logger.out({ line });
    },
    seams: productionPressResealSeams(),
  };
}

/**
 * The apply line a preview prints, quoted so it can be pasted as it stands.
 *
 * @param repos the repositories named
 * @param sourceSha256 the digest the preview computed
 * @param home the home named, when one was
 * @returns the command line
 */
export function pressResealApplyLine({
  repos,
  sourceSha256,
  home,
}: {
  repos: readonly string[];
  sourceSha256: string;
  home: string | undefined;
}): string {
  const repoFlags = repos.map((repo) => `--repo ${repo}`).join(" ");
  const homeFlag = home === undefined ? "" : ` --home ${home}`;
  return (
    `slopweaver github press-reseal ${repoFlags} --apply --source-sha256 ${sourceSha256} ` +
    `--reason "<why>"${homeFlag}`
  );
}

/**
 * The human-readable lines of a plan.
 *
 * @param plan what the reseal would do, or did
 * @returns the lines: counts per repository, then a few sample pairs
 */
function planLines({ plan }: { plan: PressResealPlan }): readonly string[] {
  const lines = [
    `press register: ${String(plan.rowCount)} rows, ${String(plan.pairs.length)} stored under a key their fields do not hash to`,
    `sourceSha256: ${plan.sourceSha256}`,
    ...plan.perRepo.map((each) => `  ${each.repoSlug}: ${String(each.rows)} rows to re-key`),
    ...plan.pairs
      .slice(0, SAMPLE_PAIRS)
      .map((pair) => `  ${pair.repoSlug}#${String(pair.number)} ${pair.oldKey} -> ${pair.newKey}`),
  ];
  if (plan.pairs.length > SAMPLE_PAIRS) {
    lines.push(`  … and ${String(plan.pairs.length - SAMPLE_PAIRS)} more (--json lists every pair)`);
  }
  return lines;
}

/**
 * Print the preview's answer.
 *
 * @returns the process exit code
 */
async function runPreview({
  deps,
  home,
  namedHome,
  repos,
  asJson,
}: {
  deps: PressResealDeps;
  home: string;
  namedHome: string | undefined;
  repos: readonly string[];
  asJson: boolean;
}): Promise<number> {
  const planned = await previewPressReseal({ home, repos, seams: deps.seams });
  if (planned.isErr()) {
    deps.out({ line: `refused: ${planned.error.message}` });
    return EXIT_ERROR;
  }
  const plan = planned.value;
  const applyLine = pressResealApplyLine({ home: namedHome, repos, sourceSha256: plan.sourceSha256 });
  if (asJson) {
    deps.out({ line: safeJsonStringify({ label: "a press-reseal preview", value: { applyLine, plan } }) });
    return plan.pairs.length === 0 ? EXIT_EXPECTED_EMPTY : EXIT_OK;
  }
  for (const line of planLines({ plan })) {
    deps.out({ line });
  }
  if (plan.pairs.length === 0) {
    deps.out({ line: "nothing to reseal: every stored press sits under its own fields' hash." });
    return EXIT_EXPECTED_EMPTY;
  }
  deps.out({ line: "preview only — nothing was written. To apply exactly this:" });
  deps.out({ line: `  ${applyLine}` });
  return EXIT_OK;
}

/**
 * The whole `github press-reseal` verb, with its edges injected.
 *
 * @param argv the FULL process argv; this verb's own arguments start at {@link VERB_ARG_OFFSET}
 * @param deps the store seams, clock and output sink
 * @returns the process exit code
 */
export async function runGithubPressReseal({
  argv,
  deps = productionDeps(),
}: {
  argv: readonly string[];
  deps?: PressResealDeps;
}): Promise<number> {
  const parsed = parseGithubPressResealArgs({ rest: argv.slice(VERB_ARG_OFFSET) });
  if (parsed.isErr()) {
    for (const line of parsed.error) {
      deps.out({ line });
    }
    deps.out({ line: GITHUB_PRESS_RESEAL_USAGE });
    return EXIT_USAGE;
  }
  const args = parsed.value;
  const home = resolveHome({ named: args.home });
  if (args.mode === "preview") {
    return runPreview({ asJson: args.asJson, deps, home, namedHome: args.home, repos: args.repos });
  }
  const applied = await applyPressReseal({
    expectedSourceSha256: args.sourceSha256,
    home,
    nowIso: deps.nowIso(),
    reason: args.reason,
    repos: args.repos,
    seams: deps.seams,
  });
  if (applied.isErr()) {
    deps.out({ line: `refused: ${applied.error.message}` });
    return EXIT_ERROR;
  }
  const { plan, receiptPath } = applied.value;
  if (args.asJson) {
    deps.out({ line: safeJsonStringify({ label: "a press-reseal receipt", value: { plan, receiptPath } }) });
    return receiptPath === undefined ? EXIT_EXPECTED_EMPTY : EXIT_OK;
  }
  if (receiptPath === undefined) {
    deps.out({ line: "nothing to reseal: every stored press already sits under its own fields' hash." });
    return EXIT_EXPECTED_EMPTY;
  }
  for (const line of planLines({ plan })) {
    deps.out({ line });
  }
  deps.out({
    line: `resealed: ${String(plan.pairs.length)} rows re-keyed in one transaction; receipt appended to ${receiptPath}`,
  });
  return EXIT_OK;
}

/** The registered `press-reseal` command. Only `run` — every other field lives in `../../manifests/github.js`. */
export const githubPressResealCommand = defineCommand({
  run: (argv: readonly string[]) => runGithubPressReseal({ argv }),
});
