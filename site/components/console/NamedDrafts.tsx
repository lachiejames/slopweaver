/*
 * Every parked Slack draft a queue card names, drawn on the card itself: a card naming a draft never draws without it,
 * for any existing or future queue card regarding a Slack draft or draft DM, because the owner reads these in the
 * native Slack UI.
 *
 * So every id resolves to something drawn (`../../lib/slackDraftIds.ts`): a held draft or a sent one as Slack
 * would draw it (`./SlackDraft.tsx`, whose stamp says which), an id the register does not hold as a named defect,
 * and a register not yet read as that. A held finding the Queue sent back unseen for want of its proof draws only the
 * line saying so, never its words (a first message in a channel too, `../live/draftProofMissing.ts`). A dropped draft is only ever drawn FOLDED behind its drop note, and a dropped
 * one that was re-cut draws its LIVE cut first, named by id, so the owner never approves a dropped cut's words.
 * Each draft is drawn ONCE: a card naming a live cut and the dropped cut before it draws the live cut alone, with no
 * re-cut note, because duplicates make the card too long.
 * Only a HELD draft carries the line that sends it, and only a held one is drawn inside the conversation it lands in,
 * read live (`./DraftConversation.tsx`) — with Codex's draft beside it, named by writer, while the owner's pick is owed
 * (`./DraftComparison.tsx`): this card owns the draft, its own post card absorbed (`../../lib/queueDraftOwnership.ts`).
 * Nothing here sends.
 */

import type { ReactElement } from "react";

import type { NamedDraft } from "../../lib/slackDraftIds";
import { proofMissingLine } from "../live/draftProofMissing";
import { isParked, type ParkedDraft } from "../live/readSlackDrafts";
import { DraftComparison } from "./DraftComparison";
import { DraftInConversation } from "./DraftConversation";
import { ReadingIndicator } from "./ReadingIndicator";
import { DraftReleaseNote, SlackDraft } from "./SlackDraft";
import { StaleMark } from "./StaleMark";

/** The quiet line under a drawn draft. */
const NOTE = "mt-1 text-[0.8rem] text-muted-foreground";

/**
 * The line under a held draft: the exact command that posts it, and what it carries beyond its text.
 *
 * The owner sees on the queue card the media that would be included with the Slack message. The pictures themselves are drawn in the message above (`./SlackAttachments.tsx`); this line says how
 * many the digest binds, and says so when there are none, rather than leave a blank that reads as "nothing to see".
 *
 * @returns the line
 */
function SendLine({ draft }: { draft: ParkedDraft }): ReactElement {
  let carried = "No media attached.";
  if (draft.media.length > 0) {
    carried = `The ${String(draft.media.length)} attachment${draft.media.length > 1 ? "s" : ""} drawn above are the exact bytes it sends.`;
  }
  return (
    <p className={NOTE}>
      <DraftReleaseNote draft={draft} />. {carried}
    </p>
  );
}

/**
 * A dropped cut, FOLDED: its id and drop note above the fold, its words only for whoever opens it. A dropped cut's
 * words are not the draft, so they are never what the card leads with.
 *
 * @returns the folded cut
 */
function DroppedCut({ draft }: { draft: ParkedDraft }): ReactElement {
  let note = "no drop note was recorded";
  if (draft.outcome !== undefined) {
    note = draft.outcome;
  }
  return (
    <details className="mt-1 text-[0.8rem]">
      <summary className="cursor-pointer text-muted-foreground">
        <code>{draft.id}</code> dropped unsent: {note}
      </summary>
      <div className="mt-2">
        <SlackDraft draft={draft} />
      </div>
    </details>
  );
}

/**
 * A named draft that was dropped and re-cut: the LIVE cut drawn, named by its own id, and every dropped cut before it
 * folded with its drop note, so the owner never approves words that are no longer the draft.
 *
 * @returns the live cut and its folded history
 */
