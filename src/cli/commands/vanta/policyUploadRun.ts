/**
 * `slopweaver write vanta upload-policy-version` — push one policy's markdown into Vanta as a DRAFT.
 *
 * ## Why an upload rather than an edit
 *
 * A policy whose approved version was loaded as a FILE reads `Via file upload (.docx)` or `(.pdf)` on its
 * page, and Vanta's in-app editor refuses it (`Policy draft is not editable`), so `write vanta
 * edit-policy-draft` cannot touch one. The route that exists is the policy page's own `Renew and make
 * updates`, and `src/browser/vantaPolicyVersionSnippet.ts` carries both measurements. Which policies are
 * files is per POLICY, not per tenant: one written in Vanta's own editor reads `Created in Vanta` and suits
 * the editor instead. Repro: `slopweaver atlas vanta policy-versions --policy
 * <id>` and read the approved version's source line in its screenshot.
 *
 * ## What `--dry-run` does and does NOT mean here
 *
 * It renders the PDF, hashes it, prints the plan and the digest, and **touches no browser**. That is the
 * whole preview: unlike `edit-policy-draft`, there is nothing to read from the page first, because starting
 * a renewal is itself the write. A caller wanting to see the renewal screen runs
 * `atlas vanta policy-versions`, which is read-only.
 *
 * ## Where the write boundary is, measured
 *
 * `Renew and make updates` opens a `Create a new version` MODAL and writes nothing. Confirming that modal
 * with `Import policy` creates the DRAFT VERSION row, before any file is chosen, so a run that stops at the
 * chooser has left an empty draft behind and the report says exactly that.
 * `src/browser/vantaPolicyVersionSnippet.ts` carries both measurements and both corrections.
 *
 * ## It never publishes, and there is no arm that could
 *
 * The snippet refuses outright if the only controls the renewal screen offers are ones
 * that would submit or approve a version, and no code path here clicks one. A run that stops after starting
 * the renewal has still left a DRAFT behind, and the report says so — the correction is to go and look at
 * the policy, never to retry.
 *
 * ## The exit-code contract
 *
 * | situation                                          | code |
 * | -------------------------------------------------- | ---- |
 * | a bad flag, or markdown that will not render        | `2`  |
 * | the door refused, or the upload did not complete    | `1`  |
 * | a dry run, or a draft carrying the new PDF          | `0`  |
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { doorLedgerPort } from "../../../admit/doorLedgerPort.js";
import { notPerformedLines } from "../../../admit/doorRefusal.js";
import { throughDoor } from "../../../admit/effects.js";
import { relayDepsAt } from "../../../atlas/kit/walkTransport.js";
import { VANTA_WEB_ORIGIN } from "../../../atlas/vanta/browserPages.js";
import { vantaPolicyUploadDeadHostRefusal } from "../../../atlas/vanta/deadHostRefusal.js";
import {
  type VantaPolicyUploadPlan,
  vantaPolicyUploadDigest,
  vantaUploadPolicyVersionApprovalGate,
} from "../../../atlas/vanta/policyVersionUpload.js";
import { vantaAtlasPaths } from "../../../atlas/vanta/store.js";
import { resolveVantaTenantSlug } from "../../../atlas/vanta/tenantSlug.js";
import { type RecordedProfilePort, recordedProfilePort } from "../../../browser/recordedProfile.js";
import {
  createVantaPolicyVersionTransport,
  type VantaPolicyVersionTransport,
  type VantaPolicyVersionUpload,
} from "../../../browser/vantaPolicyVersion.js";
import { slopweaverHome } from "../../../homeDir.js";
import { sha256Hex } from "../../../lib/hash.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { renderPolicyPdf } from "../../../policy/render/pdf.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { verbTail } from "../../optionParsers.js";
import { type VantaVerbError, VantaVerbErrors, vantaVerbErrorLines } from "./errors.js";
import { verifyPolicyUploadPdf } from "./policyUploadIntegrity.js";
import { parseUploadPolicyVersionOptions, type UploadOptions } from "./policyUploadOptions.js";
import { vantaPolicyPageUrl } from "./policyVersionRun.js";

/** Where the verb sits in the full argv: `[node, cli, "write", "vanta", "upload-policy-version", …]`. */
const WRITE_VERB_INDEX = 4;

