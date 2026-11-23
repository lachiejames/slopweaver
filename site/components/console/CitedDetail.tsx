"use client";

/*
 * What a citation chip's hover card says about a pull request or a Linear ticket beyond its address — the chip's
 * `detail`, filled for those two kinds (`./CitationChip.tsx`).
 *
 * A pull request link alone says little, so the card shows the PR title and whether its checks pass and it needs
 * review. A pull request in the shell's landing reading draws
 * its title and the pull-requests page's own chips — state, checks, next act, open review — off that row, through
 * the page's components (`../live/PrStatus.tsx`), aged by the reading's instant. One the reading does not hold, and
 * every ticket, is read through `/api/cited` when the card opens: its title and where it stands, and for a pull
 * request a line saying the checks and review are read for the owner's open ones only. Mounted inside the hover card, so
 * nothing is read until the reader hovers. Pure halves: `../../lib/citedRecord.ts`.
 */

import { GitPullRequest, GitPullRequestDraft } from "lucide-react";
import { type ReactElement, type ReactNode, useEffect, useState } from "react";

import { ageOf } from "../../lib/ageOf";
import type { CitationReference } from "../../lib/citationDisplay";
import {
  type CitedRecord,
  type CitedState,
  canonicalCitedAddress,
  citedCache,
  citedRecordFor,
  citedStateOf,
  landingRowFor,
  ticketStatusOf,
} from "../../lib/citedRecord";
import { drawnWaitOf, tagOf } from "../../lib/reviewHook";
import { ReadMark, ReadStandIn } from "../live/LiveMarks";
import { ActionTag, ChecksChip, ReviewChip } from "../live/PrStatus";
import type { LandingReading, LandingRow } from "../live/readLanding";
import { type Reviewers, readReviewers, reviewerRowFor } from "../live/readReviewers";
import { type LiveState, readyValueOf, useLive } from "../live/useLive";
import { StateLabel } from "../ui/state-label";
import { ReadingIndicator } from "./ReadingIndicator";
import { StaleMark } from "./StaleMark";
import { useShellLanding } from "./shellLanding";

/** One address's read through the route, settled either way — a thrown fetch is a `not-measured` answer. */
const fetchCited: (url: string) => Promise<Exclude<CitedState, { phase: "loading" }>> = async (url) => {
  try {
    const response = await fetch(`/api/cited?${new URLSearchParams({ url }).toString()}`, { cache: "no-store" });
    return citedStateOf({ body: await response.json() });
  } catch (cause: unknown) {
    return { phase: "not-measured", why: cause instanceof Error ? cause.message : String(cause) };
  }
};

/** Every chip on the page shares one read per record and keeps the last ready answer. */
const reads = citedCache({ lookup: fetchCited });

/**
 * One record's read through the route: the last ready answer the page holds while this card's own read settles.
 * Shared with a Slack draft's Linear unfurl (`./SlackAttachments.tsx`), which draws the same title.
 *
 * @param address the record's canonical address
 * @returns the read as it stands
 */
export function useCited({ address }: { address: string }): CitedState {
  const [settled, setSettled] = useState<{ address: string; state: Exclude<CitedState, { phase: "loading" }> }>();
  useEffect(() => {
    let live = true;
    const settle = async (): Promise<void> => {
      const state = await reads.read(address);
      if (live) {
        setSettled({ address, state });
      }
    };
    void settle();
    return () => {
      live = false;
    };
  }, [address]);
  if (settled?.address === address) {
    return settled.state;
  }
  const kept = reads.kept(address);
  if (kept !== undefined) {
    return { ...kept, refreshing: true };
  }
  return { phase: "loading" };
}

/**
 * The mark beside a cited record's drawn answer: a staleness mark when its newer read failed, a spinner while that
 * read is in flight, nothing over a current one.
 *
 * @param subject what it is, mid-sentence ("the pull request")
 * @returns the mark, or nothing
 */
export function CitedMark({
  state,
  subject,
}: {
  state: Extract<CitedState, { phase: "ready" }>;
  subject: string;
}): ReactElement | null {
  if (state.stale !== undefined) {
    return <StaleMark facts={[{ observedAtIso: state.observedAtIso, subject, why: state.stale.why }]} />;
  }
  if (state.refreshing === true) {
    return <ReadingIndicator label={`Re-reading ${subject}`} />;
  }
  return null;
}

/** The detail's frame: a fixed minimum height, so the card does not jump as a read lands. */
function Frame({ children }: { children: ReactNode }): ReactElement {
  return <div className="grid min-h-[3.25rem] content-start gap-1.5">{children}</div>;
}

/** The record's title, clamped to two lines. */
function Title({ children }: { children: ReactNode }): ReactElement {
  return <p className="m-0 line-clamp-2 font-semibold text-foreground">{children}</p>;
}

/** A small grey line: where the words came from, or why they are missing. */
function Note({ children }: { children: ReactNode }): ReactElement {
  return <p className="m-0 text-[0.7rem] text-muted-foreground">{children}</p>;
}

/**
 * A pull request the landing reading holds: its title, then the page's own state, checks, next act and open
 * review, joined with the reviewer pick exactly as the page joins it — through the page's own `reviewers`
 * channel, read once as the card opens, so a pick the page records (`refreshLive`) reaches the card too. Until
 * that read answers the row is drawn without a pick, as the page draws it, with a spinner beside the note — and with a
 * staleness mark there when the read failed. A landing reading kept over a failed re-poll carries its own mark.
 *
 * @param landing the shell's landing reading, which aged the row, as its live state stands
 * @returns the detail
 */
