/**
 * One steer's line on the Steers page — what it became, whether it landed and is in what the owner runs, how the row came to
 * count as a steer, the owner's words under the fold — and the list of them.
 */
import type { ReactElement } from "react";

import { ageOf } from "../../lib/ageOf";
import { FLEET_SHOWN } from "../../lib/fleetViews";
import { type RunningBuilds, type SteerInApp, steerInApp } from "../../lib/steerInApp";
import { CitationChip } from "../console/CitationChip";
import { SourceBlock } from "../console/SourceBlock";
import { StaleMark } from "../console/StaleMark";
import { FleetMore } from "./FleetMore";
import { Field, Row } from "./Row";
import type { SteerOriginView, SteerStateView, SteersView, SteerView } from "./readSteers";

/**
 * The builds the owner runs, the build reading still on its way, or why it failed — every applied steer's verdict reads one
 * of these. The page draws the second as a progress indicator and the third as a staleness mark, never as words.
 */
export type RunningReading =
  | {
      readonly kind: "read";
      readonly builds: RunningBuilds;
      /** Why a later build read failed, when these builds are the last reading kept over it. */
      readonly staleWhy: string | undefined;
    }
  | { readonly kind: "reading" }
  | { readonly kind: "not-read"; readonly why: string };

/** The tag an applied steer carries once it is placed against what the owner runs. */
const IN_APP_TAG: Readonly<Record<SteerInApp["kind"], string>> = {
  "awaiting-update": "pending update",
  elsewhere: "applied",
  "in-app": "applied",
  unknown: "landed",
};

/** The one-word tag a row carries, so the list reads as a column of outcomes. */
const STATE_TAG: Readonly<Record<SteerStateView["kind"], string>> = {
  applied: "applied",
  ended: "ended",
  "in-flight": "in flight",
  "landing-unknown": "unknown",
  "run-closed": "run closed",
  settled: "settled",
  waiting: "not started",
};

/**
 * What a state means, said in full in the row's fold — or, where the read it is judged from failed, a staleness mark
 * whose hover names that read and why, never a sentence in the state's place.
 */
function stateLine({ state }: { state: SteerStateView }): string | ReactElement {
  switch (state.kind) {
    case "applied": {
      let via = "its branch";
      if (state.via === "witness") {
        via = "the pull request its run was settled with";
      }
      return `landed on main ${ageOf({ iso: state.landing.mergedIso })}, found by ${via}`;
    }
    case "landing-unknown": {
      return <StaleMark facts={[{ subject: "whether this steer landed", why: state.why }]} />;
    }
    case "settled": {
      if (state.witnessPr !== undefined) {
        return `settled ${state.settlement} on ${state.witnessPr.repo}#${String(state.witnessPr.number)}, which is not on main as read`;
      }
      return `settled ${state.settlement}, and nothing it names landed on main`;
    }
    case "ended": {
      return `the row ended ${state.status}, and nothing landed on main`;
    }
    case "in-flight": {
      if (state.branch !== undefined) {
        return `a run is open on it, on ${state.branch}`;
      }
      return "a run is open on it";
    }
    case "run-closed": {
      return "a run closed on it, and nothing landed on main";
    }
    case "waiting": {
      return "no run has started on it";
    }
    default: {
      const exhausted: never = state;
      return exhausted;
    }
  }
}

/** Where an applied steer's landing stands against what the owner runs; `undefined` for a steer that has not landed. */
export function inAppOf({ steer, running }: { steer: SteerView; running: RunningReading }): SteerInApp | undefined {
  if (steer.state.kind !== "applied") {
    return undefined;
  }
  if (running.kind === "reading") {
    return { kind: "unknown", why: "the build reading has not arrived yet" };
  }
  if (running.kind === "not-read") {
    return { kind: "unknown", why: running.why };
  }
  return steerInApp({ landing: steer.state.landing, running: running.builds });
}

