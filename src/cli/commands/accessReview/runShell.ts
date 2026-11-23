/**
 * The shell every `access-review` verb shares: the injected edges, the `--help` and parse-failure path, and
 * the one place a built report is turned into output.
 *
 * Three verbs differ in exactly two things — which platforms they gather, and how they render — so those are
 * what a caller supplies. Everything else written three times would be three chances to disagree about an
 * exit code, which is the drift `cli/commands/atlas/platformResolve.ts` exists to prevent on its own half.
 */
import { logger } from "#lib/logger.js";
import type { Result } from "#lib/result.js";

import { type AccessReviewReport, buildAccessReview } from "../../../accessReview/report.js";
import { EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";

import { type AccessReviewGatherDeps, gatherSources, productionAccessReviewGatherDeps } from "./gather.js";
import { type AccessReviewOptions, parseAccessReviewArgs } from "./options.js";

/** The injected edges, so a verb is testable with plain fakes rather than mocks. */
export interface AccessReviewDeps {
  readonly gather: AccessReviewGatherDeps;
  readonly writeOut: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
}

/**
 * The real edges.
 *
 * @returns the production dependencies, writing to the process's own streams
 *
 * @internal
 */
export function productionAccessReviewDeps(): AccessReviewDeps {
  return {
    gather: productionAccessReviewGatherDeps(),
    writeDiagnostic: (line) => process.stderr.write(`${line}\n`),
    writeOut: (line) => {
      logger.out({ line });
    },
  };
}

/** What one verb contributes beyond the shared shell. */
export interface AccessReviewVerb {
  readonly usage: string;
  readonly takesPlatform: boolean;
  /** The platforms this verb needs gathered, or every reason the invocation names none. */
  readonly platformsFor: (args: { options: AccessReviewOptions }) => Result<readonly string[]>;
  readonly render: (args: { report: AccessReviewReport; options: AccessReviewOptions }) => readonly string[];
  readonly json: (args: { report: AccessReviewReport; options: AccessReviewOptions }) => unknown;
  /** The exit code the built report earns; omitted verbs always exit 0. */
  readonly exitCodeFor?: (args: { report: AccessReviewReport }) => number;
}

/**
 * Run one access-review verb end to end.
 *
 * @param argv the whole process argv, as the CLI received it
 * @param offset where the flag tail starts, past the runtime, the script, the noun and the verb
 * @param verb what this verb contributes beyond the shared shell
 * @param deps the injected edges; omitted takes the production ones
 * @returns the process exit code
 */
export async function runAccessReviewVerb({
  argv,
  offset,
  verb,
  deps = productionAccessReviewDeps(),
}: {
  argv: readonly string[];
  offset: number;
  verb: AccessReviewVerb;
  deps?: AccessReviewDeps;
}): Promise<number> {
  const rest = argv.slice(offset);
  if (rest.includes("--help") || rest.includes("-h")) {
    deps.writeOut(verb.usage);
    return EXIT_OK;
  }
  const parsed = parseAccessReviewArgs({ rest, takesPlatform: verb.takesPlatform });
  if (parsed.isErr()) {
    parsed.error.forEach((line) => {
      deps.writeDiagnostic(line);
    });
    deps.writeDiagnostic(verb.usage);
    return EXIT_USAGE;
  }
  const options = parsed.value;
  const platforms = verb.platformsFor({ options });
  if (platforms.isErr()) {
    platforms.error.forEach((line) => {
      deps.writeDiagnostic(line);
    });
    deps.writeDiagnostic(verb.usage);
    return EXIT_USAGE;
  }
  const sources = await gatherSources({ deps: deps.gather, home: options.home, platforms: platforms.value });
  const report = buildAccessReview({ sources });
  if (options.json) {
    deps.writeOut(JSON.stringify(verb.json({ options, report }), null, 2));
  } else {
    verb.render({ options, report }).forEach((line) => {
      deps.writeOut(line);
    });
  }
  if (verb.exitCodeFor === undefined) {
    return EXIT_OK;
  }
  return verb.exitCodeFor({ report });
}
