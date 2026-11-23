/**
 * `slopweaver store measurement-list`, and the seams it shares with `measurement-show` (`./measurementShowRun.ts`)
 * and `measurement-restore` (`./measurementRestoreRun.ts`) — the measurements, read back OUT of the store.
 *
 * All three answer from `measurement_location`, `measurement_blob` and the Storage bucket only; none reads a
 * file under the home. That is the property the class moved into the store for (it is queried from the database, so
 * the user-level slopweaver directory can eventually be removed
 * without having lost any functionality): a measurement a reclaim took still lists, still shows, and
 * `restore --into "$SLOPWEAVER_HOME"` puts it back byte for byte.
 *
 * The edge only: `./measurementCore.ts` parses and renders, `../../../store/fleet/measurementStore.ts` talks
 * to the store and the bucket. Every "nothing stored" line names the import.
 */
import { logger, outExact } from "#lib/logger.js";
import type { Result } from "#lib/result.js";
import { safeJsonStringify } from "#lib/safeJson.js";
import { slopweaverHome } from "../../../homeDir.js";
import { connectStore } from "../../../store/client.js";
import type { StoreError } from "../../../store/errors.js";
import { createFileUnderRoot, fileSha256 } from "../../../store/fleet/authoredWrite.js";
import {
  type MeasurementFilter,
  type MeasurementStoreError,
  measurementObjects,
  readMeasurementBody,
  readMeasurementLocations,
  type StoredMeasurementLocation,
} from "../../../store/fleet/measurementStore.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { verbTail } from "../../optionParsers.js";

import {
  MEASUREMENT_LIST_USAGE,
  measurementListLine,
  measurementNothingStoredLine,
  parseMeasurementListArgs,
  type RestoreAction,
  restoreAction,
} from "./measurementCore.js";

/** One open read of the store and its bucket. */
export interface MeasurementReader {
  /** Every stored location a filter selects, newest body first within a path. */
  readonly locations: (args: {
    filter: MeasurementFilter;
  }) => Promise<Result<readonly StoredMeasurementLocation[], StoreError>>;
  /** One body's exact bytes, inline or from its verified Storage object. */
  readonly body: (args: { bodySha256: string }) => Promise<Result<Uint8Array, MeasurementStoreError>>;
  readonly close: () => Promise<void>;
}

/** Everything the three verbs touch outside themselves, injected so a test drives the whole thing. */
export interface MeasurementVerbDeps {
  /** The state home when `--home` was not given. */
  readonly defaultHome: () => string;
  /** Open the store this home selects. */
  readonly openReader: (args: { home: string }) => Promise<Result<MeasurementReader, StoreError>>;
  /** The sha-256 of the file already at a path, or `undefined` when there is none. */
  readonly existingSha256: (args: { path: string }) => string | undefined;
  /**
   * Create one file exclusively under `root` with its exact bytes and mtime — `exists` when anything, even a
   * dangling link, is already at the path, and a failure when the path resolves outside `root` through a link.
   */
  readonly createFile: (args: {
    root: string;
    path: string;
    bytes: Uint8Array;
    modifiedAt: Date;
  }) => Result<"created" | "exists">;
  readonly writeOut: (line: string) => void;
  /** A stored text body on stdout exactly as stored — no line ending added. */
  readonly writeBody: (text: string) => void;
  readonly writeDiagnostic: (line: string) => void;
}

/**
 * Run `store measurement-list` against injected seams.
 *
 * @param rest the argv tail after `store measurement-list`
 * @param deps everything the verb touches outside itself
 * @returns the process exit code — 3 when the store holds nothing the filter selects
 */
export async function runStoreMeasurementList({
  rest,
  deps,
}: {
  rest: readonly string[];
  deps: MeasurementVerbDeps;
}): Promise<number> {
  const args = parseMeasurementListArgs({ rest });
  if (args.isErr()) {
    return refuseUsage({ deps, problems: args.error, usage: MEASUREMENT_LIST_USAGE, verb: "measurement-list" });
  }
  const { measurementClass, prefix, json } = args.value;
  return withReader({
    deps,
    home: homeOf({ deps, named: args.value.home }),
    use: async (reader) => {
      const read = await reader.locations({ filter: { measurementClass, prefix } });
      if (read.isErr()) {
        return storeUnreadable({ deps, error: read.error, verb: "measurement-list" });
      }
      if (read.value.length === 0) {
        deps.writeDiagnostic(
          `store measurement-list: ${measurementNothingStoredLine({ what: filterWords({ measurementClass, prefix }) })}`,
        );
        return EXIT_EXPECTED_EMPTY;
      }
      if (json) {
        deps.writeOut(safeJsonStringify({ label: "store measurement-list", value: { locations: read.value } }));
        return EXIT_OK;
      }
      read.value.forEach((location) => {
        deps.writeOut(measurementListLine({ location }));
      });
      return EXIT_OK;
    },
    verb: "measurement-list",
  });
}

