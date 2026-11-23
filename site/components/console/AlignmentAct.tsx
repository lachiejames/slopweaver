/** One act the fleet already took, as the Alignment page (`./Alignment.tsx`) draws it. */

import { type ReactElement, useEffect, useRef } from "react";

import type { GuidanceView } from "../../lib/alignmentGuidance";
import { withLookedUpPull } from "../../lib/queueActRow";
import { type QueueRow } from "../../lib/queueRows";
import { reasonTextOf } from "../../lib/quotedReason";
import { ProvenanceGlyph } from "../live/PrCard";
import type { LiveState } from "../live/useLive";
import { CARD, ConversationHint, dayOf, engaging } from "./AlignmentCommon";
import { IntegrationFailure } from "./ConnectIntegration";
import { CHIP } from "./controls";
import { PlainWhy } from "./RawFold";
import { ReasonLines } from "./ReasonLines";
import { RelatedGuidancePanel } from "./RelatedGuidance";
import { useActPull } from "./useActPull";
import { FindingMark } from "./workContextState";

/**
 * One act the fleet already took: what it did, and the record folded.
 *
 * The owner's word on it is said in the call, and lands on that act's own ledger line (`autonomy steer`), so it
 * changes that act only (a steer on one draft edits that one only). Touching the card makes it what the owner is
 * answering; a link naming the act scrolls the page to it.
 *
 * @returns the card
 */
export function ActCard({
  row,
  focus,
  onEngage,
  guidance,
}: {
  row: QueueRow;
  focus: boolean;
  onEngage: (key: string) => void;
  /** The owner's guidance, read once for the page; the card's sidebar names what in it relates to this act. */
  guidance: LiveState<GuidanceView>;
}): ReactElement | null {
  const card = useRef<HTMLElement>(null);
  let lookupBranch: string | undefined;
  if (row.record.kind === "act") {
    lookupBranch = row.record.lookupBranch;
  }
  const lookup = useActPull({ branch: lookupBranch });
  const shown = withLookedUpPull({ lookup, row });
  useEffect(() => {
    // A card the owner touched is already where they are looking: only the card a link named is scrolled to.
    if (focus && card.current !== null && !card.current.contains(document.activeElement)) {
      card.current.scrollIntoView({ block: "center" });
    }
  }, [focus]);
  if (shown.record.kind !== "act") {
    return null;
  }
  const { act, earlier, form, links } = shown.record;
  let scene = shown.card.question;
  if (shown.card.kind === "briefing" && shown.card.what !== undefined) {
    scene = shown.card.what.whole;
  }
  return (
    <article
      ref={card}
      className={CARD}
      id={shown.key}
      data-testid="alignment-act"
      data-card-key={row.key}
      {...engaging({ about: row.key, onEngage })}
    >
      {/* Two columns on a wide page, as a Queue card's sidebar sits beside its body; one stacked column on a narrow one. */}
      <div className="grid gap-x-4 gap-y-[0.6rem] md:grid-cols-[minmax(0,1fr)_15rem]">
        <div className="min-w-0">
          <p className="m-0 text-[0.75rem] text-muted-foreground">
            {/* The workspace's glyph, as a Queue row leads with it, so an act names whose it is here too. */}
            <ProvenanceGlyph provenance={shown.provenance} /> <span className={CHIP}>{act.kind}</span>{" "}
            {dayOf({ iso: act.doneIso })}
            {earlier.length > 0 && ` · and ${String(earlier.length)} earlier like it`}{" "}
            {/* Its placement mark, as the voice says it, so an act the default rule placed says so here too. */}
            <FindingMark placement={shown.placement} />
          </p>
          <p className="mt-[0.5rem] mb-0 text-[0.9rem]">
            <span className="text-muted-foreground">The fleet did this without asking:</span> {scene}
          </p>
          <p className="mt-[0.4rem] mb-0 text-[0.84rem] font-[600]">{shown.card.question}</p>
          {form.kind === "refused" && (
            // The by-branch pull-request lookup can fail only because GitHub is not connected: the connect affordance then.
            // A quoted read keeps the console's lead apart from the lookup's own reason (steer 7) for the fallback; the
            // not-connected test still reads the joined sentence it always read, so what draws is unchanged.
            <IntegrationFailure
              why={reasonTextOf({ reason: form.why })}
              subjects={["the pull request this act made"]}
              fallback={
                <div className="mt-[0.4rem] mb-0 text-[0.75rem] text-warning">
                  {typeof form.why === "string" ? <PlainWhy why={form.why} /> : <ReasonLines reason={form.why} />}
                </div>
              }
            />
          )}
          <ConversationHint />
          <details className="mt-[0.5rem] text-[0.78rem]">
            <summary className="cursor-pointer text-muted-foreground">the record</summary>
            <dl className="my-[0.3rem] grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1">
              <dt className="text-muted-foreground">why</dt>
              <dd className="m-0">{act.why}</dd>
              <dt className="text-muted-foreground">subject</dt>
              <dd className="m-0 break-all">{act.subject}</dd>
              {act.witness !== undefined && (
                <>
                  <dt className="text-muted-foreground">witness</dt>
                  <dd className="m-0 break-all">{act.witness}</dd>
                </>
              )}
              <dt className="text-muted-foreground">earlier</dt>
              <dd className="m-0">
                {earlier.length === 0 ? "(the only act of its pattern)" : earlier.map((was) => was.actionId).join(", ")}
              </dd>
            </dl>
            {links.kind === "linked" && links.links.length > 0 && (
              <ul className="my-[0.3rem] pl-[1.1rem]">
                {links.links.map((link) => (
                  <li key={link.url}>
                    <a href={link.url} target="_blank" rel="noreferrer">
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </details>
        </div>
        <RelatedGuidancePanel guidance={guidance} kind={act.kind} subject={act.subject} />
      </div>
    </article>
  );
}
