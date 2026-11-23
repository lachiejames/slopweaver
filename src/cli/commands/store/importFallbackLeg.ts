/**
 * `store import-fleet --only codex-fallback` — the ONE-TIME import of the legacy `codex-fallback/` directories
 * into `codex_fallback_request` and `codex_fallback_receipt`, which are the authority from then on
 * (`src/codex/fallbackPort.ts`). Nothing reads the directory once it has been imported, so it may be removed.
 *
 * A directory with no `request.json` is not a request — a half-written `prepare`, or a session's own scratch
 * folder such as `answers/` — and is skipped. The packets beside a request were never stored: the table header
 * (`../../../store/schema/codexFallback.ts`) carries why.
 *
 * Every insert is `DO NOTHING`, then the rows are READ BACK and compared with the legacy text. The row is the
 * authority and is never overwritten, so a legacy document that differs from it is a `FALLBACK_IMPORT_DIVERGED`
 * refusal and the leg exits non-zero, rather than a quiet keep of one side. A second run over an unchanged home
 * writes zero rows and diverges on none — the convergence proof.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { errorMessage } from "#lib/errorMessage.js";
import { stateHomePaths } from "../../../stateHome.js";
import type { StoreClient } from "../../../store/client.js";
import {
  decodeFallbackDocument,
  fallbackImportDivergences,
  type ProjectedFallbackRequest,
  projectFallbackRequest,
} from "../../../store/fleet/codexFallback.js";
import { importFallbackRequests, readStoredFallbackRequests } from "../../../store/fleet/codexFallbackStore.js";
import { type FleetImportError, FleetImportErrors } from "../../../store/fleet/errors.js";

import type { LegOutcome } from "./importFleetCore.js";

/** The legacy file names inside one request directory. */
const REQUEST_FILENAME = "request.json";
const RECEIPT_FILENAME = "receipt.json";

/** One request directory read and projected, or pushed onto `refused` with its reason. */
function projectDirectory({
  requestDir,
  requestId,
  refused,
}: {
  requestDir: string;
  requestId: string;
  refused: FleetImportError[];
}): ProjectedFallbackRequest | undefined {
  const requestPath = join(requestDir, REQUEST_FILENAME);
  const receiptPath = join(requestDir, RECEIPT_FILENAME);
  let requestBytes: Uint8Array;
  let receiptBytes: Uint8Array | undefined;
  try {
    requestBytes = readFileSync(requestPath);
    receiptBytes = existsSync(receiptPath) ? readFileSync(receiptPath) : undefined;
  } catch (cause) {
    refused.push(
      FleetImportErrors.unstorableFallbackDocument({ path: requestDir, reason: errorMessage({ error: cause }) }),
    );
    return undefined;
  }
  const requestText = decodeFallbackDocument({ bytes: requestBytes, path: requestPath });
  if (requestText.isErr()) {
    refused.push(requestText.error);
    return undefined;
  }
  let receiptText: string | undefined;
  if (receiptBytes !== undefined) {
    const decoded = decodeFallbackDocument({ bytes: receiptBytes, path: receiptPath });
    if (decoded.isErr()) {
      refused.push(decoded.error);
      return undefined;
    }
    receiptText = decoded.value;
  }
  const projected = projectFallbackRequest({
    path: requestDir,
    receiptText,
    requestId,
    requestText: requestText.value,
  });
  if (projected.isErr()) {
    refused.push(projected.error);
    return undefined;
  }
  return projected.value;
}

/**
 * Project every legacy fallback request directory and, unless this is a dry run, write the rows and compare
 * them with what the store then holds.
 *
 * @param client the open connection, or `undefined` on a dry run
 * @param home the state home whose `codex-fallback/` is read
 * @returns what this leg did — `written` is new requests plus new receipts, so a re-run over an unchanged
 *   home reports zero; every diverging document is a refusal
 */
export async function runFallbackLeg({
  client,
  home,
}: {
  client: StoreClient | undefined;
  home: string;
}): Promise<LegOutcome> {
  const root = stateHomePaths({ home }).codexFallback;
  const outcome = { absentSource: undefined, leg: "codex-fallback" as const, unreadableLines: 0 };
  if (!existsSync(root)) {
    return { ...outcome, absentSource: root, projected: 0, refused: [], written: 0 };
  }
  const refused: FleetImportError[] = [];
  const projected: ProjectedFallbackRequest[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true }).toSorted((a, b) => a.name.localeCompare(b.name))) {
    const requestDir = join(root, entry.name);
    if (!entry.isDirectory() || !existsSync(join(requestDir, REQUEST_FILENAME))) {
      continue;
    }
    const one = projectDirectory({ refused, requestDir, requestId: entry.name });
    if (one !== undefined) {
      projected.push(one);
    }
  }
  if (client === undefined) {
    return { ...outcome, projected: projected.length, refused, written: 0 };
  }
  const written = await importFallbackRequests({ client, projected });
  if (written.isErr()) {
    refused.push(FleetImportErrors.legWriteFailed({ path: root, reason: written.error.message }));
    return { ...outcome, projected: projected.length, refused, written: 0 };
  }
  const stored = await readStoredFallbackRequests({ client });
  if (stored.isErr()) {
    refused.push(FleetImportErrors.legWriteFailed({ path: root, reason: `read-back failed: ${stored.error.message}` }));
  } else {
    refused.push(
      ...fallbackImportDivergences({
        pathOf: ({ requestId }) => join(root, requestId),
        projected,
        stored: new Map(stored.value.map((row) => [row.requestId, row])),
      }),
    );
  }
  return {
    ...outcome,
    projected: projected.length,
    refused,
    written: written.value.requests + written.value.receipts,
  };
}
