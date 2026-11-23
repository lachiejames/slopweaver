/**
 * The one preview-then-approve shell behind `github repo --create`, `--set-public` and `--enable-actions`.
 *
 * Each action module reads live state and hands this a {@link ApprovedRepoWrite}: the plan view its digest binds,
 * a one-line change, whether it is already done, the consequences a preview must name, and the send-and-confirm it
 * performs. This prints the preview and its `ghrepo-` digest by default, and sends only when `--approve` quotes the
 * digest of the view rebuilt from a fresh read, through the door's approval gate (`./repoApproval.ts`) — the
 * contract `./repoAdministrationRun.ts` keeps for rename, transfer and archive.
 */

import type { DoorLedgerPort } from "../../../admit/doorLedgerPort.js";
import { notPerformedLines } from "../../../admit/doorRefusal.js";
import { throughDoor } from "../../../admit/effects.js";
import type { DoorRequest } from "../../../admit/types.js";
import { formatIngestError, type IngestError } from "../../../lib/ingestError.js";
import { EXIT_ERROR, EXIT_OK } from "../../exitCodes.js";
import { type GithubVerbError, GithubVerbErrors, type GithubVerbResult, githubVerbErrorLines } from "./errors.js";
import { githubRepoWriteApprovalGate } from "./repoApproval.js";
import { githubRepoViewDigest } from "./repoPlan.js";
import type { GithubRepoApprovedKind } from "./repoWriteArgs.js";

/** What a confirmed write reports: the human line, and the fields `--json` adds. */
export interface ApprovedWriteOutcome {
  readonly line: string;
  readonly fields: Readonly<Record<string, unknown>>;
}

/** One previewed write, built by an action module from the state it just read. */
export interface ApprovedRepoWrite {
  readonly kind: GithubRepoApprovedKind;
  /** Every field that changes what is sent, and nothing that does not: the digest binds exactly this. */
  readonly view: Readonly<Record<string, unknown>>;
  /** One human line describing the change. */
  readonly change: string;
  readonly alreadyDone: boolean;
  /**
   * Sections this write neither reads nor sends until the repository is public, so a second preview after
   * `--set-public` applies them; empty for every write but the settings apply.
   */
  readonly waiting: readonly string[];
  /** What the approval also accepts, printed under the preview. */
  readonly consequences: readonly string[];
  /** The invocation that prints this preview, without `--approve`. */
  readonly previewCommand: string;
  /** Send the write once and confirm it by read-back; never read the send's own response as the outcome. */
  readonly perform: () => Promise<GithubVerbResult<ApprovedWriteOutcome>>;
}

/** The edges one approved write needs. */
export interface ApprovedWriteSeams {
  readonly home: string;
  readonly ledger: DoorLedgerPort;
  readonly out: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
}

/**
 * The approval-backed external-write door request for one create, visibility change or Actions policy.
 *
 * @param view the plan view the digest was computed over, recorded so the ledger row names the exact write
 * @param digest the plan's digest as it stands now
 * @param kind which write, carried on the action so each ledger row names it
 * @param home the Slopweaver state home whose door records the write
 * @returns the request the door admits only past the approval gate
 */
export function repoApprovedWriteDoorRequest({
  view,
  digest,
  kind,
  home,
}: {
  view: Readonly<Record<string, unknown>>;
  digest: string;
  kind: GithubRepoApprovedKind;
  home: string;
}): DoorRequest {
  return {
    action: { kind: "verb", noun: "github", verb: `repo ${kind}` },
    artifact: { ...view, digest },
    meta: { createsWorkItem: false, effect: "external-write", home, requiresApproval: true },
  };
}

/**
 * Map a provider failure on one named call into this directory's union, keeping the provider's own reason.
 *
 * @param operation what was being read or written, as the diagnostic names it
 * @param error the provider failure the boundary produced
 * @returns the `UPSTREAM_REFUSED` member carrying it
 */
export function upstreamRefusedOf({ operation, error }: { operation: string; error: IngestError }): GithubVerbError {
  return GithubVerbErrors.upstreamRefused({ operation, reasons: [`${operation}: ${formatIngestError({ error })}`] });
}

/**
 * Print every line of a typed failure as a diagnostic.
 *
 * @param error the typed failure
 * @param seams the diagnostic edge
 * @returns the exit code a failure ends on
 */
export function diagnoseRepoWrite({ error, seams }: { error: GithubVerbError; seams: ApprovedWriteSeams }): number {
  for (const line of githubVerbErrorLines({ error })) {
    seams.writeDiagnostic(line);
  }
  return EXIT_ERROR;
}

