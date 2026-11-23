/**
 * `slack draft approve` and `slack draft hold` — a session's judgement of the owner's words on a row already held,
 * appended to the register with no re-cut.
 *
 * A yes the owner gave is never left unsent without a reason, though legitimate reasons not to send exist — no fleet
 * slot, a Slack token or permission, the thread moved. So the tick gate (`../../../supervisor/approvedDraftGate.ts`)
 * refuses a pass while the owner's words sit on a draft's card unjudged, and these two verbs are the judgement:
 * `approve` binds the owner's yes to these exact words (the row is then SENT by the pass), `hold` names why it is not
 * sent, and the Queue card prints that reason to the owner (`../../../outbound/slack/draftRegister.ts`'s `DraftHold`).
 *
 * Whether the owner's words mean yes stays judgement, never computed: `approve` proves that the anchor holds the
 * owner's own whole words and that their record does not contradict the yes — a relay's triage verdict is `send-it` and they were said
 * over this row's card — exactly as `record --approved` does (`./draftApprovalResolve.ts`, `./draftApprovalGate.ts`).
 */
import { logger } from "../../../lib/logger.js";
import { dropShedsApproval } from "../../../outbound/slack/draftApproval.js";
import { foldSlackDraftLog, parseSlackDraftLog, skippedDraftNote } from "../../../outbound/slack/draftLog.js";
import {
  type DraftApproval,
  type SlackDraftEvent,
  type SlackDraftItem,
  slackDraftById,
} from "../../../outbound/slack/draftRegister.js";
import { judgedSince } from "../../../supervisor/approvedDraftGate.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { draftApprovalBindingIds } from "./draftApprovalGate.js";
import { resolveBoundDraftApproval } from "./draftApprovalResolve.js";
import { refusedApproval, underCallFence } from "./draftApproveFence.js";
import type { DraftApproveOptions, DraftDropOptions, DraftHoldOptions } from "./draftCore.js";
import { dropRefusal } from "./draftDropGuard.js";
import { appendJudgement, heldRow, type JudgementDeps, landingsJudged } from "./draftJudgementAppend.js";
import { pickBeforeApproving } from "./draftPickRun.js";
import { underRegisterLock } from "./draftRegisterLock.js";
import { draftReleaseCommand } from "./draftReport.js";
import type { SlackDraftDeps } from "./draftRun.js";
import { sentNoteRefusal } from "./draftSentProof.js";

/**
 * `slack draft approve <id> --anchor <anchor>` — bind the owner's yes at the anchor to a held row. The row then owes a
 * send, so the receipt prints the release command.
 *
 * @param deps the injected world, for the owner's words and the register
 * @param options the parsed invocation
 * @returns the process exit code
 */
export function runDraftApprove({
  deps,
  options,
}: {
  deps: JudgementDeps & Pick<SlackDraftDeps, "fenceCallWrites" | "readApprovalLaterRelays" | "readOwnerWords">;
  options: DraftApproveOptions;
}): number {
  return underRegisterLock({ deps, home: options.home, run: () => approveHeld({ deps, options }) });
}

/** `approve`'s read, check and append, run under the register lock. */
function approveHeld({
  deps,
  options,
}: {
  deps: JudgementDeps & Pick<SlackDraftDeps, "fenceCallWrites" | "readApprovalLaterRelays" | "readOwnerWords">;
  options: DraftApproveOptions;
}): number {
  const row = heldRow({ deps, home: options.home, id: options.id });
  if (row.kind === "exit") {
    return row.code;
  }
  // The owner's yes binds this row only if it was said over its card, or the card of a cut the register records it re-cut.
  const items = foldSlackDraftLog({ log: parseSlackDraftLog({ lines: deps.readLog({ home: options.home }) }) });
  const resolveApproval = (): ReturnType<typeof resolveBoundDraftApproval> =>
    resolveBoundDraftApproval({
      allowedDraftIds: draftApprovalBindingIds({ items, targetIds: [options.id] }),
      anchor: options.anchor,
      claimed: `--anchor ${options.anchor}`,
      command: `slopweaver slack draft approve ${options.id}`,
      deps,
      home: options.home,
    });
  const located = resolveApproval();
  if (located.isErr()) {
    return refusedApproval({ lines: located.error });
  }
  // The first read finds the call the words were said on; the count, the pick and the append then run under its fence
  // with the words read again there (`./draftApproveFence.ts`), so nothing they were judged on moves before the append.
  return underCallFence({
    anchor: options.anchor,
    atIso: located.value.atIso,
    deps,
    first: located.value,
    home: options.home,
    read: resolveApproval,
    run: (approval) => approveFenced({ approval, deps, item: row.item, options }),
  });
}

