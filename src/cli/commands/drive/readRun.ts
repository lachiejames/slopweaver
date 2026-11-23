/**
 * The effectful shells for `drive list`, `drive read` and `drive drives`.
 *
 * All three are the same three steps: parse (pure), resolve a grant carrying the capability that verb needs,
 * and render what came back. The grant resolution and the API seam are injected, so the shells — dispatch,
 * the human vs `--json` choice, and the exit code — are unit tested with plain fakes and no Drive.
 *
 * `list` and `drives` need only `metadata`, so a `--grant metadata` install runs both of them without ever
 * approving the scope that can read a file's content. Only `read` demands `content`, and it says so by
 * asking for it here rather than by failing at the API.
 */
import { logger } from "../../../lib/logger.js";
import { err, type Result } from "../../../lib/result.js";
import { MAX_SHARED_DRIVES, makeDriveApi } from "../../../live/drive/api.js";
import { resolveDriveClient } from "../../../live/drive/client.js";
import type { DriveError } from "../../../live/drive/errors.js";
import { buildListQuery, fileIdFromAddress } from "../../../live/drive/files.js";
import {
  type DriveDrivesResult,
  type DriveFileResult,
  type DriveListingResult,
  readDriveDrives,
  readDriveFile,
  readDriveListing,
} from "../../../live/drive/read.js";
import { renderDriveDrivesText, renderDriveFileText, renderDriveListingText } from "../../../live/drive/render.js";
import { renderProviderReadJson } from "../../../live/providerRead.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";
import { parseDriveDrivesArgs, parseDriveListArgs, parseDriveReadArgs } from "./core.js";
import { driveErrorLines } from "./errors.js";

const VERB_ARG_OFFSET = 4;

/** The seams the three read shells perform their effects through. */
export interface DriveReadDeps {
  readonly list: (args: {
    home: string | undefined;
    query: string | undefined;
    driveId: string | undefined;
    limit: number;
  }) => Promise<Result<DriveListingResult, DriveError>>;
  readonly read: (args: {
    home: string | undefined;
    fileId: string;
    withText: boolean;
  }) => Promise<Result<DriveFileResult, DriveError>>;
  readonly drives: (args: { home: string | undefined }) => Promise<Result<DriveDrivesResult, DriveError>>;
  readonly writeOut: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
}

/**
 * Run `drive list` against injected edges.
 *
 * @param rest argv after `drive list`
 * @param deps the read and output seams
 * @returns the process exit code
 */
export async function runDriveList({ rest, deps }: { rest: readonly string[]; deps: DriveReadDeps }): Promise<number> {
  const parsed = parseDriveListArgs({ rest });
  if (parsed.isErr()) {
    for (const problem of driveErrorLines({ error: parsed.error })) {
      deps.writeDiagnostic(problem);
    }
    return EXIT_USAGE;
  }
  const { home, query, folderId, driveId, limit, includeTrashed, json } = parsed.value;
  const result = await deps.list({
    driveId,
    home,
    limit,
    query: buildListQuery({ folderId, includeTrashed, query }),
  });
  if (result.isErr()) {
    deps.writeDiagnostic(result.error.message);
    return EXIT_ERROR;
  }
  deps.writeOut(
    json
      ? renderProviderReadJson({ document: result.value.document })
      : renderDriveListingText({ document: result.value.document, listing: result.value.listing }),
  );
  return EXIT_OK;
}

/**
 * Run `drive read` against injected edges.
 *
 * @param rest argv after `drive read`
 * @param deps the read and output seams
 * @returns the process exit code
 */
export async function runDriveRead({ rest, deps }: { rest: readonly string[]; deps: DriveReadDeps }): Promise<number> {
  const parsed = parseDriveReadArgs({ rest });
  if (parsed.isErr()) {
    for (const problem of driveErrorLines({ error: parsed.error })) {
      deps.writeDiagnostic(problem);
    }
    return EXIT_USAGE;
  }
  const { home, address, withText, json } = parsed.value;
  const fileId = fileIdFromAddress({ address });
  if (fileId.isErr()) {
    deps.writeDiagnostic(fileId.error.message);
    return EXIT_USAGE;
  }
  const result = await deps.read({ fileId: fileId.value, home, withText });
  if (result.isErr()) {
    deps.writeDiagnostic(result.error.message);
    return EXIT_ERROR;
  }
  deps.writeOut(
    json
      ? renderProviderReadJson({ document: result.value.document })
      : renderDriveFileText({ document: result.value.document, payload: result.value.payload }),
  );
  return EXIT_OK;
}

