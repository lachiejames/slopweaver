"use client";

/**
 * The open half of an Automations card: the controls that speak to the supervisor, the requests already sent and
 * what the owner answered, the row's dated timeline, and what each recent firing posted or filed.
 *
 * **Nothing here mutates a recipe**, and nothing here takes words: the
 * console's one text input is the call's chat, so the owner says what should change there, and an open
 * card is the page's open item, carrying its `recipe:<id>`. What the owner asked then shows here as "request sent to
 * supervisor" with its moment, and the supervisor's recorded answer lands beside it.
 *
 * Every field is `automation status --json`'s (`src/automations/outputs.ts`, `src/automations/steering.ts`).
 */
import type { ReactElement } from "react";

import { ageOf } from "../../lib/ageOf";
import { readerTimeZone } from "../../lib/dateTimeFormat";
import { firingBullets, type RunBullet, type RunTone, syncRunBullets } from "../../lib/runTimeline";
import { RawFold } from "../console/RawFold";
import { StaleMark } from "../console/StaleMark";
import { ROW_DETAIL } from "./Row";
import type { AutomationOutputs, Finding, FiringAfter, Posting, Steer, TimelineEntry } from "./readAutomationDetail";
import type { Automation } from "./readAutomationsCard";

/** A card opening or folding, so the page knows which open card a word in the call is about. */
export type OnAutomationOpen = (change: { readonly about: string; readonly open: boolean }) => void;

/** A section heading inside an open card. */
export const DETAIL_HEAD = "m-0 mt-2 text-[0.74rem] font-semibold text-muted-foreground uppercase tracking-[0.04em]";

