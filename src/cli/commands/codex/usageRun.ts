/**
 * `slopweaver codex usage` — what the Codex passes on this machine have actually cost, and whether a further
 * review pass on one diff is buying anything.
 *
 * Read-only. It scans the pass ledger, folds it with `../../../codex/usageReport.ts` and prints it with
 * `../../../codex/usageRender.ts`; nothing here spends a Codex turn or touches the network, which is why its
 * manifest row is `diagnostic` like `gauge`, `route` and `signin`.
 *
 * Three things about this shell rather than the modules under it:
 *
 *  - **`--rates <path>` is the ONLY source of money.** There is no bundled tariff and no default path — a
 *    rate card is installation state, so it is named on the command line or there are no dollars at all.
 *    An unreadable or invalid card is a REFUSAL, not a silent fall back to token counts: pricing nothing
 *    while the operator believes a card was applied is the failure this verb would otherwise have.
 *  - **`--diff-sha256 <sha>` selects the marginal reading**, which is otherwise absent. The default report
 *    is about a checkout; the marginal reading is about one diff inside it, and a reader who did not ask for
 *    one should not be shown an ordinal for a diff they did not name.
 *  - **`--repo <dir>` scopes the count to one checkout**, resolved through `gitDiff.ts` so a path inside a
 *    worktree resolves to the worktree's own root — the same resolution the recorded `repoRoot` used.
 *
 * `./statusRun.ts` is the sibling this copies; both read what the spending verbs wrote.
 */

import { scanPassRecords } from "../../../codex/ledgerStore.js";
import type { MarginalTarget } from "../../../codex/marginalYield.js";
import type { CodexRateCard } from "../../../codex/pricing.js";
import type { CodexPricingError } from "../../../codex/pricingErrors.js";
import { readCodexRateCard } from "../../../codex/pricingStore.js";
import { renderCodexUsageReport } from "../../../codex/usageRender.js";
import { buildCodexUsageReport } from "../../../codex/usageReport.js";
import { logger } from "../../../lib/logger.js";
import { ok, type Result } from "../../../lib/result.js";
import { safeJsonStringify } from "../../../lib/safeJson.js";
import { stateHomePaths } from "../../../stateHome.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";
import { type FlagSpec, type ParsedFlags, parseFlags } from "../../parseFlags.js";
import { codexRepoRoot } from "./repoScope.js";

/** How many argv entries precede a verb's own flags (`node`, `slopweaver`, `codex`, `usage`). */
const VERB_ARG_OFFSET = 4;

/** The flags `codex usage` accepts. Names omit the leading `--`, which is what `parseFlags` expects. */
const USAGE_FLAGS = {
  boolean: ["json"],
  string: ["repo", "home", "diff-sha256", "rates"],
} as const satisfies FlagSpec;

/**
 * The same flags, `--`-prefixed, for the help-truth ratchet — derived from {@link USAGE_FLAGS} rather than
 * retyped, for the reason `./statusRun.ts` gives: two hand-written lists is how a usage string drifts from
 * the parser it claims to describe.
 */
export const CODEX_USAGE_FLAG_NAMES: readonly string[] = [...USAGE_FLAGS.string, ...USAGE_FLAGS.boolean]
  .map((name) => `--${name}`)
  .toSorted();

/**
 * Parse `codex usage` flags. Exported so the help-truth ratchet probes the REAL parser.
 *
 * @param rest the verb's argument tail
 * @returns the parsed flags, or the errors
 */
export function parseCodexUsageArgs({ rest }: { rest: readonly string[] }): Result<ParsedFlags> {
  return parseFlags({ args: rest, spec: USAGE_FLAGS });
}

/** One declared string flag, or `undefined` — a boolean reaching a path expecting text must not stringify. */
function stringFlag({ parsed, name }: { parsed: ParsedFlags; name: string }): string | undefined {
  const value = parsed.values[name];
  return typeof value === "string" ? value : undefined;
}

