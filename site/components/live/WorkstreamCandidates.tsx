"use client";

/**
 * The Proposed workstreams section at the top of the Workstreams page: the outcomes the owner has stated, built in, then
 * workstreams mined from the owner's own connected history, each asking one question — accept this as a workstream, done
 * meaning what you pick. Nothing is kept until the owner answers; a kept one is an outcome on the owner's register.
 *
 * Every figure is the verb's (`slopweaver workstreams candidates --json`); every press is an act row
 * (`site/lib/actVerbs.ts`) run by a card (`./CandidateCard.tsx`). Three things are the design rather than decoration:
 *
 * - **It opens on a few, never the whole mined list**: a mined list of seventy is never read. The unanswered candidates are ranked by how much of the owner's own words back each, the
 *   first {@link OPENING_FEW} drawn and the rest behind one link.
 * - **One at a time is a mode, not a page**: the same ranked list walked card by card, never wrapping to the start.
 * - **Collapsed until asked**: the section is a fold above the tiles, so the main screen is the tiles, and it opens
 *   once on `/workstreams#candidates`.
 */
import { type ReactElement, type RefObject, useEffect, useRef, useState } from "react";

import { cn } from "../../lib/utils";
import { readWorkstreamCandidates } from "../../lib/workstreamCandidates";
import {
  answeredLine,
  candidateHeading,
  candidatesSummary,
  oneAtATime,
  openingFew,
  partitionCandidates,
  provenanceLine,
} from "../../lib/workstreamCandidatesPage";
import { CANDIDATES_SLUG, type CandidateRowView, type CandidatesView } from "../../lib/workstreamCandidatesTypes";
import { shortDate } from "../../lib/workstreamTiles";
import { BUTTON, BUTTON_PRIMARY } from "../console/controls";
import { usePageReading } from "../voice/voiceContext";
import { SMALL } from "./CandidateAnswers";
import { CandidateCard, type OnCandidateOpen } from "./CandidateCard";
import { ReadMark, ReadStandIn } from "./LiveMarks";
import { useLive } from "./useLive";

/** The fragment `/workstreams#candidates` lands on. */
const ANCHOR = "candidates";

/** The section's frame, the same card the Closing fold under the tiles draws. */
const FOLD = "mt-4 rounded-[10px] border border-solid sw-glass-plane px-[0.9rem] py-[0.6rem]";

/** A small toggle or walk button. */
const SMALL_BUTTON = "px-[0.6rem] py-[0.2rem] text-[0.78rem]";

/**
 * The ranked unanswered candidates as a list: the few, then one link to the rest, one ranked list once followed
 * (the other candidates sit behind a link, ranked in order of likelihood).
 *
 * @returns the list
 */
function FewFirst({ view, onOpen }: { view: CandidatesView; onOpen: OnCandidateOpen }): ReactElement {
  const [showAll, setShowAll] = useState(false);
  const { unanswered } = partitionCandidates({ candidates: view.candidates });
  const { shown, behind } = openingFew({ showAll: false, unanswered });
  const rest = unanswered.slice(shown.length);
  return (
    <div>
      {shown.map((one) => (
        <CandidateCard key={one.id} candidate={one} view={view} onOpen={onOpen} />
      ))}
      {behind === 0 ? null : (
        <button
          type="button"
          className="mt-[0.4rem] cursor-pointer border-0 bg-transparent p-0 text-[0.84rem] text-primary underline"
          aria-expanded={showAll}
          onClick={() => {
            setShowAll(!showAll);
          }}
        >
          {showAll ? "Hide the rest" : `${String(behind)} more, ranked by evidence`}
        </button>
      )}
      {showAll ? rest.map((one) => <CandidateCard key={one.id} candidate={one} view={view} onOpen={onOpen} />) : null}
    </div>
  );
}

/**
 * The same ranked list walked one card at a time, open, with where the owner is in it.
 *
 * @returns the walk, or a line saying nothing waits on a word
 */
