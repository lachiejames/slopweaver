"use client";

/**
 * The two contexts the console voice is reached through, and the hooks a page uses to tell it what it is
 * showing.
 *
 * Two contexts rather than one because they change at very different rates. The session's state — its
 * status, what is in flight, the level meter, the transcript — re-renders about twelve times a second while it
 * is live, and only the orb and the transcript page read it. The page registration is a stable setter every page
 * calls; on the same context as the meter, every page on the console would re-render with the meter.
 */
import { createContext, useContext, useEffect, useLayoutEffect } from "react";

import type { HeardHerald } from "../../lib/announceCue";
import type { AudioRouteState } from "../../lib/audioDevices";
import type { EarlierTurn } from "../../lib/chatThread";
import type { WaitingBuild } from "../../lib/consoleHold";
import type { FrameTaken } from "../../lib/edgeGlow";
import type { MeetingNotice } from "../../lib/meetingDue";
import type { MessengerReadSubject } from "../../lib/messengerBand";
import type { ScreenSight } from "../../lib/screenFrame";
import type { StalenessFact } from "../../lib/stalenessLabel";
import type { ReopenReminderMeasurement } from "../../lib/talkTranscript";
import type { TimingUsage } from "../../lib/toolTiming";
import type { TriageClockReport, TriageCommand } from "../../lib/triageBridge";
import type { TriageVerdict } from "../../lib/triageWords";
import type { ActivityRow, VoicePhase, VoiceStatus } from "../../lib/voiceActivity";
import type { ToolCallShown } from "../../lib/voiceSessionView";
import type { VoiceLevels } from "../../lib/voiceStage";
import type { Consultation } from "../../lib/voiceStageActivity";
import type { Talking } from "../../lib/voiceTalking";
import type { HeardSegment } from "../../lib/voiceTranscript";
import type { RunningListState } from "./useRunningList";
import type { ScreenFocusControl } from "./useScreenFocus";
import type { TypedTalk } from "./useTypedTalkSeat";

/** One stretch of speech, as the plan call's v3 turns last reported it. */
export interface Segment {
  readonly id: string;
  readonly who: "owner" | "voice";
  readonly text: string;
}

/** One tool call and what it came to. */
export interface ToolLine {
  readonly name: string;
  readonly detail: string;
  readonly refused: boolean;
  /**
   * The link a read tool opened (`openedLinkOf`), written to the call so the next call can open it again — `null` on a
   * url-taking read this line cannot vouch for (`talkToolCalls.ts`'s `openedFieldOf`).
   */
  readonly opened?: string | null;
  /** From the call arriving to its answer going back — the "checking" the owner hears. */
  readonly ms: number | undefined;
  /**
   * What the response that read this answer cost. Unset on every plan call: its delegated thread's token usage is
   * per TURN, not per tool, and goes to the call file instead (`useCallTranscript.ts`).
   */
  readonly usage: TimingUsage | undefined;
  /**
   * What the call was asked and what the model was handed, drawn behind the tray's fold the way a fleet card draws a
   * tool call. Held in the page's memory only: the call file's writer names the fields it keeps (`useCallTranscript.ts`)
   * and this is not one, because whether a call keeps what its tools read is still the owner's decision.
   */
  readonly shown?: ToolCallShown;
  /** A reopened call's opening-window step, which the call file keeps (`useCallTranscript.ts`); absent on a real tool. */
  readonly reopenReminder?: ReopenReminderMeasurement;
  /**
   * When this tool settled, minted once with the call file's own instant. For the messenger band's "2 min ago"; never
   * on the model's wire.
   */
  readonly settledAtIso?: string;
  /** What this tool established, for the messenger band only: the call file's writer names its fields and not this. */
  readonly knowledge?: MessengerReadSubject;
}

/** A replayed discuss-first post: our own line for it, and its caught message carried apart when it threw. */
export interface RelayReplay {
  readonly said: string;
  readonly why: string | undefined;
}

