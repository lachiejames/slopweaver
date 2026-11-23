"use client";

/**
 * The Slack-steers chart on the Alignment page: what the owner has had to correct on Slack drafts written as them, one
 * line per kind, so a problem that has stopped shows as a line that went flat — beside the owner's own words.
 *
 * Three levels, with the charts the most prominent thing: ONE chart with a coloured line per kind, so the owner sees
 * what is most frequent now and what spiked; open it for one small chart per kind; open one of those for the owner's
 * dated words about that kind, each expandable to the whole turn. Drafts and quotes stay folded until the owner goes
 * looking. No threshold and no pass/fail colour: each kind says when it was last named and how long nothing has been
 * observed, and the owner's own word that it stopped is marked apart. The drafts the owner reviewed sit under every
 * chart as faint bars, so a quiet week reads as quiet rather than as better.
 *
 * Counts come from `slopweaver profile steers --json`; a session journals each read with `profile steers judge`.
 */

import { type ReactElement, useState } from "react";

import { readerTimeZone } from "../../lib/dateTimeFormat";
import { oldestReadingOf } from "../../lib/readingAge";
import {
  correctionsPerDay,
  KIND_COLOURS,
  kindState,
  kindStateLine,
  perDay,
  weekly,
  windowDays,
} from "../../lib/slackSteers";
import { cn } from "../../lib/utils";
import { ReadMark, ReadStandIn } from "../live/LiveMarks";
import { ReadingAge } from "../live/ReadingAge";
import { readDraftReviews, readSlackSteers, type SlackSteers, type SteerKindTrail } from "../live/readSlackSteers";
import { type LiveState, readyValueOf, useLive } from "../live/useLive";
import { BUTTON, CHIP } from "./controls";
import { StaleMark } from "./StaleMark";
import { WeeklyChart, type WeeklySeries } from "./WeeklyChart";

const CARD = "sw-glass-plane mb-3 rounded-[14px] border border-solid px-[1.1rem] py-[0.9rem]";

/** A date as the page prints it, a day number and a short month. */
function shortDay({ iso }: { iso: string }): string {
  return new Date(Date.parse(iso)).toLocaleDateString("en-AU", { day: "numeric", month: "short" });
}

/** The owner's browser's zone: the calendar their days are counted on. */
function ownerZone(): string {
  return readerTimeZone();
}

/** A kind's line on the chart, in its own colour. */
function seriesOf({ kind, counts }: { kind: string; counts: readonly number[] }): WeeklySeries {
  return { colour: KIND_COLOURS[kind], counts, key: kind };
}

/** The owner's words about one kind, newest first, each folded onto the whole turn. */
function Quotes({ trail }: { trail: SteerKindTrail }): ReactElement {
  const newest = trail.points.toReversed();
  return (
    <ul className="my-[0.5rem] list-none pl-0 text-[0.82rem]" data-testid="slack-steer-quotes">
      {newest.map((point) => (
        <li key={`${point.anchor}-${point.says}`} className="mb-[0.45rem]">
          <span className="text-muted-foreground">{shortDay({ iso: point.atIso })}</span>{" "}
          {point.says === "stopped" && <span className={CHIP}>you said it stopped</span>} “{point.quote}”
          <details className="mt-[0.15rem] text-[0.75rem]">
            <summary className="cursor-pointer text-muted-foreground">the whole turn</summary>
            {point.text === undefined ? (
              <StaleMark
                facts={[
                  {
                    subject: "this turn's record",
                    why: `it did not read this time; slopweaver profile words ${point.anchor} prints it`,
                  },
                ]}
                className="my-[0.3rem]"
              />
            ) : (
              <p className="my-[0.3rem] whitespace-pre-wrap">{point.text}</p>
            )}
          </details>
        </li>
      ))}
    </ul>
  );
}

