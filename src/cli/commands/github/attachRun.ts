/**
 * Effectful shell for `slopweaver github attach` — the owner's own browser session, its status, and the
 * governed upload.
 *
 * No session is captured here and none can be: owner ruling (`docs/browser-route.md`; what it retired,
 * `docs/browser-route/screenshot-reading-and-retirement.md`). The
 * cookies come out of the Chrome the owner is signed in to, per call, so the verb has two sub-verbs (`status` and the governed upload) where it used to have four.
 */

import { statSync } from "node:fs";
import { basename } from "node:path";

import { attachmentGates } from "../../../admit/attachmentGates.js";
import { throughDoor } from "../../../admit/effects.js";
import { attachUploadRefusalLines } from "../../../handover/attachUploadRuling.js";
import { err, type Result } from "../../../lib/result.js";
import { type GithubAttachError, GithubAttachErrors } from "../../../outbound/github/attach.errors.js";
import { readUploadContext, targetPageUrl } from "../../../outbound/github/attachClient.js";
import { attachEvidenceGate } from "../../../outbound/github/attachEvidence.js";
import {
  type ClassifiedAttachment,
  classifyAttachment,
  embedMarkdown,
  type UploadContext,
} from "../../../outbound/github/attachment.js";
import { type UploadedAsset, uploadAttachment } from "../../../outbound/github/attachUpload.js";
import {
  needsOwnerLogin,
  needsOwnerLoginEvent,
  type OwnerLoginError,
  ownerSignInRefusal,
} from "../../../outbound/github/sessionRecovery.js";
import { imageDigestOf } from "../../../visualEvidence/imageIo.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import {
  attachDoorRequest,
  attachStateHome,
  type GithubAttachUploadArgs,
  parseGithubAttachArgs,
} from "./attachCore.js";
import { type GithubAttachDeps, productionGithubAttachDeps } from "./attachDeps.js";
import { reportUploadPlan } from "./attachPlanReport.js";
import { runGithubAttachStatus } from "./attachStatusRun.js";
import {
  acknowledgedEnv,
  type PreparedUpload,
  prepareUpload,
  reportWaivers,
  type VerifiedUpload,
  verifyAndRecord,
} from "./attachVerify.js";
import { githubVerbErrorLines } from "./errors.js";
import { GITHUB_ATTACH_USAGE } from "./prUsage.js";

const VERB_ARG_OFFSET = 4;

/**
 * How this pipeline names where its cookies came from, in an error and in an event.
 *
 * A phrase rather than a path, because there is no file to point at any more and "sign in to github.com in
 * your own Chrome" is the only correction there is. `chromeSession.ts` names the specific profile when it
 * knows it; this is what the calls further down the pipeline, which never learn it, say instead.
 */
const SESSION_SOURCE = "your own Chrome";

/** Report a typed failure and exit non-zero — `.message` is what a domain error is FOR. */
function reportFailure({ deps, error }: { deps: GithubAttachDeps; error: GithubAttachError }): number {
  deps.writeDiagnostic(error.message);
  return EXIT_ERROR;
}

/** Print a verified upload in the selected output mode, its receipt id last so a description can cite it. */
function reportUpload({
  deps,
  args,
  asset,
  markdown,
  outcome,
  uploadReceiptId,
}: {
  deps: GithubAttachDeps;
  args: GithubAttachUploadArgs;
  asset: UploadedAsset;
  markdown: string;
  outcome: string;
  uploadReceiptId: string;
}): void {
  if (args.json) {
    deps.out(JSON.stringify({ asset, markdown, outcome, uploadReceiptId }, undefined, 2));
    return;
  }
  deps.out(`${outcome} ${asset.uploadName} (${asset.contentType}, ${String(asset.byteLength)} bytes)`);
  deps.out(asset.href);
  deps.out(markdown);
  deps.out(`upload receipt ${uploadReceiptId} — fetched back from GitHub and byte-identical to what was checked`);
  if (asset.contentType.startsWith("video/")) {
    // Placement is load-bearing for a video and for nothing else: GitHub turns a user-attachments URL
    // into an inline player only when it stands ALONE on its line. The same URL inside a sentence stays
    // a link, which reads as "the upload did not work" when the upload was perfect.
    deps.out("paste that URL on a line of its own, blank line either side, or it renders as a link");
  }
}

