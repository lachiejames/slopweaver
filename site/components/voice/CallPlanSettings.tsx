"use client";

/**
 * The call's plan settings, folded in the session details tray (`VoiceSession.tsx`): the voice the owner's ChatGPT plan speaks
 * in, which model the call is on, how much of the plan is left, how many talk minutes that buys, and who pays. The
 * Talk & voice page is retired, its voice controls and transcripts live in the call widget, and these read the
 * overlay's own voice state, the one that holds the call, so
 * Restart call restarts the call the owner is on. The microphone and speaker are the audio tray's (`AudioDeviceMenu.tsx`).
 * A call runs on the owner's ChatGPT plan and nothing else (no
 * platform.openai usage), so a plan that refuses is a refusal shown here, never a second model, voice or bill. The
 * plan facts are derived, never estimated, and one that nothing measures says so (`../../lib/talkPlanFacts.ts`). Laid
 * out as label-left, control-right rows, every control bounded by its cell and none portalled, so each stays inside the overlay's interactive card.
 */
import type { ReactElement, ReactNode } from "react";

import { readerTimeZone } from "../../lib/dateTimeFormat";
import {
  type PlanLeft,
  planModelWords,
  planReadWords,
  planWindowWords,
  readPlanLeft,
  TALK_MINUTES_UNKNOWN,
} from "../../lib/talkPlanFacts";
import { planVoiceNeedsRestart, TALK_PLAN_VOICES } from "../../lib/talkVoices";
import { StaleMark } from "../console/StaleMark";
import { ReadMark, ReadStandIn } from "../live/LiveMarks";
import { type LiveState, useLive } from "../live/useLive";
import { Button } from "../ui/button";
import type { VoiceState } from "./voiceContext";

/** A native select bounded by its cell, in the audio tray's quiet field (`AudioDeviceMenu.tsx`'s `PICK`). */
const NATIVE_PICK =
  "w-full min-w-0 truncate rounded-[6px] border border-solid border-border bg-(--c-panel) px-[0.4rem] py-[0.3rem] text-[0.8rem] text-foreground";

/**
 * How often the plan is read again: a call spends from it. A timed read that falls during a call waits and is taken
 * at hang-up (`../../lib/liveQuiet.ts`); a call shorter than one interval is caught by the next, and the row states
 * its read time throughout, so a figure from before a call never passes for a fresh one.
 */
const PLAN_READ_EVERY_MS = 5 * 60_000;

/**
 * The plan settings.
 *
 * @param voice the voice state of the window that holds the call
 * @returns the section
 */
export function CallPlanSettings({ voice }: { voice: VoiceState }): ReactElement {
  const planLeft = useLive({
    everyMs: PLAN_READ_EVERY_MS,
    read: (payload) => readPlanLeft({ payload }),
    slug: "codex-quota",
  });
  const model = planModelWords({ live: voice.live });
  return (
    <section className="grid min-w-0 gap-6" aria-label="call settings">
      <SettingsSection title="ChatGPT plan">
        <Row label="Voice">
          <div className="grid min-w-0 gap-2">
            <Choice
              label="Plan voice"
              options={TALK_PLAN_VOICES}
              value={voice.planVoice}
              onChange={(next) => {
                voice.setPlanVoice(next);
              }}
            />
            {planVoiceNeedsRestart({
              active: voice.activePlanVoice,
              callActive: voice.callActive,
              selected: voice.planVoice,
            }) ? (
              <RestartNotice sharing={voice.sharing !== undefined} onRestart={voice.restart} />
            ) : null}
          </div>
        </Row>
        <Row label="Model" text>
          <Fact known={model.known}>{model.words}</Fact>
        </Row>
        <Row label="Plan left" text>
          <PlanLeftFact state={planLeft} />
        </Row>
        <Row label="Talk minutes" text>
          <Fact known={false}>{TALK_MINUTES_UNKNOWN}</Fact>
        </Row>
        <Row label="Paid by" text>
          <Fact known>
            Your ChatGPT plan, through Codex. A refused call shows its refusal here, and nothing else is tried.
          </Fact>
        </Row>
      </SettingsSection>
    </section>
  );
}

/**
 * What a voice picked mid-call says: it takes effect on a restart, and the button that restarts — naming the screen
 * share that ends with the old call, when one is open.
 */