/** `approve`'s count, pick and append, over the owner's words as its fenced read gave them. */
function approveFenced({
  approval,
  deps,
  item,
  options,
}: {
  approval: DraftApproval;
  deps: JudgementDeps & Pick<SlackDraftDeps, "readApprovalLaterRelays" | "readOwnerWords">;
  item: SlackDraftItem;
  options: DraftApproveOptions;
}): number {
  // Every read that can refuse runs before the pick is appended, so a refusal leaves the row exactly as it was.
  const judged = landingsJudged({ answers: true, deps, home: options.home, id: options.id });
  if (judged.kind === "refused") {
    return EXIT_USAGE;
  }
  const chosen = pickBeforeApproving({ approval, deps, item, options });
  if (chosen !== undefined) {
    return chosen;
  }
  const { kind: _counted, ...read } = judged;
  const event: SlackDraftEvent = { approval, id: options.id, kind: "approved", tsIso: deps.nowIso(), ...read };
  if (!appendJudgement({ deps, event, home: options.home })) {
    return approvalFailed({ deps, options });
  }
  // Read back, never the row as first read: a codex pick swapped its words, and the release binds the new digest.
  const approved = heldRow({ deps, home: options.home, id: options.id });
  if (approved.kind === "exit") {
    return approved.code;
  }
  deps.out(`approved ${options.id} at ${options.anchor}: "${approval.heard.trim()}"`);
  deps.out(`  it now owes a send — release it: ${draftReleaseCommand({ item: approved.item })}`);
  return EXIT_OK;
}

/**
 * An approval that did not stand, after `appendJudgement` said why. A pick it recorded first stays, and a re-run of
 * the same approve completes it, but only on a row still held: a release appends without the register lock, so it can
 * send the picked words in the gap, and a released row is not one to approve again.
 */
function approvalFailed({ deps, options }: { deps: JudgementDeps; options: DraftApproveOptions }): number {
  const after = foldSlackDraftLog({ log: parseSlackDraftLog({ lines: deps.readLog({ home: options.home }) }) });
  const stillHeld = after.some((item) => item.id === options.id && item.state === "held");
  if (options.variant !== undefined && stillHeld) {
    logger.error({ msg: `the ${options.variant} pick stands; run the same approve again to record the owner's yes` });
  }
  return EXIT_ERROR;
}

/**
 * `slack draft hold <id> --reason <code> --why "<what>"` — why a held row carrying the owner's words is not being sent.
 * The Queue card draws the reason, so it is in front of the owner the pass it is recorded.
 *
 * @param deps the injected world, for the register
 * @param options the parsed invocation
 * @returns the process exit code
 */
export function runDraftHold({ deps, options }: { deps: JudgementDeps; options: DraftHoldOptions }): number {
  return underRegisterLock({ deps, home: options.home, run: () => holdHeld({ deps, options }) });
}

/** `hold`'s read, check and append, run under the register lock. */
function holdHeld({ deps, options }: { deps: JudgementDeps; options: DraftHoldOptions }): number {
  const row = heldRow({ deps, home: options.home, id: options.id });
  if (row.kind === "exit") {
    return row.code;
  }
  const answers = !holdKeepsApproval({ reason: options.reason });
  const judged = landingsJudged({ answers, deps, home: options.home, id: options.id });
  if (judged.kind === "refused") {
    return EXIT_USAGE;
  }
  const { approval } = row.item.draft;
  if (
    options.reason === "not-owner-yes" &&
    approval !== undefined &&
    !newerWordOwed({ deps, home: options.home, id: options.id })
  ) {
    logger.error({ msg: settledYesRefusal({ approval, id: options.id }) });
    return EXIT_USAGE;
  }
  const { kind: _counted, ...read } = judged;
  const event: SlackDraftEvent = {
    id: options.id,
    kind: "held",
    reason: options.reason,
    tsIso: deps.nowIso(),
    why: options.why,
    ...read,
  };
  if (!appendJudgement({ deps, event, home: options.home })) {
    return EXIT_ERROR;
  }
  const keeps = row.item.draft.approval !== undefined && holdKeepsApproval({ reason: options.reason });
  deps.out(`held ${options.id} (${options.reason}): ${options.why}`);
  deps.out(
    keeps
      ? "  the owner's approval stands; the Queue card shows why it is not sent, and a release still sends it"
      : "  the Queue card shows the owner why, and waits for their word",
  );
  return EXIT_OK;
}

