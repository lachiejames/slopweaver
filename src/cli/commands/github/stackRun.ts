/** `slopweaver github stack` — dispatches to the named sub-verb's own effectful shell. */
import { logger } from "../../../lib/logger.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_USAGE } from "../../exitCodes.js";
import { githubVerbErrorLines } from "./errors.js";
import { runGithubStackRestack } from "./restackForestRun.js";
import { runGithubStackAdopt } from "./stackAdoptRun.js";
import { runGithubStackAudit } from "./stackAuditRun.js";
import { parseGithubStackDispatch } from "./stackCore.js";
import { runGithubStackDissolve } from "./stackDissolveRun.js";
import { runGithubStackPush } from "./stackPushRun.js";
import { runGithubStackRemove } from "./stackRemoveRun.js";
import { runGithubStackSubmit } from "./stackSubmitRun.js";
import { runGithubStackSync } from "./stackSyncRun.js";

/** Where this verb's own arguments start: after node, the script, "github" and "stack". */
const VERB_ARG_OFFSET = 4;

/** The injectable output sink, for the one line this dispatcher can itself print. */
export interface GithubStackDeps {
  readonly out: (input: { readonly line: string }) => void;
}

const DEFAULT_DEPS: GithubStackDeps = {
  out: logger.out,
};

/**
 * Dispatch one `github stack` invocation to its named sub-verb.
 *
 * @param argv the full process argv; this verb's arguments begin after node, CLI, "github" and "stack"
 * @param deps the injectable output sink
 * @returns the process exit code
 */
export async function runGithubStack({
  argv,
  deps = DEFAULT_DEPS,
}: {
  argv: readonly string[];
  deps?: GithubStackDeps;
}): Promise<number> {
  const dispatch = parseGithubStackDispatch({ argv: argv.slice(VERB_ARG_OFFSET) });
  if (dispatch.isErr()) {
    for (const line of githubVerbErrorLines({ error: dispatch.error })) deps.out({ line });
    return EXIT_USAGE;
  }
  if (dispatch.value.subVerb === "sync") {
    return runGithubStackSync({ argv });
  }
  if (dispatch.value.subVerb === "restack") {
    return runGithubStackRestack({ argv });
  }
  if (dispatch.value.subVerb === "submit") {
    return runGithubStackSubmit({ argv });
  }
  if (dispatch.value.subVerb === "adopt") {
    return runGithubStackAdopt({ argv });
  }
  if (dispatch.value.subVerb === "audit") {
    return runGithubStackAudit({ argv });
  }
  if (dispatch.value.subVerb === "remove") {
    return runGithubStackRemove({ argv });
  }
  if (dispatch.value.subVerb === "dissolve") {
    return runGithubStackDissolve({ argv });
  }
  return runGithubStackPush({ argv });
}

/** The registered command. */
export const githubStackCommand = defineCommand({
  run: (argv: readonly string[]) => runGithubStack({ argv }),
});
