/**
 * What `slack draft list --json` PRINTS — the document the console's queue cards parse. Split out of
 * `./draftReport.ts`, which owns the text a terminal reads. Pure.
 */
import type { SlackPerson } from "../../../corpus/members/slackPeople.js";
import { listedComparison } from "../../../outbound/slack/candidateFindingProof.js";
import {
  candidateDropsReceipts,
  type DraftPickCounts,
  draftPickCounts,
} from "../../../outbound/slack/draftComparison.js";
import { type DraftMediaOf, draftProofVerdict } from "../../../outbound/slack/draftProof.js";
import type { DraftProofMissing } from "../../../outbound/slack/draftProofPieces.js";
import type { SlackDraftItem } from "../../../outbound/slack/draftRegister.js";
import { revisionRefusal, type SlackDraftVersion } from "../../../outbound/slack/draftRevision.js";
import { draftEditableText } from "../../../outbound/slack/draftRevisionText.js";
import { draftBodyLines } from "../../../outbound/slack/draftText.js";
import type { LeadingReceipt } from "../../../outbound/slack/firstMessageProof.js";
import { type DraftRelease, draftRelease } from "./draftReport.js";

/**
 * A listed row: the folded row, plus how it goes out while it is still held, and — only when true — that Codex's draft
 * beside it drops the receipt the original brings, so the card says so beside B and does not offer B as a pick.
 */
export type ListedDraftItem = Omit<SlackDraftItem, "versions"> & {
  readonly release?: DraftRelease;
  readonly codexDropsReceipts?: true;
  /**
   * The words as the console voice edits them (`../../../outbound/slack/draftRevisionText.ts`), on a held row a voice
   * edit can revise; absent on any other.
   */
  readonly editableText?: string;
  /** Every version of the words once a voice edit revised them, oldest first, each as its payload reads. */
  readonly versions?: readonly ListedDraftVersion[];
  /**
   * What a HELD row lacks as a finding or as a first message in a channel, when it lacks any
   * (`../../../outbound/slack/draftProof.ts`): the Queue sends it back unseen, drawing no card for it, and a card naming
   * its id says so.
   */
  readonly proofMissing?: readonly DraftProofMissing[];
  /** The annotated screenshot a cleared first message leads with, which its Queue card draws first. */
  readonly leadingReceipt?: LeadingReceipt;
};

/** One version of a revised row's words as the card's history draws it. */
type ListedDraftVersion = Omit<SlackDraftVersion, "words"> & { readonly digest: string; readonly text: string };

/**
 * A held row as listed: its release, the one comparison verdict the card draws rather than derives, its text, and —
 * for a row without its proof — what it lacks, which sends it back unseen, or the receipt a cleared first message leads
 * with.
 */
function listedHeld({ item: stored, mediaOf }: { item: SlackDraftItem; mediaOf: DraftMediaOf }): ListedDraftItem {
  const comparison = listedComparison({ item: stored });
  const item = comparison === undefined ? stored : { ...stored, comparison };
  const drops = item.pick === undefined && candidateDropsReceipts({ item });
  const text = revisionRefusal({ item }) === undefined ? draftEditableText({ form: item.draft.form }) : undefined;
  const proof = draftProofVerdict({ draft: item.draft, media: mediaOf({ item: stored }) });
  const proofMissing = proof.missing;
  return {
    ...listedVersions({ item }),
    release: draftRelease({ item }),
    ...(proofMissing.length > 0 ? { proofMissing } : {}),
    ...(proof.leadingReceipt === undefined ? {} : { leadingReceipt: proof.leadingReceipt }),
    ...(drops ? { codexDropsReceipts: true as const } : {}),
    ...(text?.isOk() === true ? { editableText: text.value } : {}),
  };
}

/**
 * A row with its versions as text rather than whole words, so the document stays one copy of each payload. Each
 * version's text is its PAYLOAD read as the card reads it, never its form: a hand-written line whose form says other
 * words than its payload then shows the words a release would bind, and a release re-prepares the form and refuses
 * the drift.
 */
function listedVersions({ item }: { item: SlackDraftItem }): ListedDraftItem {
  const { versions, ...rest } = item;
  if (versions === undefined) {
    return rest;
  }
  return {
    ...rest,
    versions: versions.map(({ words, ...version }) => ({
      ...version,
      digest: words.digest,
      text: draftBodyLines({ payload: words.payload }).join("\n"),
    })),
  };
}

/**
 * The document `slack draft list --json` prints, and the ONE place its shape is decided.
 *
 * The console's queue cards parse exactly this (`site/components/live/readSlackDrafts.ts`), and a site reader
 * cannot import a CLI runner, so this is the seam `site/__tests__/unit/slackDraftListContract.test.ts` drives:
 * a field or payload element this starts printing that the reader cannot draw fails that test, not a card.
 * A held row carries its `release`, so the card prints the verb `./draftReport.ts` chose rather than guessing one,
 * and `picks` counts which draft the owner chose wherever a Codex draft sat beside the original — a preference, never a
 * score.
 *
 * @param items every folded row, newest first
 * @param mediaOf what each attachment under a held row is, for the first-message proof
 * @param people who each member id the rows carry is, off member bronze
 * @param botHandles the handles the install's profile declares for its own bot, printed only when it declares one,
 *   so a bot row member bronze cannot name still reads as the bot's handle
 * @returns the object the verb serialises
 */
export function draftListDocument({
  items,
  mediaOf,
  people,
  botHandles = [],
}: {
  items: readonly SlackDraftItem[];
  mediaOf: DraftMediaOf;
  people: readonly SlackPerson[];
  botHandles?: readonly string[];
}): {
  readonly botHandles?: readonly string[];
  readonly items: readonly ListedDraftItem[];
  readonly people: readonly SlackPerson[];
  readonly picks: DraftPickCounts;
} {
  return {
    ...(botHandles.length > 0 ? { botHandles } : {}),
    items: items.map((item) => (item.state === "held" ? listedHeld({ item, mediaOf }) : listedVersions({ item }))),
    people,
    picks: draftPickCounts({ items }),
  };
}
