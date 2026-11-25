/**
 * The top of the Fleet page's agents tile: the state badge, the working count with the parked rows under it, the
 * defence, the `fleet why` sentences, the history fold and the plans' usage.
 */
import { type ReactElement, type ReactNode } from "react";

import { ageOf } from "../../lib/ageOf";
import { type FleetHistory } from "../../lib/fleetHistory";
import { type FleetDefence, type FleetInvestigation, type FleetState, type FleetStateKind } from "../../lib/fleetState";
import { type ParkedWaits } from "../../lib/parkedWaits";
import { type FleetUsage } from "../../lib/planMeters";
import { type RaiseRecord } from "../../lib/planUsageLimit";
import { cn } from "../../lib/utils";
import { HistoryFold } from "./HistoryFold";
import { PlanUsage } from "./PlanMeters";
import { ReadingAge } from "./ReadingAge";
import { type FleetWhy } from "./readGlance";
import { type CpuConsumer, type MemoryConsumer } from "./readNow";
import { type LiveState } from "./useLive";

/**
 * The last segment of a path — a seat's worktree directory is named for the work in it.
 *
 * @returns the segment, or the whole path when it has no separator
 */
function lastSegment({ path }: { path: string }): string {
  const parts = path.split("/").filter((part) => part !== "");
  const last = parts.at(-1);
  if (last === undefined) {
    return path;
  }
  return last;
}

/** Each state's badge colour: green when the fleet is using what it has, grey when held, amber when unmeasured. */
const STATE_TONE: Readonly<Record<FleetStateKind, string>> = {
  "at-capacity": "bg-success/15 text-success",
  "holding-board": "bg-muted text-muted-foreground",
  "holding-machine": "bg-muted text-muted-foreground",
  "holding-pace": "bg-muted text-muted-foreground",
  "holding-plans": "bg-muted text-muted-foreground",
  "not-measured": "bg-warning/15 text-warning",
  "picking-up": "bg-success/15 text-success",
};

/** The defence's small uppercase label, the Queue card source block's. */
const DEFENCE_LABEL = "m-0 text-[0.68rem] font-bold tracking-[0.06em] text-muted-foreground uppercase";

/**
 * One CPU consumer as a reader names it.
 *
 * @returns the phrase
 */
function cpuWords({ consumer }: { consumer: CpuConsumer }): string {
  return `${consumer.label} ${String(Math.round(consumer.cpuPct))}% cpu (${consumer.classification}, pid ${String(consumer.pid)})`;
}

/**
 * One memory consumer as a reader names it.
 *
 * @returns the phrase
 */
function memoryWords({ consumer }: { consumer: MemoryConsumer }): string {
  const where = consumer.sessionCwd === undefined ? "" : ` · ${lastSegment({ path: consumer.sessionCwd })}`;
  return `${consumer.label} ${String(consumer.footprintGb)} GB (${consumer.classification}, pid ${String(consumer.pid)})${where}`;
}

/** The investigation line, or nothing when the state is not a machine hold. */
function InvestigationLine({ investigation }: { investigation: FleetInvestigation }): ReactNode {
  if (investigation.kind === "not-applicable") {
    return null;
  }
  if (investigation.kind === "active") {
    return (
      <p className="m-0 text-[0.86rem]" data-investigation="active">
        Investigating since {ageOf({ iso: investigation.startedIso })}: <strong>{investigation.session}</strong> has it.
      </p>
    );
  }
  return (
    <p className="m-0 text-[0.86rem]" data-investigation={investigation.kind}>
      {investigation.why.charAt(0).toUpperCase()}
      {investigation.why.slice(1)}.
    </p>
  );
}

/**
 * The defence: why the fleet runs what it runs, shaped like a Queue card's quote block — the figures, the top three
 * consumers on a machine hold, the investigation, and the rest folded.
 *
 * @returns the block
 */
