/**
 * `slopweaver github watchers` — who is watching each pull request, read from the checks-read register.
 *
 * The pull-request page's watched column is what this is for — a local fold over one JSONL file, no
 * GitHub call, so it sits on the console's fast lane (`site/lib/liveVerbs.ts`, slug `watchers`). `--json` prints
 * ONE object with `observedAtIso` at the top — the instant the register was folded, which is the instant
 * the answer was true — so the tile stamps it as its own.
 *
 * A register that cannot be read is `EXIT_ERROR`, never an empty answer: an unreadable register shown as
 * "nobody is watching" is the confident-but-wrong row the trust class exists to end.
 */
import { logger } from "#lib/logger.js";
import type { Result } from "#lib/result.js";
import { safeJsonStringify } from "#lib/safeJson.js";
import {
  type ChecksReadError,
  type ChecksReadRow,
  readChecksReadLedger,
} from "../../../outbound/github/checksReadLedger.js";
import { type PullRequestWatch, watchersOf } from "../../../outbound/github/watchers.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";

import { githubWatchersUsage } from "./reportUsage.js";
import { githubWatchersArgsOf, parseGithubWatchersArgs, renderWatchers } from "./watchersCore.js";

/** argv positions before this verb's own arguments: `node`, `index.js`, `github`, `watchers`. */
const VERB_ARG_OFFSET = 4;

/** Everything `github watchers` touches outside itself, injected so a test drives the whole verb. */
export interface GithubWatchersDeps {
  readonly readLedger: (args: { home: string | undefined }) => Result<readonly ChecksReadRow[], ChecksReadError>;
  readonly now: () => string;
  readonly writeOut: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
}

/**
 * Run `github watchers` against injected seams.
 *
 * @param rest the argv tail after `github watchers`
 * @param deps everything the verb touches outside itself
 * @returns the process exit code
 */
export function runGithubWatchers({ rest, deps }: { rest: readonly string[]; deps: GithubWatchersDeps }): number {
  if (rest.includes("--help") || rest.includes("-h")) {
    deps.writeOut(githubWatchersUsage());
    return EXIT_OK;
  }
  const parsed = parseGithubWatchersArgs({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((problem) => {
      deps.writeDiagnostic(problem);
    });
    deps.writeDiagnostic(githubWatchersUsage());
    return EXIT_USAGE;
  }
  const args = githubWatchersArgsOf({ values: parsed.value.values });
  const rows = deps.readLedger({ home: args.home });
  if (rows.isErr()) {
    deps.writeDiagnostic(`github watchers: ${rows.error.message}`);
    return EXIT_ERROR;
  }
  const observedAtIso = deps.now();
  const folded = watchersOf({ nowIso: observedAtIso, rows: rows.value });
  const entries: readonly PullRequestWatch[] =
    args.repo === undefined ? folded : folded.filter((entry) => entry.repo === args.repo);
  if (args.json) {
    deps.writeOut(safeJsonStringify({ label: "the watchers fold", value: { entries, observedAtIso } }));
    return EXIT_OK;
  }
  renderWatchers({ entries }).forEach((line) => {
    deps.writeOut(line);
  });
  return EXIT_OK;
}

/**
 * The real seams: the register on disk, the wall clock, the two output channels.
 *
 * @returns the production dependencies for {@link runGithubWatchers}
 */
export function productionGithubWatchersDeps(): GithubWatchersDeps {
  return {
    now: () => new Date().toISOString(),
    readLedger: ({ home }) => readChecksReadLedger(home === undefined ? {} : { home }),
    writeDiagnostic: (line) => {
      logger.error({ msg: line });
    },
    writeOut: (line) => {
      logger.out({ line });
    },
  };
}

/** `slopweaver github watchers`. */
export const githubWatchersCommand = defineCommand({
  run: (argv) => runGithubWatchers({ deps: productionGithubWatchersDeps(), rest: argv.slice(VERB_ARG_OFFSET) }),
});