function RestartNotice({ sharing, onRestart }: { sharing: boolean; onRestart: () => void }): ReactElement {
  return (
    <div className="grid gap-1.5">
      <p className="m-0 text-sm text-pretty">This voice takes effect when the call restarts.</p>
      {sharing ? (
        <p className="m-0 text-xs text-pretty text-warning">
          Restarting ends your screen share; press look at my screen again after.
        </p>
      ) : null}
      <Button type="button" size="sm" variant="outline" className="justify-self-start" onClick={onRestart}>
        Restart call
      </Button>
    </div>
  );
}

/** A fact line — plain when it is known, muted and italic when it says it is not. */
function Fact({ known, children }: { known: boolean; children: ReactNode }): ReactElement {
  return (
    <p
      className="m-0 text-sm text-pretty data-[known=false]:text-muted-foreground data-[known=false]:italic"
      data-known={String(known)}
    >
      {children}
    </p>
  );
}

/** The plan-left row: one line per metered window, or a staleness mark whose hover says why the plan was not read. */
function PlanLeftFact({ state }: { state: LiveState<PlanLeft> }): ReactElement {
  if (state.phase !== "ready") {
    return <ReadStandIn state={state} subject="your plan (slopweaver codex quota show --routed)" />;
  }
  const left = state.value;
  if (left.kind === "not-read") {
    return (
      <span className="inline-flex items-center gap-[0.35rem]">
        <StaleMark facts={[{ subject: "your plan (slopweaver codex quota show --routed)", why: left.why }]} />
        <ReadMark state={state} subject="your plan" />
      </span>
    );
  }
  if (left.windows.length === 0) {
    return (
      <Fact known={false}>
        unknown: the plan reported no metered window <ReadMark state={state} subject="your plan" />
      </Fact>
    );
  }
  const timeZone = readerTimeZone();
  return (
    <div className="grid gap-0.5">
      {left.windows.map((window) => (
        <Fact key={`${window.limitId}:${window.label}`} known>
          {planWindowWords({ timeZone, window })}
        </Fact>
      ))}
      {left.allowed === false ? <Fact known>The plan is refusing ordinary use right now.</Fact> : null}
      <span className="inline-flex items-center gap-[0.35rem] text-xs text-muted-foreground">
        {planReadWords({ observedAtIso: state.observedAtIso, timeZone })}
        <ReadMark state={state} subject="your plan" />
      </span>
    </div>
  );
}

/** A titled section of rows. */
function SettingsSection({ title, children }: { title: string; children: ReactNode }): ReactElement {
  return (
    <section className="grid min-w-0 gap-4 border-border pt-5 not-first:border-t first:pt-0" aria-label={title}>
      <h2 className="m-0 text-sm font-semibold">{title}</h2>
      <div className="grid grid-cols-[6.5rem_minmax(0,1fr)] items-start gap-x-4 gap-y-3">{children}</div>
    </section>
  );
}

/**
 * One label-left, control-right row. The label sits on the control's text line: beside a trigger it drops to the
 * trigger's baseline, beside a fact (`text`) it sits on the first line rather than the middle of a paragraph.
 */
function Row({ label, text = false, children }: { label: string; text?: boolean; children: ReactNode }): ReactElement {
  return (
    <>
      <span className="text-sm text-muted-foreground data-[text=false]:pt-1.5" data-text={String(text)}>
        {label}
      </span>
      <div className="min-w-0">{children}</div>
    </>
  );
}

/**
 * A select over a closed list of names. A native one, as the audio tray's are (`AudioDeviceMenu.tsx`): a portalled
 * list would draw outside the desktop overlay's interactive card and let a click on an option fall through to the app
 * beneath.
 */
function Choice<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly T[];
  value: T;
  onChange: (next: T) => void;
}): ReactElement {
  return (
    <select
      className={NATIVE_PICK}
      aria-label={label}
      value={value}
      onChange={(event) => {
        const picked = options.find((option) => option === event.target.value);
        if (picked !== undefined) {
          onChange(picked);
        }
      }}
    >
      {options.map((option) => (
        <option key={option} value={option}>
          {option}
        </option>
      ))}
    </select>
  );
}