function DefenceBlock({ defence }: { defence: FleetDefence }): ReactElement {
  const folded = [
    ...(defence.cpu === undefined ? [] : defence.cpu.folded.map((consumer) => cpuWords({ consumer }))),
    ...(defence.memory === undefined ? [] : defence.memory.folded.map((consumer) => memoryWords({ consumer }))),
  ];
  return (
    <section data-defence className="grid gap-1 rounded-r-md border-l-[3px] border-primary/70 bg-primary/5 px-3 py-2">
      <h4 className={DEFENCE_LABEL}>why not more</h4>
      <p className="m-0 text-[0.92rem] leading-[1.45]">{defence.headline}</p>
      <ul className="m-0 grid list-none gap-0.5 p-0 text-[0.8rem] text-muted-foreground">
        {defence.measurements.map((line) => (
          <li key={line}>{line}</li>
        ))}
        {defence.readAtIso !== undefined && <li>read {ageOf({ iso: defence.readAtIso })}</li>}
      </ul>
      {defence.cpu !== undefined && defence.cpu.shown.length > 0 && (
        <p className="m-0 text-[0.84rem]">
          <span className="text-muted-foreground">heaviest by cpu: </span>
          {defence.cpu.shown.map((consumer) => cpuWords({ consumer })).join(" · ")}
        </p>
      )}
      {defence.memory !== undefined && defence.memory.shown.length > 0 && (
        <p className="m-0 text-[0.84rem]">
          <span className="text-muted-foreground">heaviest by memory: </span>
          {defence.memory.shown.map((consumer) => memoryWords({ consumer })).join(" · ")}
        </p>
      )}
      <InvestigationLine investigation={defence.investigation} />
      {(folded.length > 0 || defence.investigation.kind === "active") && (
        <details className="text-[0.8rem]">
          <summary className="cursor-pointer text-muted-foreground">more</summary>
          <ul className="m-0 mt-1 grid list-none gap-0.5 p-0">
            {defence.investigation.kind === "active" && (
              <li>
                what raised it: {defence.investigation.why} (row {defence.investigation.slug})
              </li>
            )}
            {folded.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

/**
 * The board rows parked on a clock or CI, as the state band holds them: still loading, not read (a failed first read,
 * or a fixture's frozen seats, which never join this machine's live board), or read.
 */
export type ParkedBandState =
  | { readonly kind: "loading" }
  | { readonly kind: "unread" }
  | {
      readonly kind: "ready";
      readonly value: ParkedWaits;
      /** When the board the parked rows come off was read: it is read once, so the band carries its own age. */
      readonly readAtIso: string;
      /**
       * When the tick's wake read each CI park's pull request, or `undefined` when no wake reading is in hand — the
       * CI parks are then said only as "on CI no wake reading has measured", and the band says their pull requests were not read.
       */
      readonly wakeReadAtIso: string | undefined;
    };

/**
 * The work the working count leaves out: how many rows are parked on CI or a clock and when the next one wakes, one
 * sentence per line, with each row behind a closed fold. Nothing while the board loads or when none is parked.
 * Every word is `lib/parkedWaits.ts`'s. The board is read once while the rest of the tile polls, so the count carries
 * the board's own age beside it rather than borrowing the tile's fresher stamp.
 *
 * @returns the lines, or nothing
 */
function ParkedBand({ parked }: { parked: ParkedBandState }): ReactNode {
  if (parked.kind === "loading") {
    return null;
  }
  if (parked.kind === "unread") {
    return (
      <p className="m-0 text-muted-foreground" data-parked="unread">
        Whether any rows are parked on CI or a clock was not read.
      </p>
    );
  }
  if (parked.value.waits.length === 0) {
    return null;
  }
  return (
    <div className="flex flex-col gap-[0.25rem]" data-parked="read">
      {parked.value.lines.map((line) => (
        <p className="m-0" key={line}>
          {line}
        </p>
      ))}
      <p className="m-0 text-[0.76rem] text-muted-foreground">
        board read <ReadingAge iso={parked.readAtIso} />
        {parked.wakeReadAtIso === undefined ? (
          <span data-wake="unread"> · whether each pull request is still open was not read</span>
        ) : (
          <span data-wake="read">
            {" "}
            · pull requests read by the last wake <ReadingAge iso={parked.wakeReadAtIso} />
          </span>
        )}
      </p>
      <details className="text-[0.84rem] [&>summary]:cursor-pointer">
        <summary className="text-muted-foreground">what each waits on</summary>
        <ul className="m-0 mt-1 grid list-none gap-0.5 p-0">
          {parked.value.waits.map((wait) => (
            <li key={wait.key}>
              <strong className="font-semibold">{wait.title}</strong>: {wait.detail}
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}

/**
 * The top of the page: the state badge, the working count with one sentence per line under it, the defence under that,
 * its history folded, then the plans' usage lines. A not-measured state is the one exception: its badge and reason on
 * a single line, and no defence. Every word is `lib/fleetState.ts`'s, which words
 * `lib/fleetGlance.ts`'s judgement.
 *
 * @returns the band
 */
export function StateBand({
  state,
  usage,
  history,
  badgeReadAtIso,
  why,
  unread,
  parked,
  raises,
  usageReadAtIso,
}: {
  state: FleetState;
  /** When the supervisor took the capacity reading the plans' usage comes from, when one is held. */
  usageReadAtIso: string | undefined;
  /** The readings the page pressed a raise from, kept above the plan rows a press can unmount. */
  raises: RaiseRecord;
  /** The rows parked on CI or a clock, drawn under the working count in both arms: the board reads on its own. */
  parked: ParkedBandState;
  usage: FleetUsage;
  history: LiveState<FleetHistory>;
  /** The instant the badge's facts were read at, for the fold to say when it is behind them. */
  badgeReadAtIso: string;
  /** The tick's `fleet why` sentences, when its reading belongs to the capacity reading the badge judged. */
  why: FleetWhy | undefined;
  /**
   * The spinner or staleness mark in the judgement's place when it is "not measured" only because a reading it stands
   * on is not in hand — the badge, the sentence after the count and the defence would all say so in words.
   */
  unread: ReactElement | null;
}): ReactElement {
  if (unread !== null) {
    return (
      <div className="flex flex-col gap-[0.5rem]" data-state="unread">
        <div>{unread}</div>
        <div className="flex flex-col gap-[0.25rem] text-[1rem] leading-[1.45]">
          <p className="m-0">
            <strong className="text-[1.15rem] font-semibold">{state.sentence.lead}</strong>
          </p>
          <ParkedBand parked={parked} />
        </div>
        <HistoryFold badgeReadAtIso={badgeReadAtIso} history={history} />
        <PlanUsage usage={usage} record={raises} readAtIso={usageReadAtIso} />
      </div>
    );
  }
  // Every reading answered and the judgement still could not be made: the badge and its reason on one line, said once.
  // The sentence lines, "why not more" and the `fleet why` lines each said it again, so none is drawn here.
  if (state.notMeasuredReason !== undefined) {
    return (
      <div className="flex flex-col gap-[0.5rem]" data-state={state.kind}>
        <p className="m-0 flex flex-wrap items-baseline gap-x-[0.5rem] text-[0.95rem]" data-not-measured>
          <strong
            className={cn("rounded-[6px] px-[0.5rem] py-[0.1rem] text-[0.95rem] font-semibold", STATE_TONE[state.kind])}
          >
            {state.badge}
          </strong>
          <span>{state.notMeasuredReason}</span>
        </p>
        <div className="flex flex-col gap-[0.25rem] text-[1rem] leading-[1.45]">
          <p className="m-0">
            <strong className="text-[1.15rem] font-semibold">{state.sentence.lead}</strong>
          </p>
          <ParkedBand parked={parked} />
        </div>
        <HistoryFold badgeReadAtIso={badgeReadAtIso} history={history} />
        <PlanUsage usage={usage} record={raises} readAtIso={usageReadAtIso} />
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-[0.5rem]" data-state={state.kind}>
      <div>
        <strong
          className={cn("rounded-[6px] px-[0.5rem] py-[0.1rem] text-[0.95rem] font-semibold", STATE_TONE[state.kind])}
        >
          {state.badge}
        </strong>
      </div>
      <div className="flex flex-col gap-[0.25rem] text-[1rem] leading-[1.45]">
        <p className="m-0">
          <strong className="text-[1.15rem] font-semibold">{state.sentence.lead}</strong>
        </p>
        {state.sentence.lines.map((line, index) => (
          <p className="m-0" key={`${String(index)}:${line}`}>
            {line}
          </p>
        ))}
        <ParkedBand parked={parked} />
      </div>
      <DefenceBlock defence={state.defence} />
      {why !== undefined && <WhyLines why={why} />}
      <HistoryFold badgeReadAtIso={badgeReadAtIso} history={history} />
      <PlanUsage usage={usage} record={raises} readAtIso={usageReadAtIso} />
    </div>
  );
}

/**
 * Why the fleet is not running more working seats: what binds it now in the open, and what the machine measured over
 * the window folded behind its own label — the tick's `fleet why` sentences, exactly as the verb prints them.
 */
function WhyLines({ why }: { why: FleetWhy }): ReactElement {
  const [binding, ...measured] = why.sentences;
  return (
    <>
      <p className="text-[0.78rem]">{binding}</p>
      {measured.length > 0 && (
        <details className="text-[0.78rem] text-muted-foreground [&>summary]:cursor-pointer">
          <summary>what the machine measured, last {String(why.minutes)} min</summary>
          {measured.map((sentence) => (
            <p key={sentence}>{sentence}</p>
          ))}
        </details>
      )}
    </>
  );
}
