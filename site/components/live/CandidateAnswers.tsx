"use client";

/**
 * Every answer a proposed workstream takes beyond the six one-press words
 * that a press can carry without the owner's typing: who the first conversation is with and the drafts it owes them;
 * the same as, a milestone of or an outcome of a workstream already on the register, which is listed beside the
 * picker; not mine, covered by one of them; and accepted as the answer to an earlier steer the owner gave.
 *
 * An answer that needs the owner's words — a title, whose it is, superseded by what, a proposal of the owner's own — has no box here:
 * the console's one text input is the call's chat: the app has no other text input, so the owner says it there and the supervisor runs the verb.
 *
 * Each control builds one press from `site/lib/workstreamCandidatesPage.ts` and runs it through the card's own
 * {@link useCandidatePress}; a press that is not complete enough for the verb to take is a disabled button, never a
 * refusal the owner has to read. Nothing here sends anything to anyone: a loop-in parks a draft on the owner's Queue.
 */
import { type ReactElement, type ReactNode, useState } from "react";

import { cn } from "../../lib/utils";
import {
  type DefinitionChoice,
  definePress,
  type PagePress,
  placingPress,
  steerWords,
} from "../../lib/workstreamCandidatesPage";
import type { CandidateRowView, CandidatesView } from "../../lib/workstreamCandidatesTypes";
import { BUTTON, CHIP } from "../console/controls";

/** A select, small enough to sit in a sentence. */
export const FIELD =
  "min-w-[10rem] flex-1 rounded-[6px] border border-solid border-border bg-(--c-bg) px-[0.45rem] py-[0.2rem] text-[0.82rem]";

/** Muted small print. */
export const SMALL = "text-[0.8rem] text-muted-foreground";

/** A small button beside a field. */
const ACT = cn(BUTTON, "px-[0.55rem] py-[0.15rem] text-[0.76rem]");

/** One labelled answer's row. */
const ROW = "my-[0.3rem] flex flex-wrap items-center gap-2 text-[0.84rem]";

/** The words that file a candidate against a register workstream, as the placing select offers them. */
const PLACING_WORDS = ["milestone-of", "outcome-of", "same-as"] as const;

/** How one answer reaches the card's press. */
type Run = (args: { presses: readonly (PagePress | null)[]; tiles: boolean }) => void;

/**
 * One labelled line, the way every line in an open card reads.
 *
 * @returns the paragraph
 */
export function Line({ label, children }: { label: string; children: ReactNode }): ReactElement {
  return (
    <p className="my-[0.3rem] text-[0.88rem]">
      <b>{label}</b> {children}
    </p>
  );
}

/**
 * A press button that is disabled until its press is complete.
 *
 * @returns the button
 */
function Press({
  label,
  press,
  busy,
  run,
  tiles = false,
  before = null,
}: {
  label: string;
  press: PagePress | null;
  busy: boolean;
  run: Run;
  tiles?: boolean;
  before?: PagePress | null;
}): ReactElement {
  return (
    <button
      type="button"
      className={ACT}
      disabled={busy || press === null}
      onClick={() => {
        run({ presses: [before, press], tiles });
      }}
    >
      {label}
    </button>
  );
}

/**
 * A picker over the register's workstreams, each named with its id, for a word that names one.
 *
 * @returns the select
 */
function RegisterSelect({
  view,
  value,
  onValue,
  label,
}: {
  view: CandidatesView;
  value: string;
  onValue: (next: string) => void;
  label: string;
}): ReactElement {
  return (
    <select
      className={FIELD}
      aria-label={label}
      value={value}
      onChange={(event) => {
        onValue(event.target.value);
      }}
    >
      <option value="">{label}</option>
      {view.register.map((entry) => (
        <option key={entry.id} value={entry.id}>
          {entry.name} ({entry.id})
        </option>
      ))}
    </select>
  );
}

/**
 * Who the first conversation is with, as people, apart from the team that owns it; and each person the mine says is
 * owed one, with the draft parked for them on the Queue.
 *
 * @returns the answer
 */
