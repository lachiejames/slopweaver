/**
 * A held draft the Queue sends back unseen: it lacks the proof `src/outbound/slack/draftProof.ts` owes — as a finding,
 * a screenshot, a link and the impact in people (`findingProof.ts`); as a first message in a channel, an annotated,
 * unobstructed screenshot and a link (`firstMessageProof.ts`). `slack draft list --json` marks it `proofMissing` with
 * what is missing; the Queue draws no card for it, and a card naming its id says it was sent back rather than drawing
 * its words.
 *
 * A queue card raising a finding that is missing those key details wastes the owner's time and the fleet's, so it is
 * sent back. The very first message in a channel comes in with the
 * receipts, every screenshot annotated, and a card failing that is sent back without being put in front of the owner.
 */
import type { Bag } from "../../lib/bag";

/**
 * What a draft can be missing — `src/outbound/slack/draftProofPieces.ts`'s `DRAFT_PROOF_MISSING`, restated because
 * `site/` cannot import that tree; `site/__tests__/unit/draftProofMissing.test.ts` holds the two lists equal.
 */
export const DRAFT_PROOF_MISSING = ["screenshot", "link", "annotation", "impact", "impact-count-first"] as const;

/** One of {@link DRAFT_PROOF_MISSING}. */
export type DraftProofMissing = (typeof DRAFT_PROOF_MISSING)[number];

/** How each missing piece reads on a card. */
const SAID: Readonly<Record<DraftProofMissing, string>> = {
  annotation: "no annotated, unobstructed screenshot",
  impact: "no impact in people",
  "impact-count-first": "the impact count is not in its first line",
  link: "no link",
  screenshot: "no screenshot",
};

/**
 * A listed row's `proofMissing` field: `undefined` when the row carries none, `"malformed"` when present and not a
 * non-empty list of known pieces — a send-back the card cannot state is not one it may draw as a live draft.
 *
 * @param item one `items[]` entry of the list document
 * @returns the missing pieces, `undefined`, or `"malformed"`
 */
export function draftProofMissingOf({ item }: { item: Bag }): readonly DraftProofMissing[] | undefined | "malformed" {
  const value: unknown = item["proofMissing"];
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value) || value.length === 0) {
    return "malformed";
  }
  const missing: DraftProofMissing[] = [];
  for (const piece of value) {
    const known = DRAFT_PROOF_MISSING.find((one) => one === piece);
    if (known === undefined) {
      return "malformed";
    }
    missing.push(known);
  }
  return missing;
}

/** The annotated screenshot a cleared first message leads with: its bytes, and the note on each box drawn into it. */
export interface LeadingReceipt {
  readonly sha256: string;
  readonly notes: readonly string[];
}

/** The register's spelling of a blob's digest. */
const SHA256_HEX = /^[0-9a-f]{64}$/u;

/**
 * A listed row's `leadingReceipt` field: `undefined` when it carries none, `"malformed"` when present and not exactly a
 * digest and a non-empty list of notes — a receipt the card cannot draw is not one it may lead with.
 *
 * @param item one `items[]` entry of the list document
 * @returns the receipt, `undefined`, or `"malformed"`
 */
export function leadingReceiptOf({ item }: { item: Bag }): LeadingReceipt | undefined | "malformed" {
  const value: unknown = item["leadingReceipt"];
  if (value === undefined) {
    return undefined;
  }
  if (!isFieldBag(value)) {
    return "malformed";
  }
  const { notes, sha256, ...rest } = value;
  if (Object.keys(rest).length > 0 || typeof sha256 !== "string" || !SHA256_HEX.test(sha256) || !isNoteList(notes)) {
    return "malformed";
  }
  return { notes, sha256 };
}

/** Whether a value is a plain object whose fields can be read by name. */
function isFieldBag(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Whether a value is a non-empty list of notes, each carrying a visible character as an image record's note must. */
function isNoteList(value: unknown): value is readonly string[] {
  return (
    Array.isArray(value) && value.length > 0 && value.every((note) => typeof note === "string" && /\S/u.test(note))
  );
}

/**
 * A listed row's two proof fields read together: what it lacks, and the receipt a cleared first message leads with.
 * Either one malformed, a send-back on a resolved row, a receipt beside a send-back or on a resolved row, or a receipt
 * naming bytes the row does not carry is a document this build cannot describe truthfully.
 *
 * @param item one `items[]` entry of the list document
 * @param held whether the row is still held
 * @param attached the digest of every file under the row, which a receipt must name one of
 * @returns the fields to spread onto the row, or `"malformed"`
 */
export function draftProofFieldsOf({
  attached,
  held,
  item,
}: {
  attached: readonly string[];
  held: boolean;
  item: Bag;
}): { proofMissing?: readonly DraftProofMissing[]; leadingReceipt?: LeadingReceipt } | "malformed" {
  const proofMissing = draftProofMissingOf({ item });
  const leadingReceipt = leadingReceiptOf({ item });
  if (proofMissing === "malformed" || leadingReceipt === "malformed") {
    return "malformed";
  }
  if (leadingReceipt !== undefined && !attached.includes(leadingReceipt.sha256)) {
    return "malformed";
  }
  const stray = (proofMissing !== undefined || leadingReceipt !== undefined) && !held;
  if (stray || (proofMissing !== undefined && leadingReceipt !== undefined)) {
    return "malformed";
  }
  return {
    ...(proofMissing === undefined ? {} : { proofMissing }),
    ...(leadingReceipt === undefined ? {} : { leadingReceipt }),
  };
}

/**
 * The line a card naming a draft sent back for its proof draws in place of its words.
 *
 * @param missing what the draft lacks
 * @returns the sentence
 */
export function proofMissingLine({ missing }: { missing: readonly DraftProofMissing[] }): string {
  return `It came without its proof (${missing.map((piece) => SAID[piece]).join(", ")}), so it was sent back unseen.`;
}