/** Usage for `codex usage`, kept beside the verb so `--help` and the parser share one string. */
const USAGE_TEXT =
  "usage: slopweaver codex usage [--repo <dir>] [--home <dir>] [--diff-sha256 <sha>] [--rates <path>] [--json]\n" +
  "\n" +
  "Counts every recorded Codex pass in this checkout: how many ran per arm, what each found, and how many\n" +
  "carry an attempt the SDK never reported usage for. A pass nobody measured is COUNTED, never summed as\n" +
  "zero, and every pass kind gets a row including the ones that never ran.\n" +
  "\n" +
  "  --diff-sha256   also report the marginal reading for that diff: which invocation the next review pass\n" +
  "                  on it would be, what the earlier ones found, and what that ordinal has found elsewhere.\n" +
  "  --rates         price the counted tokens from THIS card. There is no bundled tariff and no default\n" +
  "                  path, so without it the report carries token counts and no dollars at all.";

/**
 * Load the rate card a caller named, or report that they named none.
 *
 * A missing flag is an `ok(undefined)` — the report says so itself. An unreadable or invalid card is an
 * ERROR: the operator asked for dollars, and quietly printing a report without them would look identical to
 * the run they did not ask for. The failure stays in the `Result` channel carrying pricing's own typed error
 * rather than being flattened into an exit code here, so the `code` distinguishing an unreadable card from
 * an invalid one survives to whichever caller wants it.
 *
 * @param path the `--rates` value, or undefined when the flag was absent
 * @returns the card, `undefined` when none was asked for, or why the named one could not be used
 */
function loadRateCard({ path }: { path: string | undefined }): Result<CodexRateCard | undefined, CodexPricingError> {
  if (path === undefined) {
    return ok(undefined);
  }
  return readCodexRateCard({ path });
}

/**
 * Report what the Codex passes in one checkout have cost.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runCodexUsage(argv: readonly string[]): Promise<number> {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: USAGE_TEXT });
    return EXIT_OK;
  }
  const parsed = parseCodexUsageArgs({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((problem) => {
      logger.error({ msg: problem });
    });
    logger.error({ msg: USAGE_TEXT });
    return EXIT_USAGE;
  }
  const repoRoot = codexRepoRoot({ repo: stringFlag({ name: "repo", parsed: parsed.value }) });
  if (repoRoot.isErr()) {
    logger.error({ msg: `codex usage: ${repoRoot.error.message}` });
    return EXIT_ERROR;
  }
  const rateCard = loadRateCard({ path: stringFlag({ name: "rates", parsed: parsed.value }) });
  if (rateCard.isErr()) {
    logger.error({ msg: "codex usage: the rate card could not be used, so nothing was priced:" });
    rateCard.error.problems.forEach((problem) => {
      logger.error({ msg: `  ${problem}` });
    });
    return EXIT_ERROR;
  }
  return reportUsage({
    diffSha256: stringFlag({ name: "diff-sha256", parsed: parsed.value }),
    home: stringFlag({ name: "home", parsed: parsed.value }),
    json: parsed.value.values["json"] === true,
    rateCard: rateCard.value,
    repoRoot: repoRoot.value,
  });
}

/**
 * Scan, fold and print.
 *
 * Split from the argument handling so the whole read is one function with no argv in it — the shape
 * `./statusRun.ts`'s `renderStatus` has, for the same reason.
 *
 * @param diffSha256 the diff to add a marginal reading for, or undefined for none
 * @param home the state home to read the pass ledger from, defaulting to this install's
 * @param json emit one machine-readable document instead of the rendered lines
 * @param rateCard the validated card, or undefined when the caller supplied none
 * @param repoRoot the checkout whose passes are counted
 * @returns the process exit code
 */
function reportUsage({
  diffSha256,
  home,
  json,
  rateCard,
  repoRoot,
}: {
  diffSha256: string | undefined;
  home: string | undefined;
  json: boolean;
  rateCard: CodexRateCard | undefined;
  repoRoot: string;
}): number {
  const resolvedHome = resolveHome({ named: home });
  const scan = scanPassRecords({ orchestrationRoot: stateHomePaths({ home: resolvedHome }).orchestration });
  if (scan.isErr()) {
    logger.error({ msg: `codex usage: ${scan.error.message}` });
    return EXIT_ERROR;
  }
  const target: MarginalTarget | undefined = diffSha256 === undefined ? undefined : { diffSha256, repoRoot };
  const report = buildCodexUsageReport({ rateCard, repoRoot, scan: scan.value, target });
  if (json) {
    logger.out({ line: safeJsonStringify({ label: "codex usage report", value: report }) });
    return EXIT_OK;
  }
  for (const line of renderCodexUsageReport({ report })) {
    logger.out({ line });
  }
  return EXIT_OK;
}

export const codexUsageCommand = defineCommand({ run: runCodexUsage });
