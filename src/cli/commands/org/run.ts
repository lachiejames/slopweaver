/**
 * `slopweaver org show|set` — the organisation this install works for, read and written in the store.
 *
 * `show` is the one read the organisation's readers share (`../../../organisation/read.ts`), printed. An install with no
 * organisation exits `EXIT_EXPECTED_EMPTY` naming `org set`, which is the status, not a fault. `set` writes the whole
 * row through `../../../organisation/write.ts`, pinned to the revision it read, and prints the row read back.
 */
import { logger } from "#lib/logger.js";

import type { Result } from "../../../lib/result.js";
import { type Organisation, type OrganisationRecord, organisationLines } from "../../../organisation/core.js";
import type { OrganisationError } from "../../../organisation/errors.js";
import { readOrganisation } from "../../../organisation/read.js";
import { writeOrganisation } from "../../../organisation/write.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";
import { orgSetArgs, orgShowArgs } from "./core.js";
import { ORG_SET_USAGE, ORG_SHOW_USAGE } from "./usage.js";

/** How many argv entries precede the verb's own arguments: `[node, cli, noun, verb, …]`. */
const VERB_ARG_OFFSET = 4;

/** Everything the two verbs touch outside themselves; production wires the store, a test passes fakes. */
export interface OrgRunDeps {
  readonly readOrganisation: (args: { home: string }) => Promise<Result<Organisation, OrganisationError>>;
  readonly writeOrganisation: (args: {
    home: string;
    record: OrganisationRecord;
  }) => Promise<Result<Organisation, OrganisationError>>;
  readonly out: (args: { line: string }) => void;
  readonly err: (args: { msg: string }) => void;
}

/** The production seams: the store, stdout and the structured logger. */
const LIVE_DEPS: OrgRunDeps = {
  err: ({ msg }) => {
    logger.error({ msg });
  },
  out: ({ line }) => {
    logger.out({ line });
  },
  readOrganisation,
  writeOrganisation,
};

/**
 * Print a read or a write's outcome: the organisation as JSON or as lines, or the refusal with its exit code.
 *
 * `ORG_NOT_CONFIGURED` is `EXIT_EXPECTED_EMPTY` — the install has simply not run `org set` yet.
 */
function report({
  deps,
  json,
  result,
}: {
  deps: OrgRunDeps;
  json: boolean;
  result: Result<Organisation, OrganisationError>;
}): number {
  if (result.isErr()) {
    deps.err({ msg: result.error.message });
    return result.error.code === "ORG_NOT_CONFIGURED" ? EXIT_EXPECTED_EMPTY : EXIT_ERROR;
  }
  if (json) {
    deps.out({ line: JSON.stringify(result.value) });
    return EXIT_OK;
  }
  for (const line of organisationLines({ organisation: result.value })) {
    deps.out({ line });
  }
  return EXIT_OK;
}

/**
 * Print a parser's refusal lines, then the usage, and return the usage exit code.
 *
 * @returns {@link EXIT_USAGE}
 */
function refuse({ deps, lines, usage }: { deps: OrgRunDeps; lines: readonly string[]; usage: string }): number {
  for (const msg of [...lines, usage]) {
    deps.err({ msg });
  }
  return EXIT_USAGE;
}

/**
 * Run `org show` over injected seams.
 *
 * @param rest the argv after `org show`
 * @returns the exit code
 */
export async function runOrgShowWith({ rest, deps }: { rest: readonly string[]; deps: OrgRunDeps }): Promise<number> {
  const args = orgShowArgs({ rest });
  if (args.isErr()) {
    return refuse({ deps, lines: args.error, usage: ORG_SHOW_USAGE });
  }
  const read = await deps.readOrganisation({ home: resolveHome({ named: args.value.home }) });
  return report({ deps, json: args.value.json, result: read });
}

/**
 * Run `org set` over injected seams: the whole record is validated by the parser before any write is attempted.
 *
 * @param rest the argv after `org set`
 * @returns the exit code
 */
export async function runOrgSetWith({ rest, deps }: { rest: readonly string[]; deps: OrgRunDeps }): Promise<number> {
  const args = orgSetArgs({ rest });
  if (args.isErr()) {
    return refuse({ deps, lines: args.error, usage: ORG_SET_USAGE });
  }
  const written = await deps.writeOrganisation({
    home: resolveHome({ named: args.value.home }),
    record: args.value.record,
  });
  // A write never reads NOT_CONFIGURED back — it just wrote the row — so any refusal here is a fault.
  if (written.isErr()) {
    deps.err({ msg: written.error.message });
    return EXIT_ERROR;
  }
  return report({ deps, json: args.value.json, result: written });
}

/** `slopweaver org show`. */
export const orgShowCommand = defineCommand({
  run: (argv) => runOrgShowWith({ deps: LIVE_DEPS, rest: argv.slice(VERB_ARG_OFFSET) }),
});

/** `slopweaver org set`. */
export const orgSetCommand = defineCommand({
  run: (argv) => runOrgSetWith({ deps: LIVE_DEPS, rest: argv.slice(VERB_ARG_OFFSET) }),
});
