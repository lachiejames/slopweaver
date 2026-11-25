"use client";

/**
 * The Fleet page's doctrine panel: one closed line under the sessions saying how many of its five lines are red or
 * amber, and behind it the five lines, each one sentence with every item it counts folded behind it, that say
 * whether the fleet is running the way the owner's doctrine says. Every word is the projection's (`../../lib/fleetDoctrine.ts`);
 * this file reads the one channel the Now view does not already poll — `github landing`'s reading, for the owner's open pull
 * requests — and lays the lines out.
 */
import { type ReactElement, useEffect, useState } from "react";
import { doctrineAlertSummary, fleetDoctrineOf } from "../../lib/fleetDoctrine";
import { doctrineInputOf, doctrinePendingOf } from "../../lib/fleetDoctrineInput";
import { landingInCadenceOf, landingStaleAtOf } from "../../lib/fleetDoctrinePulls";
import type { DoctrineGlance, DoctrineSeats } from "../../lib/fleetDoctrineSeats";
import type {
  DoctrineBoard,
  DoctrineInput,
  DoctrineItem,
  DoctrineLanding,
  DoctrineLine,
  DoctrineTone,
} from "../../lib/fleetDoctrineTypes";
import { cn } from "../../lib/utils";
import { useNow } from "../console/QueueSections";
import { PlainWhy } from "../console/RawFold";
import type { Board } from "./read";
import type { Reading } from "./reading";
import { type LandingReading, readLandingReading } from "./readLanding";
import type { Reconcile } from "./readWorkstreamsTypes";
import { type LiveState, useLive } from "./useLive";

/** How often the landing reading is re-read — the supervisor tick records it, so a slow poll is current enough. */
const LANDING_POLL_MS = 30_000;

/** The marker each tone draws beside its sentence. */
const TONE_MARK: Readonly<Record<DoctrineTone, string>> = {
  attention: "bg-warning",
  danger: "bg-danger",
  ok: "bg-success",
  unread: "bg-muted-foreground/40",
};

/** The words a screen reader hears for each tone, since the marker is colour alone. */
const TONE_WORD: Readonly<Record<DoctrineTone, string>> = {
  attention: "work left on the table",
  danger: "doctrine broken",
  ok: "doctrine kept",
  unread: "not read",
};

/**
 * One line: its marker, its sentence, and every item it counts behind a fold.
 *
 * @returns the line
 */
