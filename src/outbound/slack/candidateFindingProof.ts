/**
 * The finding proof bar held over Codex's draft beside a held row (`./draftComparison.ts`). A pick makes the
 * candidate's form and payload the row's words while the row keeps its own media and impact, so a candidate that turns
 * a plain draft into a finding owes the same screenshot, link and counted impact the row would. It is
 * refused at admission, refused at pick, and a ready one admitted before this bar lists as refused, so the Queue never
 * offers it.
 */
import type { SlackDraftCandidate, SlackDraftComparison } from "./draftComparison.js";
import type { ParkedSlackDraft, SlackDraftItem } from "./draftRegister.js";
import { findingProofRefusal, storedFindingProofMissing } from "./findingProof.js";
import type { FindingProofMissing } from "./findingProofPieces.js";

/**
 * What the held row would lack, as a finding, if Codex's draft became its words.
 *
 * @param candidate Codex's form and the payload it prepared to
 * @param draft the held row, whose media, impact, kind and destination a pick keeps
 * @returns the missing pieces, empty when the candidate raises no finding or the row proves it
 */
export function candidateFindingProofMissing({
  candidate,
  draft,
}: {
  candidate: Pick<SlackDraftCandidate, "form" | "payload">;
  draft: Pick<ParkedSlackDraft, "act" | "actor" | "channel" | "impact" | "kind" | "media" | "threadTs">;
}): readonly FindingProofMissing[] {
  return storedFindingProofMissing({ draft: { ...draft, form: candidate.form, payload: candidate.payload } });
}

/**
 * A row's comparison as the Queue lists it: a ready Codex draft the finding proof bar refuses reads as refused at
 * admission, which is what admitting it today would record, so the card draws the refusal instead of offering B.
 *
 * @param item the held row
 * @returns its comparison, the refused reading in place of an unproved ready one
 */
export function listedComparison({ item }: { item: SlackDraftItem }): SlackDraftComparison | undefined {
  const { comparison } = item;
  if (comparison?.state !== "ready" || item.pick !== undefined) {
    return comparison;
  }
  const missing = candidateFindingProofMissing({ candidate: comparison.candidate, draft: item.draft });
  if (missing.length === 0) {
    return comparison;
  }
  return { atIso: comparison.atIso, reasons: findingProofRefusal({ missing }), stage: "admission", state: "refused" };
}