function OneByOne({ view, onOpen }: { view: CandidatesView; onOpen: OnCandidateOpen }): ReactElement {
  const [at, setAt] = useState(0);
  const { unanswered } = partitionCandidates({ candidates: view.candidates });
  const shown = oneAtATime({ at, list: unanswered });
  if (shown === null) {
    return <p className={SMALL}>Nothing waits on your word.</p>;
  }
  return (
    <div>
      <div className="my-[0.3rem] flex items-center gap-2 text-[0.82rem]">
        <button
          type="button"
          className={cn(BUTTON, SMALL_BUTTON)}
          disabled={!shown.hasPrev}
          onClick={() => {
            setAt(shown.index - 1);
          }}
        >
          ← previous
        </button>
        <span className="tabular-nums">
          {shown.index + 1} of {unanswered.length}
        </span>
        <button
          type="button"
          className={cn(BUTTON, SMALL_BUTTON)}
          disabled={!shown.hasNext}
          onClick={() => {
            setAt(shown.index + 1);
          }}
        >
          next →
        </button>
      </div>
      <CandidateCard key={shown.candidate.id} candidate={shown.candidate} view={view} open onOpen={onOpen} />
    </div>
  );
}

/**
 * The workstreams the owner proposed in the owner's own words, each with the candidate a mine read it into or the mine it is owed. A
 * new one is proposed in the call's chat — the console's one text input.
 *
 * @returns the fold
 */
function Proposals({ view }: { view: CandidatesView }): ReactElement {
  return (
    <details className="mt-2">
      <summary className="cursor-pointer text-[0.86rem]">
        <b>Your proposals</b> <span className={SMALL}>{view.proposals.length}</span>
      </summary>
      <ul className="my-[0.3rem] list-none p-0">
        {view.proposals.map((one) => (
          <li key={one.id} className="my-[0.2rem] text-[0.86rem]">
            <span className="text-muted-foreground tabular-nums">{one.id}</span> {one.title}{" "}
            <span className={SMALL}>
              {one.from === null ? "proposed outright" : `${one.relation} of ${one.from}`} ·{" "}
              {one.minedAs === null ? "the next mine owes it a candidate" : `mined as ${one.minedAs}`}
            </span>
          </li>
        ))}
      </ul>
      <p className={SMALL}>To propose another, say it in the call's chat.</p>
    </details>
  );
}

/**
 * Every candidate the owner has already ruled on, behind ONE collapsed section, each line its ruling in one clause with the
 * date and the owner's quoted words, opening to its card to change it, so ruled candidates are never jumbled with the ones still open.
 *
 * @returns the section, or nothing while the owner has ruled on none
 */
function Ruled({
  answered,
  view,
  onOpen,
}: {
  answered: readonly CandidateRowView[];
  view: CandidatesView;
  onOpen: OnCandidateOpen;
}): ReactElement | null {
  if (answered.length === 0) {
    return null;
  }
  return (
    <details className="mt-2">
      <summary className="cursor-pointer text-[0.86rem]">
        <b>Already ruled</b> <span className={SMALL}>{answered.length}</span>
      </summary>
      {answered.map((one) => (
        <details key={one.id} className="mt-[0.3rem] text-[0.84rem]">
          <summary className="cursor-pointer">
            {candidateHeading({ candidate: one })} <span className={SMALL}>· {answeredLine({ candidate: one })}</span>
            {one.reactedIso === null ? null : (
              <span className={SMALL}> · {shortDate({ date: one.reactedIso.slice(0, 10) })}</span>
            )}
          </summary>
          <CandidateCard candidate={one} view={view} onOpen={onOpen} />
        </details>
      ))}
    </details>
  );
}

/**
 * The section once the reading is in. The candidate the owner last touched or opened that is still open is the page's open
 * item, `candidate:<id>`, so a word in the call names it; folding the section takes every candidate back out.
 *
 * @returns the fold
 */
