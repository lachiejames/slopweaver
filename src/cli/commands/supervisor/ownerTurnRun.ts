/**
 * `slopweaver supervisor owner-turn-record` and `owner-turn-show` — the owner's verbatim words, into the store the
 * moment a seat writes them, and back out of it by anchor.
 *
 * `record` is the per-file write a chair runs right after it writes an `owner-turn-*.txt`, so the store does
 * not wait for the next `store import-fleet --only owner-turns` to hold it. `show` is the READ that anchor
 * resolution switches to: it answers from the store only, so a turn whose file a reclaim took is still
 * readable, and one the store never received says so rather than being quietly served off disk.
 *
 * Both are the edge only: `./ownerTurnCore.ts` parses and renders, `../../../store/fleet/ownerTurnStore.ts`
 * reads the bytes and talks to the store. Every failure exits non-zero and names the import command.
 */
import { slopweaverHome } from "../../../homeDir.js";
import { logger } from "../../../lib/logger.js";
import type { Result } from "../../../lib/result.js";
import type { StoreError } from "../../../store/errors.js";
import type { OwnerTurnRef } from "../../../store/fleet/ownerTurnAnchor.js";
import { resolveOwnerTurnRef } from "../../../store/fleet/ownerTurnAnchor.js";
import {
  type OwnerTurnRecordError,
  type OwnerTurnRecordOutcome,
  type OwnerTurnStoreRead,
  readOwnerTurnsFromStore,
  recordOwnerTurnFile,
  type StoredOwnerTurn,
} from "../../../store/fleet/ownerTurnStore.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { verbTail } from "../../optionParsers.js";

import {
  bodyAsOutLine,
  OWNER_TURN_IMPORT_COMMAND,
  OWNER_TURN_RECORD_USAGE,
  OWNER_TURN_SHOW_USAGE,
  ownerTurnNothingStoredLine,
  ownerTurnRecordLines,
  ownerTurnVersionHeader,
  ownerTurnVersions,
  parseOwnerTurnRecordArgs,
  parseOwnerTurnShowArgs,
} from "./ownerTurnCore.js";

/** Everything the two verbs touch outside themselves, injected so a test drives the whole thing. */
export interface OwnerTurnVerbDeps {
  /** The state home when `--home` was not given. */
  readonly defaultHome: () => string;
  /** Re-read one file and write its rows. */
  readonly record: (args: {
    path: string;
    home: string;
  }) => Promise<Result<OwnerTurnRecordOutcome, OwnerTurnRecordError>>;
  /** Read every stored copy one ref resolves to. */
  readonly read: (args: { ref: OwnerTurnRef; home: string }) => Promise<Result<OwnerTurnStoreRead, StoreError>>;
  readonly writeOut: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
}

/**
 * Run `supervisor owner-turn-record` against injected seams.
 *
 * @param rest the argv tail after `supervisor owner-turn-record`
 * @param deps everything the verb touches outside itself
 * @returns the process exit code
 */
export async function runSupervisorOwnerTurnRecord({
  rest,
  deps,
}: {
  rest: readonly string[];
  deps: OwnerTurnVerbDeps;
}): Promise<number> {
  const args = parseOwnerTurnRecordArgs({ rest });
  if (args.isErr()) {
    return refuseUsage({ deps, problems: args.error, usage: OWNER_TURN_RECORD_USAGE, verb: "owner-turn-record" });
  }
  const { file, json } = args.value;
  if (file === undefined) {
    return refuseUsage({
      deps,
      problems: ["--file <path> is required: the owner-turn file a seat just wrote"],
      usage: OWNER_TURN_RECORD_USAGE,
      verb: "owner-turn-record",
    });
  }
  const home = homeOf({ deps, named: args.value.home });
  const recorded = await deps.record({ home, path: file });
  if (recorded.isErr()) {
    deps.writeDiagnostic(`supervisor owner-turn-record: ${file} was NOT recorded (${recorded.error.code})`);
    deps.writeDiagnostic(`  ${recorded.error.message}`);
    deps.writeDiagnostic(`  reconcile with \`${OWNER_TURN_IMPORT_COMMAND}\` once the cause is fixed`);
    return EXIT_ERROR;
  }
  const rendered = ownerTurnRecordLines({ file, home, outcome: recorded.value });
  if (json) {
    deps.writeOut(JSON.stringify({ file, home, outcome: recorded.value }));
  }
  if (!rendered.ok) {
    rendered.lines.forEach((line) => {
      deps.writeDiagnostic(line);
    });
    return EXIT_ERROR;
  }
  if (!json) {
    rendered.lines.forEach((line) => {
      deps.writeOut(line);
    });
  }
  return EXIT_OK;
}

/**
 * Run `supervisor owner-turn-show` against injected seams.
 *
 * @param rest the argv tail after `supervisor owner-turn-show`
 * @param deps everything the verb touches outside itself
 * @returns the process exit code
 */
