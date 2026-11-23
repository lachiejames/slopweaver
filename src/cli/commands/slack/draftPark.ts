/**
 * `slack draft record`'s one register write, under either identity: park the row and drop what it re-cuts, under the
 * register lock, then say where they can read it. Split out of `./draftRecordRun.ts` along that seam — everything before
 * it reads Slack, and nothing here does.
 */
import type { Result } from "#lib/result.js";

import { logger } from "../../../lib/logger.js";
import type { RecordedApproval } from "../../../outbound/slack/draftApproval.js";
import { comparisonAtPark } from "../../../outbound/slack/draftComparison.js";
import { foldSlackDraftLog, parseSlackDraftLog } from "../../../outbound/slack/draftLog.js";
import type { ParkedSlackDraft, SlackDraftItem } from "../../../outbound/slack/draftRegister.js";
import { followupOfRefusals } from "../../../outbound/slack/sharedFindings.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { approvalUnderLock, type RecordingApproval, recordedApproval } from "./draftApprovalResolve.js";
import { underCallFence } from "./draftApproveFence.js";
import type { DraftRecordOptions } from "./draftCore.js";
import { recutRefusal } from "./draftDropGuard.js";
import { dropSuperseded } from "./draftJudgementRun.js";
import { underRegisterLock } from "./draftRegisterLock.js";
import { draftRecordedLines } from "./draftReport.js";
import type { SlackDraftDeps } from "./draftRun.js";

/** The console page the queue lives on, and the query the slide-over opens from. */
const CONSOLE_QUEUE_PATH = "/queue";

/**
 * The deep link that opens one row in the console's queue slide-over.
 *
 * @param deps the injected world, for the console origin
 * @param id the draft the slide-over opens on
 * @returns the console URL
 */
export function draftConsoleUrl({ deps, id }: { deps: Pick<SlackDraftDeps, "consoleBase">; id: string }): string {
  return `${deps.consoleBase()}${CONSOLE_QUEUE_PATH}?open=post%3A${encodeURIComponent(id)}`;
}

/**
 * Append the row, then say where they can read it — or report that nothing was parked at all.
 *
 * @param deps the injected world, for the lock, the append, the output channel and the console origin
 * @param draft the row to append
 * @param options the parsed record, naming the home, `--json`, the rows it re-cuts and the yes it resolved again
 * @param approval the owner's yes the row carries, or the change that set one down, as resolved before the Slack reads;
 *   an inherited one is derived again under the lock (`./draftApprovalResolve.ts`'s `approvalUnderLock`)
 * @returns the process exit code
 */
export function parkAndReport({
  approval,
  deps,
  draft,
  options,
}: {
  approval: RecordingApproval;
  deps: SlackDraftDeps;
  draft: ParkedSlackDraft;
  options: DraftRecordOptions;
}): number {
  const { home, json, supersedes } = options;
  const park = (carried: RecordingApproval): number =>
    parkUnderLock({ approval: carried, deps, draft, home, json, supersedes });
  const fresh = approval.approval?.inheritedFrom === undefined ? approval.approval : undefined;
  // A yes is judged once, when it is bound. An inherited one carries the held row's approval unchanged, and a release
  // re-checks only the digest, so that row would itself send on it: words its call gains after the binding — a stretch
  // that now reads cut — do not unbind it, the same as a later take-back the owner never relayed.
  if (fresh === undefined) {
    return underRegisterLock({ deps, home, run: () => park(approval) });
  }
  // A fresh yes was resolved before the Slack reads, so the words it names could have been cut, revised or re-placed
  // since: the call and its landings are held still from a read made under the register lock through the append, in
  // approve's register, call, ledger order, and the whole resolution is run again there.
  const { anchor, atIso } = fresh;
  const read = (): Result<RecordingApproval> => recordedApproval({ deps, options });
  return underRegisterLock({
    deps,
    home,
    run: () => underCallFence({ anchor, atIso, deps, first: approval, home, read, run: park }),
  });
}

/** The park and its drops, deciding off the register as it stands under the lock. */
function parkUnderLock({
  approval,
  deps,
  draft: composed,
  home,
  json,
  supersedes,
}: {
  approval: RecordingApproval;
  deps: SlackDraftDeps;
  draft: ParkedSlackDraft;
  home: string;
  json: boolean;
  supersedes: readonly string[];
}): number {
  const log = parseSlackDraftLog({ lines: deps.readLog({ home }) });
  const items = foldSlackDraftLog({ log });
  // The fold keys a row by its id, so a minted id the register already holds would let a release or a judgement of
  // the older row land on this one, its words never sent.
  if (items.some((item) => item.id === composed.id)) {
    logger.error({
      msg: `the minted id ${composed.id} is already in the draft register — NOTHING was parked; record again.`,
    });
    return EXIT_ERROR;
  }
  const carried = approvalUnderLock({ approval, digest: composed.digest, items, supersedes });
  const refused = refusalsUnderLock({ carried, composed, deps, home, items, log, supersedes });
  if (refused.length > 0 || carried.isErr()) {
    for (const line of refused) {
      logger.error({ msg: line });
    }
    return EXIT_USAGE;
  }
  const recut = { ...composed, ...carried.value, ...(supersedes.length === 0 ? {} : { recuts: supersedes }) };
  // Decided here, after the approval is carried, so a row parking with their yes already on it is never compared.
  const comparison = comparisonAtPark({ draft: recut });
  const draft = comparison === undefined ? recut : { ...recut, comparison };
  const counted = parkJudgedLandings({ carried: carried.value, deps, home, items, log });
  if (counted === undefined) {
    return EXIT_USAGE;
  }
  const appended = deps.appendEvent({
    event: { draft, id: draft.id, kind: "parked", tsIso: draft.tsIso, ...counted },
    home,
  });
  if (appended.isErr()) {
    logger.error({ msg: `${appended.error.message} — NOTHING was parked and nothing was sent.` });
    return EXIT_USAGE;
  }
  if (!dropSuperseded({ deps, home, id: draft.id, supersedes })) {
    return EXIT_ERROR;
  }
  printParked({ deps, item: { draft, id: draft.id, state: "held" }, json });
  return EXIT_OK;
}