/**
 * `slack draft drop <id> --note "<why>"` — resolve a draft without sending it. A drop that would end the owner's yes,
 * or their unjudged words on its card, in neither a send nor a reason in front of them is refused (`./draftDropGuard.ts`), and so
 * is a `sent …` note Slack does not bear out (`./draftSentProof.ts`).
 *
 * @param deps the injected world, for the register and the read of a claimed send
 * @param options the parsed invocation
 * @returns the process exit code
 */
export async function runDraftDrop({
  deps,
  options,
}: {
  deps: JudgementDeps & Pick<SlackDraftDeps, "botToken" | "readLandedDrafts" | "threadReplies" | "userToken">;
  options: DraftDropOptions;
}): Promise<number> {
  const unproven = await sentNoteRefusal({ deps, home: options.home, id: options.id, note: options.note });
  if (unproven !== undefined) {
    logger.error({ msg: unproven });
    return EXIT_USAGE;
  }
  return underRegisterLock({ deps, home: options.home, run: () => dropHeld({ deps, options }) });
}

/** `drop`'s read, guard and append, run under the register lock so no judgement lands between them. */
function dropHeld({
  deps,
  options,
}: {
  deps: JudgementDeps & Pick<SlackDraftDeps, "readLandedDrafts">;
  options: DraftDropOptions;
}): number {
  const log = parseSlackDraftLog({ lines: deps.readLog({ home: options.home }) });
  const note = skippedDraftNote({ skipped: log.skipped });
  if (note !== undefined) {
    logger.warn({ msg: note });
  }
  const items = foldSlackDraftLog({ log });
  const found = slackDraftById({ id: options.id, items, mustBeHeld: true });
  if (found.isErr()) {
    logger.error({ msg: found.error.message });
    return EXIT_EXPECTED_EMPTY;
  }
  const landed = deps.readLandedDrafts({ home: options.home, items, skipped: log.skipped });
  const refusal = dropRefusal({ items, landed, note: options.note, row: found.value });
  if (refusal !== undefined) {
    logger.error({ msg: refusal });
    return EXIT_USAGE;
  }
  // The landings this drop judged: one written past them outran it, whatever instant its writer stamped.
  const read = landed.kind === "read" ? { landingsRead: landed.ledgerRows } : {};
  const appended = deps.appendEvent({
    event: { id: options.id, kind: "dropped", note: options.note, tsIso: deps.nowIso(), ...read },
    home: options.home,
  });
  if (appended.isErr()) {
    logger.error({ msg: `${appended.error.message} — the draft is still HELD.` });
    return EXIT_USAGE;
  }
  if (!dropsKeptOwnerYes({ deps, home: options.home, ids: [options.id], note: options.note })) {
    return EXIT_ERROR;
  }
  deps.out(`dropped ${options.id}: ${options.note}`);
  return EXIT_OK;
}

/**
 * Drop each row a new cut supersedes, once that cut is parked, then read the register back. The caller holds the
 * register lock and derived the cut's approval under it (`./draftApprovalResolve.ts`'s `approvalUnderLock`), so an
 * approve landing while `record` read Slack is inherited rather than left behind.
 *
 * @param deps the injected world, for the register and the clock
 * @param home the state home the register lives under
 * @param id the cut just parked, which the drop notes name
 * @param supersedes the held rows it re-cuts
 * @returns true when every drop landed and none shed the owner's yes
 */
export function dropSuperseded({
  deps,
  home,
  id: recut,
  supersedes,
}: {
  deps: JudgementDeps;
  home: string;
  id: string;
  supersedes: readonly string[];
}): boolean {
  // "superseded by <id>" is the wording `draftLiveCut.ts` follows to the cut that stands.
  const note = `superseded by ${recut} (recorded with --supersedes)`;
  for (const [index, id] of supersedes.entries()) {
    const dropped = deps.appendEvent({ event: { id, kind: "dropped", note, tsIso: deps.nowIso() }, home });
    if (dropped.isErr()) {
      const held = supersedes.slice(index);
      logger.error({
        msg:
          `${dropped.error.message} — ${recut} WAS parked, and ${held.join(", ")} ${held.length === 1 ? "is" : "are"} ` +
          `still held. Spend ${held.length === 1 ? "it" : "each"}: ` +
          held.map((heldId) => `slopweaver slack draft drop ${heldId} --note "${note}"`).join(" ; "),
      });
      return false;
    }
  }
  return dropsKeptOwnerYes({ deps, home, ids: supersedes, note });
}