function LandingPull({
  row,
  landing,
}: {
  row: LandingRow;
  landing: Extract<LiveState<LandingReading>, { phase: "ready" }>;
}): ReactElement {
  const reading = landing.value;
  const reviewersState = useLive<Reviewers>({ read: readReviewers, slug: "reviewers" });
  const reviewers = readyValueOf({ state: reviewersState });
  let picked: { readonly reviewer: string } | undefined;
  let people = reading.landing.people;
  if (reviewers !== undefined) {
    picked = reviewerRowFor({ number: row.number, repoSlug: row.repoSlug, reviewers })?.picked;
    people = new Map([...reviewers.people, ...reading.landing.people]);
  }
  const wait = drawnWaitOf({ people, picked, row });
  return (
    <Frame>
      <Title>{row.title}</Title>
      <span className="flex flex-wrap items-center gap-1.5">
        <StateLabel
          status={row.draft ? "draft" : "open"}
          icon={row.draft ? GitPullRequestDraft : GitPullRequest}
          size="small"
        />
        <ChecksChip row={row} />
        <ActionTag row={row} wait={wait} title={`next act: ${tagOf({ row, wait })}`} className="max-w-full" />
        <ReviewChip row={row} avatarOf={() => undefined} />
      </span>
      <Note>
        from the landing reading, {ageOf({ iso: reading.observedAtIso })}{" "}
        <ReadMark state={landing} subject="the landing reading" />
        {reviewersState.phase === "ready" ? (
          <ReadMark state={reviewersState} subject="the reviewer picks" />
        ) : (
          <ReadStandIn state={reviewersState} subject="the reviewer picks" />
        )}
      </Note>
    </Frame>
  );
}

/**
 * A record read through the route: a pull request the landing reading does not hold — or could not be read to say —
 * or a ticket.
 *
 * @param landingWhy why the shell's landing reading failed, when it did: the note then marks that read stale rather
 * than claiming the reading does not hold the pull request
 * @returns the detail
 */
function ReadRecord({ record, landingWhy }: { record: CitedRecord; landingWhy: string | undefined }): ReactElement {
  const state = useCited({ address: canonicalCitedAddress({ record }) });
  let what = "pull request";
  if (record.kind !== "pull") {
    what = `ticket ${record.key}`;
  }
  if (state.phase === "loading") {
    return (
      <Frame>
        <ReadingIndicator label={`Reading the ${what}`} />
      </Frame>
    );
  }
  if (state.phase === "not-measured") {
    return (
      <Frame>
        <StaleMark facts={[{ subject: `The ${what}`, why: state.why }]} />
      </Frame>
    );
  }
  const { read } = state;
  if (read.kind === "pull") {
    let landingNote: ReactNode = ", and the landing reading does not hold this one";
    if (landingWhy !== undefined) {
      landingNote = (
        <>
          {" "}
          <StaleMark facts={[{ subject: "the landing reading", why: landingWhy }]} />
        </>
      );
    }
    return (
      <Frame>
        <Title>{read.title}</Title>
        <span className="flex flex-wrap items-center gap-1.5">
          <StateLabel status={read.lifecycle} size="small" />
        </span>
        <Note>
          read {ageOf({ iso: state.observedAtIso })}: checks, next act and review are read for your open pull requests
          only{landingNote} <CitedMark state={state} subject={`the ${what}`} />
        </Note>
      </Frame>
    );
  }
  return (
    <Frame>
      <Title>{read.title}</Title>
      <span className="flex flex-wrap items-center gap-1.5">
        <StateLabel status={ticketStatusOf({ stateType: read.stateType })} size="small">
          {read.state}
        </StateLabel>
      </span>
      <Note>
        read from Linear {ageOf({ iso: state.observedAtIso })} <CitedMark state={state} subject={`the ${what}`} />
      </Note>
    </Frame>
  );
}

/**
 * A pull request: the landing row when the shell's reading holds it, else a read of its own.
 *
 * @returns the detail
 */
function PullDetail({ record }: { record: Extract<CitedRecord, { kind: "pull" }> }): ReactElement {
  const landing = useShellLanding();
  if (landing?.phase === "loading") {
    return (
      <Frame>
        <ReadingIndicator label="Reading the landing reading" />
      </Frame>
    );
  }
  if (landing?.phase === "ready") {
    const row = landingRowFor({ landing: landing.value.landing, pull: record });
    if (row !== undefined) {
      return <LandingPull row={row} landing={landing} />;
    }
  }
  // A landing reading kept over a failed re-read cannot say a fresh one would not hold this pull request, so its
  // absence there is marked with the failure, never stated as a fact.
  let landingWhy: string | undefined;
  if (landing?.phase === "not-measured") {
    landingWhy = landing.why;
  }
  if (landing?.phase === "ready" && landing.stale !== undefined) {
    landingWhy = landing.stale.why;
  }
  return <ReadRecord record={record} landingWhy={landingWhy} />;
}

/**
 * The live detail for a chip's reference, when it names a pull request or a Linear ticket.
 *
 * @param reference what the chip points at
 * @returns the detail, or `null` for any other record — the card then draws its place and footer alone
 */
export function CitedDetail({ reference }: { reference: CitationReference }): ReactElement | null {
  const record = citedRecordFor({ reference });
  if (record === undefined) {
    return null;
  }
  if (record.kind === "pull") {
    return <PullDetail record={record} />;
  }
  return <ReadRecord record={record} landingWhy={undefined} />;
}

/**
 * Whether a reference has a live detail at all, so the chip draws the bordered block only when one will fill it.
 *
 * @returns true for a pull request or a Linear ticket
 */
export function hasCitedDetail({ reference }: { reference: CitationReference }): boolean {
  return citedRecordFor({ reference }) !== undefined;
}