/**
 * Why the park refuses, decided off the register as it stands under the lock: a `--followup-of` the register will not
 * let spend a card — asked here so two seats naming one finding cannot both read its card unspent — then an approval
 * that would not carry, then a bare re-cut's own refusals.
 */
function refusalsUnderLock({
  carried,
  composed,
  deps,
  home,
  items,
  log,
  supersedes,
}: {
  carried: ReturnType<typeof approvalUnderLock>;
  composed: ParkedSlackDraft;
  deps: SlackDraftDeps;
  home: string;
  items: readonly SlackDraftItem[];
  log: ReturnType<typeof parseSlackDraftLog>;
  supersedes: readonly string[];
}): readonly string[] {
  const followup = followupOfRefusals({ draft: composed, events: log.events, skipped: log.skipped, supersedes });
  if (followup.length > 0) {
    return followup;
  }
  if (carried.isErr()) {
    return carried.error;
  }
  return bareRecutRefusals({ carried: carried.value, deps, home, items, log, supersedes });
}

/** The receipt for a parked row: its JSON, or the lines naming the console page and the release it owes. */
function printParked({ deps, item, json }: { deps: SlackDraftDeps; item: SlackDraftItem; json: boolean }): void {
  const consoleUrl = draftConsoleUrl({ deps, id: item.id });
  if (json) {
    deps.out(JSON.stringify({ consoleUrl, item }, null, 2));
    return;
  }
  for (const line of draftRecordedLines({ consoleUrl, item })) {
    deps.out(line);
  }
}

/**
 * How many landing ledger rows a park that IS a judgement read — a fresh `--approved` or a `--meaning-changed` — so a
 * landing written before it never reads as their answer to it, whatever instant they spoke it at; the draft's own instant
 * is stamped before the lock is even taken. An inherited approval stands on the boundary it
 * carries and a bare park judges nothing; a judged park over landings that do not read is refused, since uncounted it
 * would answer a yes written after it but decided before it, and `undefined` says so, logged.
 */
function parkJudgedLandings({
  carried,
  deps,
  home,
  items,
  log,
}: {
  carried: RecordedApproval;
  deps: SlackDraftDeps;
  home: string;
  items: readonly SlackDraftItem[];
  log: ReturnType<typeof parseSlackDraftLog>;
}): { readonly landingsRead?: number } | undefined {
  const fresh = carried.approval !== undefined && carried.approval.inheritedFrom === undefined;
  if (!fresh && carried.meaningChanged === undefined) {
    return {};
  }
  const landed = deps.readLandedDrafts({ home, items, skipped: log.skipped });
  if (landed.kind === "read") {
    return { landingsRead: landed.ledgerRows };
  }
  logger.error({
    msg:
      `the card landings could not be read (${landed.why}), so which of their words this park judges is unknown. ` +
      "Repair that read (the tick refuses on an unreadable one too), then record it. NOTHING was parked.",
  });
  return undefined;
}

/**
 * Why a re-cut carrying neither their yes nor a change of meaning may not park: a row it supersedes holds a reason a
 * `not-owner-yes` hold set down that they have not seen, and the drop that follows the park would take it off their Queue
 * — or its landings cannot all be read, and the drop would end a yes no cut binds (round 33).
 * Landings are read only when such a re-cut supersedes something.
 */
function bareRecutRefusals({
  carried,
  deps,
  home,
  items,
  log,
  supersedes,
}: {
  carried: RecordedApproval;
  deps: SlackDraftDeps;
  home: string;
  items: readonly SlackDraftItem[];
  log: ReturnType<typeof parseSlackDraftLog>;
  supersedes: readonly string[];
}): readonly string[] {
  if (carried.approval !== undefined || carried.meaningChanged !== undefined || supersedes.length === 0) {
    return [];
  }
  const landed = deps.readLandedDrafts({ home, items, skipped: log.skipped });
  return items
    .filter((row) => supersedes.includes(row.id))
    .map((row) => recutRefusal({ items, landed, row }))
    .filter((line) => line !== undefined);
}
