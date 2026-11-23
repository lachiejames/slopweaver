"use client";

/**
 * One proposed workstream as a card: its head and the six one-press words always in view, and behind the fold the
 * dated quotes of the person's own words that are its evidence, the earlier steers it answers, what looks stalled,
 * the definitions of done to pick from, who the first conversation is with, and every other answer the tile takes
 * (`./CandidateAnswers.tsx`).
 *
 * The question the card asks is one sentence — accept this as a workstream, done meaning what you picked — so a
 * definition chosen here is pressed BEFORE the word it goes with (`definePress`), and the yes carries it onto the
 * new tile. Every figure is the verb's; this file only draws.
 */
import { type ReactElement, useState } from "react";

import { cn } from "../../lib/utils";
import {
  answeredLine,
  candidateHeading,
  candidatePeriod,
  type DefinitionChoice,
  definePress,
  standingChoice,
} from "../../lib/workstreamCandidatesPage";
import {
  type CandidateRowView,
  type CandidatesView,
  LENS_LABEL,
  PRESS_LABEL,
  PRESS_REACTIONS,
  type PressReaction,
} from "../../lib/workstreamCandidatesTypes";
import { shortDate } from "../../lib/workstreamTiles";
import { BUTTON, BUTTON_PRIMARY, CHIP } from "../console/controls";
import { Outcome } from "../console/press";
import { CandidateAnswers, FIELD, Line, SMALL } from "./CandidateAnswers";
import { useCandidatePress } from "./candidatePress";

/** The words whose press may add or change a register tile, so the tiles below are re-read after one. */
const MOVES_TILES: ReadonlySet<PressReaction> = new Set<PressReaction>(["yes", "done"]);

/**
 * One cited line in the person's own words: its date, the quote verbatim, and the link — or, for a line said in a
 * session, the anchor naming where.
 *
 * @returns the list item
 */
function Quote({ line }: { line: CandidateRowView["evidence"][number] }): ReactElement {
  return (
    <li className="my-[0.2rem] text-[0.86rem]">
      <span className="inline-block min-w-[4.2rem] text-muted-foreground tabular-nums" title={line.date}>
        {shortDate({ date: line.date })}
      </span>
      “{line.quote}”{" "}
      {line.href === null ? (
        <code className="text-[0.76rem] text-muted-foreground">{line.anchor}</code>
      ) : (
        <a href={line.href} target="_blank" rel="noreferrer">
          source
        </a>
      )}
    </li>
  );
}

/**
 * The definitions of done to choose between: each offered option with what it is judged by, its trade-off and its
 * stretch rung; or all of them, then which comes first. A definition in the owner's own words is said in the call's chat — the
 * console's one text input.
 *
 * @returns the picker, or a line saying the mine offered none
 */
function DonePicker({
  candidate,
  choice,
  onChoice,
}: {
  candidate: CandidateRowView;
  choice: DefinitionChoice | null;
  onChoice: (next: DefinitionChoice) => void;
}): ReactElement {
  const name = `done-${candidate.id}`;
  const options = candidate.doneOptions;
  return (
    <fieldset className="my-[0.4rem] border-0 p-0">
      <legend className="text-[0.86rem] font-semibold">Done means…</legend>
      {options.map((option) => (
        <label key={option.id} className="my-[0.25rem] flex gap-2 text-[0.86rem]">
          <input
            type="radio"
            name={name}
            checked={choice !== null && choice.kind === "option" && choice.optionId === option.id}
            onChange={() => {
              onChoice({ kind: "option", optionId: option.id });
            }}
          />
          <span>
            {option.text} <span className={CHIP}>{LENS_LABEL[option.lens]}</span>
            <span className={SMALL}>
              {" "}
              · trade-off: {option.tradeoff}
              {option.stretch === null ? null : `; stretch: ${option.stretch}`}
            </span>
          </span>
        </label>
      ))}
      {options.length < 2 ? null : <AllOfThem candidate={candidate} choice={choice} name={name} onChoice={onChoice} />}
      {candidate.definition !== null && candidate.definition.kind === "words" && (
        <p className={SMALL}>
          Recorded in your words: {candidate.definition.text}
          {candidate.definition.stretch === null ? null : `; stretch: ${candidate.definition.stretch}`}
        </p>
      )}
      <p className={SMALL}>None of these? Say what done means in the call's chat.</p>
    </fieldset>
  );
}