/** What this verb prints when asked how to use it.
 * @internal
 */
export const VANTA_UPLOAD_POLICY_VERSION_USAGE = [
  "usage: slopweaver write vanta upload-policy-version --policy <id> --file <path.md>",
  "       [--source-commit <sha>] [--tenant <slug>] [--approve <digest>] [--dry-run] [--json] [--home <dir>]",
  "  Renders the policy markdown to a PDF, starts a new version of the policy in your own Chrome, and",
  "  attaches it. The version is left a DRAFT and is never submitted, approved or published.",
  "  --dry-run renders and prints the plan and its digest, and touches no browser at all.",
].join("\n");

/** The rendered PDF and everything the plan is bound to. */
interface ResolvedUpload {
  readonly plan: VantaPolicyUploadPlan;
  readonly digest: string;
  readonly pdfPath: string;
  readonly pages: number;
}

/**
 * Render the markdown, write the PDF into the atlas's own scratch, and bind a plan to its exact bytes.
 *
 * The PDF is written before the door rather than inside it, deliberately: the digest has to cover bytes
 * that already exist, or an approval would be transplantable onto a document that had been re-rendered.
 *
 * @param options the validated invocation
 * @param url the policy page the renewal would be started from
 * @returns the plan, its digest and the file on disk, or every reason there is none
 */
async function resolveUpload({
  options,
  url,
}: {
  options: UploadOptions;
  url: string;
}): Promise<Result<ResolvedUpload, VantaVerbError>> {
  let markdown: string;
  try {
    markdown = readFileSync(options.file, "utf8");
  } catch {
    return err(VantaVerbErrors.policySourceUnreadable({ path: options.file }));
  }
  // The dead-Datadog-host refusal, on the SOURCE and the id the attached file is named after.
  const refusal = vantaPolicyUploadDeadHostRefusal({ markdown, policyId: options.policyId });
  if (refusal !== undefined) {
    return err(VantaVerbErrors.policyUploadRefused({ reasons: refusal }));
  }
  const rendered = await renderPolicyPdf({ markdown });
  if (rendered.isErr()) {
    return err(VantaVerbErrors.pdfRenderFailed({ reasons: rendered.error }));
  }
  const scratchDir = join(vantaAtlasPaths({ home: options.home }).directory, "_policy-version");
  mkdirSync(scratchDir, { recursive: true });
  const pdfPath = join(scratchDir, `${options.policyId}-${String(Date.now())}.pdf`);
  try {
    writeFileSync(pdfPath, rendered.value.bytes);
  } catch {
    return err(VantaVerbErrors.pdfUnwritable({ path: pdfPath }));
  }
  const plan: VantaPolicyUploadPlan = {
    disposition: "draft-only",
    kind: "vanta-policy-version-upload-v1",
    markdownSha256: sha256Hex({ bytes: markdown }),
    pdfSha256: sha256Hex({ bytes: rendered.value.bytes }),
    policyId: options.policyId,
    sourceCommit: options.sourceCommit,
    url,
  };
  return ok({ digest: vantaPolicyUploadDigest({ plan }), pages: rendered.value.pages, pdfPath, plan });
}

/**
 * Read the staged PDF back from disk and check it still hashes to what the approved plan covers.
 *
 * @param path the staged PDF the browser arm is about to attach
 * @param expectedSha256 the plan's `pdfSha256`
 * @returns the verified bytes, or why the file cannot be attached under this approval
 */
function readVerifiedUploadPdf({
  path,
  expectedSha256,
}: {
  path: string;
  expectedSha256: string;
}): Result<Uint8Array, VantaVerbError> {
  let bytes: Uint8Array;
  try {
    bytes = readFileSync(path);
  } catch (cause) {
    return err(VantaVerbErrors.policyUploadPdfUnreadable({ cause, path }));
  }
  return verifyPolicyUploadPdf({ bytes, expectedSha256, path });
}

/**
 * Build the transport this upload drives, bound to one policy page and one approval for its whole life.
 *
 * @param home the state home the token, the atlas directory and the recorded profile live under
 * @param url the policy page address
 * @param approvedDigest the upload digest the door admitted
 * @param profiles the door the recorded work profile is read through
 * @returns a transport attached to the owner's own Chrome, or every reason there is none
 */