/** Measure the file and classify it — the whole local half, before a session is even looked for. */
function prepare({ args }: { args: GithubAttachUploadArgs }): Result<ClassifiedAttachment, GithubAttachError> {
  let byteLength: number;
  try {
    byteLength = statSync(args.file).size;
  } catch (cause: unknown) {
    return err(GithubAttachErrors.fileUnreadable({ cause, path: args.file }));
  }
  return classifyAttachment({ byteLength, fileName: basename(args.file) });
}

/** Send the three calls through the door, once every local check has already passed. */
async function sendThroughDoor({
  args,
  deps,
  home,
  classified,
  prepared,
  context,
  cookieHeader,
}: UploadAttempt & {
  context: UploadContext;
  cookieHeader: string;
}): Promise<Result<VerifiedUpload, GithubAttachError>> {
  const { bytes, checks, file, pixelText } = prepared;
  const target = { number: args.number, owner: args.owner, repo: args.repo };
  const through = await throughDoor({
    env: acknowledgedEnv({ acknowledge: args.acknowledge, env: process.env }),
    gates: [...attachmentGates({ file }), attachEvidenceGate({ findings: checks.findings })],
    home,
    ledger: deps.doorLedger,
    perform: () =>
      uploadAttachment({
        bytes,
        classified,
        context,
        cookieHeader,
        fetchImpl: deps.fetchImpl,
        // A picture whose text could not be read is held by the gate above, so `perform` only ever sees read lines;
        // a recording has none to add.
        pixelText: pixelText?.isOk() === true ? pixelText.value.lines : [],
        refererUrl: targetPageUrl({ target }),
      }),
    request: attachDoorRequest({ args, byteLength: classified.byteLength, contentType: classified.contentType, home }),
  });
  reportWaivers({ acknowledged: args.acknowledge, deps, overridden: through.decision.overridden });
  if (through.performed) {
    if (through.result.isErr()) {
      return err(through.result.error);
    }
    const sentDigest = imageDigestOf({ bytes });
    return verifyAndRecord({ args, asset: through.result.value, checks, cookieHeader, deps, home, sentDigest });
  }
  if (through.kind === "recording-refused") {
    return err(GithubAttachErrors.doorRecordingRefused({ message: through.error.message }));
  }
  return err(GithubAttachErrors.doorRefused({ decision: through.decision }));
}

/** Everything one upload attempt needs, prepared before the session is read. */
interface UploadAttempt {
  readonly args: GithubAttachUploadArgs;
  readonly deps: GithubAttachDeps;
  readonly home: string;
  readonly classified: ClassifiedAttachment;
  readonly prepared: PreparedUpload;
}

/**
 * One full pass from the browser's session to the finalized asset.
 *
 * Split out precisely so every session-dependent step runs together — the cookie read AND the
 * page scrape. Retrying only the scrape would send the lapsed cookies a second time, and retrying only the
 * cookie read would reuse a token scraped by an anonymous visitor.
 */
async function attemptUpload({
  args,
  deps,
  home,
  classified,
  prepared,
}: UploadAttempt): Promise<Result<VerifiedUpload, GithubAttachError>> {
  const cookies = await deps.loadCookies({ home });
  if (cookies.isErr()) {
    return err(cookies.error);
  }
  const context = await readUploadContext({
    cookieHeader: cookies.value,
    fetchImpl: deps.fetchImpl,
    sessionPath: SESSION_SOURCE,
    target: { number: args.number, owner: args.owner, repo: args.repo },
  });
  if (context.isErr()) {
    return err(context.error);
  }
  return sendThroughDoor({
    args,
    classified,
    context: context.value,
    cookieHeader: cookies.value,
    deps,
    home,
    prepared,
  });
}

/** Report whichever way an attempt ended. */
function finishUpload({
  args,
  deps,
  uploaded,
}: {
  args: GithubAttachUploadArgs;
  deps: GithubAttachDeps;
  uploaded: Result<VerifiedUpload, GithubAttachError>;
}): number {
  if (uploaded.isErr()) {
    return reportFailure({ deps, error: uploaded.error });
  }
  const { asset, receipt } = uploaded.value;
  reportUpload({
    args,
    asset,
    deps,
    // The alt embedded is the alt scanned, carried on the receipt, never re-derived from what GitHub named the file.
    markdown: embedMarkdown({ alt: receipt.image.alt, contentType: asset.contentType, href: asset.href }),
    outcome: "uploaded",
    uploadReceiptId: receipt.uploadReceiptId,
  });
  return EXIT_OK;
}

