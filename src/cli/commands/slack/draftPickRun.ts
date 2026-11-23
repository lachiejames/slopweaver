/**
 * `slack draft pick <id> --variant original|codex` — which of the two drafts on a comparison card they chose
 * (`../../../outbound/slack/draftComparison.ts`), and the pick half of `slack draft approve --variant`.
 *
 * A pick is a preference recorded once per row. A `codex` pick makes Codex's draft the row's words, so it is refused
 * on a row already approved — the words an approval bound are never swapped under it. Choosing AND approving in one
 * step is `approve --variant`, which appends the pick and the approval under one register lock.
 */
import { logger } from "../../../lib/logger.js";
import { candidateFindingProofMissing } from "../../../outbound/slack/candidateFindingProof.js";
import {
  candidateDropsReceipts,
  codexDropsReceiptsRefusal,
  type DraftPickVoice,
  type DraftVariant,
  pickOwed,
  pickOwedRefusal,
} from "../../../outbound/slack/draftComparison.js";
import { foldSlackDraftLog, parseSlackDraftLog } from "../../../outbound/slack/draftLog.js";
import type { DraftApproval, SlackDraftItem } from "../../../outbound/slack/draftRegister.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveDraftApproval } from "./draftApprovalResolve.js";
import type { DraftApproveOptions, DraftPickOptions } from "./draftCore.js";
import { heldRow, type JudgementDeps } from "./draftJudgementAppend.js";
import { underRegisterLock } from "./draftRegisterLock.js";
import type { SlackDraftDeps } from "./draftRun.js";

/**
 * Why a row cannot take this pick: approved already, no Codex draft ready beside it, a different pick on record, or a
 * Codex draft that drops the original's receipt or raises a finding the row cannot prove. Picking the same variant twice is not refused — it records nothing new.
 *
 * @param item the held row
 * @param variant the variant asked for
 * @returns the refusal, or `undefined` when the pick may land
 */
export function pickRefusal({ item, variant }: { item: SlackDraftItem; variant: DraftVariant }): string | undefined {
  if (item.pick !== undefined && item.pick.variant !== variant) {
    return `${item.id}: they already chose the ${item.pick.variant} draft; a pick is recorded once`;
  }
  if (item.pick !== undefined) {
    return undefined;
  }
  if (item.draft.approval !== undefined) {
    return `${item.id} is already approved, and the words an approval bound are never swapped under it`;
  }
  if (item.comparison?.state !== "ready") {
    return `${item.id} has no Codex draft ready beside it, so there is nothing to choose between`;
  }
  if (variant === "codex" && candidateDropsReceipts({ item })) {
    return codexDropsReceiptsRefusal({ id: item.id });
  }
  const missing =
    variant === "codex"
      ? candidateFindingProofMissing({ candidate: item.comparison.candidate, draft: item.draft })
      : [];
  if (missing.length > 0) {
    return (
      `${item.id}: Codex's draft raises a finding the row cannot prove (missing ${missing.join(", ")}), so it is not ` +
      "picked: they send such a card back unseen. Pick the original, or re-cut the row with its proof."
    );
  }
  return undefined;
}

/**
 * Append a pick and read it back.
 *
 * @param deps the register edges
 * @param home the state home
 * @param item the held row, as read under the lock
 * @param variant the variant chosen
 * @param voice their words choosing it, when the pick came off a call
 * @returns true when the register now reads the pick
 */
function appendPick({
  deps,
  home,
  item,
  variant,
  voice,
}: {
  deps: JudgementDeps;
  home: string;
  item: SlackDraftItem;
  variant: DraftVariant;
  voice: DraftPickVoice | undefined;
}): boolean {
  if (item.pick !== undefined) {
    return true;
  }
  const tsIso = deps.nowIso();
  const appended = deps.appendEvent({
    event: { id: item.id, kind: "picked", tsIso, variant, ...(voice === undefined ? {} : { voice }) },
    home,
  });
  if (appended.isErr()) {
    logger.error({ msg: `${appended.error.message} — no pick was recorded.` });
    return false;
  }
  const after = foldSlackDraftLog({ log: parseSlackDraftLog({ lines: deps.readLog({ home }) }) });
  const row = after.find((candidate) => candidate.id === item.id);
  if (row?.pick?.atIso !== tsIso || row.pick.variant !== variant) {
    logger.error({ msg: `${item.id} moved before the pick landed, so the register does not read it. Read it again.` });
    return false;
  }
  return true;
}

/**
 * On a comparison card, the pick an approval needs first: refused when Codex's draft is ready and `--variant` names
 * neither, else the pick `--variant` names appended under the same lock, carrying the approval's anchor as the owner's
 * words choosing it. A row with no comparison takes no `--variant`.
 *
 * @param approval the yes being approved, whose anchor and words the pick carries
 * @param item the held row, as read under the lock
 * @returns the exit code to stop on, or `undefined` to go on and approve
 */
export function pickBeforeApproving({
  approval,
  deps,
  item,
  options,
}: {
  approval: DraftApproval;
  deps: JudgementDeps;
  item: SlackDraftItem;
  options: DraftApproveOptions;
}): number | undefined {
  const { variant } = options;
  if (variant === undefined) {
    if (!pickOwed({ item })) {
      return undefined;
    }
    logger.error({ msg: pickOwedRefusal({ id: item.id, pending: item.comparison?.state === "pending" }) });
    return EXIT_USAGE;
  }
  const refusal = pickRefusal({ item, variant });
  if (refusal !== undefined) {
    logger.error({ msg: refusal });
    return EXIT_USAGE;
  }
  const { anchor, atIso, heard } = approval;
  const voice = { anchor, atIso, heard };
  return appendPick({ deps, home: options.home, item, variant, voice }) ? undefined : EXIT_ERROR;
}

/**
 * `slack draft pick <id> --variant <original|codex> [--anchor <where they chose>]`.
 *
 * @param deps the injected world, for their words and the register
 * @param options the parsed invocation
 * @returns the process exit code
 */
export function runDraftPick({
  deps,
  options,
}: {
  deps: JudgementDeps & Pick<SlackDraftDeps, "readOwnerWords">;
  options: DraftPickOptions;
}): number {
  return underRegisterLock({ deps, home: options.home, run: () => pickHeld({ deps, options }) });
}

/** `pick`'s read, check and append, under the register lock. */
function pickHeld({
  deps,
  options,
}: {
  deps: JudgementDeps & Pick<SlackDraftDeps, "readOwnerWords">;
  options: DraftPickOptions;
}): number {
  const row = heldRow({ deps, home: options.home, id: options.id });
  if (row.kind === "exit") {
    return row.code;
  }
  const refusal = pickRefusal({ item: row.item, variant: options.variant });
  if (refusal !== undefined) {
    logger.error({ msg: refusal });
    return EXIT_USAGE;
  }
  let voice: DraftPickVoice | undefined;
  if (options.anchor !== undefined) {
    const heard = resolveDraftApproval({
      anchor: options.anchor,
      claimed: `--anchor ${options.anchor}`,
      deps,
      home: options.home,
    });
    if (heard.isErr()) {
      for (const line of heard.error) {
        logger.error({ msg: line });
      }
      return EXIT_USAGE;
    }
    voice = { anchor: heard.value.anchor, atIso: heard.value.atIso, heard: heard.value.heard };
  }
  if (!appendPick({ deps, home: options.home, item: row.item, variant: options.variant, voice })) {
    return EXIT_ERROR;
  }
  deps.out(`picked the ${options.variant} draft on ${options.id}; it still waits for their yes to send`);
  return EXIT_OK;
}
