/**
 * `slopweaver write vanta create-document|upload-evidence|submit-document [...]` — the three additive
 * document writes, each through the admit door behind an approval digest.
 *
 * One shell for three verbs because they are one act at three stages — create the record, attach the
 * evidence, submit it for review — sharing one credential bind, one door shape and one approval gate. What
 * differs per verb is entirely inside `documentCore.ts`'s parser and `writePreview.ts`'s resolved request.
 *
 * ## Why `--dry-run` returns BEFORE the door
 *
 * A dry run performs no external write, so routing it would record a decision in the ledger for something
 * that never happened and the ledger would over-count real mutations. `deactivateRun.ts` states the same
 * reasoning; this shell mirrors it deliberately rather than inventing a second convention.
 *
 * ## The exit-code contract
 *
 * | situation                                          | code |
 * | -------------------------------------------------- | ---- |
 * | a bad flag, or a request that could not be built   | `2`  |
 * | credentials genuinely not configured               | `3`  |
 * | the door refused, or Vanta did                     | `1`  |
 * | a dry run, or a write that landed                  | `0`  |
 */
import { readFileSync } from "node:fs";
import { basename } from "node:path";

import { type DoorLedgerPort, doorLedgerPort } from "../../../admit/doorLedgerPort.js";
import { notPerformedLines } from "../../../admit/doorRefusal.js";
import { throughDoor } from "../../../admit/effects.js";
import { vantaCredentialErrorsLines } from "../../../atlas/vanta/credentialErrors.js";
import { vantaDocumentApprovalGate, vantaDocumentDigest } from "../../../atlas/vanta/documentApproval.js";
import { createVantaManageWriteClient, type VantaManageWriteClient } from "../../../atlas/vanta/writeClient.js";
import { resolveVantaWriteRequest, type VantaWriteRequestInput } from "../../../atlas/vanta/writePreview.js";
import { slopweaverHome } from "../../../homeDir.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { verbTail } from "../../optionParsers.js";
import { bindVanta } from "./binding.js";
import {
  parseVantaCreateDocumentOptions,
  parseVantaSubmitDocumentOptions,
  parseVantaUploadEvidenceOptions,
  type VantaDocumentBaseOptions,
  type VantaDocumentOptions,
} from "./documentCore.js";
import { renderVantaDocumentDryRun, renderVantaWriteResult } from "./documentReport.js";
import {
  VANTA_CREATE_DOCUMENT_USAGE,
  VANTA_SUBMIT_DOCUMENT_USAGE,
  VANTA_UPLOAD_EVIDENCE_USAGE,
} from "./documentUsage.js";
import { type VantaVerbError, VantaVerbErrors, vantaVerbErrorLines } from "./errors.js";

/** Where a `write vanta` verb sits: past the runtime, the script, the `write` noun and the `vanta` platform. */
const WRITE_VERB_INDEX = 4;

/** What an uploaded file is announced as when its own extension says nothing. */
const FALLBACK_MIME_TYPE = "application/octet-stream";

/** The extensions this verb can name a media type for; anything else uploads as an opaque stream. */
const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  ".csv": "text/csv",
  ".htm": "text/html",
  ".html": "text/html",
  ".json": "application/json",
  ".md": "text/markdown",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".txt": "text/plain",
};

/**
 * The media type an upload is announced as, from its own extension.
 *
 * `Object.hasOwn` rather than an index, so an inherited key can never answer: only an extension this table
 * declares names a type, and every other one uploads as the opaque stream the table's own doc promises.
 *
 * @param extension the lowercased extension with its dot, `.pdf`, or `""` for a file with none
 * @returns the declared media type, or the opaque stream for an extension Vanta is given no type for
 *
 * @internal
 */
export function mediaTypeFor({ extension }: { extension: string }): string {
  if (!Object.hasOwn(MIME_BY_EXTENSION, extension)) {
    return FALLBACK_MIME_TYPE;
  }
  return MIME_BY_EXTENSION[extension]!;
}

/** Read the file an upload would send, and name a media type for it from its own extension. */
function readUploadFile({
  path,
}: {
  path: string;
}): Result<{ name: string; mimeType: string; content: Uint8Array<ArrayBuffer> }, VantaVerbError> {
  try {
    const bytes = readFileSync(path);
    const name = basename(path);
    const dot = name.lastIndexOf(".");
    const extension = dot === -1 ? "" : name.slice(dot).toLowerCase();
    return ok({
      content: new Uint8Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)),
      mimeType: mediaTypeFor({ extension }),
      name,
    });
  } catch (error: unknown) {
    return err(VantaVerbErrors.uploadFileUnreadable({ cause: error, path }));
  }
}