function Line({ line }: { line: DoctrineLine }): ReactElement {
  // A line not read draws its short lead, its reasons folded beneath: drawn inline, the same reason ran on three lines.
  let shown = line.sentence;
  let notRead: ReactElement | null = null;
  if (line.notRead !== undefined) {
    shown = line.notRead.lead;
    notRead = (
      <details className="mt-0.5 pl-4 text-[0.8rem] text-muted-foreground" data-doctrine-not-read>
        <summary className="cursor-pointer">why it was not read</summary>
        <ul className="m-0 mt-0.5 grid list-disc gap-0.5 pl-4">
          {line.notRead.reasons.map((reason, at) => (
            <li className="first-letter:uppercase" key={`${String(at)}:${reason}`}>
              {reason}
            </li>
          ))}
        </ul>
      </details>
    );
  }
  const sentence = (
    <span className="flex items-baseline gap-2">
      <span
        aria-label={TONE_WORD[line.tone]}
        className={cn("inline-block size-2 shrink-0 rounded-full", TONE_MARK[line.tone])}
        role="img"
      />
      <span>{shown}</span>
    </span>
  );
  // Each read's reason the line stands on: its own plain line and fold, beside the sentence and never inside a
  // `<summary>`, which cannot hold the fold (steer 7). Keyed by position and lead, never by the raw message.
  const quotedReasons =
    line.quoted.length === 0 ? null : (
      <div className="mt-0.5 grid gap-0.5 pl-4 text-[0.8rem] text-muted-foreground">
        {line.quoted.map((reason, at) => (
          <div key={`${String(at)}:${reason.lead}`}>
            <PlainWhy lead={reason.lead} why={reason.why} />
          </div>
        ))}
      </div>
    );
  const quoted = (
    <>
      {notRead}
      {quotedReasons}
    </>
  );
  if (line.groups.length === 0) {
    return (
      <li className="m-0" data-doctrine-line={line.key} data-tone={line.tone}>
        {sentence}
        {quoted}
      </li>
    );
  }
  return (
    <li className="m-0" data-doctrine-line={line.key} data-tone={line.tone}>
      <details className="[&>summary]:cursor-pointer">
        <summary className="list-none">{sentence}</summary>
        <div className="mt-1 grid gap-1.5 pl-4 text-[0.8rem]">
          {line.groups.map((group) => (
            <div key={group.label}>
              <p className="m-0 text-muted-foreground">
                {group.label} ({group.items.length})
              </p>
              <ul className="m-0 grid list-none gap-0.5 p-0">
                {group.items.map((item) => (
                  <li key={item.key}>
                    <Item item={item} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </details>
      {quoted}
    </li>
  );
}

/**
 * One item a line counts: a read's reason it quotes said plainly with the raw message folded (steer 7), else its link
 * when it has an address, else its words.
 *
 * @returns the item
 */
function Item({ item }: { item: DoctrineItem }): ReactElement {
  if (item.why !== undefined) {
    return <PlainWhy lead={item.text} why={item.why} />;
  }
  if (item.href === undefined) {
    return <>{item.text}</>;
  }
  return (
    <a className="underline-offset-2 hover:underline" href={item.href} rel="noreferrer" target="_blank">
      {item.text}
    </a>
  );
}

/**
 * A re-render on a tick and again just past a deadline, so a page nobody touches still withdraws a reading the
 * instant it goes stale. The instant the render judges by is its own clock read (see the panel), never this
 * hook's value alone: a reading that arrives already stale would otherwise be drawn once over the last tick's
 * instant. The shape is `ShellBadges.tsx`'s pull-request pill's, which ages the same census.
 *
 * @param everyMs how often to re-render regardless
 * @param deadlineMs the instant to re-render just after, or undefined for none
 * @returns the last instant a tick or the deadline read, in epoch milliseconds
 */
function useNowPast({ everyMs, deadlineMs }: { everyMs: number; deadlineMs: number | undefined }): number {
  const now = useNow({ everyMs });
  const [pastDeadline, setPastDeadline] = useState<number | undefined>(undefined);
  useEffect(() => {
    if (deadlineMs === undefined) {
      return undefined;
    }
    const timer = setTimeout(
      () => {
        setPastDeadline(Date.now());
      },
      Math.max(deadlineMs - Date.now() + 1, 0),
    );
    return () => {
      clearTimeout(timer);
    };
  }, [deadlineMs]);
  if (pastDeadline !== undefined && pastDeadline > now) {
    return pastDeadline;
  }
  return now;
}

/**
 * The panel, off the Now view's own readings plus the landing reading it polls itself.
 *
 * @param glance the Now view's glance, already passed through `doctrineGlanceOf` so a stale ceiling or burst is withdrawn
 * @param seats the seats reading the tile is drawing, or why it is not in hand (a refresh that failed since)
 * @param reconcile the reconcile channel, already marked not measured when the seats are frozen to a fixture
 * @param board the board channel
 * @param frozen whether the seats are frozen to a fixture, which no board or landing capture is committed beside
 * @returns the panel
 */
export function FleetDoctrinePanel({
  glance,
  seats,
  reconcile,
  board,
  frozen,
}: {
  glance: DoctrineGlance;
  seats: DoctrineInput<DoctrineSeats>;
  reconcile: LiveState<Reading<Reconcile>>;
  board: LiveState<Board>;
  frozen: boolean;
}): ReactElement {
  const landingState = useLive<LandingReading>({
    everyMs: LANDING_POLL_MS,
    read: readLandingReading,
    slug: "landing-reading",
  });
  const landingReading = doctrineInputOf({
    pick: (value) => ({ landing: value.landing, observedAtIso: value.observedAtIso }),
    state: landingState,
    subject: "the landing reading",
  });
  const tickedMs = useNowPast({ deadlineMs: landingStaleAtOf({ reading: landingReading }), everyMs: LANDING_POLL_MS });
  // oxlint-disable-next-line react/purity -- the clock IS the input: a render that shows the count must read the time it shows it at
  const renderedAtMs = Date.now();
  const nowMs = Math.max(tickedMs, renderedAtMs);
  const frozenWhy = "the seats are frozen to a fixture, and no capture of it is committed beside them";
  let boardInput: DoctrineInput<DoctrineBoard> = { kind: "unread", why: frozenWhy };
  let landingInput: DoctrineInput<DoctrineLanding> = { kind: "unread", why: frozenWhy };
  if (!frozen) {
    // The rows AND what the scan could not finish: a doc it could not read is a gap, never an empty row.
    boardInput = doctrineInputOf({
      pick: (value) => ({ rows: value.rows, unreadable: value.unreadable, unresolved: value.unresolved }),
      state: board,
      subject: "the board",
    });
    // A recorded reading past the landing cadence is not counted, however cleanly it re-reads.
    landingInput = landingInCadenceOf({ nowMs, reading: landingReading });
  }
  const reconcileInput = doctrineInputOf({
    pick: (value) => value.value,
    state: reconcile,
    subject: "the board reconcile",
  });
  const doctrine = fleetDoctrineOf({
    board: boardInput,
    glance,
    landing: landingInput,
    reconcile: reconcileInput,
    seats,
  });
  const pending = doctrinePendingOf({ glance, inputs: [seats, boardInput, landingInput, reconcileInput] });
  // One closed line saying only how many lines are red or amber; the five lines sit inside it (the owner's call).
  return (
    <details
      aria-busy={pending}
      aria-label="Is the fleet running the way the doctrine says"
      className="text-[0.86rem] [&>summary]:cursor-pointer"
      data-doctrine
    >
      <summary className="text-muted-foreground">{doctrineAlertSummary({ lines: doctrine.lines })}</summary>
      <ul className="m-0 mt-1 grid list-none gap-1 p-0 pl-4 text-[0.9rem] leading-[1.45]">
        {doctrine.lines.map((line) => (
          <Line key={line.key} line={line} />
        ))}
      </ul>
    </details>
  );
}
