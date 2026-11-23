/** `slopweaver github self-review` — dispatches to the named sub-verb's own effectful shell. */
import { defineCommand } from "../../defineCommand.js";
import { EXIT_USAGE } from "../../exitCodes.js";
import { GITHUB_SELF_REVIEW_RELEASE_USAGE } from "./prUsage.js";
import { productionGithubSelfReviewReleaseDeps, runGithubSelfReviewRelease } from "./selfReviewReleaseRun.js";

/** Where this verb's own arguments start: after node, the script, "github" and "self-review". */
const VERB_ARG_OFFSET = 4;

const SUB_VERBS = ["release"] as const;

/** Injectable output sink, for the one line this dispatcher can itself print. */
export interface GithubSelfReviewDispatchDeps {
  readonly writeDiagnostic: (line: string) => void;
}

const DEFAULT_DEPS: GithubSelfReviewDispatchDeps = {
  writeDiagnostic: (line) => process.stderr.write(`${line}\n`),
};

/**
 * Dispatch one `github self-review` invocation to its named sub-verb.
 *
 * @param argv the full process argv; this verb's own arguments begin after node, CLI, "github" and "self-review"
 * @param deps the injectable diagnostic sink
 * @returns the process exit code
 */
export function runGithubSelfReview({
  argv,
  deps = DEFAULT_DEPS,
}: {
  argv: readonly string[];
  deps?: GithubSelfReviewDispatchDeps;
}): number {
  const subVerb = argv[VERB_ARG_OFFSET];
  if (subVerb === "release") {
    return runGithubSelfReviewRelease({
      deps: productionGithubSelfReviewReleaseDeps(),
      rest: argv.slice(VERB_ARG_OFFSET + 1),
    });
  }
  deps.writeDiagnostic(`usage: slopweaver github self-review <${SUB_VERBS.join("|")}> [...]`);
  deps.writeDiagnostic(GITHUB_SELF_REVIEW_RELEASE_USAGE);
  return EXIT_USAGE;
}

/** `slopweaver github self-review`. */
export const githubSelfReviewCommand = defineCommand({
  run: (argv: readonly string[]) => runGithubSelfReview({ argv }),
});
