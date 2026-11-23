/**
 * `slopweaver autonomy qualify` — write one stored act's bare GitHub references as `owner/repo#N`, in place.
 *
 * The repair `../../../autonomy/reviseStore.ts` performs, behind a dry run: a bare `#N` in an act's `why`
 * made `briefing check` refuse every chair page, and nothing else could reach a stored act — the
 * ledger is append-only and `why` is an identity field. The repository is NAMED by the caller and never guessed:
 * which repository a bare number belongs to is a fact the act does not carry, which is why it rendered bare.
 */
import type { AutonomyError } from "../../../autonomy/errors.js";
import type { AutonomyQualification } from "../../../autonomy/reviseStore.js";
import { qualifyStoredAct } from "../../../autonomy/reviseStore.js";
import type { AutonomyStoreError } from "../../../autonomy/storeErrors.js";
import { productionAutonomyStoreSeams } from "../../../autonomy/storeRows.js";
import { logger } from "../../../lib/logger.js";
import type { Result } from "../../../lib/result.js";
import type { RepoRef } from "../../../outbound/linkify/bareRefs.js";
import { isGithubRepoRef } from "../../../outbound/linkify/githubRepoRef.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";

import { parseAutonomyQualifyArgs, QUALIFY_USAGE, VERB_ARG_OFFSET } from "./core.js";

/** Everything `autonomy qualify` touches outside itself, injected so a test drives the whole verb. */
export interface AutonomyQualifyDeps {
  readonly now: () => string;
  readonly writeOut: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
  /** The repair itself — production's runs `qualifyStoredAct` over the store. */
  readonly qualify: (request: {
    readonly home: string;
    readonly actionId: string;
    readonly repo: RepoRef;
    readonly nowIso: string;
    readonly apply: boolean;
  }) => Promise<Result<AutonomyQualification, AutonomyError | AutonomyStoreError>>;
}

/**
 * The repository a `--repo` value names, or undefined when it is not one `owner/repo` pair GitHub could hold.
 *
 * @param raw the value as typed
 * @returns the repository, or undefined
 */
export function parseRepoFlag({ raw }: { raw: string }): RepoRef | undefined {
  const [owner, repo, ...rest] = raw.split("/");
  if (owner === undefined || repo === undefined || rest.length > 0) {
    return undefined;
  }
  return isGithubRepoRef({ owner, repo }) ? { owner, repo } : undefined;
}

/**
 * The report a qualification prints: the act, each field before and after, and whether it was written.
 *
 * @param qualification what the repair did, or would do
 * @returns the lines to print
 */
export function qualificationReportLines({
  qualification,
}: {
  qualification: AutonomyQualification;
}): readonly string[] {
  const fields = qualification.changed.flatMap(({ field, before, after }) => [
    `  ${field} before: ${before}`,
    `  ${field} after:  ${after}`,
  ]);
  const tail = qualification.applied
    ? "  applied; the original is quoted in the act's own witness"
    : "  nothing was written — pass --apply to install this";
  return [`autonomy qualify: ${qualification.actionId}`, ...fields, tail];
}

/**
 * Run `autonomy qualify` against injected seams.
 *
 * @param rest the argv tail after `autonomy qualify`
 * @param deps everything the verb touches outside itself
 * @returns the process exit code
 */
export async function runAutonomyQualify({
  rest,
  deps,
}: {
  rest: readonly string[];
  deps: AutonomyQualifyDeps;
}): Promise<number> {
  if (rest.includes("--help") || rest.includes("-h")) {
    deps.writeOut(QUALIFY_USAGE);
    return EXIT_OK;
  }
  const parsed = parseAutonomyQualifyArgs({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((problem) => {
      deps.writeDiagnostic(problem);
    });
    deps.writeDiagnostic(QUALIFY_USAGE);
    return EXIT_USAGE;
  }
  const { positionals, values } = parsed.value;
  const rawRepo = values["repo"];
  const repo = typeof rawRepo === "string" ? parseRepoFlag({ raw: rawRepo }) : undefined;
  if (positionals.length !== 1 || repo === undefined) {
    deps.writeDiagnostic("autonomy qualify: name exactly one act id, and --repo as owner/repo");
    deps.writeDiagnostic(QUALIFY_USAGE);
    return EXIT_USAGE;
  }
  const home = values["home"];
  const qualified = await deps.qualify({
    actionId: positionals[0]!,
    apply: values["apply"] === true,
    home: resolveHome({ named: typeof home === "string" ? home : undefined }),
    nowIso: deps.now(),
    repo,
  });
  if (qualified.isErr()) {
    deps.writeDiagnostic(`autonomy qualify: ${qualified.error.message}`);
    return EXIT_ERROR;
  }
  qualificationReportLines({ qualification: qualified.value }).forEach((line) => {
    deps.writeOut(line);
  });
  return EXIT_OK;
}

/**
 * The real seams: the machine clock, the two output channels and the store.
 *
 * @returns the production dependencies for {@link runAutonomyQualify}
 */
export function productionAutonomyQualifyDeps(): AutonomyQualifyDeps {
  return {
    now: () => new Date().toISOString(),
    qualify: (request) => qualifyStoredAct({ ...request, seams: productionAutonomyStoreSeams() }),
    writeDiagnostic: (line) => {
      logger.error({ msg: line });
    },
    writeOut: (line) => {
      logger.out({ line });
    },
  };
}

/** `slopweaver autonomy qualify`. */
export const autonomyQualifyCommand = defineCommand({
  run: (argv) => runAutonomyQualify({ deps: productionAutonomyQualifyDeps(), rest: argv.slice(VERB_ARG_OFFSET) }),
});
