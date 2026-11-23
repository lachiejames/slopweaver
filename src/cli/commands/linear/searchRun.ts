/** The effectful shell for `slopweaver linear search`. */

import { linearToken } from "../../../config.js";
import { logger } from "../../../lib/logger.js";
import { err, type Result } from "../../../lib/result.js";
import { type LinearLiveError, LinearLiveErrors } from "../../../live/linear/errors.js";
import {
  type LinearSearchDocument,
  linearSearchRequest,
  renderLinearSearchJson,
  renderLinearSearchText,
  searchLinear,
} from "../../../live/linear/search.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { linearVerbErrorLines } from "./errors.js";
import { linearSearchUsage, parseLinearSearchArgs } from "./searchCore.js";

const VERB_ARG_OFFSET = 4;

/** Injectable command edges. A plain fake exercises the shell without the Linear SDK or a credential. */
export interface LinearSearchDeps {
  readonly search: (args: {
    term: string;
    home: string | undefined;
    limit: number;
  }) => Promise<Result<LinearSearchDocument, LinearLiveError>>;
  readonly writeOut: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
}

/**
 * Run `linear search` against injected edges.
 *
 * @param rest argv after `linear search`
 * @param deps the search and output seams
 * @returns the process exit code
 */
export async function runLinearSearch({
  rest,
  deps,
}: {
  rest: readonly string[];
  deps: LinearSearchDeps;
}): Promise<number> {
  const parsed = parseLinearSearchArgs({ rest });
  if (parsed.isErr()) {
    for (const problem of linearVerbErrorLines({ error: parsed.error })) {
      deps.writeDiagnostic(problem);
    }
    deps.writeDiagnostic(linearSearchUsage());
    return EXIT_USAGE;
  }
  const result = await deps.search({ home: parsed.value.home, limit: parsed.value.limit, term: parsed.value.term });
  if (result.isErr()) {
    deps.writeDiagnostic(result.error.message);
    return EXIT_ERROR;
  }
  deps.writeOut(
    parsed.value.json
      ? renderLinearSearchJson({ document: result.value })
      : renderLinearSearchText({ document: result.value }),
  );
  return EXIT_OK;
}

/**
 * Production search edge: credential resolution stays in the same explicit state home as the search.
 *
 * @returns a credential-aware, safe search reader and output sinks
 */
export function productionLinearSearchDeps(): LinearSearchDeps {
  const nowIso = (): string => new Date().toISOString();
  return {
    search: async ({ term, home, limit }) => {
      const token = linearToken(home === undefined ? {} : { home });
      return token === undefined
        ? err(LinearLiveErrors.searchFailed({ message: "no Linear token configured; run `slopweaver connect linear`" }))
        : searchLinear({ limit, nowIso, request: linearSearchRequest({ token }), term });
    },
    writeDiagnostic: (line) => {
      logger.warn({ msg: line });
    },
    writeOut: (line) => {
      logger.out({ line });
    },
  };
}

/** `slopweaver linear search`. */
export const linearSearchCommand = defineCommand({
  run: (argv) => runLinearSearch({ deps: productionLinearSearchDeps(), rest: argv.slice(VERB_ARG_OFFSET) }),
});