function WhoFirst({ candidate, busy, run }: { candidate: CandidateRowView; busy: boolean; run: Run }): ReactElement {
  const said = candidate.whoFirst;
  return (
    <div>
      <Line label="Who first:">
        {said === null ? <span className={SMALL}>not said yet</span> : said.people.join(", ")}
        {said === null || said.team === null ? null : <span className={SMALL}> · owning team: {said.team}</span>}
        {candidate.owningTeam === null ? null : (
          <span className={SMALL}>
            {" "}
            · the mine reads it as {candidate.owningTeam.name}’s ({candidate.owningTeam.why})
          </span>
        )}
      </Line>
      {candidate.loopIn.map((person) => (
        <div key={person.slack} className={ROW}>
          <span>
            <b>{person.name}</b>
            <span className={SMALL}>
              : {person.why}. “{person.opener}”
            </span>
          </span>
          {person.draftState === "none" ? (
            <Press
              label="Draft it on the Queue"
              press={{ slots: { candidate: candidate.id, person: person.slack }, slug: "workstream-loop-in" }}
              busy={busy}
              run={run}
            />
          ) : (
            <span className={CHIP} data-tone="hot">
              {person.draftState === "held" ? "drafted on the Queue, not sent" : "sent from the Queue"}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * The same as, a milestone of or an outcome of a register workstream.
 *
 * @returns the answer, or nothing while the register holds no workstream to name
 */
function Placing({
  candidate,
  view,
  busy,
  run,
}: {
  candidate: CandidateRowView;
  view: CandidatesView;
  busy: boolean;
  run: Run;
}): ReactElement | null {
  const [word, setWord] = useState<(typeof PLACING_WORDS)[number]>("milestone-of");
  const [target, setTarget] = useState("");
  if (view.register.length === 0) {
    return null;
  }
  return (
    <div className={ROW}>
      <select
        className={FIELD}
        aria-label="how it relates"
        value={word}
        onChange={(event) => {
          const picked = PLACING_WORDS.find((one) => one === event.target.value);
          if (picked !== undefined) {
            setWord(picked);
          }
        }}
      >
        <option value="milestone-of">a milestone of</option>
        <option value="outcome-of">an outcome of</option>
        <option value="same-as">the same as</option>
      </select>
      <RegisterSelect view={view} value={target} onValue={setTarget} label="which workstream" />
      <Press
        label="File it there"
        press={placingPress({ candidate, choice: { kind: word, target } })}
        busy={busy}
        run={run}
        tiles
      />
    </div>
  );
}

/**
 * Not mine, covered by a register workstream as a side effect; and accepted as the answer to a steer the owner already gave,
 * which carries the picked definition of done first like a plain accept.
 *
 * @returns the answers
 */
function NotMineOrSteer({
  candidate,
  view,
  busy,
  run,
  choice,
}: {
  candidate: CandidateRowView;
  view: CandidatesView;
  busy: boolean;
  run: Run;
  choice: DefinitionChoice | null;
}): ReactElement {
  const [coveredBy, setCoveredBy] = useState("");
  const [steer, setSteer] = useState(
    candidate.priorSteers.length === 0 ? "" : steerWords({ steer: candidate.priorSteers[0] }),
  );
  return (
    <>
      {view.register.length === 0 ? null : (
        <div className={ROW}>
          <RegisterSelect view={view} value={coveredBy} onValue={setCoveredBy} label="not mine: covered by" />
          <Press
            label="Not mine"
            press={placingPress({ candidate, choice: { coveredBy, kind: "not-mine" } })}
            busy={busy}
            run={run}
            tiles
          />
        </div>
      )}
      {candidate.priorSteers.length === 0 ? null : (
        <div className={ROW}>
          <select
            className={FIELD}
            aria-label="the steer it answers"
            value={steer}
            onChange={(event) => {
              setSteer(event.target.value);
            }}
          >
            {candidate.priorSteers.map((one) => (
              <option key={`${one.date}-${one.anchor}`} value={steerWords({ steer: one })}>
                {steerWords({ steer: one })}
              </option>
            ))}
          </select>
          <Press
            label="Accept, answering that steer"
            before={definePress({ candidate, choice, word: "yes" })}
            press={placingPress({ candidate, choice: { kind: "accept-steer", steer } })}
            busy={busy}
            run={run}
            tiles
          />
        </div>
      )}
    </>
  );
}

/**
 * Every answer beyond the one-press words.
 *
 * @returns the answers, behind their own fold
 */
export function CandidateAnswers({
  candidate,
  view,
  busy,
  run,
  choice,
}: {
  candidate: CandidateRowView;
  view: CandidatesView;
  busy: boolean;
  run: Run;
  choice: DefinitionChoice | null;
}): ReactElement {
  return (
    <>
      <WhoFirst candidate={candidate} busy={busy} run={run} />
      <details className="mt-[0.4rem]">
        <summary className="cursor-pointer text-[0.84rem] font-semibold">Other answers</summary>
        <Placing candidate={candidate} view={view} busy={busy} run={run} />
        <NotMineOrSteer candidate={candidate} view={view} busy={busy} run={run} choice={choice} />
      </details>
    </>
  );
}