/** Resolve the preview input for one parsed invocation, reading an upload's bytes when there are any. */
function previewInput({ options }: { options: VantaDocumentOptions }): Result<VantaWriteRequestInput, VantaVerbError> {
  if (options.write.kind === "create-document") {
    return ok({ input: options.write.input, kind: "create-document" });
  }
  if (options.write.kind === "submit-document") {
    return ok({ input: options.write.input, kind: "submit-document" });
  }
  const file = readUploadFile({ path: options.write.input.filePath });
  if (file.isErr()) {
    return err(file.error);
  }
  return ok({
    input: {
      description: options.write.input.description,
      documentId: options.write.input.documentId,
      effectiveAtDate: options.write.input.effectiveAtDate,
      file: file.value,
    },
    kind: "upload-evidence",
  });
}

/**
 * The one seam this verb injects: how a bound write client is obtained.
 *
 * It exists for the reason `deactivateRun.ts`'s does — so the door's refusal can be proved at the REAL
 * command boundary with a client that records whether Vanta was reached, rather than with a mock this
 * repo's testing rule bans.
 *
 * @internal
 */
export interface VantaDocumentDeps {
  /** Bind credentials and build the write client, or report every reason it could not be built. */
  readonly createClient: (input: { base: VantaDocumentBaseOptions }) => Result<VantaManageWriteClient>;
  /** The door ledger the write's decision is recorded through. */
  readonly doorLedger: DoorLedgerPort;
}

/** The production seam: resolve the credential pair the usual way and build the real HTTP client. */
const PRODUCTION_DEPS: VantaDocumentDeps = {
  createClient: ({ base }) => {
    const bound = bindVanta({
      clientIdFile: base.clientIdFile,
      clientSecretFile: base.clientSecretFile,
      env: process.env,
      home: base.home,
    });
    return bound.map(createVantaManageWriteClient).mapErr((errors) => vantaCredentialErrorsLines({ errors }));
  },
  doorLedger: doorLedgerPort(),
};

/** Perform the write this invocation names, against a bound client. */
async function performWrite({
  client,
  request,
}: {
  client: VantaManageWriteClient;
  request: VantaWriteRequestInput;
}): Promise<Result<unknown, VantaVerbError>> {
  if (request.kind === "create-document") {
    return (await client.createDocument(request.input)).mapErr((reasons) => VantaVerbErrors.writeFailed({ reasons }));
  }
  if (request.kind === "upload-evidence") {
    return (await client.uploadEvidence(request.input)).mapErr((reasons) => VantaVerbErrors.writeFailed({ reasons }));
  }
  if (request.kind === "submit-document") {
    return (await client.submitDocument(request.input)).mapErr((reasons) => VantaVerbErrors.writeFailed({ reasons }));
  }
  return err(VantaVerbErrors.requestUnperformable({ kind: request.kind }));
}

/** Which document a write addresses, or `null` for the one that is creating it. */
function documentIdOf({ request }: { request: VantaWriteRequestInput }): string | null {
  if (request.kind === "upload-evidence" || request.kind === "submit-document") {
    return request.input.documentId;
  }
  return null;
}

/**
 * The door request one document write makes.
 *
 * The artifact carries the document id and the write's SHAPE — never a title, a description or a byte of an
 * uploaded file. The ledger is a record that a write happened, not a copy of what it said; `deactivateRun.ts`
 * holds the same line for a deactivation reason.
 */
function documentDoorRequest({
  base,
  request,
  verb,
}: {
  base: VantaDocumentBaseOptions;
  request: VantaWriteRequestInput;
  verb: string;
}): Parameters<typeof throughDoor>[0]["request"] {
  return {
    action: { kind: "verb", noun: "write", verb: `vanta ${verb}` },
    artifact: { document: documentIdOf({ request }), write: request.kind },
    meta: { createsWorkItem: false, effect: "external-write", home: base.home, requiresApproval: true },
  };
}