/** An instant as a reader scans it: date and minute, UTC said. */
function at({ iso }: { iso: string }): string {
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)}Z`;
}

/** A filed row's settlement once it has one, else its board status. */
function findingState({ finding }: { finding: Finding }): string {
  if (finding.settlement === undefined) {
    return finding.status;
  }
  return finding.settlement;
}

/** Where a firing posted. Slack's own link needs a workspace this machine does not store, so it is the channel and ts. */
function postingWords({ posting }: { posting: Posting }): string {
  return `posted to ${posting.channel} at ${at({ iso: posting.postedAtIso })} (ts ${posting.ts})`;
}

/**
 * The reader's own IANA zone — every clock on the card is said in it, and never named.
 *
 * @returns the zone the owner's browser reports
 */
export function readerZone(): string {
  return readerTimeZone();
}

/** A run's dot colour: a failure stands out in red at a glance. */
const RUN_DOT: Readonly<Record<RunTone, string>> = {
  failed: "bg-danger",
  ok: "bg-success",
  running: "bg-info",
  waited: "bg-muted-foreground",
};

/**
 * One run on the timeline: when, whether it failed, how long it took, what it pulled in — kind by kind and team by
 * team on hover, dotted so it reads as hoverable — and its error.
 */
function RunDot({ bullet }: { bullet: RunBullet }): ReactElement {
  const failed = bullet.tone === "failed";
  return (
    <li className="relative pb-[0.55rem] pl-4">
      <span className={`absolute top-[0.45em] -left-[6px] size-[10px] rounded-full ${RUN_DOT[bullet.tone]}`} />
      <span className="inline-block min-w-[9.5rem] text-muted-foreground tabular-nums">{bullet.when}</span>
      <b className={failed ? "text-danger" : ""}>{bullet.headline}</b>
      {bullet.took === undefined ? "" : ` · ${bullet.took}`}
      {bullet.pulled === undefined ? "" : " · "}
      {bullet.pulled === undefined ? null : (
        <span
          className={
            bullet.pulledDetail === undefined ? "" : "cursor-help underline decoration-dotted underline-offset-2"
          }
          title={bullet.pulledDetail}
        >
          {bullet.pulled}
        </span>
      )}
      {bullet.error === undefined ? null : (
        <>
          <br />
          <span className="text-danger">{bullet.error}</span>
        </>
      )}
      {bullet.errorDetail === undefined ? null : <RawFold raw={bullet.errorDetail} />}
    </li>
  );
}

/**
 * The row's recent runs as a timeline the owner scans: one dot per run, newest first, a failure in red. A sync row reads its
 * sync runs, which say what each stored; any other row reads its firings, and what each posted or filed.
 *
 * @param nowIso the page's reading instant, which decides "today"
 * @returns the timeline, or nothing for a row with no run on record
 */
export function RecentRuns({ automation, nowIso }: { automation: Automation; nowIso: string }): ReactElement | null {
  const timeZone = readerZone();
  const bullets =
    automation.syncRuns.length > 0
      ? syncRunBullets({ nowIso, runs: automation.syncRuns, timeZone })
      : firingBullets({
          firings: automation.recentFirings,
          nowIso,
          outputs: automation.outputs.firings,
          timeZone,
        });
  if (bullets.length === 0) {
    return null;
  }
  return (
    <>
      <h4 className={DETAIL_HEAD}>Recent runs</h4>
      <ol className="my-[0.4rem] list-none border-y-0 border-r-0 border-l-2 border-solid border-border p-0 text-[0.76rem]">
        {bullets.map((bullet) => (
          <RunDot bullet={bullet} key={bullet.key} />
        ))}
      </ol>
    </>
  );
}

/**
 * How to steer the card: in the call, with the card open — and what is already waiting on the supervisor.
 *
 * @returns the line, or the reason this row cannot be steered from its card
 */
export function SteerNote({ automation }: { automation: Automation }): ReactElement {
  const { key, keyRefusal, unanswered, nextFiringIso } = automation.steering;
  const unread = automation.steering.steers.flatMap((steer) =>
    steer.answerUnreadable === undefined
      ? []
      : [{ subject: `the answer to your request of ${at({ iso: steer.sentAtIso })}`, why: steer.answerUnreadable }],
  );
  if (key === undefined) {
    return <p className="m-0 text-[0.74rem] text-warning">{keyRefusal}</p>;
  }
  const next =
    nextFiringIso === undefined
      ? "it has no next firing on its own cadence"
      : `next firing ${at({ iso: nextFiringIso })}`;
  return (
    <p className="m-0 text-[0.72rem] text-muted-foreground">
      Say what should change (disable it, run it now, a new cadence) aloud or in the call&apos;s chat while this card is
      open; nothing here changes the row itself.{" "}
      <span className={unanswered > 0 ? "text-warning" : ""}>
        {unanswered} request{unanswered === 1 ? "" : "s"} awaiting an answer · {next}
      </span>
      {/* An answer that would not read may be one more awaiting, so the count is marked short, each on hover. */}
      {unread.length > 0 && (
        <>
          {" "}
          <StaleMark facts={unread} />
        </>
      )}
    </p>
  );
}

/** What became of a request: its answer, the board saying none will land, a staleness mark, or still awaited. */
function AnswerOf({ steer }: { steer: Steer }): ReactElement {
  if (steer.answer !== undefined) {
    const witness = steer.answer.witness === undefined ? "" : `: ${steer.answer.witness}`;
    return <span className="text-success">answered: {`${steer.answer.settlement}${witness}`}</span>;
  }
  if (steer.answerUnreadable !== undefined) {
    return <StaleMark facts={[{ subject: "the supervisor's answer", why: steer.answerUnreadable }]} />;
  }
  if (steer.boardRowMissing) {
    return <span className="text-warning">no board row holds {steer.slug}, so no answer will land here</span>;
  }
  return <span className="text-warning">awaiting the supervisor&apos;s answer</span>;
}

/** One request and what became of it. */
function SteerLine({ steer }: { steer: Steer }): ReactElement {
  const delivered =
    steer.delivery === undefined ? "no chat delivery attempted" : `${steer.delivery.kind}: ${steer.delivery.detail}`;
  return (
    <li>
      <b>request sent to supervisor</b> {at({ iso: steer.sentAtIso })} ({ageOf({ iso: steer.sentAtIso })}): “
      {steer.words}”
      <br />
      <span className="text-muted-foreground">{delivered}</span> · <AnswerOf steer={steer} />
    </li>
  );
}

/**
 * The requests sent about this row, newest first, each with the supervisor's recorded answer.
 *
 * @returns the list, or one line saying none was sent
 */
export function Steers({ steers, gap }: { steers: readonly Steer[]; gap: string | undefined }): ReactElement {
  if (steers.length === 0 && gap !== undefined) {
    return <GapNote gap={gap} />;
  }
  if (steers.length === 0) {
    return (
      <p className="m-0 text-[0.74rem] text-muted-foreground">
        No request has been sent to the supervisor about this row.
      </p>
    );
  }
  return (
    <>
      {gap === undefined ? null : <GapNote gap={gap} />}
      <ul className={ROW_DETAIL}>
        {steers.map((steer) => (
          <SteerLine key={steer.turnId} steer={steer} />
        ))}
      </ul>
    </>
  );
}

/**
 * A store this section reads that would not read whole — a staleness mark whose hover says why, so its absence never
 * reads as "nothing happened" and is never a sentence either.
 */
function GapNote({ gap }: { gap: string }): ReactElement {
  return <StaleMark facts={[{ subject: "a store this section reads", why: gap }]} className="self-start" />;
}

/** What the first firing after an entry did; a posting record that would not read is a staleness mark in its place. */
function AfterWords({ after }: { after: FiringAfter | undefined }): ReactElement {
  if (after === undefined) {
    return <>no firing since</>;
  }
  const head = `next firing ${at({ iso: after.startedAtIso })}: ${after.outcome}`;
  if (after.posting !== undefined) {
    return <>{`${head}, ${postingWords({ posting: after.posting })}`}</>;
  }
  if (after.postingUnreadable !== undefined) {
    return (
      <>
        {head} <StaleMark facts={[{ subject: "what it posted", why: after.postingUnreadable }]} />
      </>
    );
  }
  return <>{head}</>;
}

/** A timeline entry's head: a steer, or which record dates the row's earliest trace. */
function headOf({ entry }: { entry: TimelineEntry }): string {
  if (entry.kind === "steer") {
    return "steer";
  }
  if (entry.earliestFrom === "file-born") {
    return "row file created";
  }
  return "earliest firing on record";
}

/** One dated dot on the timeline. */
function TimelineDot({ entry }: { entry: TimelineEntry }): ReactElement {
  const stated = entry.kind === "stated";
  return (
    <li className="relative pb-[0.55rem] pl-4">
      <span
        className={`absolute top-[0.45em] -left-[6px] size-[10px] rounded-full ${stated ? "bg-muted-foreground" : "bg-primary"}`}
      />
      <span className="inline-block min-w-[8.5rem] text-muted-foreground tabular-nums" title={entry.atIso}>
        {at({ iso: entry.atIso })}
      </span>
      <b>{headOf({ entry })}</b>: {stated ? `reads now: ${entry.text}` : entry.text}
      <br />
      <span className="text-muted-foreground">
        <AfterWords after={entry.firingAfter} />
        {entry.rowEditedAfterIso === undefined ? "" : ` · row edited ${at({ iso: entry.rowEditedAfterIso })}`}
      </span>
    </li>
  );
}

/**
 * The row's dated story: its earliest trace and which record dates it, beside its wording now, each steer since, and
 * after each what the next firing did and whether the row was edited. It puts the evidence beside a steer; it never
 * claims a cause.
 *
 * @returns the timeline
 */
export function Timeline({
  timeline,
  gap,
}: {
  timeline: readonly TimelineEntry[];
  gap: string | undefined;
}): ReactElement {
  if (timeline.length === 0 && gap !== undefined) {
    return <GapNote gap={gap} />;
  }
  if (timeline.length === 0) {
    return <p className="m-0 text-[0.74rem] text-muted-foreground">No record dates this row, and no steer was sent.</p>;
  }
  return (
    <>
      {gap === undefined ? null : <GapNote gap={gap} />}
      <ol className="my-[0.4rem] list-none border-y-0 border-r-0 border-l-2 border-solid border-border p-0 text-[0.76rem]">
        {timeline.map((entry) => (
          <TimelineDot entry={entry} key={`${entry.kind}-${entry.atIso}`} />
        ))}
      </ol>
    </>
  );
}

/**
 * What the row produced: per recent firing its posting or why there is none, the finding a failure filed, and the
 * readings and floating notes it left.
 *
 * @returns the section
 */
export function Outputs({ outputs }: { outputs: AutomationOutputs }): ReactElement {
  return (
    <>
      {outputs.storeGap === undefined ? null : <GapNote gap={outputs.storeGap} />}
      {outputs.postingsNote === undefined ? null : (
        <p className="m-0 text-[0.74rem] text-muted-foreground">{outputs.postingsNote}</p>
      )}
      <ul className={ROW_DETAIL}>
        {outputs.firings.map((firing) => {
          const posted = firing.posting === undefined ? firing.postingNote : postingWords({ posting: firing.posting });
          let found: string | undefined;
          if (firing.finding !== undefined) {
            const settled = findingState({ finding: firing.finding });
            const summary = firing.finding.summary === undefined ? "" : `: ${firing.finding.summary}`;
            found = `filed ${firing.finding.slug} (${settled})${summary}`;
          }
          // A record that would not read is a staleness mark in its slot, never its why as a sentence.
          const unread = [
            ...(firing.postingUnreadable === undefined
              ? []
              : [{ subject: "what it posted", why: firing.postingUnreadable }]),
            ...(firing.findingNote === undefined ? [] : [{ subject: "the finding it filed", why: firing.findingNote }]),
          ];
          return (
            <li key={firing.slotIso}>
              {at({ iso: firing.slotIso })}
              {posted === undefined ? "" : ` · ${posted}`}
              {found === undefined ? "" : ` · ${found}`}
              {unread.length > 0 && (
                <>
                  {" "}
                  <StaleMark facts={unread} />
                </>
              )}
            </li>
          );
        })}
        {outputs.readings.map((reading) => (
          <li key={`${reading.atIso}-${reading.file}`}>
            {at({ iso: reading.atIso })} · reading {reading.file} by {reading.producer} (
            {reading.bytes.toLocaleString()} bytes)
          </li>
        ))}
        {outputs.notes.map((note) => (
          <li key={`${note.atIso}-${note.what}`}>
            {at({ iso: note.atIso })} · floating note: {note.what}
            {note.url === undefined ? null : (
              <>
                {" "}
                <a href={note.url} className="underline">
                  open
                </a>
              </>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}
