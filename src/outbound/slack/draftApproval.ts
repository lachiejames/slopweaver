/**
 * Whether a recorded draft carries the owner's yes to its content — the rule that a yes already given is the SEND,
 * and a mechanical fix never earns a second one.
 *
 * A pre-approved message with common violations (an em-dash, non-drip form) has those fixed before sending, and the
 * approved draft is then actually sent unless there is a good reason otherwise. Approved rows once sat held for
 * hours having lost the approval the same way: a re-cut (a wrong tag, a merge) parked a fresh row "for the owner's
 * yes", and nothing on the row said it had already been given.
 *
 * So an approval travels with the words. A fresh `--approved <anchor>` names the owner's own words; a re-cut of ONE
 * approved row inherits its approval, because a re-cut is how a mechanical fix is made; and only `--meaning-changed`
 * — the words now mean something else, or the thread moved materially — sets it down and waits for the owner again.
 *
 * A re-cut MERGING several rows carries no approval across: a merge once folded a finding the owner never heard into
 * a drip they had settled, and inheriting there would send the finding under their yes. That recording names a
 * fresh anchor covering the merged words, or declares the change.
 *
 * Pure: the anchor is resolved by the shell (`../../cli/commands/slack/draftApprovalResolve.ts`).
 */
import { err, ok, type Result } from "../../lib/result.js";
import { type DraftDropError, DraftDropErrors } from "./draftDropErrors.js";
import { type SlackDraftError, SlackDraftErrors } from "./draftErrors.js";
import { liveCutOf } from "./draftLiveCut.js";
import type { DraftApproval, SlackDraftItem } from "./draftRegister.js";
import { noteRecordsSend } from "./draftSentNote.js";
import { recordedCutOf } from "./draftSpent.js";

/** The approval fields a recorded row carries: an approval, a declared change of meaning, or neither. */
export interface RecordedApproval {
  readonly approval?: DraftApproval | undefined;
  readonly meaningChanged?: string | undefined;
}

/**
 * The approval a new row carries, from what its recording declared and the rows it re-cuts.
 *
 * @param fresh the owner's words at a `--approved` anchor, already resolved; absent when the flag was not passed
 * @param meaningChanged the `--meaning-changed` words, when the recorder declared one
 * @param superseded the held rows `--supersedes` names, as the register holds them
 * @returns the fields the row carries, or why the recording would carry an approval the owner never gave
 */
export function inheritedDraftApproval({
  fresh,
  meaningChanged,
  superseded,
}: {
  fresh: DraftApproval | undefined;
  meaningChanged: string | undefined;
  superseded: readonly SlackDraftItem[];
}): Result<RecordedApproval, SlackDraftError> {
  const approved = superseded.filter((item) => item.draft.approval !== undefined);
  if (fresh !== undefined && meaningChanged !== undefined) {
    return err(
      SlackDraftErrors.approvalInvalid({
        claimed: `--approved ${fresh.anchor}`,
        why: "--meaning-changed says the words no longer carry the owner's yes, so it cannot stand beside one",
      }),
    );
  }
  if (fresh !== undefined) {
    return ok({ approval: fresh });
  }
  const changed = superseded.filter((item) => item.draft.meaningChanged !== undefined);
  if (meaningChanged !== undefined) {
    // A yes an approval-voiding hold set down still waits on the owner's word, so the change that carries it to them is wanted.
    const setDown = superseded.filter((item) => item.hold?.setDown !== undefined);
    if (approved.length === 0 && changed.length === 0 && setDown.length === 0) {
      return err(
        SlackDraftErrors.approvalInvalid({
          claimed: `--meaning-changed "${meaningChanged}"`,
          why:
            "no row --supersedes names carries the owner's approval, a change of meaning waiting on their word, or a " +
            "yes an approval-voiding hold set down, so there is no yes for the change to set down",
        }),
      );
    }
    return ok({ meaningChanged });
  }
  if (approved.length === 0 && changed.length > 0) {
    return err(changeUnseen({ changed }));
  }
  const [only] = superseded;
  if (approved.length === 0 || only === undefined) {
    return ok({});
  }
  if (superseded.length === 1 && only.draft.approval !== undefined) {
    return ok({ approval: carriedApproval({ approval: only.draft.approval, item: only }) });
  }
  const ids = superseded.map((item) => item.id).join(", ");
  return err(
    SlackDraftErrors.approvalInvalid({
      claimed: `--supersedes ${ids}`,
      why:
        `this re-cut merges ${String(superseded.length)} rows and ${approved.map((item) => item.id).join(", ")} ` +
        "carries the owner's approval, so the merge would send words they never heard under it. Pass --approved " +
        "<anchor> naming their yes to the merged words, or --meaning-changed saying what the merge added",
    }),
  );
}