/** What an applied steer's place against the owner's running app adds to its line. */
function inAppLine({ inApp }: { inApp: SteerInApp }): string {
  switch (inApp.kind) {
    case "in-app": {
      return "in the app you are running";
    }
    case "elsewhere": {
      return "in a repository your app is not built from, so no update of it bears on this";
    }
    case "awaiting-update": {
      return "waiting for your app to update: Update now in the sidebar brings it";
    }
    case "unknown": {
      return `whether your running app has it is not known: ${inApp.why}`;
    }
    default: {
      const exhausted: never = inApp;
      return exhausted;
    }
  }
}

/** How the row came to count as a steer. */
function originLine({ origin }: { origin: SteerOriginView }): string {
  switch (origin.kind) {
    case "cut": {
      return `cut from your call at ${origin.anchor}`;
    }
    case "relay-taken-up": {
      return `relayed from your console at ${origin.anchor}, and a session started a run on it`;
    }
    case "named-in-text": {
      return `the row names call turn ${origin.turn} only in its text, with no anchor, so your words are not attached`;
    }
    default: {
      const exhausted: never = origin;
      return exhausted;
    }
  }
}

/** One steer: what it became, whether it landed and is in what the owner runs, and the owner's words under the fold. */
function SteerLine({ steer, running }: { steer: SteerView; running: RunningReading }): ReactElement {
  const inApp = inAppOf({ running, steer });
  let tag = STATE_TAG[steer.state.kind];
  const state = stateLine({ state: steer.state });
  let where: string | ReactElement = state;
  if (inApp !== undefined) {
    tag = IN_APP_TAG[inApp.kind];
  }
  // The line says where an applied steer stands against what the owner runs only once the build reading is in; while it is
  // on its way or failed, the headline's one mark says so instead of every row repeating it.
  if (inApp !== undefined && running.kind === "read") {
    where = (
      <>
        {state}; {inAppLine({ inApp })}
      </>
    );
  }
  let given = "no instant";
  if (steer.askedIso !== undefined) {
    given = ageOf({ iso: steer.askedIso });
  }
  let times = "";
  if (steer.timesGiven > 1) {
    times = ` · said ${String(steer.timesGiven)} times`;
  }
  const lead = (
    <>
      {steer.title}{" "}
      <span className="text-[0.72rem] text-muted-foreground">
        · {given}
        {times}
      </span>
    </>
  );
  return (
    <Row lead={lead} quote={steer.words?.words} tag={tag}>
      {steer.words !== undefined && (
        <SourceBlock source={{ bearsOn: undefined, kind: "words", quote: steer.words, steers: [] }} />
      )}
      <Field label="where it stands" value={where} />
      {steer.state.kind === "applied" && (
        <Field
          label="pull request"
          value={
            <a href={steer.state.landing.url} rel="noreferrer">
              #{String(steer.state.landing.number)} {steer.state.landing.title}
            </a>
          }
        />
      )}
      <Field label="steer" value={originLine({ origin: steer.origin })} />
      <Field
        label="board row"
        value={<CitationChip reference={{ kind: "board-row", slug: steer.slug }}>{steer.slug}</CitationChip>}
      />
    </Row>
  );
}

/** The list, newest first, ten shown. */
export function SteerList({ view, running }: { view: SteersView; running: RunningReading }): ReactElement {
  if (view.steers.length === 0) {
    return <p className="sw-tile-note">no steer from a call is on the board</p>;
  }
  const shown = view.steers.slice(0, FLEET_SHOWN);
  const folded = view.steers.slice(FLEET_SHOWN);
  return (
    <>
      <div>
        {shown.map((steer) => (
          <SteerLine key={steer.slug} running={running} steer={steer} />
        ))}
      </div>
      <FleetMore
        label={`and ${String(folded.length)} more`}
        rows={folded}
        render={(steer) => <SteerLine key={steer.slug} running={running} steer={steer} />}
      />
    </>
  );
}
