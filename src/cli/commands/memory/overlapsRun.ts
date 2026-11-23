/**
 * `slopweaver memory overlaps` — what the write gate's overlap nomination would ask of every memory in one
 * corpus if each were written anew, now.
 *
 * Two jobs, one read. A writer about to add a memory sees what it will be asked to answer before the refusal
 * does it; and the thresholds in `src/memory/overlapNomination.ts` are MEASURED, so they need a command a
 * reader can run to re-measure them, rather than a number and a date. It edits nothing and exits 0 whatever
 * it finds: a standing overlap is a question for a writer, never a failure of the tool.
 *
 * The effectful edge is this file; the rule is `corpusOverlaps`, the same two functions the gate calls.
 */
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { safeJsonStringify } from "../../../lib/safeJson.js";
import { readCanonSections } from "../../../memory/canonReader.js";
import { corpusOverlaps } from "../../../memory/overlapNomination.js";
import { readMemoryCorpus } from "../../../memory/store.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { type FlagSpec, parseFlags } from "../../parseFlags.js";
import { requiredAbsolutePath, requiredDir, VERB_ARG_OFFSET } from "./args.js";

const USAGE = "usage: slopweaver memory overlaps --dir <path> --repo <path> [--json]";

/** The flags `memory overlaps` accepts. */
const FLAGS: FlagSpec = { boolean: ["json"], string: ["dir", "repo"] };

/** Every flag this verb accepts, `--`-prefixed, for the help-truth ratchet. */
export const MEMORY_OVERLAPS_FLAG_NAMES: readonly string[] = ["--dir", "--json", "--repo"];

/**
 * Parse `memory overlaps` flags. Exported so the ratchet probes the real parser; resolution is separate, so a
 * probe of `--json` alone is not refused for lacking `--dir`.
 *
 * @param rest the argv after the noun and verb
 * @returns the parsed flags
 */
export function parseMemoryOverlapsArgs({ rest }: { rest: readonly string[] }): ReturnType<typeof parseFlags> {
  return parseFlags({ args: rest, spec: FLAGS });
}

/** Both required paths, or every refusal — a caller who got both wrong is told about both. */
function resolvePaths({ rest }: { rest: readonly string[] }): Result<{ dir: string; repo: string; json: boolean }> {
  const parsed = parseMemoryOverlapsArgs({ rest });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const dir = requiredDir({ parsed: parsed.value });
  const repo = requiredAbsolutePath({
    key: "repo",
    parsed: parsed.value,
    why: "the canon a memory can contradict is the canon of the repository it loads beside",
  });
  if (dir.isOk() && repo.isOk()) {
    return ok({ dir: dir.value, json: parsed.value.values["json"] === true, repo: repo.value });
  }
  return err([...(dir.isOk() ? [] : [dir.error.message]), ...(repo.isOk() ? [] : [repo.error.message])]);
}

/**
 * Run `memory overlaps`.
 *
 * @param argv the full process argv (verb tail starts at {@link VERB_ARG_OFFSET})
 * @returns 0 whatever it finds, 2 on a bad flag, 1 when the corpus cannot be read
 */
export function runMemoryOverlaps(argv: readonly string[]): number {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: USAGE });
    return EXIT_OK;
  }
  const paths = resolvePaths({ rest });
  if (paths.isErr()) {
    paths.error.forEach((problem) => {
      logger.error({ msg: `memory overlaps: ${problem}` });
    });
    logger.error({ msg: USAGE });
    return EXIT_USAGE;
  }
  const { dir, json, repo } = paths.value;
  const corpus = readMemoryCorpus({ dir });
  if (corpus.isErr()) {
    logger.error({ msg: `memory overlaps: cannot read ${dir} — ${corpus.error.message}` });
    return EXIT_ERROR;
  }
  const report = corpusOverlaps({ leaves: corpus.value.leaves, sections: readCanonSections({ cwd: repo }) });
  if (json) {
    logger.out({ line: safeJsonStringify({ label: "memory overlaps report", value: report }) });
    return EXIT_OK;
  }
  const nominations = report.flatMap((entry) => entry.unanswered);
  const canon = nominations.filter((nomination) => nomination.kind === "canon").length;
  for (const entry of report) {
    logger.out({ line: entry.file });
    for (const nomination of entry.unanswered) {
      logger.out({ line: `  ${nomination.kind} ${nomination.id} — ${nomination.sharedTokens.join(", ")}` });
    }
  }
  logger.out({
    line:
      `memory overlaps: ${String(corpus.value.leaves.length)} leaves, ${String(nominations.length)} unanswered ` +
      `(${String(nominations.length - canon)} memory, ${String(canon)} canon)`,
  });
  return EXIT_OK;
}

export const memoryOverlapsCommand = defineCommand({ run: runMemoryOverlaps });