/**
 * Run `drive drives` against injected edges.
 *
 * @param rest argv after `drive drives`
 * @param deps the read and output seams
 * @returns the process exit code
 */
export async function runDriveDrives({
  rest,
  deps,
}: {
  rest: readonly string[];
  deps: DriveReadDeps;
}): Promise<number> {
  const parsed = parseDriveDrivesArgs({ rest });
  if (parsed.isErr()) {
    for (const problem of driveErrorLines({ error: parsed.error })) {
      deps.writeDiagnostic(problem);
    }
    return EXIT_USAGE;
  }
  const result = await deps.drives({ home: parsed.value.home });
  if (result.isErr()) {
    deps.writeDiagnostic(result.error.message);
    return EXIT_ERROR;
  }
  deps.writeOut(
    parsed.value.json
      ? renderProviderReadJson({ document: result.value.document })
      : renderDriveDrivesText({ document: result.value.document, vocabulary: result.value.vocabulary }),
  );
  return EXIT_OK;
}

/**
 * The production read seams.
 *
 * @returns the grant-aware readers and output sinks
 */
export function productionDriveReadDeps(): DriveReadDeps {
  const nowIso = (): string => new Date().toISOString();
  return {
    drives: async ({ home }) => {
      const bound = resolveDriveClient({ capabilities: ["metadata"], home: resolveHome({ named: home }) });
      if (bound.isErr()) {
        return err(bound.error);
      }
      return readDriveDrives({
        account: bound.value.account,
        api: makeDriveApi({ account: bound.value.account, client: bound.value.client }),
        capped: MAX_SHARED_DRIVES,
        nowIso,
      });
    },
    list: async ({ home, query, driveId, limit }) => {
      const bound = resolveDriveClient({ capabilities: ["metadata"], home: resolveHome({ named: home }) });
      if (bound.isErr()) {
        return err(bound.error);
      }
      return readDriveListing({
        account: bound.value.account,
        api: makeDriveApi({ account: bound.value.account, client: bound.value.client }),
        driveId,
        limit,
        nowIso,
        query,
      });
    },
    read: async ({ home, fileId, withText }) => {
      // `content` rather than `metadata`, even for a `--metadata-only` read: the verb's contract is that it
      // CAN return text, and a grant that could not would have to fail halfway through rather than at the
      // door. One verb, one minimum grant, decided before anything is fetched.
      const bound = resolveDriveClient({ capabilities: ["content"], home: resolveHome({ named: home }) });
      if (bound.isErr()) {
        return err(bound.error);
      }
      return readDriveFile({
        account: bound.value.account,
        api: makeDriveApi({ account: bound.value.account, client: bound.value.client }),
        fileId,
        nowIso,
        withText,
      });
    },
    writeDiagnostic: (line) => {
      logger.warn({ msg: line });
    },
    writeOut: (line) => {
      logger.out({ line });
    },
  };
}

/** `slopweaver drive list`. */
export const driveListCommand = defineCommand({
  run: (argv) => runDriveList({ deps: productionDriveReadDeps(), rest: argv.slice(VERB_ARG_OFFSET) }),
});

/** `slopweaver drive read`. */
export const driveReadCommand = defineCommand({
  run: (argv) => runDriveRead({ deps: productionDriveReadDeps(), rest: argv.slice(VERB_ARG_OFFSET) }),
});

/** `slopweaver drive drives`. */
export const driveDrivesCommand = defineCommand({
  run: (argv) => runDriveDrives({ deps: productionDriveReadDeps(), rest: argv.slice(VERB_ARG_OFFSET) }),
});