/** Print one outcome in the selected output mode. */
function report({
  write,
  json,
  seams,
  fields,
  text,
}: {
  write: ApprovedRepoWrite;
  json: boolean;
  seams: ApprovedWriteSeams;
  fields: Readonly<Record<string, unknown>>;
  text: readonly string[];
}): void {
  if (json) {
    seams.out(JSON.stringify({ ...write.view, ...fields }, undefined, 2));
    return;
  }
  for (const line of text) {
    seams.out(line);
  }
}

/** Print the preview and the digest an `--approve` must quote; nothing is sent. */
function printPreview({
  write,
  digest,
  json,
  seams,
  waitingLines,
}: {
  write: ApprovedRepoWrite;
  digest: string;
  json: boolean;
  seams: ApprovedWriteSeams;
  waitingLines: readonly string[];
}): number {
  const text = [
    `preview: ${write.change}`,
    ...waitingLines,
    ...write.consequences.map((line) => `  approving this also accepts: ${line}`),
    `  digest ${digest}`,
    `  apply:  ${write.previewCommand} --approve ${digest}`,
  ];
  report({
    fields: { consequences: write.consequences, digest, outcome: "preview", sent: false },
    json,
    seams,
    text,
    write,
  });
  return EXIT_OK;
}

/**
 * Preview one write, or with a matching `--approve` send it through the door and report the read-back.
 *
 * @param write the previewed write over the state just read
 * @param approve the digest the caller supplied, or undefined for a preview
 * @param json whether to print one JSON document instead of lines
 * @param seams the door ledger and output edges
 * @returns the process exit code
 */
export async function runApprovedRepoWrite({
  write,
  approve,
  json,
  seams,
}: {
  write: ApprovedRepoWrite;
  approve: string | undefined;
  json: boolean;
  seams: ApprovedWriteSeams;
}): Promise<number> {
  const waitingLines = write.waiting.map(
    (section) => `  waiting for public: ${section}, applied by previewing again after --set-public`,
  );
  if (write.alreadyDone) {
    reportNothingToSend({ json, seams, waitingLines, write });
    return EXIT_OK;
  }
  const digest = githubRepoViewDigest({ view: write.view });
  if (approve === undefined) {
    return printPreview({ digest, json, seams, waitingLines, write });
  }
  return sendApproved({ approve, digest, json, seams, write });
}

/** Report a write with nothing to send now: already done, or all that remains waits for the repository public. */
function reportNothingToSend({
  write,
  json,
  seams,
  waitingLines,
}: {
  write: ApprovedRepoWrite;
  json: boolean;
  seams: ApprovedWriteSeams;
  waitingLines: readonly string[];
}): void {
  if (write.waiting.length > 0) {
    // Nothing is ready to send, so nothing passes the door; what remains needs the repository public first.
    report({
      fields: { outcome: "waiting for public", sent: false },
      json,
      seams,
      text: [`nothing to send now: ${write.change}`, ...waitingLines],
      write,
    });
    return;
  }
  report({
    fields: { outcome: "already done", sent: false },
    json,
    seams,
    text: [`already done: ${write.change}`],
    write,
  });
}

/** Send an approved write through the door's approval gate and report its read-back. */
async function sendApproved({
  write,
  approve,
  digest,
  json,
  seams,
}: {
  write: ApprovedRepoWrite;
  approve: string;
  digest: string;
  json: boolean;
  seams: ApprovedWriteSeams;
}): Promise<number> {
  const through = await throughDoor({
    gates: [githubRepoWriteApprovalGate({ expected: digest, preview: write.previewCommand, supplied: approve })],
    home: seams.home,
    ledger: seams.ledger,
    perform: write.perform,
    request: repoApprovedWriteDoorRequest({ digest, home: seams.home, kind: write.kind, view: write.view }),
  });
  if (!through.performed) {
    for (const line of notPerformedLines({ command: write.previewCommand, through })) {
      seams.writeDiagnostic(line);
    }
    return EXIT_ERROR;
  }
  if (through.result.isErr()) {
    return diagnoseRepoWrite({ error: through.result.error, seams });
  }
  const confirmed = through.result.value;
  report({
    fields: { ...confirmed.fields, confirmed: true, digest, outcome: "confirmed", sent: true },
    json,
    seams,
    text: [`confirmed: ${confirmed.line}`],
    write,
  });
  return EXIT_OK;
}