async function attachedUploader({
  home,
  url,
  approvedDigest,
  profiles,
}: {
  home: string;
  url: string;
  approvedDigest: string;
  profiles: RecordedProfilePort;
}): Promise<Result<VantaPolicyVersionTransport>> {
  const scratchDir = join(vantaAtlasPaths({ home }).directory, "_policy-version");
  const deps = await relayDepsAt({ home, origins: [VANTA_WEB_ORIGIN], platform: "vanta", profiles, scratchDir });
  if (deps.isErr()) {
    return err(deps.error);
  }
  return ok(createVantaPolicyVersionTransport({ approvedDigest, deps: deps.value, url }));
}

/** The lines a completed or refused upload prints.
 * @internal
 *
 * @param upload what the browser arm reported
 * @returns the lines to print, in order
 */
export function uploadReportLines({ upload }: { upload: VantaPolicyVersionUpload }): readonly string[] {
  const lines = [
    upload.attached
      ? "upload-policy-version: the PDF is attached to a DRAFT version. It was NOT submitted, approved or published."
      : `upload-policy-version did not attach the PDF — it stopped at "${upload.stage}"`,
    `  settled on ${upload.finalUrl}`,
    `  before: ${upload.beforeScreenshotPath}`,
  ];
  if (upload.screenshotPath !== null) {
    lines.push(`  after:  ${upload.screenshotPath}`);
  }
  if (upload.refused !== null) {
    lines.push(`  refused: ${upload.refused}`);
  }
  if (upload.wrote && !upload.attached) {
    lines.push(
      "  A DRAFT VERSION was created but the PDF did not land on it, so the draft is empty. Open the policy " +
        "and either upload the rendered PDF by hand or delete the draft; do not simply re-run this. The " +
        "approved version is untouched and nothing was published.",
    );
  }
  if (!upload.wrote) {
    lines.push("  Nothing was written at Vanta. The new-version modal was open and was closed unconfirmed.");
  }
  lines.push(`  controls on screen: ${controlsOnScreen({ upload })}`);
  return lines;
}

/** The controls the browser arm saw on screen, or `none` when it saw no labelled one. */
function controlsOnScreen({ upload }: { upload: VantaPolicyVersionUpload }): string {
  const seen = upload.controls.join(" | ");
  if (seen === "") {
    return "none";
  }
  return seen;
}

/** Print the dry run: the plan, the digest and where the rendered PDF is. */
function reportDryRun({ resolved, json }: { resolved: ResolvedUpload; json: boolean }): number {
  if (json) {
    logger.out({
      line: JSON.stringify({ digest: resolved.digest, pdfPath: resolved.pdfPath, plan: resolved.plan }, null, 2),
    });
    return EXIT_OK;
  }
  logger.info({ msg: `upload-policy-version (dry run): nothing was opened and nothing was written` });
  logger.info({ msg: `  policy:   ${resolved.plan.policyId}` });
  logger.info({ msg: `  page:     ${resolved.plan.url}` });
  logger.info({ msg: `  markdown: sha256 ${resolved.plan.markdownSha256}` });
  logger.info({ msg: `  commit:   ${resolved.plan.sourceCommit}` });
  logger.info({
    msg: `  pdf:      ${resolved.pdfPath} (${String(resolved.pages)} page(s), sha256 ${resolved.plan.pdfSha256})`,
  });
  logger.info({ msg: `  This upload leaves the version a DRAFT. It is never submitted, approved or published.` });
  logger.info({ msg: `  To proceed: --approve ${resolved.digest}` });
  return EXIT_OK;
}

/** Print every problem to stderr, so a refusal names all of what is wrong rather than the first thing. */
function printProblems({ problems }: { problems: readonly string[] }): void {
  for (const problem of problems) {
    logger.error({ msg: problem });
  }
}

/**
 * Everything the run needs before the door past the flags: the page address and the rendered PDF.
 *
 * @param options the validated flags
 * @returns the resolved upload, or every reason there is none
 */