/** One relay attempt, bound to the turn it wrote under (or to none, when the gate shut before one was minted). */
export interface RelayLine {
  readonly turnId: string | undefined;
  readonly say: string;
  readonly heard: string;
  readonly about: string;
  /** `relayed` is a line cmux took into the supervisor's chat; `board-only` is a row that never reached it. */
  readonly outcome: "sending" | "relayed" | "board-only" | "shut" | "refused" | "unknown";
  readonly detail: string;
  /**
   * Why the first post was refused, when a words-alone retry followed it: carried apart from `detail`, which is then
   * our own sentence, so the viewer folds this raw message rather than drawing it inside one (steer 7).
   */
  readonly firstRefusal?: string;
  /** What a discuss-first question's relay, posted again before this one, came to (`relayAttemptPost.ts` `replayPut`). */
  readonly replay?: RelayReplay;
  /** The owner's triage verdict, when the relay carries one: a park leaves its card on the Queue (`../../lib/steeredCards.ts`). */
  readonly triageVerdict?: TriageVerdict;
  /** `true` when the voice judged the owner's words answer the card `about` names (`relay_steer`'s `answers_open_card`). */
  readonly answersCard?: true;
  /** The other Queue cards the voice judged the owner's words answer (`relay_steer`'s `also_answers`); absent when none. */
  readonly alsoAnswers?: readonly string[];
}

/**
 * What a minted call was minted as: a call on the owner's ChatGPT plan through the `codex app-server` child this server
 * holds (`callId`), the only kind there is.
 */
export interface LiveMeta {
  readonly sessionId: string;
  readonly model: string;
  readonly backendModel: string;
  readonly voice: string;
  readonly callId: string;
  readonly threadId: string;
}

