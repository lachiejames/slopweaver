/**
 * `slopweaver pane pr-status` — a one-shot read of `collectPrStatus`, printed as JSON: the owner's own open
 * pull requests, ranked, with why each one is blocked, as a single command the console's live reads
 * (`site/lib/liveVerbs.ts`) and a live routing capability can run mid-turn.
 *
 * The repositories it watches are `--pr-repos`, or the current checkout's own `origin` when that is absent.
 */
import { slopweaverHome } from "../../../config.js";
import { logger } from "../../../lib/logger.js";
import type { Result } from "../../../lib/result.js";
import { readCommand } from "../../../measurement/measure.js";
import { collectPrStatus } from "../../../pane/sections/prStatusCollect.js";
import { parsePrRepos, repoFromRemote } from "../../../pane/sections/prStatusDecode.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { type ParsedFlags, parseFlags } from "../../parseFlags.js";

export const PANE_PR_STATUS_USAGE = "usage: slopweaver pane pr-status [--pr-repos <value>] [--repo <dir>] --json";

export const PANE_PR_STATUS_FLAG_NAMES = ["--pr-repos", "--repo", "--json"] as const;

const VERB_ARG_OFFSET = 4;

/**
 * Parse the pr-status argv tail without performing I/O.
 *
 * @param rest the argv tail after `pane pr-status`
 * @returns parsed flags or their syntax errors
 */
export function parsePanePrStatusArgs({ rest }: { rest: readonly string[] }): Result<ParsedFlags> {
  return parseFlags({ args: rest, spec: { boolean: ["json"], string: ["pr-repos", "repo"] } });
}

/**
 * Which repositories to watch — `--pr-repos`, falling back to the current checkout's own `origin` remote when
 * it names none.
 */
function reposFrom({ values }: { values: Readonly<Record<string, string | boolean>> }): {
  repos: ReturnType<typeof parsePrRepos>["repos"];
  refused: readonly string[];
} {
  const declared = values["pr-repos"];
  if (typeof declared === "string") {
    return parsePrRepos({ value: declared });
  }
  const repoRoot = typeof values["repo"] === "string" ? values["repo"] : process.cwd();
  const remote = readCommand({ args: ["remote", "get-url", "origin"], command: "git", cwd: repoRoot });
  if (!remote.known) {
    return {
      refused: [`no --pr-repos was given and ${repoRoot}'s origin could not be read: ${remote.why}`],
      repos: [],
    };
  }
  const nameWithOwner = repoFromRemote({ url: remote.value });
  return nameWithOwner === undefined
    ? { refused: [`no --pr-repos was given and "${remote.value}" names no GitHub repository`], repos: [] }
    : { refused: [], repos: [{ nameWithOwner, tokenUser: undefined }] };
}

/**
 * Run the pr-status verb.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export function runPanePrStatus(argv: readonly string[]): number {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: PANE_PR_STATUS_USAGE });
    return EXIT_OK;
  }
  const parsed = parsePanePrStatusArgs({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((problem) => {
      logger.error({ msg: problem });
    });
    logger.error({ msg: PANE_PR_STATUS_USAGE });
    return EXIT_USAGE;
  }
  if (parsed.value.values["json"] !== true) {
    logger.error({ msg: "--json is required" });
    logger.error({ msg: PANE_PR_STATUS_USAGE });
    return EXIT_USAGE;
  }
  const { refused, repos } = reposFrom({ values: parsed.value.values });
  if (refused.length > 0) {
    refused.forEach((problem) => {
      logger.error({ msg: problem });
    });
    return EXIT_ERROR;
  }
  const repoRoot = typeof parsed.value.values["repo"] === "string" ? parsed.value.values["repo"] : process.cwd();
  const section = collectPrStatus({
    cwd: repoRoot,
    home: slopweaverHome(),
    nowMs: Date.now(),
    read: readCommand,
    repos,
  });
  logger.out({ line: JSON.stringify(section) });
  return EXIT_OK;
}

export const panePrStatusCommand = defineCommand({ run: runPanePrStatus });