function Fold({
  view,
  foldRef,
}: {
  view: CandidatesView;
  foldRef: RefObject<HTMLDetailsElement | null>;
}): ReactElement {
  const [single, setSingle] = useState(false);
  const [touched, setTouched] = useState<readonly string[]>([]);
  const onOpen: OnCandidateOpen = ({ key, open }) => {
    setTouched((previous) => {
      const others = previous.filter((each) => each !== key);
      return open ? [...others, key] : others;
    });
  };
  const drawn = touched.filter((key) => view.candidates.some((one) => `candidate:${one.id}` === key));
  const about = drawn.at(-1);
  const openCandidate = view.candidates.find((one) => `candidate:${one.id}` === about);
  usePageReading({
    open: about,
    openTitle: openCandidate === undefined ? undefined : candidateHeading({ candidate: openCandidate }),
    shows: {
      open:
        openCandidate === undefined
          ? null
          : {
              heading: candidateHeading({ candidate: openCandidate }),
              outcome: openCandidate.outcome,
              reaction: openCandidate.reaction,
            },
      summary: candidatesSummary({ view }),
    },
  });
  const { answered } = partitionCandidates({ candidates: view.candidates });
  return (
    <details
      className={FOLD}
      ref={foldRef}
      onToggle={(event) => {
        if (!event.currentTarget.open) {
          setTouched([]);
        }
      }}
    >
      <summary className="cursor-pointer">
        <b>Proposed workstreams</b>{" "}
        <span className="text-[0.85rem] text-muted-foreground">{candidatesSummary({ view })}</span>
      </summary>
      <p className="mt-[0.5rem] mb-0 text-[0.86rem]">
        Accept each as a workstream, done meaning the definition you pick. Every answer is kept and teaches the next
        one.
      </p>
      <p className={cn(SMALL, "mt-[0.2rem] mb-0")}>{provenanceLine({ view })}</p>
      <div className="my-[0.5rem] flex gap-1" role="group" aria-label="how to go through them">
        <button
          type="button"
          aria-pressed={!single}
          className={cn(single ? BUTTON : BUTTON_PRIMARY, SMALL_BUTTON)}
          onClick={() => {
            setSingle(false);
          }}
        >
          A few at a time
        </button>
        <button
          type="button"
          aria-pressed={single}
          className={cn(single ? BUTTON_PRIMARY : BUTTON, SMALL_BUTTON)}
          onClick={() => {
            setSingle(true);
          }}
        >
          One at a time
        </button>
      </div>
      {single ? <OneByOne view={view} onOpen={onOpen} /> : <FewFirst view={view} onOpen={onOpen} />}
      <Ruled answered={answered} view={view} onOpen={onOpen} />

      <Proposals view={view} />
    </details>
  );
}

/**
 * The Proposed workstreams section, read live.
 *
 * @returns the section in whichever state the reading is, always under the `#candidates` anchor
 */
export function WorkstreamCandidates(): ReactElement {
  const state = useLive<CandidatesView>({
    read: (payload) => readWorkstreamCandidates({ payload }),
    slug: CANDIDATES_SLUG,
  });
  // Folded by default, opened ONCE when the address names it, so `/workstreams#candidates` lands on the list itself.
  // Opened on the element rather than through state: after that first landing the fold is the owner's to open and close.
  const foldRef = useRef<HTMLDetailsElement>(null);
  const landed = useRef(false);
  useEffect(() => {
    if (landed.current || state.phase !== "ready") {
      return;
    }
    landed.current = true;
    if (window.location.hash === `#${ANCHOR}` && foldRef.current !== null) {
      foldRef.current.open = true;
    }
  }, [state.phase]);
  // There is no "nothing mined yet" state: the owner's stated outcomes are always proposed, so a fresh install reads ready
  // with those, and anything else not ready is a failed read.
  let body: ReactElement;
  if (state.phase !== "ready") {
    body = <ReadStandIn state={state} subject="the proposed workstreams" block />;
  } else {
    body = (
      <>
        <ReadMark state={state} subject="The proposed workstreams" row />
        <Fold view={state.value} foldRef={foldRef} />
      </>
    );
  }
  return (
    <section id={ANCHOR} className="scroll-mt-4">
      {body}
    </section>
  );
}