/**
 * The owner's yes as a re-cut carries it: the words they heard, plus the judgement the row it came from stood on — when
 * it was judged, how many landings that judgement read, and the hold keeping it unsent. A re-cut judges no words, so a
 * landing past that boundary stays owed, and a stated block stays in front of them. Read off the folded
 * row, never off the approval, whose own carried fields a later judgement of that row has since replaced.
 */
function carriedApproval({ approval, item }: { approval: DraftApproval; item: SlackDraftItem }): DraftApproval {
  const { anchor, atIso, heard } = approval;
  const judged = item.judgedIso === undefined ? {} : { judgedIso: item.judgedIso };
  const counted = item.judgedLandings === undefined ? {} : { judgedLandings: item.judgedLandings };
  const { hold } = item;
  const held = hold === undefined ? {} : { hold: { atIso: hold.atIso, reason: hold.reason, why: hold.why } };
  return { anchor, atIso, heard, inheritedFrom: item.id, ...judged, ...counted, ...held };
}

/**
 * The refusal of a re-cut that would set down a change of meaning still waiting on the owner's word. The change is not
 * inherited silently: a re-cut parked carrying it would read as a judgement of any words of the owner's that landed
 * on the earlier cut, so the recorder re-declares it, or names their yes.
 */
function changeUnseen({ changed }: { changed: readonly SlackDraftItem[] }): SlackDraftError {
  const reasons = changed.map((item) => `${item.id}: "${String(item.draft.meaningChanged)}"`).join("; ");
  return SlackDraftErrors.approvalInvalid({
    claimed: `--supersedes ${changed.map((item) => item.id).join(", ")}`,
    why:
      `its meaning changed and waits on the owner's word (${reasons}), and a re-cut recording neither would set that ` +
      'change down with the reason never in front of them. Re-run the same record adding --meaning-changed "<the ' +
      'change, or what changed since>", or --approved <anchor> naming their yes to these words',
  });
}

/**
 * Where a drop leaves a row's words: on a held re-cut, sent, or nowhere. `unlinked` names the cut the note pointed at
 * when the register does not record it as this row's message, so a refusal can say why that cut does not count.
 */
export type DropLeadsTo =
  | { readonly kind: "held"; readonly cut: SlackDraftItem }
  | { readonly kind: "sent" }
  | { readonly kind: "ends"; readonly unlinked?: SlackDraftItem };

/**
 * Where dropping this row with this note leaves its words: the note followed, through re-cuts already dropped, to a
 * held cut; to a released one, or a whole `sent …` record (`./draftSentNote.ts`), which is a send; or to nothing at
 * all, which is the words spent unsent. A cut, held or released, counts only when the register RECORDS it as this
 * row's message (`./draftSpent.ts`'s `recordedCutOf`): a note can name any row, and an unrelated one carrying its own
 * fresh yes once let an approved draft drop unsent, as did a released row merely carrying the same anchor or opening
 * line.
 *
 * @param row the held row about to be dropped
 * @param note the drop note, read for the re-cut it names exactly as the live-cut walk reads it
 * @param items every folded row
 * @returns where the drop leads
 */