/** The session, as the widget and the transcript page read it. */
export interface VoiceState {
  readonly phase: VoicePhase;
  /** What the orb says about the phase: its headline, the turn in flight, and how long it has held. */
  readonly status: VoiceStatus;
  /** Every turn and tool in flight, newest progress first — what the orb's activity tab lists. */
  readonly inFlight: readonly ActivityRow[];
  /**
   * How many `progress` events this provider's calls have had, counting up for good: each new one is a working cue
   * owed (`useOrbCues`, `./OrbCues.tsx`), and a cue still waiting when the next arrives is superseded by it.
   */
  readonly progressCue: number;
  /**
   * The newest heralds the call sent before a line the owner did not ask for (`site/lib/announceCue.ts`), oldest first and
   * numbered, so two in one read of the stream are both played; empty before the first. Played by `useOrbCues`
   * (`./OrbCues.tsx`).
   */
  readonly announceCues: readonly HeardHerald[];
  /**
   * How many triage cards' clocks have run out with no voice call up to herald its own line, counting up for good:
   * each new one is the chime owed (`useOrbCues`, `./OrbCues.tsx`).
   */
  readonly triageDings: number;
  /** Rapid triage's clock now — off, paused, between cards or running to a deadline (`../../lib/triageClockReport.ts`). */
  readonly triageClock: TriageClockReport;
  /** Press one of rapid triage's controls, as the menu bar or a floating note would (`./triageCommandRun.ts`). */
  readonly triagePress: (input: { readonly command: TriageCommand }) => void;
  /**
   * Whether a Codex turn still runs, read off the live activity fold at the call rather than `inFlight`'s last sample,
   * so a working cue scheduled just after the last turn completed is dropped (`useOrbCues`).
   */
  readonly workRunning: () => boolean;
  /**
   * Bind a writer to the call running now, taken when a cue is decided, that puts what became of that cue on the call's
   * file as a `cue` tool line (`site/lib/cueTrace.ts`), so a sound the owner expected and never heard leaves its reason on
   * the record. Never the session viewer's list: a cue is not a tool.
   */
  readonly traceCue: () => (line: { readonly detail: string; readonly refused: boolean }) => void;
  /**
   * Whether THIS provider's call holds the connection — minted or minting — whatever the orb says about it. It is
   * this document's alone: a reload ends it, and `stop`, `live` and the transcript are its.
   */
  readonly callActive: boolean;
  /**
   * Whether a call is up here or anywhere else in the desktop shell — the voice window's, as the shell forwards it to
   * the console window. What a start control reads, so the console window never offers a start while one is up.
   */
  readonly callActiveAnywhere: boolean;
  /**
   * Whether a start can go anywhere from this window: the desktop app's overlay runs it, its console window hands it
   * there, a browser tab has none (`site/lib/voiceStart.ts`). What a start control reads beside `callActiveAnywhere`.
   */
  readonly canStart: boolean;
  /**
   * The running list the owner, the voice and the fleet add to, call or no call, its dot, and the names it draws a `<@U…>`
   * with — the roster's, else the id (`./useRunningList.ts`, `copyMentionLabels`).
   */
  readonly runningList: RunningListState;
  /** Send the nudge `status.nudge` offers, once; a no-op whenever the live fold offers none. */
  readonly nudge: () => void;
  /** The ten bar heights, 0 to 1. */
  readonly bars: readonly number[];
  /** The owner's microphone and the voice's output, each 0 to 1 and unmixed: what the stage orb swells to (`stageOrbLevel`). */
  readonly levels: VoiceLevels;
  /**
   * Whether the owner is audibly talking at the last sample, held across a breath and only after a moment of it: what
   * their typing dots in the conversation read (`site/lib/ownerTalkingShown.ts`), never the raw microphone level.
   */
  readonly ownerTalking: boolean;
  /**
   * Who is talking at the last sample and which signal says so (`site/lib/voiceTalking.ts`), `undefined` in a quiet
   * moment or off a call: the same answer `phase` was drawn from, which the cue gate holds a badge on and names.
   */
  readonly talking: Talking | undefined;
  /** What the session start is doing, while it is connecting. */
  readonly step: string | undefined;
  /** Why the last start or session ended badly, until the next start. */
  readonly failure: string | undefined;
  readonly live: LiveMeta | undefined;
  /** The voice a call is minted in — one of the ChatGPT voices. Fixed for a running call. */
  readonly planVoice: string;
  readonly setPlanVoice: (next: string) => void;
  /** The voice the running call was minted in, from the moment it starts connecting; `undefined` with no call. */
  readonly activePlanVoice: string | undefined;
  /** Hang up and start again, in the voice picked now — the screen share ends with the call. */
  readonly restart: () => void;
  /** Start a call where this window's route sends it; does nothing in a browser tab, which has no route. */
  readonly start: () => void;
  /** Hang up: stop the call on the server, its app-server child and realtime session with it. */
  readonly stop: () => void;
  /** Which microphone and speaker the call is on, the devices the owner can pick between, and their picks. */
  readonly audio: AudioRouteState;
  /** Whether the owner's microphone is muted. */
  readonly muted: boolean;
  /** Mute or unmute the owner's microphone, keeping the call up. */
  readonly toggleMute: () => void;
  /** What was said, each stretch with whether its turn is done (`site/lib/voiceTranscript.ts`). */
  readonly segments: readonly HeardSegment[];
  /**
   * What the owner and the voice said before this conversation, spoken or typed, oldest first — drawn above its speech
   * (`./useEarlierConversation.ts`).
   */
  readonly earlier: readonly EarlierTurn[];
  /**
   * When the page first showed each turn of `segments`, by id: what a tapped live bubble says it was said at. A page
   * observation, unlike an earlier turn's own `beganIso`, which the call file carries.
   */
  readonly shownAt: ReadonlyMap<string, string>;
  /** Why the earlier turns may be missing something, drawn after them as one staleness mark; `undefined` when none. */
  readonly unread: readonly StalenessFact[] | undefined;
  /** Whether the earlier turns' first read is in flight, so the history draws a progress indicator in their place. */
  readonly earlierReading: boolean;
  /** Whether the conversation going on now is spoken or typed. */
  readonly liveMedium: EarlierTurn["medium"];
  /**
   * The orb messenger's typed conversation: the same conversation by text, while no call is up — during one the box is
   * shown but takes nothing (`./useTypedTalk.ts`).
   */
  readonly typed: TypedTalk;
  readonly tools: readonly ToolLine[];
  /** What the voice is consulting now, for the stage's activity line, or `undefined` before its first tool. */
  readonly consultation: Consultation | undefined;
  /** The latest frame a look actually took this call, which the edge pulses for, or `undefined` before one. */
  readonly frameTaken: FrameTaken | undefined;
  /** The region of the owner's screen the voice lifted on their ask, and how a tap drops it (`./useScreenFocus.ts`). */
  readonly screenFocus: ScreenFocusControl;
  readonly relays: readonly RelayLine[];
  /** The page title the voice currently believes the owner is on. */
  readonly pageTitle: string;
  /** The key of the Queue or Automations card the owner has open on that page, or `undefined` with none open. */
  readonly openCard: string | undefined;
  /** The path of that page and the title of that card, as the messenger band names them. */
  readonly bandPlace: { readonly path: string; readonly openTitle: string | undefined };
  /** What the owner's screen share is of, or `undefined` when they are not sharing. */
  readonly sharing: string | undefined;
  /**
   * How the voice sees the owner's screen: `native` in the desktop app's voice window, which looks itself on their ask and so
   * draws no share button; `share` everywhere else (`site/lib/screenFrame.ts`).
   */
  readonly screenSight: ScreenSight;
  readonly shareScreen: () => void;
  readonly stopShare: () => void;
  /**
   * The build a refresh is holding until this call ends, while one is (`site/lib/consoleHold.ts`). The sidebar build
   * chip reads it; neither voice view shows it.
   */
  readonly waiting: WaitingBuild | undefined;
  /** A navigation held because it would have unloaded the page mid-call; it opens when the owner hangs up. */
  readonly held: string | undefined;
  /**
   * The meeting of the owner's starting now that the voice cut in about, whose join link sits beside the orb until the
   * owner clicks it, dismisses it, or it ends (`./useMeetingWatch.ts`).
   */
  readonly meeting: MeetingNotice | undefined;
  /** Take the join link away. */
  readonly dismissMeeting: () => void;
}

