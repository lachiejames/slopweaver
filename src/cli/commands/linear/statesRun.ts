/**
 * The effectful shell for `slopweaver linear states`.
 *
 * Unlike the other Linear READ verbs this one has a side effect on disk, and it is the point rather than a
 * convenience: the write door refuses a `stateId` it has no evidence came from a real read, so this verb is
 * what supplies that evidence (`../../../outbound/linear/stateCatalog.ts`). `--no-record` exists for the
 * case where an operator wants to look without moving what the door will accept.
 *
 * Recording happens AFTER the read succeeds and never on a failure, so a refused or empty read cannot widen
 * the gate — and it REPLACES the team's catalog rather than merging, so a deleted state stops being writable.
 */

import { linearToken } from "../../../config.js";
import { logger } from "../../../lib/logger.js";
import { err, type Result } from "../../../lib/result.js";
import type { LinearLiveError } from "../../../live/linear/errors.js";
import { LinearLiveErrors } from "../../../live/linear/errors.js";
import {
  type LinearStatesDocument,
  linearStatesRequest,
  readLinearStates,
  renderLinearStatesJson,
  renderLinearStatesText,
} from "../../../live/linear/states.js";
import { writeStateCatalog } from "../../../outbound/linear/stateCatalog.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";
import { linearVerbErrorLines } from "./errors.js";
import { linearStatesUsage, parseLinearStatesArgs } from "./statesCore.js";

const VERB_ARG_OFFSET = 4;

/** Injectable command edges. Plain fakes exercise the shell without the Linear SDK or a credential. */
export interface LinearStatesDeps {
  readonly read: (args: {
    teamKey: string;
    home: string | undefined;
    limit: number;
  }) => Promise<Result<LinearStatesDocument, LinearLiveError>>;
  readonly record: (args: { home: string | undefined; document: LinearStatesDocument }) => void;
  readonly writeOut: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
}

/**
 * Run `linear states` against injected edges.
 *
 * @param rest argv after `linear states`
 * @param deps the read, record and output seams
 * @returns the process exit code
 */
export async function runLinearStates({
  rest,
  deps,
}: {
  rest: readonly string[];
  deps: LinearStatesDeps;
}): Promise<number> {
  const parsed = parseLinearStatesArgs({ rest });
  if (parsed.isErr()) {
    for (const problem of linearVerbErrorLines({ error: parsed.error })) {
      deps.writeDiagnostic(problem);
    }
    deps.writeDiagnostic(linearStatesUsage());
    return EXIT_USAGE;
  }
  const options = parsed.value;
  const result = await deps.read({ home: options.home, limit: options.limit, teamKey: options.teamKey });
  if (result.isErr()) {
    deps.writeDiagnostic(result.error.message);
    return EXIT_ERROR;
  }
  if (!options.noRecord) {
    deps.record({ document: result.value, home: options.home });
  }
  deps.writeOut(
    options.json
      ? renderLinearStatesJson({ document: result.value })
      : renderLinearStatesText({ document: result.value }),
  );
  return EXIT_OK;
}

/**
 * Record one states read as the write door's evidence for that team, replacing what it held, stamped with the
 * workspace Linear itself reported for the token. The PR gate forgives this catalog's key only while that stamp
 * matches the organisation's configured workspace (`../../../outbound/github/installationIdentifiersRead.ts`).
 *
 * @param home the named state home, the default when undefined
 * @param document the read that just succeeded
 */
export function recordLinearStates({
  home,
  document,
}: {
  home: string | undefined;
  document: LinearStatesDocument;
}): void {
  writeStateCatalog({
    catalog: {
      members: document.members.map((member) => ({ displayName: member.displayName, id: member.id })),
      readAtIso: document.readAtIso,
      states: document.states.map((state) => ({ id: state.id, name: state.name, type: state.type })),
      teamId: document.team.id,
      teamKey: document.team.key,
      workspace: document.workspace,
    },
    home: resolveHome({ named: home }),
  });
}

/**
 * Production edges: credential resolution and the catalog write stay in the same explicit state home.
 *
 * @returns a credential-aware, safe states reader, the catalog recorder and the output sinks
 */
export function productionLinearStatesDeps(): LinearStatesDeps {
  const nowIso = (): string => new Date().toISOString();
  return {
    read: async ({ teamKey, home, limit }) => {
      const token = linearToken(home === undefined ? {} : { home });
      return token === undefined
        ? err(LinearLiveErrors.readFailed({ message: "no Linear token configured; run `slopweaver connect linear`" }))
        : readLinearStates({ limit, nowIso, request: linearStatesRequest({ token }), teamKey });
    },
    record: recordLinearStates,
    writeDiagnostic: (line) => {
      logger.warn({ msg: line });
    },
    writeOut: (line) => {
      logger.out({ line });
    },
  };
}

/** `slopweaver linear states`. */
export const linearStatesCommand = defineCommand({
  run: (argv) => runLinearStates({ deps: productionLinearStatesDeps(), rest: argv.slice(VERB_ARG_OFFSET) }),
});