export function dropLeadsTo({
  items,
  note,
  row,
}: {
  items: readonly SlackDraftItem[];
  note: string;
  row: SlackDraftItem;
}): DropLeadsTo {
  if (noteRecordsSend({ note, row })) {
    return { kind: "sent" };
  }
  const dropped: SlackDraftItem = { ...row, outcome: note, state: "dropped" };
  const cut = liveCutOf({ id: row.id, items: [dropped, ...items.filter((item) => item.id !== row.id)] });
  if (cut === undefined) {
    return { kind: "ends" };
  }
  const successor = cut.live;
  if (successor.id === row.id || successor.state === "dropped") {
    return { kind: "ends" };
  }
  if (!recordedCutOf({ carrier: successor, items, row })) {
    return { kind: "ends", unlinked: successor };
  }
  if (successor.state === "held") {
    return { cut: successor, kind: "held" };
  }
  return { kind: "sent" };
}

/**
 * Why a drop would shed the owner's yes. The row carries their approval and the drop either spends its words unsent —
 * a note naming no cut and no permalink, so a yes would end in neither a send nor a reason on their Queue — or leads
 * to a held cut carrying neither that approval nor a declared change of meaning: a re-cut recorded without
 * `--supersedes`, which the gate would then never owe. A row with no approval but a change of meaning waiting on the
 * owner's word is refused the same way onto a cut carrying neither.
 *
 * @param row the held row about to be dropped
 * @param note the drop note, read for the re-cut it names exactly as the live-cut walk reads it
 * @param items every folded row
 * @returns the refusal, or `undefined` when the drop sheds nothing
 */
export function dropShedsApproval({
  items,
  note,
  row,
}: {
  items: readonly SlackDraftItem[];
  note: string;
  row: SlackDraftItem;
}): DraftDropError | undefined {
  if (row.draft.approval === undefined) {
    return dropShedsChange({ items, note, row });
  }
  const leads = dropLeadsTo({ items, note, row });
  if (leads.kind === "ends") {
    return DraftDropErrors.dropSpendsYes({ dropped: row.id, unlinked: leads.unlinked?.id });
  }
  if (leads.kind === "sent") {
    return undefined;
  }
  const successor = leads.cut;
  // An inherited approval counts only when it is the yes this row carries now: a second approve landing while a re-cut
  // read leaves the cut holding the earlier one. A fresh `--approved` on the cut is its own yes.
  const carried = successor.draft.approval;
  const carriesThisYes =
    carried !== undefined && (carried.inheritedFrom === undefined || carried.anchor === row.draft.approval.anchor);
  if (carriesThisYes || successor.draft.meaningChanged !== undefined) {
    return undefined;
  }
  return DraftDropErrors.dropShedsApproval({ dropped: row.id, recut: successor.id });
}

/**
 * Why a drop would shed a change of meaning still waiting on the owner's word: the note leads to a held cut carrying
 * neither the change nor their yes, so the reason leaves their Queue card and the gate owes nothing. A drop
 * ending the row outright is the drop guard's (`../../cli/commands/slack/draftDropGuard.ts`).
 */
function dropShedsChange({
  items,
  note,
  row,
}: {
  items: readonly SlackDraftItem[];
  note: string;
  row: SlackDraftItem;
}): DraftDropError | undefined {
  if (row.draft.meaningChanged === undefined) {
    return undefined;
  }
  const leads = dropLeadsTo({ items, note, row });
  if (leads.kind !== "held") {
    return undefined;
  }
  const successor = leads.cut.draft;
  if (successor.approval !== undefined || successor.meaningChanged !== undefined) {
    return undefined;
  }
  return DraftDropErrors.dropShedsChange({ dropped: row.id, recut: leads.cut.id });
}

/**
 * Whether a row is held on an approval the owner already gave — the row the next chair pass owes a release.
 *
 * @param item one folded row
 * @returns true when it is held and carries the owner's yes
 */
export function heldOnApproval({ item }: { item: SlackDraftItem }): boolean {
  return item.state === "held" && item.draft.approval !== undefined;
}