/** Route the real write through the door and report both arms of what came back. */
async function applyWrite({
  base,
  command,
  request,
  verb,
  deps,
}: {
  base: VantaDocumentBaseOptions;
  command: string;
  request: VantaWriteRequestInput;
  verb: string;
  deps: VantaDocumentDeps;
}): Promise<number> {
  const bound = deps.createClient({ base });
  if (bound.isErr()) {
    bound.error.forEach((problem) => {
      logger.error({ msg: problem });
    });
    return EXIT_EXPECTED_EMPTY;
  }
  const client = bound.value;
  const routed = await throughDoor({
    gates: [
      vantaDocumentApprovalGate({
        expected: vantaDocumentDigest({ request: resolveVantaWriteRequest(request) }),
        supplied: base.approve,
      }),
    ],
    home: base.home,
    ledger: deps.doorLedger,
    perform: () => performWrite({ client, request }),
    request: documentDoorRequest({ base, request, verb }),
  });
  if (!routed.performed) {
    for (const line of notPerformedLines({ command, through: routed })) {
      logger.error({ msg: line });
    }
    return EXIT_ERROR;
  }
  if (routed.result.isErr()) {
    vantaVerbErrorLines({ error: routed.result.error }).forEach((problem) => {
      logger.error({ msg: problem });
    });
    return EXIT_ERROR;
  }
  if (base.json) {
    logger.out({ line: JSON.stringify({ result: routed.result.value, sent: true, write: request.kind }, null, 2) });
  } else {
    renderVantaWriteResult({ result: routed.result.value, verb }).forEach((line) => {
      logger.out({ line });
    });
  }
  return EXIT_OK;
}

/** Print the resolved request and change nothing. */
function reportDryRun({
  base,
  request,
  verb,
}: {
  base: VantaDocumentBaseOptions;
  request: VantaWriteRequestInput;
  verb: string;
}): number {
  const resolved = resolveVantaWriteRequest(request);
  const digest = vantaDocumentDigest({ request: resolved });
  if (base.json) {
    logger.out({ line: JSON.stringify({ approve: digest, request: resolved, sent: false }, null, 2) });
    return EXIT_OK;
  }
  for (const line of renderVantaDocumentDryRun({ digest, request: resolved, verb })) {
    logger.out({ line });
  }
  return EXIT_OK;
}

/**
 * One document verb: the command its door refusal names, its usage, and the pure parser that reads its tail.
 * The command is a literal per verb, never interpolated, so `printedCommandsResolve.test.ts` resolves each one.
 */
interface DocumentVerb {
  readonly command: `slopweaver write vanta ${string}`;
  readonly usage: string;
  readonly parse: (input: { rest: readonly string[]; defaultHome: string }) => Result<VantaDocumentOptions>;
}

/** Every document verb this shell answers, keyed by the word the caller types. */
const DOCUMENT_VERBS: Readonly<Record<string, DocumentVerb>> = {
  "create-document": {
    command: "slopweaver write vanta create-document",
    parse: parseVantaCreateDocumentOptions,
    usage: VANTA_CREATE_DOCUMENT_USAGE,
  },
  "submit-document": {
    command: "slopweaver write vanta submit-document",
    parse: parseVantaSubmitDocumentOptions,
    usage: VANTA_SUBMIT_DOCUMENT_USAGE,
  },
  "upload-evidence": {
    command: "slopweaver write vanta upload-evidence",
    parse: parseVantaUploadEvidenceOptions,
    usage: VANTA_UPLOAD_EVIDENCE_USAGE,
  },
};

/**
 * Run one document write against an injected provider seam.
 *
 * @param argv the full process argv (verb tail starts at index 4)
 * @param verb which document write was asked for
 * @param deps how the write client is obtained
 * @returns the process exit code
 * @internal
 */
export async function runVantaDocumentWith({
  argv,
  verb,
  deps,
}: {
  argv: readonly string[];
  verb: string;
  deps: VantaDocumentDeps;
}): Promise<number> {
  const entry = DOCUMENT_VERBS[verb];
  if (entry === undefined) {
    logger.error({ msg: `slopweaver write vanta has no verb "${verb}"` });
    return EXIT_USAGE;
  }
  const rest = verbTail({ argv, at: WRITE_VERB_INDEX, verbs: [verb] });
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: entry.usage });
    return EXIT_OK;
  }
  const parsed = entry.parse({ defaultHome: slopweaverHome(), rest });
  if (parsed.isErr()) {
    parsed.error.forEach((problem) => {
      logger.error({ msg: problem });
    });
    logger.error({ msg: entry.usage });
    return EXIT_USAGE;
  }
  const { base } = parsed.value;
  const request = previewInput({ options: parsed.value });
  if (request.isErr()) {
    vantaVerbErrorLines({ error: request.error }).forEach((problem) => {
      logger.error({ msg: problem });
    });
    return EXIT_USAGE;
  }
  return base.dryRun
    ? reportDryRun({ base, request: request.value, verb })
    : applyWrite({ base, command: entry.command, deps, request: request.value, verb });
}

/**
 * Run one document write against the real Vanta write client.
 *
 * @param argv the full process argv (verb tail starts at index 4)
 * @param verb which document write was asked for
 * @returns the process exit code
 * @internal
 */
export async function runVantaDocument({ argv, verb }: { argv: readonly string[]; verb: string }): Promise<number> {
  return runVantaDocumentWith({ argv, deps: PRODUCTION_DEPS, verb });
}
