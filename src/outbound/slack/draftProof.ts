/**
 * The one proof verdict a held draft gets: what it owes as a finding (`./findingProof.ts`) and as a first message in a
 * channel (`./firstMessageProof.ts`), merged so each piece is named once, in {@link DRAFT_PROOF_MISSING}'s order. Every
 * seam that hides, refuses or lists a row on its proof — record, revise, the Queue list, release, the console voice's
 * card search, the Codex comparison — asks this, so no surface draws a card another hides.
 *
 * Pure: the attachments arrive already read (`../../cli/commands/slack/draftMediaEvidence.ts`).
 */
import { DRAFT_PROOF_MISSING, type DraftProofMissing } from "./draftProofPieces.js";
import type { ParkedSlackDraft, SlackDraftItem } from "./draftRegister.js";
import { findingProofRefusal, storedFindingProofMissing } from "./findingProof.js";
import type { FindingProofMissing } from "./findingProofPieces.js";
import {
  type DraftMediaEvidence,
  type FirstMessageProofMissing,
  firstMessageProofRefusal,
  firstMessageProofVerdict,
  type LeadingReceipt,
} from "./firstMessageProof.js";

/** A held row's proof: every piece it lacks, and the receipt a cleared first message leads with. */
export interface DraftProofVerdict {
  readonly missing: readonly DraftProofMissing[];
  /** What each rule found, so a refusal can say which rule each piece answers. */
  readonly finding: readonly FindingProofMissing[];
  readonly firstMessage: readonly FirstMessageProofMissing[];
  readonly leadingReceipt?: LeadingReceipt | undefined;
}

/**
 * What each attachment under a row is, read by the shell (`../../cli/commands/slack/draftMediaEvidence.ts`) — the one
 * input a seam listing rows on their proof cannot read for itself.
 */
export type DraftMediaOf = (args: { item: SlackDraftItem }) => readonly DraftMediaEvidence[];

/** The row fields the two rules read. */
export type ProofDraft = Pick<
  ParkedSlackDraft,
  "act" | "actor" | "channel" | "form" | "groupDm" | "impact" | "kind" | "media" | "payload" | "shape" | "threadTs"
>;

/**
 * Both rules over one row, merged.
 *
 * @param draft the stored row, or the row a revision or a pick would make it
 * @param media what each attachment under it is, in attach order
 * @returns the verdict
 */
export function draftProofVerdict({
  draft,
  media,
}: {
  draft: ProofDraft;
  media: readonly DraftMediaEvidence[];
}): DraftProofVerdict {
  const finding = storedFindingProofMissing({ draft });
  const first = firstMessageProofVerdict({ draft, media });
  const named = new Set<DraftProofMissing>([...finding, ...first.missing]);
  const missing = DRAFT_PROOF_MISSING.filter((piece) => named.has(piece));
  return {
    finding,
    firstMessage: first.missing,
    missing,
    ...(missing.length === 0 && first.leadingReceipt !== undefined ? { leadingReceipt: first.leadingReceipt } : {}),
  };
}

/**
 * The refusal for a row missing proof, each rule's lines once, or nothing when it misses none.
 *
 * @param verdict what {@link draftProofVerdict} found
 * @returns the refusal lines
 */
export function draftProofRefusal({ verdict }: { verdict: DraftProofVerdict }): readonly string[] {
  return [
    ...findingProofRefusal({ missing: verdict.finding }),
    ...firstMessageProofRefusal({ missing: verdict.firstMessage }),
  ];
}

/**
 * Why a held row missing proof is not released: the Queue hides it, so no send may go round the Queue either. It names
 * the re-cut that brings the proof and the drop that ends it.
 *
 * @param id the row the release names
 * @param verdict what {@link draftProofVerdict} found, missing at least one piece
 * @returns the refusal reason
 */
export function draftProofReleaseRefusal({ id, verdict }: { id: string; verdict: DraftProofVerdict }): string {
  const what = [
    ...(verdict.finding.length > 0 ? ["raises a finding"] : []),
    ...(verdict.firstMessage.length > 0 ? ["is a first message in a channel"] : []),
  ].join(" and ");
  const annotationOnly = verdict.missing.length === 1 && verdict.missing[0] === "annotation";
  const fix = annotationOnly
    ? "Record the box already drawn into its screenshot (`slopweaver browser image-record` with `annotations` and " +
      '`obstruction: "none"`), draw the boxes onto an unannotated capture with `slopweaver browser annotate` and ' +
      "re-cut it, or retake an obscured capture and re-cut it"
    : `Re-cut it with its proof (\`slopweaver slack draft record … --supersedes ${id}\`)`;
  return (
    `${id} ${what} and is missing ${verdict.missing.join(", ")}, so it is not sent: the owner sends such a card back unseen. ` +
    `${fix}, or drop it (\`slopweaver slack draft drop ${id} --note "no proof"\`).`
  );
}
