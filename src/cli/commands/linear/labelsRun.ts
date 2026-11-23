/**
 * The effectful shell for `slopweaver linear labels` — a pure read, with none of `linear states`' catalog
 * recording: no write door gates a label id on evidence of a read, so there is nothing on disk to move.
 */

import { linearToken } from "../../../config.js";
import { logger } from "../../../lib/logger.js";
import { err, type Result } from "../../../lib/result.js";
import { type LinearLiveError, LinearLiveErrors } from "../../../live/linear/errors.js";
import {
  type LinearLabelsDocument,
  readLinearLabels,
  renderLinearLabelsJson,
  renderLinearLabelsText,
} from "../../../live/linear/labels.js";
import { linearStatesRequest } from "../../../live/linear/states.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { linearVerbErrorLines } from "./errors.js";
import { parseLinearLabelsArgs } from "./labelsCore.js";
import { LINEAR_LABELS_USAGE } from "./labelsUsage.js";

const VERB_ARG_OFFSET = 4;

/** Injectable command edges. Plain fakes exercise the shell without the Linear SDK or a credential. */
export interface LinearLabelsDeps {
  readonly read: (args: {
    teamKey: string;
    home: string | undefined;
  }) => Promise<Result<LinearLabelsDocument, LinearLiveError>>;
  readonly writeOut: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
}

/**
 * Run `linear labels` against injected edges.
 *
 * @param rest argv after `linear labels`
 * @param deps the read and output seams
 * @returns the process exit code
 */
export async function runLinearLabels({
  rest,
  deps,
}: {
  rest: readonly string[];
  deps: LinearLabelsDeps;
}): Promise<number> {
  const parsed = parseLinearLabelsArgs({ rest });
  if (parsed.isErr()) {
    for (const problem of linearVerbErrorLines({ error: parsed.error })) {
      deps.writeDiagnostic(problem);
    }
    deps.writeDiagnostic(LINEAR_LABELS_USAGE);
    return EXIT_USAGE;
  }
  const options = parsed.value;
  const result = await deps.read({ home: options.home, teamKey: options.teamKey });
  if (result.isErr()) {
    deps.writeDiagnostic(result.error.message);
    return EXIT_ERROR;
  }
  deps.writeOut(
    options.json
      ? renderLinearLabelsJson({ document: result.value })
      : renderLinearLabelsText({ document: result.value }),
  );
  return EXIT_OK;
}

/**
 * Production edges: the credential resolves from the named state home, over the shared paced transport.
 *
 * @returns a credential-aware labels reader and the output sinks
 */
export function productionLinearLabelsDeps(): LinearLabelsDeps {
  const nowIso = (): string => new Date().toISOString();
  return {
    read: async ({ teamKey, home }) => {
      const token = linearToken(home === undefined ? {} : { home });
      if (token === undefined) {
        return err(
          LinearLiveErrors.readFailed({ message: "no Linear token configured; run `slopweaver connect linear`" }),
        );
      }
      return readLinearLabels({ nowIso, request: linearStatesRequest({ token }), teamKey });
    },
    writeDiagnostic: (line) => {
      logger.warn({ msg: line });
    },
    writeOut: (line) => {
      logger.out({ line });
    },
  };
}

/** `slopweaver linear labels`. */
export const linearLabelsCommand = defineCommand({
  run: (argv) => runLinearLabels({ deps: productionLinearLabelsDeps(), rest: argv.slice(VERB_ARG_OFFSET) }),
});