async function prepare({ options }: { options: UploadOptions }): Promise<Result<ResolvedUpload>> {
  const slug = resolveVantaTenantSlug({ env: process.env, flag: options.tenant, home: options.home });
  if (slug.isErr()) {
    return err(slug.error);
  }
  const resolved = await resolveUpload({
    options,
    url: vantaPolicyPageUrl({ policyId: options.policyId, tenantSlug: slug.value }),
  });
  return resolved.isErr() ? err(vantaVerbErrorLines({ error: resolved.error })) : ok(resolved.value);
}

/**
 * The validated flags, or the exit code once `--help` or a refusal has been printed. The typed flag refusal
 * becomes lines here, at the verb's reporting boundary, and nowhere earlier.
 *
 * @param rest the verb tail
 * @returns the options, or the exit code to return with
 */
function optionsOrExit({ rest }: { rest: readonly string[] }): UploadOptions | number {
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: VANTA_UPLOAD_POLICY_VERSION_USAGE });
    return EXIT_OK;
  }
  const parsed = parseUploadPolicyVersionOptions({ defaultHome: slopweaverHome(), rest });
  if (parsed.isOk()) {
    return parsed.value;
  }
  printProblems({ problems: [...vantaVerbErrorLines({ error: parsed.error }), VANTA_UPLOAD_POLICY_VERSION_USAGE] });
  return EXIT_USAGE;
}

/**
 * Run the policy-version upload.
 *
 * @param argv the full process argv; the flags start after `write vanta upload-policy-version`
 * @returns the process exit code
 */
// max-lines-exempt: the CLI shell's own parse -> door -> report sequence; every piece of it that could be hoisted already has been (`prepare`, `reportDryRun`, `uploadReportLines`).
export async function runVantaUploadPolicyVersion(argv: readonly string[]): Promise<number> {
  const options = optionsOrExit({
    rest: verbTail({ argv, at: WRITE_VERB_INDEX, verbs: ["upload-policy-version"] }),
  });
  if (typeof options === "number") {
    return options;
  }
  const prepared = await prepare({ options });
  if (prepared.isErr()) {
    printProblems({ problems: prepared.error });
    return EXIT_USAGE;
  }
  const resolved = prepared.value;
  const url = resolved.plan.url;
  if (options.dryRun) {
    return reportDryRun({ json: options.json, resolved });
  }
  const profiles = recordedProfilePort();
  const admitted = await throughDoor({
    gates: [vantaUploadPolicyVersionApprovalGate({ expected: resolved.digest, supplied: options.approve })],
    home: options.home,
    ledger: doorLedgerPort(),
    perform: async () => {
      // The approval covers the RENDERED bytes and the browser attaches a PATH, so the file is re-read and
      // re-hashed here, before any browser is touched (`./policyUploadIntegrity.ts` names the gap left).
      const verified = readVerifiedUploadPdf({ expectedSha256: resolved.plan.pdfSha256, path: resolved.pdfPath });
      if (verified.isErr()) {
        return err(vantaVerbErrorLines({ error: verified.error }));
      }
      const uploader = await attachedUploader({ approvedDigest: resolved.digest, home: options.home, profiles, url });
      if (uploader.isErr()) {
        return err(uploader.error);
      }
      try {
        return uploader.value.upload({ pdfPath: resolved.pdfPath }).mapErr((error) => [error.message]);
      } finally {
        uploader.value.release();
      }
    },
    request: {
      action: { kind: "verb", noun: "write", verb: "vanta upload-policy-version" },
      artifact: {
        digest: resolved.digest,
        disposition: "draft-only",
        pdfSha256: resolved.plan.pdfSha256,
        policy: options.policyId,
        url,
      },
      meta: { createsWorkItem: false, effect: "external-write", home: options.home, requiresApproval: true },
    },
  });
  if (!admitted.performed) {
    for (const line of notPerformedLines({
      command: "slopweaver write vanta upload-policy-version",
      through: admitted,
    })) {
      logger.out({ line });
    }
    return EXIT_ERROR;
  }
  if (admitted.result.isErr()) {
    printProblems({ problems: admitted.result.error });
    return EXIT_ERROR;
  }
  const upload = admitted.result.value;
  if (options.json) {
    logger.out({ line: JSON.stringify(upload, null, 2) });
    return upload.attached ? EXIT_OK : EXIT_ERROR;
  }
  for (const line of uploadReportLines({ upload })) {
    logger.info({ msg: line });
  }
  return upload.attached ? EXIT_OK : EXIT_ERROR;
}
