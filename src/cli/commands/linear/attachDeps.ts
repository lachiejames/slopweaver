/**
 * The injectable edges of `slopweaver linear attach upload` (`./attachRun.ts`) and their live wiring — the
 * file reads, the token, the Linear asset API, the PUT transport, the output sinks and the door ledger. A test
 * supplies plain functions in their place; nothing here is a mock.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname } from "node:path";

import { type DoorLedgerPort, doorLedgerPort } from "../../../admit/doorLedgerPort.js";
import { linearToken } from "../../../config.js";
import { type LinearAssetWriteApi, makeLinearAssetWriteApi } from "../../../corpus/linear/writeAssets.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { type AssetPutFetch, productionAssetPutFetch } from "../../../outbound/linear/assetUpload.js";
import { type LinearAttachError, LinearAttachErrors } from "../../../outbound/linear/attach.errors.js";
import { type LinearWritePrivacy, linearWritePrivacy } from "../../../outbound/linear/writePrivacy.js";

/** The injectable edges. A test supplies plain functions; nothing here is a mock. */
export interface LinearAttachDeps {
  readonly readFileBytes: (args: { path: string }) => Result<Uint8Array, LinearAttachError>;
  readonly fileSize: (args: { path: string }) => Result<number, LinearAttachError>;
  /** Every other entry in a file's own directory — what the `rendered-page-sibling` check reads. */
  readonly listSiblings: (args: { path: string }) => readonly string[];
  readonly resolveToken: (args: { home: string }) => string | undefined;
  readonly makeApi: (args: { home: string; token: string }) => LinearAssetWriteApi;
  readonly putFetch: AssetPutFetch;
  /** The outbound privacy policy an upload's name and text-like bytes are judged under, from the verb's own home. */
  readonly privacy: (args: { home: string }) => LinearWritePrivacy;
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
  /** The door ledger the upload's admit decision is recorded through. */
  readonly doorLedger: DoorLedgerPort;
}

/** Read a local file's bytes, or say which file could not be read. */
function readFileBytes({ path }: { path: string }): Result<Uint8Array, LinearAttachError> {
  try {
    return ok(readFileSync(path));
  } catch (cause: unknown) {
    return err(LinearAttachErrors.fileUnreadable({ cause, path }));
  }
}

/** Measure a file without opening it — the size the reservation is taken for. */
function fileSize({ path }: { path: string }): Result<number, LinearAttachError> {
  try {
    return ok(statSync(path).size);
  } catch (cause: unknown) {
    return err(LinearAttachErrors.fileUnreadable({ cause, path }));
  }
}

/**
 * The live edges.
 *
 * @returns the production dependency bag, swapped for plain fakes under test
 */
export function productionLinearAttachDeps(): LinearAttachDeps {
  return {
    doorLedger: doorLedgerPort(),
    err: (line) => process.stderr.write(`linear attach:${line}\n`),
    fileSize,
    listSiblings: ({ path }) => {
      try {
        return readdirSync(dirname(path)).filter((name) => name !== basename(path));
      } catch {
        return [];
      }
    },
    makeApi: ({ home, token }) => makeLinearAssetWriteApi({ privacy: linearWritePrivacy({ home }), token }),
    out: (line) => {
      logger.out({ line });
    },
    putFetch: productionAssetPutFetch(),
    privacy: ({ home }) => linearWritePrivacy({ home }),
    readFileBytes,
    resolveToken: ({ home }) => linearToken({ home }),
  };
}