/** What a page registers. `title` comes from its `PageHead`; `open` and `shows` from the page body. */
export interface PageRegistration {
  readonly register: (
    part:
      | { readonly title: string }
      | { readonly open: string | undefined; readonly openTitle: string | undefined; readonly shows: unknown },
  ) => void;
  readonly clear: (part: "title" | "reading") => void;
}

export const VoiceContext = createContext<VoiceState | undefined>(undefined);

export const PageVoiceContext = createContext<PageRegistration | undefined>(undefined);

/**
 * The session state, for the widget and the transcript page.
 *
 * @returns the state, or `undefined` outside the console shell (the docs pages have no voice)
 */
export function useVoice(): VoiceState | undefined {
  return useContext(VoiceContext);
}

/**
 * Tell the voice which page this is. `PageHead` calls it, so every console page is named without a line
 * of its own.
 *
 * @param title the page's own title
 */
export function usePageTitle({ title }: { title: string }): void {
  const page = useContext(PageVoiceContext);
  useEffect(() => {
    if (page === undefined) {
      return undefined;
    }
    page.register({ title });
    return () => {
      page.clear("title");
    };
  }, [page, title]);
}

/**
 * Hand the voice what this page is showing, for `read_page`, and which item is open.
 *
 * `shows` is read only when the model asks, so passing a fresh object on every render costs a ref write and
 * nothing else — nothing re-renders. It registers in a layout effect, in the same commit that draws the page, so a
 * `read_page` answered between a commit and its passive effects never hands the voice the figure the page just
 * replaced. Its clear is a layout cleanup too: a departing page's passive cleanup would run after the
 * arriving page registered, and erase it.
 *
 * @param open the `?open=` key of the item the owner has open, or `undefined`
 * @param openTitle that item's title as the page draws it, for the messenger band; it never reaches the model
 * @param shows the page's reading, JSON-serialisable
 */
export function usePageReading({
  open,
  openTitle,
  shows,
}: {
  open: string | undefined;
  openTitle?: string | undefined;
  shows: unknown;
}): void {
  const page = useContext(PageVoiceContext);
  useLayoutEffect(() => {
    page?.register({ open, openTitle, shows });
  });
  useLayoutEffect(() => {
    if (page === undefined) {
      return undefined;
    }
    return () => {
      page.clear("reading");
    };
  }, [page]);
}