/**
 * Re-read the register after drops are journalled and say, for each dropped row, whether the owner's yes it carried now
 * sits on a held cut carrying neither it nor a declared change of meaning. Every judging verb decides and drops under
 * the register lock, so no approve or re-cut lands between them; this read-back is the backstop for a
 * writer that does not take the lock, and since a drop cannot be taken back, the error names what the cut owes.
 */
function dropsKeptOwnerYes({
  deps,
  home,
  ids,
  note,
}: {
  deps: Pick<JudgementDeps, "readLog">;
  home: string;
  ids: readonly string[];
  note: string;
}): boolean {
  const after = foldSlackDraftLog({ log: parseSlackDraftLog({ lines: deps.readLog({ home }) }) });
  const shed = ids
    .map((id) => after.find((item) => item.id === id))
    .filter((row) => row !== undefined)
    .map((row) => dropShedsApproval({ items: after, note, row }))
    .filter((problem) => problem !== undefined);
  for (const problem of shed) {
    logger.error({
      msg: `${problem.dropped} WAS dropped, and a write racing this verb left what it owed the owner behind: ${problem.message}.`,
    });
  }
  return shed.length === 0;
}

/**
 * Whether a word of the owner's landed on the row's card that its yes never saw. Only that newer word can set the
 * owner's yes down: they may change their mind, but a session may not re-read the words they already approved as "not
 * a yes".
 * The caller has already refused an unreadable landings read (`./draftJudgementAppend.ts`'s `landingsJudged`), so one
 * here reads as none.
 */
function newerWordOwed({ deps, home, id }: { deps: JudgementDeps; home: string; id: string }): boolean {
  const log = parseSlackDraftLog({ lines: deps.readLog({ home }) });
  const landed = deps.readLandedDrafts({ home, items: foldSlackDraftLog({ log }), skipped: log.skipped });
  if (landed.kind === "unreadable") {
    return false;
  }
  return landed.bindings.bound.some((bound) => bound.item.id === id && !judgedSince({ bound }));
}

/**
 * Why a hold for the not-a-yes reason is refused on a row carrying the owner's recorded yes with no newer word of
 * theirs on its card. A verdict the owner gave on a card is settled: a session re-reading their yes as "not a yes"
 * would put the row back on the Queue as if unanswered. A hold has no hatch and says so
 * (`.claude/rules/error-handling.md`): the owner's newer word, a change of meaning and a blocked send all stay open.
 *
 * @param approval the yes the row carries, quoted back so the refusal shows what is settled
 * @returns the refusal, naming each route left and the absent hatch
 */
export function settledYesRefusal({ approval, id }: { approval: DraftApproval; id: string }): string {
  return (
    `slack draft hold ${id} --reason not-owner-yes refused: ${id} carries the owner's yes ("${approval.heard}" at ` +
    `${approval.anchor}) and no word of the owner's has landed on its card since, so the yes stands and is never ` +
    `re-asked. If the owner has since said not to send it, that word lands on the card first, then this hold goes ` +
    `through. If the words no longer carry what the owner approved: slopweaver slack draft hold ${id} --reason ` +
    `meaning-changed --why "<what changed>", or re-cut with --supersedes ${id} --meaning-changed "<what>". If a send ` +
    "is blocked on something real: --reason thread-moved|no-fleet-slot|slack-refused, which keeps the owner's yes. " +
    "There is deliberately NO escape hatch: an override would be the documented way to un-say the owner's yes, which " +
    "is the defect this closes."
  );
}

/**
 * Whether a hold keeps the row's approval — the reasons that block a send the owner already approved, rather than say
 * the words no longer carry the owner's yes.
 *
 * @param reason the hold's reason
 * @returns true for `thread-moved`, `no-fleet-slot` and `slack-refused`
 */
export function holdKeepsApproval({ reason }: { reason: DraftHoldOptions["reason"] }): boolean {
  return reason !== "not-owner-yes" && reason !== "meaning-changed";
}
