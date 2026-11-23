/**
 * The injectable edges of `slopweaver github attach`, and the production implementation of each.
 *
 * Split from `./attachRun.ts`, which owns the upload pipeline and the verb's dispatch. This module imports
 * nothing back from it, so `./attachStatusRun.ts` and the tests reach the seams without the pipeline.
 */

import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { basename, dirname } from "node:path";

import { type DoorLedgerPort, doorLedgerPort } from "../../../admit/doorLedgerPort.js";
import { recordedProfilePort } from "../../../browser/recordedProfile.js";
import { slopweaverHome } from "../../../config.js";
import type { SupervisorEvent } from "../../../events/event.js";
import { publishSupervisorEvent } from "../../../events/store.js";
import type { AttachUploadStanding } from "../../../handover/attachUploadRuling.js";
import { readAttachUploadStanding } from "../../../handover/attachUploadRulingStore.js";
import { privateTermsOrRefusal } from "../../../hygiene/privateTerms.js";
import { loadDenylistResult, unreadableDenylistMessage } from "../../../hygiene/scan.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { type GithubAttachError, GithubAttachErrors } from "../../../outbound/github/attach.errors.js";
import { type AttachFetch, productionAttachFetch } from "../../../outbound/github/attachClient.js";
import { type AttachTextScan, publicationAttachScan } from "../../../outbound/github/attachEvidence.js";
import { type AttachAssetFetch, productionAttachAssetFetch } from "../../../outbound/github/attachReadBack.js";
import {
  type GithubSessionStatus,
  githubCookieHeader,
  githubSessionStatus,
} from "../../../outbound/github/chromeSession.js";
import { stateHomePaths } from "../../../stateHome.js";
import {
  type ImageTextError,
  type RecognisedImageText,
  recogniseImageText,
} from "../../../visualEvidence/imageTextRecognition.js";

/** Injectable edges for a no-network unit test. */
export interface GithubAttachDeps {
  /** The door ledger the upload's decision is recorded through before any byte is sent. */
  readonly doorLedger: DoorLedgerPort;
  /**
   * The attach-upload standing the owner's recorded word leaves: CLOSED until a ruling permits it. Asked first, before the
   * file is read or the session touched. The production default walks the home's run journals
   * (`readAttachUploadStanding`).
   */
  readonly attachUploadStanding: (args: { home: string }) => AttachUploadStanding;
  readonly home: () => string;
  readonly readFileBytes: (args: { path: string }) => Result<Uint8Array, GithubAttachError>;
  /** Every other entry in a file's own directory — what the `rendered-page-sibling` check reads. */
  readonly listSiblings: (args: { path: string }) => readonly string[];
  readonly loadCookies: (args: { home: string }) => Promise<Result<string, GithubAttachError>>;
  readonly status: (args: { home: string }) => Promise<GithubSessionStatus>;
  readonly fetchImpl: AttachFetch;
  /** The read-back transport: an uploaded asset is fetched back and compared before any receipt is written. */
  readonly fetchAsset: AttachAssetFetch;
  /**
   * The publication scan for one upload, built for its home and its own repository, or the refusal sentence when
   * the hygiene policy it reads could not be loaded. Built once, before any network call, so a policy that did not
   * load refuses the upload before GitHub is contacted. The production default is the surface-aware publication
   * scan (`publicationAttachScan`).
   */
  readonly textScanFor: (args: { home: string; ownRepository: string }) => Result<AttachTextScan, string>;
  /**
   * Read the text a picture's pixels show, on this machine, from the exact buffer that will be uploaded. Called once per
   * upload, before GitHub is contacted. The production default is macOS Vision (`recogniseImageText`).
   */
  readonly recogniseImageText: (args: { bytes: Uint8Array }) => Result<RecognisedImageText, ImageTextError>;
  /** Mint the id a new upload receipt is filed under, `upl-<uuid>`. */
  readonly newUploadReceiptId: () => string;
  readonly out: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
  /** Append one event to the supervisor stream. Never throws — a stream failure must not sink an upload. */
  readonly publishEvent: (args: { event: SupervisorEvent; home: string }) => void;
  readonly nowIso: () => string;
}

/**
 * Read a local file's bytes, or say which file could not be read.
 *
 * Returns `readFileSync`'s own Buffer rather than copying it into a fresh `Uint8Array` — a Buffer already IS
 * one, and at the 100 MiB video ceiling a needless copy is 100 MiB of resident memory for nothing. The
 * single copy this pipeline does make happens once, at the point the bytes become a `Blob`.
 */
function readFileBytes({ path }: { path: string }): Result<Uint8Array, GithubAttachError> {
  try {
    return ok(readFileSync(path));
  } catch (cause: unknown) {
    return err(GithubAttachErrors.fileUnreadable({ cause, path }));
  }
}

/**
 * Every other entry in a file's own directory, or none when the directory cannot be listed.
 *
 * An unreadable directory yields an empty listing rather than a failure: this feeds a tripwire, and a
 * tripwire that turned a permissions quirk into a refused upload would be a fence.
 */
function listSiblings({ path }: { path: string }): readonly string[] {
  try {
    return readdirSync(dirname(path)).filter((name) => name !== basename(path));
  } catch {
    return [];
  }
}

/**
 * The production scan: the private denylist and private terms read from the home, handed to the description gate's
 * own leak scan. An absent denylist scans with no denylisted word (every credential shape still fires); an
 * unreadable one refuses, and so do private terms that did not load, absence included.
 *
 * @param home the state home both are read from
 * @param ownRepository the upload's own `owner/repo`
 * @returns the scan port, or the refusal sentence
 */
function productionTextScan({
  home,
  ownRepository,
}: {
  home: string;
  ownRepository: string;
}): Result<AttachTextScan, string> {
  const load = loadDenylistResult({ home });
  if (load.kind === "unreadable") {
    return err(unreadableDenylistMessage({ load }));
  }
  const privateTerms = privateTermsOrRefusal({ home });
  if (privateTerms.isErr()) {
    return err(privateTerms.error);
  }
  const denylist = load.kind === "loaded" ? load.lines : [];
  return ok(publicationAttachScan({ denylist, ownRepository, privateTerms: privateTerms.value }));
}

/**
 * Production session, filesystem, transport and output seams.
 *
 * @returns the real edges for the attach command
 */
export function productionGithubAttachDeps(): GithubAttachDeps {
  const profiles = recordedProfilePort();
  return {
    attachUploadStanding: ({ home }) => readAttachUploadStanding({ runsDir: stateHomePaths({ home }).runs }),
    doorLedger: doorLedgerPort(),
    fetchAsset: productionAttachAssetFetch(),
    fetchImpl: productionAttachFetch(),
    newUploadReceiptId: () => `upl-${randomUUID()}`,
    recogniseImageText: ({ bytes }) => recogniseImageText({ bytes }),
    textScanFor: productionTextScan,
    home: slopweaverHome,
    loadCookies: ({ home }) => githubCookieHeader({ home, profiles }),
    out: (line) => {
      logger.out({ line });
    },
    listSiblings,
    readFileBytes,
    nowIso: () => new Date().toISOString(),
    publishEvent: ({ event, home }) => {
      const failure = publishSupervisorEvent({ event, home });
      if (failure !== undefined) {
        logger.warn({ msg: `supervisor stream: ${failure}` });
      }
    },
    status: ({ home }) => githubSessionStatus({ home, profiles }),
    writeDiagnostic: (line) => {
      logger.warn({ msg: line });
    },
  };
}
