/**
 * A held draft's slot while Codex's draft sits beside the original and the owner has chosen neither: the original
 * inside its live conversation, then Codex's, drawn as Slack would draw it. Codex wrote it
 * blind to the original, from the same conversation and the owner's voice brief, so the two are offered as equals and never
 * ranked.
 *
 * On a post card the two are A and B, its options' letters. On an ask or hand card that absorbed the post card
 * (`../../lib/queueDraftOwnership.ts`) the letters are the card's own options, so each is named by who wrote it.
 *
 * Once the owner has chosen, or on a row with nothing to choose, it is the one draft in its conversation, as before.
 */
import type { ReactElement } from "react";
import type { ParkedDraft } from "../live/readSlackDrafts";
import { DraftInConversation } from "./DraftConversation";
import { SlackDraft } from "./SlackDraft";
import type { DraftContextState } from "./useDraftContext";

/** The small caps label above each variant. */
const VARIANT_LABEL = "text-[0.72rem] font-bold tracking-[0.06em] text-muted-foreground uppercase";

/** How the two drafts are labelled: by the post card's option letters, or by who wrote each. */
export type DraftComparisonLabels = "option-letters" | "writers";

/**
 * The draft slot of a card drawing a held draft.
 *
 * @param draft the parked draft, its comparison included
 * @param context the conversation already read for the draft
 * @param labels `writers` on a card whose letters are its own options; the post card's letters otherwise
 * @returns both drafts, labelled, while the owner owes a pick; else the one draft
 */
export function DraftComparison({
  draft,
  context,
  labels = "option-letters",
}: {
  draft: ParkedDraft;
  context?: DraftContextState;
  labels?: DraftComparisonLabels;
}): ReactElement {
  const codex = draft.comparison?.codex;
  if (codex === undefined) {
    return <DraftInConversation draft={draft} {...(context === undefined ? {} : { context })} />;
  }
  const originalBy = draft.comparison?.composer === "claude-code" ? "Claude's draft" : "the recording session's draft";
  let original = `A · ${originalBy}`;
  let blind = "B · Codex's draft, written blind to A";
  if (labels === "writers") {
    original = originalBy;
    blind = `Codex's draft, written blind to ${originalBy}`;
  }
  return (
    <div className="grid gap-3">
      <section className="grid gap-1" aria-label="the original draft">
        <span className={VARIANT_LABEL}>{original}</span>
        <DraftInConversation draft={draft} {...(context === undefined ? {} : { context })} />
      </section>
      <section className="grid gap-1" aria-label="Codex's draft">
        <span className={VARIANT_LABEL}>{blind}</span>
        {draft.comparison?.codexDropsReceipts === true ? (
          <p className="text-sm text-destructive" data-testid="draft-b-drops-receipts">
            Drops the receipt the original links to, so it is not offered until it is re-cut with the link.
          </p>
        ) : null}
        <SlackDraft draft={{ ...draft, ...codex }} />
      </section>
    </div>
  );
}