/** One kind's small chart, its state, and its words behind a press. */
function KindCard({
  trail,
  days,
  reviewed,
  nowIso,
  zone,
}: {
  trail: SteerKindTrail;
  days: readonly string[];
  reviewed: readonly number[] | undefined;
  nowIso: string;
  zone: string;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const corrections = trail.points.filter((point) => point.says === "corrects").length;
  const counts = weekly({ counts: correctionsPerDay({ days, timeZone: zone, trail }) });
  return (
    <article className={cn(CARD, "mb-0")} data-testid="slack-steer-kind" data-kind={trail.kind}>
      <h4 className="m-0 flex items-center gap-2 text-[0.86rem] font-[650]">
        <span
          aria-hidden
          className="inline-block h-[0.6rem] w-[0.6rem] rounded-full"
          style={{ background: KIND_COLOURS[trail.kind] }}
        />
        {trail.title} <span className="font-normal text-muted-foreground">· {String(corrections)}</span>
      </h4>
      <WeeklyChart series={[seriesOf({ counts, kind: trail.kind })]} reviewed={reviewed} width={280} height={44} />
      <p className="mt-[0.3rem] mb-0 text-[0.75rem] text-muted-foreground">
        {kindStateLine({ day: shortDay, state: kindState({ nowIso, trail }) })}
      </p>
      {trail.points.length > 0 && (
        <button
          type="button"
          className={cn(BUTTON, "mt-[0.4rem]")}
          aria-expanded={open}
          onClick={() => {
            setOpen(!open);
          }}
        >
          {open ? "hide your words" : "your words"}
        </button>
      )}
      {open && <Quotes trail={trail} />}
    </article>
  );
}

/**
 * The reading drawn: the one chart, its legend, and the small charts behind a press. The reviewed-drafts bars ride
 * their own read, so the legend carries its spinner while it reads and its staleness mark when it failed.
 */
function Drawn({
  steers,
  reviewsState,
}: {
  steers: SlackSteers;
  reviewsState: LiveState<readonly string[]>;
}): ReactElement {
  const [perKind, setPerKind] = useState(false);
  const reviews = readyValueOf({ state: reviewsState });
  const zone = ownerZone();
  const days = windowDays({ nowIso: steers.observedAtIso, sinceIso: steers.sinceIso, timeZone: zone });
  const reviewed =
    reviews === undefined ? undefined : weekly({ counts: perDay({ days, isos: reviews, timeZone: zone }) });
  const series = steers.kinds.map((trail) =>
    seriesOf({ counts: weekly({ counts: correctionsPerDay({ days, timeZone: zone, trail }) }), kind: trail.kind }),
  );
  const unreadFacts = [
    ...steers.gaps.map((why) => ({ subject: "a source your turns are read from", why })),
    ...(steers.unparsed.length === 0
      ? []
      : [
          {
            subject: "part of the stored steer measurements",
            why: `measurement(s) ${steers.unparsed.join(", ")} of the store's steer journal would not read, so a turn each judged is not on a chart`,
          },
        ]),
  ];
  const toggle = (): void => {
    setPerKind(!perKind);
  };
  return (
    <>
      <button
        type="button"
        className="block w-full cursor-pointer border-0 bg-transparent p-0"
        aria-expanded={perKind}
        aria-label="your Slack corrections per kind per week: open one chart per kind"
        onClick={toggle}
      >
        <WeeklyChart series={series} reviewed={reviewed} width={640} height={120} />
      </button>
      <p className="mt-[0.2rem] mb-0 flex justify-between text-[0.7rem] text-muted-foreground">
        <span>{shortDay({ iso: steers.sinceIso })}</span>
        <span className="inline-flex items-center gap-1">
          one point per week · faint bars: drafts you reviewed that week{" "}
          {reviewsState.phase === "ready" ? (
            <ReadMark state={reviewsState} subject="the drafts you reviewed" />
          ) : (
            <ReadStandIn state={reviewsState} subject="the drafts you reviewed" />
          )}
        </span>
        <span>{shortDay({ iso: steers.observedAtIso })}</span>
      </p>
      <ul className="my-[0.5rem] flex list-none flex-wrap gap-x-3 gap-y-1 pl-0 text-[0.78rem]">
        {steers.kinds.map((trail) => (
          <li key={trail.kind} className="flex items-center gap-1">
            <span
              aria-hidden
              className="inline-block h-[0.55rem] w-[0.55rem] rounded-full"
              style={{ background: KIND_COLOURS[trail.kind] }}
            />
            {trail.title} {String(trail.points.filter((point) => point.says === "corrects").length)}
          </li>
        ))}
      </ul>
      <button type="button" className={BUTTON} aria-expanded={perKind} onClick={toggle}>
        {perKind ? "hide the per-kind charts" : "one chart per kind"}
      </button>
      {perKind && (
        <div className="mt-[0.6rem] grid gap-3 sm:grid-cols-2" data-testid="slack-steer-kinds">
          {steers.kinds.map((trail) => (
            <KindCard
              key={trail.kind}
              trail={trail}
              days={days}
              reviewed={reviewed}
              nowIso={steers.observedAtIso}
              zone={zone}
            />
          ))}
        </div>
      )}
      <p className="mt-[0.6rem] mb-0 flex items-center gap-[0.35rem] text-[0.75rem] text-muted-foreground">
        {String(steers.read)} of your turns read for this · {String(steers.unread)} that may name a kind not read yet
        {/* A source or verdict line that did not read leaves the counts short: a mark naming each, never a line. */}
        {unreadFacts.length > 0 && <StaleMark facts={unreadFacts} />}
      </p>
    </>
  );
}

/**
 * The section's age beside its heading: the older of the steers reading and the reviewed-draft reading behind the
 * faint bars, once that one is ready (`../../lib/readingAge.ts`), so a fresh review count never vouches for a steer
 * line read earlier. A review reading still loading or failed adds nothing here; its own mark beside the chart says so.
 *
 * @param steers the ready steers reading the section is drawn from
 * @param reviews the reviewed-draft reading behind the faint bars, in whatever phase it is
 * @returns the ticking age, its hover naming the reading when that is the reviews
 */
function SectionAge({
  steers,
  reviews,
}: {
  steers: Extract<LiveState<SlackSteers>, { phase: "ready" }>;
  reviews: LiveState<readonly string[]>;
}): ReactElement {
  const aged = oldestReadingOf({
    others: [{ state: reviews, subject: "the reviewed drafts" }],
    primary: { observedAtIso: steers.observedAtIso, stampedByRoute: steers.stampedByRoute, subject: "your words" },
  });
  let title: string | undefined;
  if (aged.subject !== "your words") {
    title = `the age of ${aged.subject}, the older reading this chart is drawn from`;
  }
  return <ReadingAge iso={aged.observedAtIso} title={title} className="text-[0.72rem] text-muted-foreground" />;
}

/**
 * The Slack-steers section, first on the Alignment page.
 *
 * @returns the section
 */
export function SlackSteersSection(): ReactElement {
  // Read once: the verb reads every turn of the owner's in sixty days, 37.2s measured (`site/lib/liveVerbs.ts`'s row), too
  // slow to poll — so the heading carries the reading's own age, which keeps counting while the page is open.
  const steers = useLive<SlackSteers>({ read: readSlackSteers, slug: "slack-steers" });
  const reviews = useLive<readonly string[]>({ read: readDraftReviews, slug: "slack-draft-corrections" });
  const reading = readyValueOf({ state: steers });
  return (
    <section className={cn(CARD, "mt-4")} data-testid="slack-steers" aria-label="Slack steers">
      <div className="mb-[0.6rem] flex items-baseline justify-between gap-3">
        <h2 className="m-0 text-[0.95rem] font-[650]">Slack steers</h2>
        {steers.phase === "ready" && <SectionAge steers={steers} reviews={reviews} />}
      </div>
      {steers.phase === "ready" ? (
        <ReadMark state={steers} subject="your words" row />
      ) : (
        <ReadStandIn state={steers} subject="your words" block />
      )}
      {reading !== undefined && <Drawn steers={reading} reviewsState={reviews} />}
    </section>
  );
}