/**
 * The signed-out branch: refuse in one line naming the fix, and publish the block where the owner reads it.
 *
 * There is no retry, because there is nothing this process can do to change the answer — the correction is
 * a tab in the owner's own browser. What replaces the retry is doctrine rule 6: the refusal is printed AND
 * published to the supervisor stream, so a blocked upload in a terminal nobody is watching still surfaces.
 *
 * @param attempt the upload that could not go through
 * @param error the narrowed session failure
 * @returns the process exit code
 */
function refuseAndSurface({ attempt, error }: { attempt: UploadAttempt; error: OwnerLoginError }): number {
  const { deps, home } = attempt;
  deps.publishEvent({
    event: needsOwnerLoginEvent({ atIso: deps.nowIso(), error, sessionPath: SESSION_SOURCE }),
    home,
  });
  deps.writeDiagnostic(ownerSignInRefusal({ error }));
  return EXIT_ERROR;
}

/** Run `attach upload`: classify, size-check, scrape, then the three calls through the door. */
async function runUpload({
  args,
  deps,
  home,
}: {
  args: GithubAttachUploadArgs;
  deps: GithubAttachDeps;
  home: string;
}): Promise<number> {
  // The owner's recorded word comes first: attach upload is closed until a ruling permits it, so a refused upload reads
  // no file and touches no session. A dry run sends nothing, so it still previews, its plan carrying the same refusal.
  const standing = deps.attachUploadStanding({ home });
  if (standing.kind === "refused" && !args.dryRun) {
    for (const line of attachUploadRefusalLines({ standing })) {
      deps.writeDiagnostic(line);
    }
    return EXIT_ERROR;
  }
  const classified = prepare({ args });
  if (classified.isErr()) {
    return reportFailure({ deps, error: classified.error });
  }
  // The hygiene policy loads before the session is read or any page is fetched: a policy that did not load
  // refuses here, so GitHub is never contacted for an upload whose text could not be scanned.
  const scan = deps.textScanFor({ home, ownRepository: `${args.owner}/${args.repo}` });
  if (scan.isErr()) {
    deps.writeDiagnostic(`refused: ${scan.error} nothing was sent.`);
    return EXIT_ERROR;
  }
  // The file is read and its picture's text recognised here, once, before the session is read or any page is fetched,
  // so the dry run and the door judge the same result. A picture whose text cannot be read, or shows something
  // private, is held at the door: none of its bytes are sent.
  const prepared = prepareUpload({ args, classified: classified.value, deps, home, scan: scan.value });
  if (prepared.isErr()) {
    return reportFailure({ deps, error: prepared.error });
  }
  const attempt: UploadAttempt = { args, classified: classified.value, deps, home, prepared: prepared.value };
  if (args.dryRun) {
    reportUploadPlan({ ...attempt, standing });
    return EXIT_OK;
  }
  const uploaded = await attemptUpload(attempt);
  if (uploaded.isOk()) {
    return finishUpload({ args, deps, uploaded });
  }
  const blocked = needsOwnerLogin({ error: uploaded.error });
  return blocked === undefined
    ? reportFailure({ deps, error: uploaded.error })
    : refuseAndSurface({ attempt, error: blocked });
}

/**
 * Run the attach command.
 *
 * @param rest argv after `github attach`
 * @param deps session, filesystem, transport and output seams
 * @returns the process exit code
 */
export async function runGithubAttach({
  rest,
  deps,
}: {
  rest: readonly string[];
  deps: GithubAttachDeps;
}): Promise<number> {
  const parsed = parseGithubAttachArgs({ rest });
  if (parsed.isErr()) {
    for (const problem of githubVerbErrorLines({ error: parsed.error })) {
      deps.writeDiagnostic(problem);
    }
    deps.writeDiagnostic(GITHUB_ATTACH_USAGE);
    return EXIT_USAGE;
  }
  const args = parsed.value;
  const home = attachStateHome({ args, resolveDefault: () => deps.home() });
  return args.kind === "upload"
    ? runUpload({ args, deps, home })
    : runGithubAttachStatus({ deps, home, json: args.json, org: args.org });
}

/** `slopweaver github attach`. */
export const githubAttachCommand = defineCommand({
  run: (argv) => runGithubAttach({ deps: productionGithubAttachDeps(), rest: argv.slice(VERB_ARG_OFFSET) }),
});