export async function runSupervisorOwnerTurnShow({
  rest,
  deps,
}: {
  rest: readonly string[];
  deps: OwnerTurnVerbDeps;
}): Promise<number> {
  const args = parseOwnerTurnShowArgs({ rest });
  if (args.isErr()) {
    return refuseUsage({ deps, problems: args.error, usage: OWNER_TURN_SHOW_USAGE, verb: "owner-turn-show" });
  }
  const { ref, all, json } = args.value;
  if (ref === undefined) {
    return refuseUsage({
      deps,
      problems: ["--ref <anchor|turn> is required"],
      usage: OWNER_TURN_SHOW_USAGE,
      verb: "owner-turn-show",
    });
  }
  const home = homeOf({ deps, named: args.value.home });
  const resolved = resolveOwnerTurnRef({ home, ref });
  if (resolved.isErr()) {
    deps.writeDiagnostic(`supervisor owner-turn-show: ${resolved.error.message}`);
    return EXIT_ERROR;
  }
  const read = await deps.read({ home, ref: resolved.value });
  if (read.isErr()) {
    deps.writeDiagnostic(`supervisor owner-turn-show: the store could not be read (${read.error.code})`);
    deps.writeDiagnostic(`  ${read.error.message}`);
    return EXIT_ERROR;
  }
  if (read.value.kind === "no-store") {
    deps.writeDiagnostic(
      `supervisor owner-turn-show: ${home} selects no store, so there is nothing to read — this verb never ` +
        `reads the disk copy; select a store and run \`${OWNER_TURN_IMPORT_COMMAND}\``,
    );
    return EXIT_ERROR;
  }
  return printVersions({ all, deps, json, ref, resolved: resolved.value, rows: read.value.rows });
}

/**
 * Print what the store holds for one ref — or say it holds nothing, never reaching for the disk copy.
 *
 * @param rows every stored copy the ref resolved to, newest first
 * @param ref the ref as typed, named in the lines
 * @param resolved the ref as resolved, carried in `--json`
 * @returns the exit code
 */
function printVersions({
  rows,
  ref,
  resolved,
  all,
  json,
  deps,
}: {
  rows: readonly StoredOwnerTurn[];
  ref: string;
  resolved: OwnerTurnRef;
  all: boolean;
  json: boolean;
  deps: OwnerTurnVerbDeps;
}): number {
  const versions = ownerTurnVersions({ rows });
  if (versions.length === 0) {
    deps.writeDiagnostic(ownerTurnNothingStoredLine({ ref }));
    return EXIT_ERROR;
  }
  if (json) {
    deps.writeOut(JSON.stringify({ ref: resolved, versions }));
    return EXIT_OK;
  }
  if (!all) {
    deps.writeOut(bodyAsOutLine({ body: versions[0]!.body }));
    if (versions.length > 1) {
      deps.writeDiagnostic(
        `supervisor owner-turn-show: ${String(versions.length)} distinct bodies are stored for ${ref}; this is ` +
          "the newest-written — --all prints every one",
      );
    }
    return EXIT_OK;
  }
  for (const version of versions) {
    deps.writeOut(ownerTurnVersionHeader({ version }));
    deps.writeOut(bodyAsOutLine({ body: version.body }));
  }
  return EXIT_OK;
}

/**
 * The home `--home` named, or the resolved one when it named none.
 *
 * @param named the `--home` value, when given
 * @returns the state home to judge paths and select the store against
 */
function homeOf({ named, deps }: { named: string | undefined; deps: OwnerTurnVerbDeps }): string {
  if (named === undefined) {
    return deps.defaultHome();
  }
  return named;
}

/**
 * Print a usage refusal and return its exit code.
 *
 * @param problems each line saying what was wrong with the arguments
 * @param usage the verb's usage block, printed after them
 * @returns {@link EXIT_USAGE}
 */
function refuseUsage({
  problems,
  usage,
  verb,
  deps,
}: {
  problems: readonly string[];
  usage: string;
  verb: string;
  deps: OwnerTurnVerbDeps;
}): number {
  for (const line of problems) {
    deps.writeDiagnostic(`supervisor ${verb}: ${line}`);
  }
  deps.writeDiagnostic(usage);
  return EXIT_USAGE;
}

/**
 * The real seams: the resolved home, the store, and the two output channels.
 *
 * @returns the production dependencies for both verbs
 */
export function productionOwnerTurnVerbDeps(): OwnerTurnVerbDeps {
  return {
    defaultHome: () => slopweaverHome(),
    read: ({ ref, home }) => readOwnerTurnsFromStore({ home, ref }),
    record: ({ path, home }) => recordOwnerTurnFile({ home, path }),
    writeDiagnostic: (line) => {
      logger.error({ msg: line });
    },
    writeOut: (line) => {
      logger.out({ line });
    },
  };
}

/** `slopweaver supervisor owner-turn-record`. */
export const supervisorOwnerTurnRecordCommand = defineCommand({
  run: (argv) =>
    runSupervisorOwnerTurnRecord({
      deps: productionOwnerTurnVerbDeps(),
      rest: verbTail({ argv, verbs: ["owner-turn-record"] }),
    }),
});

/** `slopweaver supervisor owner-turn-show`. */
export const supervisorOwnerTurnShowCommand = defineCommand({
  run: (argv) =>
    runSupervisorOwnerTurnShow({
      deps: productionOwnerTurnVerbDeps(),
      rest: verbTail({ argv, verbs: ["owner-turn-show"] }),
    }),
});