/**
 * What an exclusive create's outcome means for one path: written, or — when something was already there —
 * whether it holds the stored bytes.
 *
 * @param created the create's outcome
 * @param location the stored location whose body was being written
 * @param target the path the create aimed at
 * @returns `write` when this run wrote it, else `identical` or `differs`
 */
export function settleExisting({
  created,
  location,
  target,
  deps,
}: {
  created: "created" | "exists";
  location: StoredMeasurementLocation;
  target: string;
  deps: MeasurementVerbDeps;
}): RestoreAction {
  if (created === "created") {
    return "write";
  }
  const action = restoreAction({
    bodySha256: location.bodySha256,
    existingSha256: deps.existingSha256({ path: target }),
  });
  if (action === "identical") {
    return "identical";
  }
  return "differs";
}

/**
 * Open the store, run one verb's body against it, and close it whatever happened.
 *
 * @param home the state home whose store is opened
 * @param use the verb's body
 * @returns the verb's exit code, or 1 when the store would not open
 */
export async function withReader({
  home,
  use,
  verb,
  deps,
}: {
  home: string;
  use: (reader: MeasurementReader) => Promise<number>;
  verb: string;
  deps: MeasurementVerbDeps;
}): Promise<number> {
  const opened = await deps.openReader({ home });
  if (opened.isErr()) {
    return storeUnreadable({ deps, error: opened.error, verb });
  }
  try {
    return await use(opened.value);
  } finally {
    await opened.value.close();
  }
}

/**
 * Report a store that would not open or answer.
 *
 * @param error the typed failure
 * @returns the error exit code, {@link EXIT_ERROR}
 */
export function storeUnreadable({
  error,
  verb,
  deps,
}: {
  error: StoreError;
  verb: string;
  deps: MeasurementVerbDeps;
}): number {
  deps.writeDiagnostic(`store ${verb}: the store could not be read (${error.code})`);
  deps.writeDiagnostic(`  ${error.message}`);
  return EXIT_ERROR;
}

/**
 * A filter as the words a "nothing stored" line names.
 *
 * @returns e.g. `class proof, prefix proof/1263`, or `any class` for no filter
 */
export function filterWords({
  measurementClass,
  prefix,
}: {
  measurementClass: string | undefined;
  prefix: string | undefined;
}): string {
  const words = [
    ...(measurementClass === undefined ? [] : [`class ${measurementClass}`]),
    ...(prefix === undefined ? [] : [`prefix ${prefix}`]),
  ];
  if (words.length === 0) {
    return "any class";
  }
  return words.join(", ");
}

/**
 * The home `--home` named, or the resolved one when it named none.
 *
 * @param named the `--home` value, when given
 * @returns the state home to select the store against
 */
export function homeOf({ named, deps }: { named: string | undefined; deps: MeasurementVerbDeps }): string {
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
 * @returns the usage exit code, {@link EXIT_USAGE}
 */
export function refuseUsage({
  problems,
  usage,
  verb,
  deps,
}: {
  problems: readonly string[];
  usage: string;
  verb: string;
  deps: MeasurementVerbDeps;
}): number {
  for (const line of problems) {
    deps.writeDiagnostic(`store ${verb}: ${line}`);
  }
  deps.writeDiagnostic(usage);
  return EXIT_USAGE;
}

/**
 * The real seams: the resolved home, the store and its bucket, the filesystem, and the two output channels.
 *
 * @returns the production dependencies for all three verbs
 */
export function productionMeasurementVerbDeps(): MeasurementVerbDeps {
  return {
    defaultHome: () => slopweaverHome(),
    existingSha256: ({ path }) => fileSha256({ path }),
    openReader: async ({ home }) => {
      const opened = await connectStore({ home });
      return opened.map((client) => ({
        body: ({ bodySha256 }) => readMeasurementBody({ bodySha256, client, objects: () => measurementObjects() }),
        close: () => client.close(),
        locations: ({ filter }) => readMeasurementLocations({ client, filter }),
      }));
    },
    writeDiagnostic: (line) => {
      logger.error({ msg: line });
    },
    createFile: ({ root, path, bytes, modifiedAt }) => createFileUnderRoot({ bytes, modifiedAt, path, root }),
    writeBody: (text) => {
      outExact({ text });
    },
    writeOut: (line) => {
      logger.out({ line });
    },
  };
}

/** `slopweaver store measurement-list`. */
export const storeMeasurementListCommand = defineCommand({
  run: (argv) =>
    runStoreMeasurementList({
      deps: productionMeasurementVerbDeps(),
      rest: verbTail({ argv, verbs: ["measurement-list"] }),
    }),
});
