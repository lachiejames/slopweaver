/**
 * The `--dry-run` half of `slopweaver github attach upload`: print the plan and the very findings the real upload
 * would be held on, and send nothing. Split from `./attachRun.ts` along the line the verb already draws between
 * previewing an upload and performing one.
 */
import { attachmentFindings } from "../../../admit/attachmentGates.js";
import { doorFindingLines } from "../../../admit/doorRefusal.js";
import {
  type AttachUploadStanding,
  attachUploadRefusalLines,
  attachUploadStandingLine,
} from "../../../handover/attachUploadRuling.js";
import { targetPageUrl, uploadTokenPageUrls } from "../../../outbound/github/attachClient.js";
import type { ClassifiedAttachment } from "../../../outbound/github/attachment.js";
import type { GithubAttachUploadArgs } from "./attachCore.js";
import type { GithubAttachDeps } from "./attachDeps.js";
import type { PreparedUpload } from "./attachVerify.js";

/**
 * Print one upload's plan. A refused attach-upload standing is printed as the same block the real upload prints, so
 * a plan never reads "would upload" when the real call would refuse before reading the file.
 *
 * @param standing the owner's recorded word on attach upload, read before anything else
 * @param prepared the checks the real upload would judge, run once on the same bytes
 */
export function reportUploadPlan({
  deps,
  args,
  classified,
  prepared,
  standing,
}: {
  deps: GithubAttachDeps;
  args: GithubAttachUploadArgs;
  classified: ClassifiedAttachment;
  prepared: PreparedUpload;
  standing: AttachUploadStanding;
}): void {
  const permitted = standing.kind === "permitted";
  const refusalLines = standing.kind === "permitted" ? [] : attachUploadRefusalLines({ standing });
  const plan = {
    attachUpload: attachUploadStandingLine({ standing }),
    byteLength: classified.byteLength,
    contentType: classified.contentType,
    limitBytes: classified.limitBytes,
    outcome: permitted ? "would upload" : "would refuse: attach upload is not permitted",
    refusalLines,
    attributedTo: targetPageUrl({ target: { number: args.number, owner: args.owner, repo: args.repo } }),
    scrapeFrom: uploadTokenPageUrls({ target: { number: args.number, owner: args.owner, repo: args.repo } }),
    uploadName: classified.fileName,
  };
  if (args.json) {
    deps.out(JSON.stringify(plan, undefined, 2));
    return;
  }
  for (const line of refusalLines) {
    deps.out(line);
  }
  deps.out(plan.attachUpload);
  deps.out(
    `${permitted ? "would upload" : "would refuse to upload"} ${classified.fileName} ` +
      `(${classified.contentType}, ${String(classified.byteLength)} of ${String(classified.limitBytes)} bytes allowed)`,
  );
  deps.out(
    `token would be scraped from ${plan.scrapeFrom.classicPullPage}, else ${plan.scrapeFrom.releaseForm}; ` +
      `the upload attributed to ${plan.attributedTo}`,
  );
  // The same block the real refusal prints, from the same prepared checks, so a dry run previews what the operator
  // will actually be told rather than a second, shorter rendering of it.
  for (const finding of [...attachmentFindings({ file: prepared.file }), ...prepared.checks.findings]) {
    for (const line of doorFindingLines({ command: "slopweaver github attach upload", finding })) {
      deps.out(line);
    }
  }
}