function Recut({ named }: { named: Extract<NamedDraft, { kind: "recut" }> }): ReactElement {
  const { id, live, superseded } = named;
  const history = superseded.map((draft) => <DroppedCut key={draft.id} draft={draft} />);
  // The chain can end on a cut that was itself dropped with no re-cut named — its words are folded like the rest.
  if (live.state === "dropped") {
    return (
      <div className="mb-3">
        <p className="mt-0 mb-1 text-[0.8rem] text-muted-foreground">
          This card names <code>{id}</code>, which was dropped and re-cut; the last cut, <code>{live.id}</code>, was
          dropped too with no re-cut named, so there is nothing to send.
        </p>
        <DroppedCut draft={live} />
        {history}
      </div>
    );
  }
  let drawn = <DraftInConversation draft={live} />;
  let standing = <SendLine draft={live} />;
  if (isParked({ draft: live })) {
    drawn = <DraftComparison draft={live} labels="writers" />;
  } else {
    standing = (
      <p className={NOTE}>
        <code>{live.id}</code> is no longer waiting on you either; the drafts register has it {live.state}, so there is
        nothing left to send.
      </p>
    );
  }
  return (
    <div className="mb-3">
      <p className="mt-0 mb-2 text-[0.8rem] text-warning">
        This card names <code>{id}</code>, which was dropped and re-cut. The live cut is <code>{live.id}</code>, drawn
        here. That is the draft to judge.
      </p>
      {drawn}
      {standing}
      {history}
    </div>
  );
}

/**
 * One resolution, drawn.
 *
 * @returns the draft, or the line saying why there is none to draw
 */
function Named({ named }: { named: NamedDraft }): ReactElement {
  if (named.kind === "held") {
    return (
      <div className="mb-3">
        <DraftComparison draft={named.draft} labels="writers" />
        <SendLine draft={named.draft} />
      </div>
    );
  }
  if (named.kind === "recut") {
    return <Recut named={named} />;
  }
  if (named.kind === "spent" && named.draft.state === "dropped") {
    return (
      <div className="mb-3">
        <p className="mt-0 mb-1 text-[0.8rem] text-muted-foreground">
          This card names <code>{named.id}</code>, dropped unsent with no re-cut named, so there is nothing to send.
        </p>
        <DroppedCut draft={named.draft} />
      </div>
    );
  }
  if (named.kind === "spent") {
    return (
      <div className="mb-3">
        <SlackDraft draft={named.draft} />
        <p className={NOTE}>
          <code>{named.id}</code> is no longer waiting on you; the drafts register has it {named.draft.state}, so there
          is nothing left to send.
        </p>
      </div>
    );
  }
  if (named.kind === "proof-missing") {
    return (
      <p className="mt-0 mb-3 text-[0.8rem] text-muted-foreground">
        Draft <code>{named.id}</code>: {proofMissingLine({ missing: named.missing })}
      </p>
    );
  }
  if (named.kind === "absent") {
    return (
      <p className="mt-0 mb-3 text-[0.8rem] text-warning">
        This card names <code>{named.id}</code> and the drafts register holds no such draft, so there is nothing to show
        you. That is a defect in whatever recorded the card, not a card without a draft.
      </p>
    );
  }
  if (named.kind === "not-measured") {
    return (
      <div className="mb-3">
        <StaleMark facts={[{ subject: `the drafts register, for ${named.id}`, why: named.why }]} block />
      </div>
    );
  }
  return (
    <div className="mb-3">
      <ReadingIndicator label={`Reading the drafts register for ${named.id}`} block />
    </div>
  );
}

/**
 * Every draft a card names, in the order it names them.
 *
 * @param drafts the resolutions — at least one, or the panel passes no preview at all
 * @returns the drafts
 */
export function NamedDrafts({ drafts }: { drafts: readonly NamedDraft[] }): ReactElement {
  return (
    <>
      {drafts.map((named) => (
        <Named key={named.id} named={named} />
      ))}
    </>
  );
}
