/**
 * The effectful shell for `slopweaver linear issues` — a pure read, with nothing recorded on disk.
 */

import { linearToken } from "../../../config.js";
import { logger } from "../../../lib/logger.js";
import { err, type Result } from "../../../lib/result.js";
import { type LinearLiveError, LinearLiveErrors } from "../../../live/linear/errors.js";
import {
  type LinearIssuesDocument,
  type LinearIssuesSelection,
  readLinearIssues,
} from "../../../live/linear/issues.js";
import { renderLinearIssuesJson, renderLinearIssuesText } from "../../../live/linear/issuesRender.js";
import { linearStatesRequest } from "../../../live/linear/states.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { linearVerbErrorLines } from "./errors.js";
import { parseLinearIssuesArgs } from "./issuesCore.js";
import { LINEAR_ISSUES_USAGE } from "./issuesUsage.js";

const VERB_ARG_OFFSET = 4;

/** Injectable command edges. Plain fakes exercise the shell without the Linear SDK or a credential. */
export interface LinearIssuesDeps {
  readonly read: (args: {
    selection: LinearIssuesSelection;
    home: string | undefined;
  }) => Promise<Result<LinearIssuesDocument, LinearLiveError>>;
  readonly nowMs: () => number;
  readonly writeOut: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
}

/**
 * Run `linear issues` against injected edges.
 *
 * @param rest argv after `linear issues`
 * @param deps the read, clock and output seams
 * @returns the process exit code
 */
export async function runLinearIssues({
  rest,
  deps,
}: {
  rest: readonly string[];
  deps: LinearIssuesDeps;
}): Promise<number> {
  const parsed = parseLinearIssuesArgs({ nowMs: deps.nowMs(), rest });
  if (parsed.isErr()) {
    for (const problem of linearVerbErrorLines({ error: parsed.error })) {
      deps.writeDiagnostic(problem);
    }
    deps.writeDiagnostic(LINEAR_ISSUES_USAGE);
    return EXIT_USAGE;
  }
  const options = parsed.value;
  const result = await deps.read({ home: options.home, selection: options.selection });
  if (result.isErr()) {
    deps.writeDiagnostic(result.error.message);
    return EXIT_ERROR;
  }
  deps.writeOut(
    options.json
      ? renderLinearIssuesJson({ document: result.value })
      : renderLinearIssuesText({ document: result.value }),
  );
  return EXIT_OK;
}

/**
 * Production edges: the credential resolves from the named state home, over the shared paced transport.
 *
 * @returns a credential-aware issues reader, the wall clock and the output sinks
 */
export function productionLinearIssuesDeps(): LinearIssuesDeps {
  const nowIso = (): string => new Date().toISOString();
  return {
    nowMs: () => Date.now(),
    read: async ({ selection, home }) => {
      const token = linearToken(home === undefined ? {} : { home });
      if (token === undefined) {
        return err(
          LinearLiveErrors.readFailed({ message: "no Linear token configured; run `slopweaver connect linear`" }),
        );
      }
      return readLinearIssues({ nowIso, request: linearStatesRequest({ token }), selection });
    },
    writeDiagnostic: (line) => {
      logger.warn({ msg: line });
    },
    writeOut: (line) => {
      logger.out({ line });
    },
  };
}

/** `slopweaver linear issues`. */
export const linearIssuesCommand = defineCommand({
  run: (argv) => runLinearIssues({ deps: productionLinearIssuesDeps(), rest: argv.slice(VERB_ARG_OFFSET) }),
});