/**
 * "All of the above", and once it is picked, the question it leaves: which of them comes first.
 *
 * @returns the option and its follow-up
 */
function AllOfThem({
  candidate,
  choice,
  name,
  onChoice,
}: {
  candidate: CandidateRowView;
  choice: DefinitionChoice | null;
  name: string;
  onChoice: (next: DefinitionChoice) => void;
}): ReactElement {
  const all = choice?.kind === "all" ? choice : null;
  return (
    <div className="my-[0.25rem] text-[0.86rem]">
      <label className="flex gap-2">
        <input
          type="radio"
          name={name}
          checked={all !== null}
          onChange={() => {
            onChoice({ first: null, kind: "all" });
          }}
        />
        All of the above
      </label>
      {all === null ? null : (
        <label className="mt-[0.2rem] ml-6 flex flex-wrap items-center gap-2">
          Which comes first?
          <select
            className={FIELD}
            // oxlint-disable-next-line prefer-nullish-coalescing -- house-rules bans `?? ""`; this ternary is the honest form
            value={all.first === null ? "" : all.first}
            onChange={(event) => {
              const first = event.target.value === "" ? null : event.target.value;
              onChoice({ first, kind: "all" });
            }}
          >
            <option value="">not said yet</option>
            {candidate.doneOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.text}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}

/**
 * The six one-press words, the standing one selected.
 *
 * @returns the button row
 */
function Words({
  current,
  busy,
  onWord,
}: {
  current: CandidateRowView["reaction"];
  busy: boolean;
  onWord: (word: PressReaction) => void;
}): ReactElement {
  return (
    <div className="flex shrink-0 flex-wrap gap-1" role="group" aria-label="your word on this candidate">
      {PRESS_REACTIONS.map((word) => {
        const selected = word === current;
        return (
          <button
            key={word}
            type="button"
            aria-pressed={selected}
            disabled={busy}
            className={cn(
              selected || word === "yes" ? BUTTON_PRIMARY : BUTTON,
              "px-[0.55rem] py-[0.15rem] text-[0.76rem]",
            )}
            onClick={() => {
              onWord(word);
            }}
          >
            {PRESS_LABEL[word]}
          </button>
        );
      })}
    </div>
  );
}

/**
 * The card's head: number, heading, how much evidence over what period, and where it stands.
 *
 * @returns the summary line
 */
function Head({ candidate }: { candidate: CandidateRowView }): ReactElement {
  return (
    <summary className="cursor-pointer text-[0.92rem]">
      <span className="text-muted-foreground tabular-nums">#{candidate.n}</span>{" "}
      <span className="font-[650]">{candidateHeading({ candidate })}</span>{" "}
      <span className={SMALL}>
        {candidatePeriod({ candidate })} · {candidate.evidenceCount} messages
      </span>{" "}
      {candidate.registerId === null ? null : (
        <span className={CHIP} data-tone="hot" title={candidate.registerId}>
          on the register
        </span>
      )}{" "}
      <span className={CHIP} data-tone={candidate.reaction === null ? undefined : "warn"}>
        {answeredLine({ candidate })}
      </span>
    </summary>
  );
}

/**
 * What the card shows behind its fold: the outcome, the evidence, the earlier steers and the stall.
 *
 * @returns the facts
 */
function Facts({ candidate }: { candidate: CandidateRowView }): ReactElement {
  return (
    <>
      {candidate.title === null ? null : <p className={SMALL}>Mined as “{candidate.name}”.</p>}
      <Line label="Outcome:">{candidate.outcome}</Line>
      <p className="mt-[0.4rem] mb-0 text-[0.84rem] font-semibold">In your own words</p>
      <ul className="my-[0.2rem] list-none p-0">
        {candidate.evidence.map((line, index) => (
          <Quote key={`${line.date}-${String(index)}`} line={line} />
        ))}
      </ul>
      {candidate.priorSteers.length === 0 ? null : (
        <>
          <p className="mt-[0.4rem] mb-0 text-[0.84rem] font-semibold">Your earlier steers</p>
          <ul className="my-[0.2rem] list-none p-0">
            {candidate.priorSteers.map((steer) => (
              <li key={`${steer.date}-${steer.anchor}`} className="my-[0.2rem] text-[0.86rem]">
                <span className="inline-block min-w-[4.2rem] text-muted-foreground tabular-nums">
                  {shortDate({ date: steer.date })}
                </span>
                {steer.text} <code className="text-[0.76rem] text-muted-foreground">{steer.anchor}</code>
              </li>
            ))}
          </ul>
        </>
      )}
      {candidate.stalled === null ? null : (
        <Line label="Looks stalled:">
          {candidate.stalled.what}, since {shortDate({ date: candidate.stalled.since })}
        </Line>
      )}
    </>
  );
}

/** A candidate card opening, folding or being touched, so the page knows which one a word in the call is about. */
export type OnCandidateOpen = (change: { readonly key: `candidate:${string}`; readonly open: boolean }) => void;

/**
 * One proposed workstream. Touching it or opening it makes it the page's open item and folding it takes it back out,
 * so what the owner says in the call's chat — the console's one text input — names this candidate.
 *
 * @param open draw it unfolded — the one-at-a-time view
 * @param onOpen told when the owner touches, opens or folds it
 * @returns the card
 */
export function CandidateCard({
  candidate,
  view,
  open = false,
  onOpen,
}: {
  candidate: CandidateRowView;
  view: CandidatesView;
  open?: boolean;
  onOpen: OnCandidateOpen;
}): ReactElement {
  const key = `candidate:${candidate.id}` as const;
  const engage = (): void => {
    onOpen({ key, open: true });
  };
  const { state, run } = useCandidatePress();
  const [choice, setChoice] = useState<DefinitionChoice | null>(standingChoice({ candidate }));
  const busy = state.phase === "sending";
  const onWord = (word: PressReaction): void => {
    const first = definePress({ candidate, choice, word });
    const said = { slots: { candidate: candidate.id, reaction: word }, slug: "workstream-react" };
    run({ presses: [first, said], tiles: MOVES_TILES.has(word) });
  };
  return (
    <div
      className="border-x-0 border-t border-b-0 border-solid border-border py-[0.5rem] first:border-t-0"
      data-candidate={candidate.id}
      onFocusCapture={engage}
      onPointerDownCapture={engage}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <details
          className="min-w-[16rem] flex-1"
          open={open}
          onToggle={(event) => {
            onOpen({ key, open: event.currentTarget.open });
          }}
        >
          <Head candidate={candidate} />
          <div className="mt-[0.4rem] pl-4">
            <Facts candidate={candidate} />
            <DonePicker candidate={candidate} choice={choice} onChoice={setChoice} />
            <button
              type="button"
              className={cn(BUTTON, "px-[0.55rem] py-[0.15rem] text-[0.76rem]")}
              disabled={busy || definePress({ candidate, choice, word: null }) === null}
              onClick={() => {
                run({
                  presses: [definePress({ candidate, choice, word: null })],
                  tiles: candidate.registerId !== null,
                });
              }}
            >
              Record this definition
            </button>
            <CandidateAnswers candidate={candidate} view={view} busy={busy} run={run} choice={choice} />
          </div>
        </details>
        <Words current={candidate.reaction} busy={busy} onWord={onWord} />
      </div>
      <div className="mt-[0.3rem] flex flex-wrap">
        <Outcome state={state} />
      </div>
    </div>
  );
}
