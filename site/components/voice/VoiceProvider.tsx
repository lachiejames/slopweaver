"use client";

/**
 * The console voice: one realtime session that runs in the desktop app's voice window, follows the owner across the
 * console's pages, knows which page they are on, and relays a steer they talk through to the board as their own word.
 *
 * The flow it serves: voice mode is on globally through the floating widget; the owner opens a queue item, asks what
 * they are looking at, the voice answers from what was said earlier, and a relayed steer lands as if the owner had
 * given it directly to the supervisor. Each step is a mechanism below.
 *
 * ## Global, because it runs in its own window
 *
 * The call runs in the desktop app's voice window, which the console window never navigates, so a session
 * started on the Queue is the same session on Pull requests: the console window publishes each page it shows
 * (`publishPage`) and the voice reads it from there. A console page mounts this provider too, in the app or a
 * browser tab, for the record and (in the app) to hand a start across, never to run a call. The hidden `<audio>` element and the `AudioContext`
 * are owned HERE, never by a page. Closing the voice window — `pagehide` — still ends it: a voice session the owner
 * cannot see is one they cannot interrupt.
 *
 * ## Page-aware, on asking
 *
 * Each page names itself through `PageHead` and may hand over a reading (`usePageReading`). The words on the
 * page reach the model only when it calls `read_page`, so a page the owner glances at costs nothing, and one they ask
 * about costs what it shows.
 *
 * ## The whole screen, when asked
 *
 * The read binds to what is in front of the screen, across all apps. So `read_screen`
 * hands the model one still the desktop shell takes itself with no share at all (`captureScreen`), or, under an
 * older shell with no capture of its own, one frame of a screen share the owner opened from the
 * widget with the system picker, which Stop ends with the call. Either way a frame is
 * taken only when the model asks. The weighing is `site/lib/screenFrame.ts`'s header.
 *
 * ## The relay is the owner's, by the gate
 *
 * `relay_steer` is not pressed or offered; the model calls it the moment the owner gives a steer. Before anything
 * is written, `relayGate.ts` reads this session's own record — every raw input-transcript fragment and every
 * tool output, in order — and refuses unless the owner has spoken since the last relay; when something third-party
 * reached the model after they last spoke, the relay goes with their words only and the model's reading is not
 * sent. The row carries their transcribed words first, and the frame a `read_screen` took on their word in this window
 * rides with it — or the word that none was taken, never a capture of its own.
 *
 * ## The voice never waits on the relay
 *
 * The owner needs only a brief acknowledgement before moving on. The model is answered the moment the gate opens, and the 4–8s post runs on `relayQueue` behind the answer
 * (`relayAttempt.ts`'s `handOffRelay`): one turn id per accepted relay, and the gate's boundary taken at accept, so
 * words the owner says while a post runs ride the next relay.
 *
 * ## The owner's ChatGPT plan, and nothing else
 *
 * The call rides the owner's ChatGPT plan through `codex app-server` — the same path Codex's own
 * `/voice` takes, in the chatgpt.com voices. Nothing reaches platform.openai, so a plan
 * refusal is shown as one and nothing else is minted (`site/lib/talkOffer.ts`). The call's data channel speaks
 * realtime v3 (`site/lib/talkPlanEvents.ts`), and its tools arrive from the app-server child this server holds,
 * over `/api/talk/call/<id>/events` (`planCallClient.ts`).
 *
 * ## No credential reaches this page
 *
 * `OpenAILiveWebRTC` takes an application-owned `exchangeSdp`, so the voice window's offer is traded through
 * `/api/talk/offer`, which runs `slopweaver talk offer` and the app-server on this machine. No key, and no
 * ephemeral key, is ever in the document.
 *
 * ## Stop stops what the session ACQUIRED, including what is still being acquired
 *
 * `generation` is bumped by `stop()` and captured before every await. A microphone permission granted after
 * Stop resolves into a stale generation and its tracks are stopped on the spot (`talkSession.ts`'s
 * `stillMine`). A relay already accepted is the one thing Stop does not reach — the voice went on as if it was
 * handed off, and a spawned verb may have written its row — so it is posted, and its outcome recorded against its
 * own turn id when it returns.
 *
 * ## Hanging up is the server's stop
 *
 * The end button beside the orb (`hangUp`) marks the end as the owner's, so no drop cue plays, and calls `stop()`: the
 * call's stop route ends the app-server child and its realtime session together, and no terminal event carries
 * usage to wait for — the delegated thread's usage is written per turn as it arrives.
 *
 * ## A dropped call comes back on its own, still seeing the owner's screen
 *
 * Measured: a call hit the console's 90-minute limit, and on the new one the voice could not see the owner's screen
 * for two minutes — `stop` had closed the owner's share with the call, and only the owner's click re-opens one. The
 * owner wants automatic reconnection with visual and audio feedback. So a live call that ends on a reason the owner
 * did not ask for — the same ends the drop cue sounds for — releases only the call on the wire
 * (`releaseCall`): the drop cue plays, the orb reads "reconnecting" with the attempt, and a new call is minted after
 * `site/lib/callReconnect.ts`'s wait, told it carries on (`talk offer --reconnect`). The owner's screen share, their mute, what
 * the call showed and the console's poll hold all carry over; going live again plays the back cue. Attempts that
 * fail are written onto the dropped call (`talk calls`), and the console keeps trying until the call is back,
 * never spending an attempt while the browser is offline,
 * and trying at once when the network returns. The owner's hang-up, the page left or reloaded, and a start that never went
 * live end it for good, and no reconnect outlives the page: after the app quits, a call starts only when the owner
 * presses start call.
 *
 * ## A long call rolls over in a pause, and the owner never hears it
 *
 * The console's own 90-minute limit cuts the owner off mid-sentence, measured at three times in one day. So past 80 minutes the server tells the page, once, in a free floor, to roll the call
 * over (`site/lib/callRollover.ts`): the page releases the call on purpose with no drop cue, keeps the orb live and
 * opens a successor minted to wait silently (`talk offer --rollover`). Share, mute, what the call showed and the poll
 * hold carry over, exactly as on a reconnect, and nothing plays when it goes live. Only a successor that fails to open
 * is a drop: the drop cue plays, and the reconnect above takes over, journalled onto the call it replaced.
 *
 * ## A lost link is heard and seen at once
 *
 * The owner must know quickly that the call dropped, or they cannot tell a dead call from a slow response. The SDK ends a call only when its peer reaches `failed`, about 30 seconds
 * after the network goes. So a live call watches its peer and the browser's network (`site/lib/callLink.ts`): the
 * moment either is lost the drop cue plays, the orb reads reconnecting with "connection lost", and a quiet connecting
 * cue repeats until the call is back. The call itself is held for a short heal window — releasing it would stop the owner's
 * running Codex consultation — and comes back with the back cue if the link does; past the window it ends as a drop.
 *
 * ## A rebuild waits for the call
 *
 * A rebuild that turns a click into a full reload of the page running the call drops the call. So a live call beats a lease to `/api/console/call`, which holds the refresh round's
 * swap; and any navigation that would unload the voice window's document, the one running the call, is held on
 * the Navigation API's `navigate` event and opened when the owner hangs up — `useCallHold.ts`, with the whole
 * mechanism in `site/lib/consoleHold.ts`'s header.
 *
 * ## The call is written down as it runs
 *
 * A transcript held only in this component's state is lost when a call drops, steers included. So every closed stretch of speech, a snapshot of the open one every few
 * seconds, every tool line and relay, and the call's open and end are queued and posted a batch at a time to
 * `/api/talk/transcript`, which appends them to `$SLOPWEAVER_HOME/talk/calls/<callId>.jsonl`
 * (`site/lib/transcriptSink.ts`, `site/lib/talkTranscript.ts`). `talk calls` and `talk recent` read that file back, and the next call's
 * continuity opens from it. A page going away writes its end and sends the tail as a `keepalive` request.
 *
 * ## The call says which microphone and speaker it is on
 *
 * A call that hears the laptop while the owner's headset is the system input must say so. The microphone opens on the
 * owner's pick, and the line they read is the live track's own device. On the system default
 * both devices follow the Mac live, mid-call; the owner's own pick overrides that until it is unplugged (`useAudioRoute.ts`).
 *
 * ## Rule 2
 *
 * `AGENTS.md` rule 2 bans a headless model. This is a session the owner starts, can see in the desktop app's floating
 * orb, and can stop with one click; it launches no `claude`, holds no queue, and a console nobody has open answers
 * nothing.
 */

import { usePathname } from "next/navigation";
import type { OpenAILiveWebRTC } from "openai/live/webrtc";
import { type ReactElement, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { withHerald } from "../../lib/announceCue";
import { CallDropCue, playCallDropCue } from "../../lib/callDropCue";
import { callEndOutcome, type ReconnectChain, reconnectStepWords } from "../../lib/callReconnect";
import type { CallOpenMode } from "../../lib/callRollover";
import type { FrameTaken } from "../../lib/edgeGlow";
import { relayLines } from "../../lib/heardOver";
import { messengerKnowledgeOf } from "../../lib/messengerKnowledge";
import { openContextOf } from "../../lib/pageVoice";
import { type GateEntry, standingReads } from "../../lib/relayGate";
import { serialQueue } from "../../lib/relayRetry";
import type { ScreenSight } from "../../lib/screenFrame";
import { PAGE_SETUP_TIMEOUT_MS } from "../../lib/talkOffer";
import { foldPlanEvent, type PlanTurn } from "../../lib/talkPlanEvents";
import { DEFAULT_TALK_PLAN_VOICE, isStoredTalkPlanVoice, TALK_PLAN_VOICE_STORAGE_KEY } from "../../lib/talkVoices";
import type { HeardStamp } from "../../lib/transcriptSinkContract";
import type { TypedLookCell, TypedLookState } from "../../lib/typedLookGate";
import type { VoiceLink } from "../../lib/voiceActivity";
import { consultationAnswered, consultationOf } from "../../lib/voiceStageActivity";
import { runVoiceStart } from "../../lib/voiceStart";
import type { HeardSegment } from "../../lib/voiceTranscript";
import { usePreference } from "../console/preference";
import { recordSteerLine } from "../console/steered";
import { connectionStopWhy, functionCallOutputOf, setupFailureOf, stillMine } from "../live/talkSession";
import { quietLiveTicks } from "../live/useLive";
import { meterOf, playVoiceTrack } from "./callAudio";
import { openLiveCall } from "./callOpening";
import type { DesktopVoiceSeam } from "./desktopVoiceSeam";
import { discussFirstLedger } from "./discussFirstLedger";
import { useDraftEditSeams } from "./draftEditRun";
import { toolFailureNotice, useFailureNotice } from "./failureNotice";
import { fileImageAnswerOf } from "./fileImageGrab";
import { mintOffer } from "./mintOffer";
import { type PlanToolCall, planCallEventHandler } from "./planWiring";
import { planEffectHandler, typedInHandler } from "./planWiringEffects";
import {
  claimOnHeld,
  deliverPlanAnswer,
  failLateRun,
  failOnHeld,
  followMinted,
  type HeldPlanCall,
  releasePlanCall,
  speechShower,
} from "./planWiringHeld";
import { framePoster, lookPoster } from "./planWiringLook";
import { onReceipt, prepareCall } from "./prepareCall";
import { freshTurnWindow, handOffRelay, keptRelayLines, type RelayHandedOff, type TurnWindow } from "./relayAttempt";
import type { AskFrame } from "./screenLookSeam";
import { screenLooks } from "./screenLooks";
import { sendWatcher } from "./sendWatchWiring";
import { pendingToolName, postRelay, runVerbTool } from "./talkToolCalls";
import { lookSurfaceOf, runTalkTool } from "./talkToolRun";
import { settleToolAnswer } from "./toolAnswerSettle";
import { useAudioRoute } from "./useAudioRoute";
import { useCallHold } from "./useCallHold";
import { useConnectingCue, useNetworkBack, useReconnectWait, watchCallLink, windowSchedule } from "./useCallLink";
import { useCallTranscript } from "./useCallTranscript";
import { useConversationWork } from "./useConversationWork";
import { useCrashRecovery } from "./useCrashRecovery";
import { windowInstance } from "./useDesktopShell";
import { useEarlierConversation } from "./useEarlierConversation";
import { useFrontWindowNotices } from "./useFrontWindowNotices";
import { useHeldPage } from "./useHeldPage";
import { type HeldPosts, NO_HELD_POSTS, useHeldPosts } from "./useHeldPosts";
import { useLatest } from "./useLatest";
import { useMeetingWatch } from "./useMeetingWatch";
import { type DesktopCardMove, useOpenCardSeams } from "./useOpenCardSeams";
import { useQueueRecord } from "./useQueueRecord";
import { useQueueScreen } from "./useQueueScreen";
import { useQueueScreenServer } from "./useQueueScreenServer";
import { ROLL_NOWHERE, type RollOn, useQuietRollover } from "./useQuietRollover";
import { useRunningList } from "./useRunningList";
import { useScreenFocus } from "./useScreenFocus";
import { useScreenShareControl } from "./useScreenShareControl";
import { useStageSwitchSetter } from "./useStageToggles";
import { useSteerRiskWatch } from "./useSteerRiskWatch";
import { useTriageClockHeld, useTriageCommands } from "./useTriageCommands";
import { callSeat, useTypedTalk } from "./useTypedTalk";
import { useVoiceActivity } from "./useVoiceActivity";
import { useVoiceReadings } from "./useVoiceReadings";
import {
  type LiveMeta,
  PageVoiceContext,
  type RelayLine,
  type Segment,
  type ToolLine,
  VoiceContext,
  type VoiceState,
} from "./voiceContext";
import { IDLE_VOICE_RECORD, type LiveVoiceRecord, openCardReads, voiceRecordWatcher } from "./voiceRecordWiring";

/** Why the console is not moved by a tool that read no record: fail closed, never a move on nothing. */
const NO_RECORD_READ = "the Queue record was not read for this call, so the console was not moved";
/** How many transcript segments, tool lines and relays are kept. The transcript page shows all of them. */
const KEPT_SEGMENTS = 200;
const KEPT_LINES = 40;

/**
 * The console voice's provider. Mounted in `Shell` and, in the desktop shell, in the voice's window too: only the
 * voice's window runs a call, the console window hands its start there, and a browser tab starts none (`desktop`).
 *
 * @param children the console
 * @param desktop its place in the desktop shell; omitted in a browser, where no call starts
 * @returns the console with the voice around it
 */
export function VoiceProvider({
  children,
  desktop,
}: {
  children: ReactNode;
  desktop?: DesktopVoiceSeam | undefined;
}): ReactElement {
  const pathname = usePathname();
  const seam = useRef(desktop);
  useEffect(() => {
    seam.current = desktop;
  }, [desktop]);
  const storedPlan = usePreference<string>({
    accept: isStoredTalkPlanVoice,
    fallback: DEFAULT_TALK_PLAN_VOICE,
    key: TALK_PLAN_VOICE_STORAGE_KEY,
  });
  // The voice's route to the stage switches the owner can click — the same stored values, so either way flips both.
  const setStageSwitch = useStageSwitchSetter();

  // Where the connection is. The status the orb shows is derived from this, the activity fold and the meter.
  const [link, setLink] = useState<VoiceLink>("off");
  const [step, setStep] = useState<string | undefined>(undefined);
  // What the voice is consulting now and the conversation's tool lines, which a fresh call or typed conversation drops.
  const { consultation, conversationOpened, setConsultation, setTools, tools } = useConversationWork();
  const [frameTaken, setFrameTaken] = useState<FrameTaken | undefined>(undefined);
  const [failure, setFailure] = useState<string | undefined>(undefined);
  const [live, setLive] = useState<LiveMeta | undefined>(undefined);
  const [segments, setSegments] = useState<readonly HeardSegment[]>([]);
  // What the owner and the voice said before this conversation, drawn above it (`./useEarlierConversation.ts`).
  const conversation = useEarlierConversation({ segments });
  const {
    earlier,
    fresh: freshConversation,
    medium: liveMedium,
    noteUnwritten,
    reading: earlierReading,
    shownAt,
    unread,
  } = conversation;
  // A turn the sink lost never reaches the file, so the history keeps its carried copy. The desktop
  // test instance's batches are marked off the window's own mark, kept bridge or not, so its call is stamped as the
  // walk's and never read as the owner's words.
  const instance = windowInstance();
  const transcript = useCallTranscript({ instance, kept: KEPT_LINES, onUnwritten: noteUnwritten, setTools });
  const [relays, setRelays] = useState<readonly RelayLine[]>([]);
  // Whether the owner's microphone track is disabled.
  const [muted, setMuted] = useState(false);
  // The voice this call was minted in, set as it starts connecting, so a pick made since can offer a restart.
  const [activePlanVoice, setActivePlanVoice] = useState<string | undefined>(undefined);
  // How many progress events the server sent, each a working cue owed (`VoiceState.progressCue`).
  const [progressCue, setProgressCue] = useState(0);
  // The newest heralds the server sent before a line the owner did not ask for (`VoiceState.announceCues`).
  const [announceCues, setAnnounceCues] = useState<VoiceState["announceCues"]>([]);

  const generation = useRef(0);
  // The generation the owner pressed end on, so the reason that ending carries is theirs and never a drop.
  const closing = useRef<number | undefined>(undefined);
  // Only a live call ending on a reason the owner did not ask for plays the drop cue (`site/lib/callDropCue.ts`),
  // beside the reason the widget already shows.
  const dropCue = useRef(new CallDropCue({ play: playCallDropCue }));
  // A dropped call the console is re-opening on its own (`site/lib/callReconnect.ts`), the wait before its next
  // attempt, and what makes that attempt. Refs only, never storage: a console opened again waits for the owner's press.
  const chain = useRef<ReconnectChain | undefined>(undefined);
  const reopen = useRef<() => void>(() => undefined);
  // The wait before the next attempt, counted down or parked until the network is back.
  const reconnectWait = useReconnectWait({ reopen, setStep });
  // A long call rolled over in a pause before the console's limit, never heard (`site/lib/callRollover.ts`).
  const rollOn = useRef<RollOn>(ROLL_NOWHERE);
  const rollover = useQuietRollover({ chain, dropCue, journal: transcript.tool, rollOn });
  // What stops the live call's link watch (`./useCallLink.ts`) — its heal window and its listeners.
  const unwatchLink = useRef<(() => void) | undefined>(undefined);
  // The live call's watcher (`./voiceRecordWiring.ts`): it writes an unkept grounding down as the call ends, and
  // is told a Slack send the voice was handed landed, so the voice's "sent" is grounded.
  const liveRecord = useRef<LiveVoiceRecord>(IDLE_VOICE_RECORD);
  // Whether the owner is muted, as a ref, so a reconnect's new microphone opens the way the old one was left.
  const mutedNow = useRef(false);
  const connection = useRef<OpenAILiveWebRTC | undefined>(undefined);
  // The plan call this session rides, while it does: its id on this server, and what stops following its events.
  const planCall = useRef<HeldPlanCall | undefined>(undefined);
  // A plan call's open turns, as its data channel has built them so far (`site/lib/talkPlanEvents.ts`).
  const planTurns = useRef<ReadonlyMap<string, PlanTurn>>(new Map());
  const microphone = useRef<MediaStream | undefined>(undefined);
  const speaker = useRef<HTMLAudioElement | null>(null);
  const audio = useRef<AudioContext | undefined>(undefined);
  const micMeter = useRef<AnalyserNode | undefined>(undefined);
  const outMeter = useRef<AnalyserNode | undefined>(undefined);
  const gateLog = useRef<GateEntry[]>([]);
  /** Every tool call this session has dispatched, so a late copy of one is never run again. */
  const claimedCalls = useRef(new Set<string>());
  // The frame the next relay may carry, replaced whole each time a relay is accepted (`relayAttempt.ts`).
  const turnWindow = useRef<TurnWindow>(freshTurnWindow());
  // A share stopped or replaced takes its frame away: a picture an attempt already sent stays, for its retry.
  const dropFrame = useCallback((): void => {
    turnWindow.current.availableScreen = undefined;
  }, []);
  // The repositories this call has put the discuss-first question for, kept to once a call (`discussFirstLedger.ts`).
  const discussFirstAsked = useRef(discussFirstLedger());
  // The latest look's number, so an older look finishing after a newer one started never leaves its frame for a relay.
  const latestLook = useRef(0);
  // The frame the owner's look ask took, which the same turn's `read_screen` answers with rather than a second capture.
  const askFrame = useRef<AskFrame | undefined>(undefined);
  // The one look the owner's latest typed message asked for, set by `useTypedTalk` and spent where the look is taken.
  const typedLook = useRef<TypedLookState | undefined>(undefined);
  // The relay posts queued behind their answers: one at a time, so rows land in the order the owner spoke (`relayRetry.ts`).
  // One queue for the page's life, never one per call: a reconnect's posts wait behind the dropped call's.
  const relayQueue = useRef(serialQueue());
  // Which microphone and speaker the call is on, read off the devices, and the owner's pick of each (`useAudioRoute.ts`).
  const { holdMic, openMic, releaseMic, route } = useAudioRoute({
    audio,
    connection,
    generation,
    micMeter,
    microphone,
    muted,
    speaker,
  });
  // What the clock calls when the owner's words went unanswered, or a promise started nothing: set below, once the plan call's
  // wiring exists.
  const postsNow = useRef<HeldPosts>(NO_HELD_POSTS);
  // What the voice is doing — its delegated turn, its tools, whose turn it is — and the meter that draws it.
  const {
    act,
    bars,
    inFlight,
    micAhead,
    offer: nudgeOffer,
    reset,
    sounding,
    sample,
    status,
    workRunning,
  } = useVoiceActivity({ link, micMeter, muted, outMeter, posts: postsNow, rollover, transcript });
  // Third-party data the session carries from its mint — the context pack — so every relay treats it as read
  // after the owner spoke (`site/lib/relayGate.ts`). Set from the offer's own report, closed when it does not say.
  const standingData = useRef<readonly string[]>([]);
  // The console's twenty-second polls are held from "connecting" until the call ends, then read once: left running
  // they queued a screen relay 12.1s in the browser (`site/lib/liveQuiet.ts`). `start` takes the
  // hold and `stop` gives it back, both synchronously — the pagehide effect's unmount cleanup calls `stop`
  // too, so the hold outlives neither the call nor the provider, and is never dropped before the call ends.
  const quietRelease = useRef<(() => void) | undefined>(undefined);
  const { bandPlace, openCard, openKeyNow, pageTitle, reading, registration, view } = useHeldPage({
    desktop,
    pathname,
  });
  // The conversation and the share as last rendered, for a tool's activity line: read through a ref so the tool
  // loop `openCall` built keeps one stable `answerTool`. Written after every render, below the share it reads.
  const heard = useRef<{ segments: readonly HeardSegment[]; sharing: string | undefined }>({
    segments,
    sharing: undefined,
  });
  // The page's readings draw what is on screen here (`./useVoiceReadings.ts`); a Queue tool answers from the record.
  const voiceReadings = useVoiceReadings({ desktop, drawn: reading, pathname });
  const { contextNow, copyLabels, readings, relayWorkspaceNow, shownNow: shownHere, workContextNow } = voiceReadings;
  // In the shell's voice window, the Queue the console window shows, asked for at the tool.
  const screen = useQueueScreen({ desktop, live: link === "live", shownNow: shownHere, view });
  const { shownNow } = screen;
  // What a Queue tool answers from: the record, read fresh at the tool, checked against that screen.
  const queueRecord = useQueueRecord({ contextNow, readings, screen });
  // `open_card`'s rows, the owner's switch and the move — in the shell's voice window, the console window's (`desktop.cardMove`).
  const cardMove = useLatest<DesktopCardMove | undefined>({ value: desktop?.cardMove });
  const localCallActive = link === "live" || link === "connecting" || link === "reconnecting";
  const focus = useScreenFocus({ callLive: link === "live", heard, seam, segments });
  // The running list, read whether or not a call is up; `offer_copy` adds to it, each landing on a call written to its
  // file and the relay gate's record, and so does the owner's own add, which tells the call or typed conversation up that it
  // changed.
  const listSeams = { callIdNow: () => planCall.current?.callId, copyLabels, freshConversation, gateLog, link };
  const { freshCall, list: runningList, offerCopy } = useRunningList({ ...listSeams, transcript, watcher: liveRecord });

  /** That card, whether the voice opened it, and the owner's console, which a stretch of their speech carries (`talk transcript`). */
  const openNow = useCallback(
    (): HeardStamp => ({ ...openContextOf({ view: view() }), context: workContextNow() }),
    [view, workContextNow],
  );

  const note = useCallback(
    ({ line }: { line: ToolLine }): void => {
      setTools((held) => [...held.slice(-(KEPT_LINES - 1)), line]);
      transcript.tool({ line });
    },
    [setTools, transcript],
  );
  // What became of each orb cue, onto the call file only: the session viewer lists tools, and a cue is not one.
  const traceCue = transcript.cue;

  /** Hand one failure to the console window's toast (`./failureNotice.ts`); an old shell says so on the record. */
  const noticeFailure = useFailureNotice({ note, seamRef: seam });
  // The cards `open_card` presents, and the owner's triage pass over them with its card clock.
  // Rapid triage's clock, out to the menu bar and the orb's buttons, and its chime off a call.
  const triageHeld = useTriageClockHeld({
    callUp: localCallActive || desktop?.callActiveElsewhere === true,
    link: () => seam.current?.triageClock,
  });
  const openCardSeams = useOpenCardSeams({
    callNow: transcript.current,
    clockOut: triageHeld.clockOut,
    desktop: cardMove,
    items: queueRecord.actionItems,
    note,
    openKeyNow,
    planCall,
    queue: queueRecord,
    recordMove: transcript.cardMove,
    sounding,
  });
  useQueueScreenServer({ cards: queueRecord.pageCards, desktop, shownNow: shownHere, view });
  // A live edit of the parked draft on the card the owner has open, aimed at it by the page (`./draftEditRun.ts`).
  const draftEdit = useDraftEditSeams({ call: transcript.current, cards: openCardSeams, heard, open: openKeyNow });
  // The window in front, sampled once for both notices: drift from the owner's plan and straying off ISO.
  const frontWindow = desktop?.frontWindow;
  const driftWatch = useFrontWindowNotices({ frontWindow, heard, live, note, openKeyNow, planCall, readings });
  // A meeting of the owner's starting while the call is up: the voice says it once, and its join link sits beside the orb —
  // unless the owner said they have had it or will not go (`meeting_skip`).
  const { meetingSkip, pill } = useMeetingWatch({ heard, live, note, planCall });
  // A deliverable the owner explicitly steered gone at risk: the voice cuts in once per note, the minute it is up.
  useSteerRiskWatch({ live, note, planCall });
  // The owner's screen shared with the call, which Stop also ends (`./useScreenShareControl.ts`).
  const { share, shareScreen, sharing, stopShare } = useScreenShareControl({ closing, dropFrame, generation, note });
  // The looks, built where a look is taken and never while rendering, since they are made of the provider's refs.
  const looks = useCallback(
    () =>
      screenLooks({
        noteLook: focus.noteLook,
        refs: { askFrame, connection, generation, heard, latestLook, share, turnWindow },
        seam,
        setFrameTaken,
        typedLook,
      }),
    [focus.noteLook, share],
  );
  const typedLookCell = useMemo<TypedLookCell>(
    () => ({
      get: () => typedLook.current,
      set: (next) => {
        typedLook.current = next;
      },
    }),
    [],
  );
  useEffect(() => {
    heard.current = { segments, sharing };
  });

  const recordRelay = useCallback(
    ({ call, line }: { call: string | undefined; line: RelayLine }): void => {
      // A relay of a call the owner has since left for another may only update its own line.
      setRelays((held) => keptRelayLines({ held, kept: KEPT_LINES, line, overtaken: call !== transcript.current() }));
      transcript.relay({ call, line });
      // The card the owner is steering on collapses on the Queue the moment the relay starts, and is accounted for after.
      recordSteerLine({ line, openCard: openKeyNow() });
    },
    [openKeyNow, transcript],
  );

  /**
   * Release the call on the wire — the plan call, the peer connection, the microphone, the meters and the speaker —
   * and write its end, then the reconnect steps it led to. Bumping the generation FIRST is the contract: anything still
   * in flight sees a stale generation when it resolves and releases what it was about to attach. What outlives one call
   * into the next — the owner's screen share, the shown transcript, the console's poll hold — is {@link stop}'s to keep or end.
   */
  const releaseCall = useCallback(
    ({ why, journal }: { why: string | undefined; journal: ReturnType<typeof callEndOutcome>["journal"] }): void => {
      unwatchLink.current?.();
      unwatchLink.current = undefined;
      // Before the bump, so a grounding still unkept is written onto THIS call's file (`./voiceRecordWiring.ts`); an
      // ended call's again folds nothing and, no longer current, writes nothing.
      liveRecord.current.end();
      generation.current += 1;
      releasePlanCall({ held: planCall.current });
      planCall.current = undefined;
      planTurns.current = new Map();
      connection.current?.close();
      connection.current = undefined;
      microphone.current?.getTracks().forEach((track) => {
        track.stop();
      });
      microphone.current = undefined;
      releaseMic();
      // A no-op when the page's leaving already wrote it.
      transcript.end({ journal, leaving: false, why });
      void audio.current?.close();
      audio.current = undefined;
      micMeter.current = undefined;
      outMeter.current = undefined;
      const element = speaker.current;
      if (element !== null) {
        element.srcObject = null;
      }
      setLive(undefined);
      setActivePlanVoice(undefined);
      reset();
    },
    [releaseMic, reset, transcript],
  );

  /**
   * A call is ending. A live one that dropped on a reason the owner did not ask for is re-opened on its own after a wait
   * (`site/lib/callReconnect.ts`), keeping the owner's screen share — the browser will not re-open one without a click — and
   * what the call showed; every other end releases everything, the share included.
   */
  const stop = useCallback(
    ({ why }: { why: string | undefined }): void => {
      // First: a rollover's successor failing starts the reconnect chain this end is then judged against.
      rollover.ended({ why });
      // Before the bump: whether the owner had pressed end on THIS call is what separates their end from a drop.
      const dropped = dropCue.current.ended({ ownerEnding: closing.current === generation.current, why });
      const ending = { callId: transcript.current(), chain: chain.current, dropped, nowMs: performance.now(), why };
      const outcome = callEndOutcome(ending);
      reconnectWait.clear();
      releaseCall({ journal: outcome.journal, why });
      if (outcome.kind === "retry") {
        chain.current = outcome.chain;
        setFailure(undefined);
        setStep(reconnectStepWords({ attempt: outcome.attempt }));
        setLink("reconnecting");
        reconnectWait.wait({ attempt: outcome.attempt, delayMs: outcome.delayMs });
        return;
      }
      chain.current = undefined;
      stopShare();
      setMuted(false);
      mutedNow.current = false;
      closing.current = undefined;
      setStep(undefined);
      quietRelease.current?.();
      quietRelease.current = undefined;
      if (outcome.why === undefined) {
        setLink("off");
      } else {
        setFailure(outcome.why);
        setLink("failed");
      }
    },
    [reconnectWait, releaseCall, rollover, stopShare, transcript],
  );
  useNetworkBack({ wait: reconnectWait });
  useConnectingCue({ link });

  /**
   * The owner's hang-up. The call's end is the server's to make — its stop route ends the app-server child and the
   * realtime session together, and no terminal event carries usage to wait for — so this is {@link stop}, marked
   * as the owner's end first so a reason racing the press never plays the drop cue.
   */
  const hangUp = useCallback((): void => {
    closing.current = generation.current;
    stop({ why: undefined });
  }, [stop]);

  /**
   * Mute or unmute the owner's microphone — the call, its context and the screen share stay up. The local track is
   * disabled, so what the owner says leaves the voice window as silence, at the press: realtime v3 has no mute event to
   * acknowledge, and silence is what it hears.
   */
  const toggleMute = useCallback((): void => {
    const want = !muted;
    microphone.current?.getAudioTracks().forEach((track) => {
      track.enabled = !want;
    });
    mutedNow.current = want;
    setMuted(want);
  }, [muted]);

  useEffect(() => {
    const onHide = (): void => {
      transcript.end({ journal: undefined, leaving: true, why: "the page was closed or reloaded mid-call" });
      stop({ why: undefined });
    };
    window.addEventListener("pagehide", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
      stop({ why: undefined });
    };
  }, [stop, transcript]);

  /**
   * Answer one relay at once and post it behind the answer (`relayAttempt.ts`'s `handOffRelay`). `mine` is the
   * session that asked for it. The queue is the page's one queue, so a reconnect's posts wait behind the dropped
   * call's and every row lands in the order the owner gave them. What the steer carries beside the owner's words — a check-in or
   * candidate verdict, a triage ruling, the outward act — is `handOffRelay`'s own to document.
   */
  const relay = useCallback(
    ({ mine, ...steer }: Omit<Parameters<typeof handOffRelay>[0], "seams"> & { mine: number }): RelayHandedOff => {
      const queue = relayQueue.current;
      const current = (): boolean => stillMine({ current: generation.current, mine });
      return handOffRelay({
        ...steer,
        seams: {
          discussFirst: discussFirstAsked.current,
          enqueue: (task) => void queue.run(task),
          gateLog,
          lines: relayLines<RelayLine>({ openNow: openKeyNow, record: recordRelay, transcript }),
          live: () => current() && closing.current !== mine,
          micAhead,
          mintTurnId: () => crypto.randomUUID(),
          nowIso: () => new Date().toISOString(),
          post: (wire) => postRelay({ instance: windowInstance(), wire }),
          relayed: transcript.relayed,
          standing: () => standingData.current,
          turnWindow,
          watchSend: sendWatcher({
            current,
            gateLog,
            held: () => planCall.current,
            note,
            onLanded: (input) => {
              liveRecord.current.landed(input);
            },
            read: runVerbTool,
          }),
          workspace: relayWorkspaceNow,
        },
      });
    },
    [micAhead, note, openKeyNow, recordRelay, relayWorkspaceNow, transcript],
  );

  /**
   * Answer one tool call and hand the result back to the model. A refusal goes back as the OUTPUT, because
   * a call that gets no answer leaves the session waiting while one that gets a reason can say it out loud.
   */
  const answerTool = useCallback(
    async (call: PlanToolCall & { mine: number; typed: boolean }): Promise<void> => {
      const { mine, tool: name, token, rawArguments, turnId, typed: fromTyped } = call;
      act({ input: { callId: token, kind: "tool-started", name: pendingToolName({ rawArguments, tool: name }) } });
      const { segments: heardNow, sharing: sharingNow } = heard.current;
      setConsultation(
        consultationOf({
          pageShows: view().shows,
          rawArguments,
          screen: lookSurfaceOf({ native: seam.current?.captureScreen !== undefined, sharing: sharingNow }),
          segments: heardNow,
          token,
          tool: name,
        }),
      );
      // The plan call it was claimed on, kept in case the owner hangs up while it runs and `stop` clears `planCall`; and the
      // call file it began on, which its answer is journalled to however the call has moved on since.
      const [startedOn, startedCall] = [planCall.current, transcript.current()];
      const began = performance.now();
      const look = looks().tool({ mine, token, typed: fromTyped });
      const ran = await runTalkTool({
        answerId: turnId,
        name,
        rawArguments,
        // The tool call's own token, so a retried `offer_copy` is the one item on the list rather than two.
        requestId: token,
        seams: {
          ...openCardSeams,
          actionItems: queueRecord.actionItems,
          readQueueRecord: queueRecord.readQueueRecord,
          // Replaced by each Queue tool call's own (`./talkToolRun.ts`); a move with no record read never happens.
          undrawnWhy: async () => NO_RECORD_READ,
          draftEdit,
          fileImage: ({ image }) =>
            fileImageAnswerOf({ image, maxMessageSize: connection.current?.peerConnection.sctp?.maxMessageSize }),
          focus: driftWatch,
          meetingSkip,
          offerCopy,
          relay: (steer) => relay({ ...steer, mine }),
          screenFocus: focus.run,
          screenShot: look.screenShot,
          stageSetting: setStageSwitch,
          gateLog: () => gateLog.current,
          // `verb` is `openCardSeams`' own: a Slack thread goes in front of the owner once per call (`./slackScreenVerb.ts`).
          view,
        },
      });
      let { detail, readText, refused } = ran;
      // The console window hears of a failure once, on the call's FINAL outcome (`toolFailureNotice`) — one that
      // finished after the call ended included, since what it tried for the owner still failed. A tool that
      // RAN after the call ended raises nothing: its answer was dropped by the hang-up, not failed.
      const { partialFailures, triageVisit } = ran;
      if (!stillMine({ current: generation.current, mine })) {
        noticeFailure({ notice: toolFailureNotice({ detail, partialFailures, refused, tool: name, why: undefined }) });
        // The session ended while this was in flight: no call to answer, and a log line would report work on a
        // session that is gone. A relay has already recorded itself against its turn — the relay log is kept across
        // sessions and keyed by turn, so that replaces its own "sending" row. The activity is NOT touched: `stop`
        // reset it, and it now belongs to a later session. The plan call it was claimed on is still told it will not
        // be answered, in case the stop did not arrive; one that did stop refuses.
        failLateRun({ held: startedOn, token });
        return;
      }
      act({ input: { callId: token, kind: "tool-answered" } });
      const { failure: unsent, output } = functionCallOutputOf({ answer: ran.answer, image: ran.image, tool: name });
      if (unsent === undefined) {
        setConsultation((now) => consultationAnswered({ consultation: now, image: ran.image, token }));
      } else {
        // Only the refusal reaches the model, so no third-party text did.
        ({ detail, readText, refused } = { detail: unsent.message, readText: false, refused: true });
      }
      const lookedApp = look.lookedApp();
      const knowledge = messengerKnowledgeOf({ lookedApp, name, page: view(), rawArguments, refused });
      // Delivered FIRST, its answer journalled after onto the call it began on.
      const why = await settleToolAnswer({
        call: startedCall,
        deliver: deliverPlanAnswer,
        delivery: { gateLog, readText, token, triageVisit },
        live: () => stillMine({ current: generation.current, mine }),
        note,
        output,
        plan: planCall.current,
        settle: transcript.settledTool,
        tool: { detail, knowledge, ms: Math.round(performance.now() - began), name, rawArguments, refused, turnId },
      });
      noticeFailure({ notice: toolFailureNotice({ detail, partialFailures, refused, tool: name, why }) });
    },
    [
      act,
      draftEdit,
      driftWatch,
      focus.run,
      looks,
      meetingSkip,
      note,
      noticeFailure,
      offerCopy,
      openCardSeams,
      queueRecord.actionItems,
      queueRecord.readQueueRecord,
      relay,
      setConsultation,
      setStageSwitch,
      transcript,
      view,
    ],
  );
  const seat = useCallback(() => callSeat({ claimedCalls, gateLog, generation, planCall, standingData }), []);
  const typed = useTypedTalk({
    act,
    answerTool,
    conversationOpened,
    fresh: freshConversation,
    kept: KEPT_SEGMENTS,
    note,
    openNow,
    seat,
    setSegments,
    transcript,
    turnStarted: openCardSeams.triage.turnStarted,
    typedLook: typedLookCell,
  });
  // Rapid triage's presses — menu bar, floating note, the orb's own buttons — run in this window's conversation.
  const triagePress = useTriageCommands({
    link: desktop?.triageClock,
    note,
    seams: openCardSeams,
    typed,
    voiceCallUp: triageHeld.callUpNow,
  });

  /**
   * Open a session: microphone, peer connection, SDP trade, tool loop. A reconnect keeps what the dropped call showed
   * and the orb's reconnect line, and is minted to carry on rather than open fresh; a rollover keeps the same, says
   * nothing on the orb, and is minted to wait silently for the owner.
   */
  const openCall = useCallback(
    async ({ mode }: { mode: CallOpenMode }): Promise<void> => {
      const carrying = mode !== "fresh";
      generation.current += 1;
      const mine = generation.current;
      claimedCalls.current = new Set();
      const planVoice = storedPlan.value;
      setActivePlanVoice(planVoice);
      const thisCall = transcript.begin();
      // What the dropped call was consulting died with its plan child, so a reconnect clears it too.
      conversationOpened({ carrying });
      setFrameTaken(undefined);
      askFrame.current = undefined;
      if (!carrying) {
        freshCall();
        discussFirstAsked.current.reset();
        openCardSeams.startFreshCall();
        setSegments([]);
      }
      setFailure(undefined);
      gateLog.current = [];
      turnWindow.current = freshTurnWindow();
      if (quietRelease.current === undefined) {
        quietRelease.current = quietLiveTicks();
      }
      // A reconnect's own line stays on the orb while it is made; a pressed start says each step.
      const say = (line: string): void => {
        if (!carrying) {
          setStep(line);
        }
      };
      if (!carrying) setLink("connecting");
      say("asking for the microphone");

      const stillWanted = (): boolean => stillMine({ current: generation.current, mine });
      // Judged again on receipt, not only inside: its return is one more turn of the queue a newer press can take.
      // Bounded only when the page opened it, so a slow attempt is journalled as failed rather than going quiet.
      const prepared = await prepareCall({ mode, openMic, schedule: windowSchedule, stillWanted });
      const ready = onReceipt({ ready: prepared, stillWanted });
      if ("superseded" in ready) {
        return;
      }
      if ("why" in ready) {
        stop({ why: ready.why });
        return;
      }
      const { opened, LiveWebRTC } = ready;
      const { stream } = opened;
      // Muted when the call dropped stays muted on the call that replaced it.
      stream.getAudioTracks().forEach((track) => {
        track.enabled = !mutedNow.current;
      });
      microphone.current = stream;
      holdMic(opened);
      audio.current = new AudioContext();
      micMeter.current = meterOf({ context: audio.current, stream });

      const conn = new LiveWebRTC();
      connection.current = conn;
      stream.getAudioTracks().forEach((track) => {
        conn.peerConnection.addTrack(track, stream);
      });
      conn.peerConnection.addEventListener("track", (event: RTCTrackEvent) => {
        const out = playVoiceTrack({ context: audio.current, event, speaker: speaker.current });
        if (out !== undefined) outMeter.current = out;
      });

      // Its counts held to the app's, and each starting Codex turn handed what it has not had (`./voiceRecordWiring.ts`).
      const voiceRecord = voiceRecordWatcher({
        current: () => stillMine({ current: generation.current, mine }),
        heardStamp: transcript.heardStamp,
        held: () => planCall.current,
        note,
        ...openCardReads({ cards: openCardSeams.cards, gateLog }),
        shownNow,
      });
      liveRecord.current = voiceRecord;
      const drawSpeech = speechShower({ call: thisCall, kept: KEPT_SEGMENTS, openNow, setSegments, transcript });
      const showSpeech = (input: { speech: Segment; final: boolean }): void => {
        drawSpeech(input);
        voiceRecord.speech(input);
      };
      const looking = lookPoster({
        current: () => stillMine({ current: generation.current, mine }),
        held: () => planCall.current,
        note,
      });
      // The frame for the owner's look ask is a look like `read_screen`'s, so a relay this turn carries it and the edge pulses.
      let framesTaken = 0;
      const framing = framePoster({
        current: () => stillMine({ current: generation.current, mine }),
        held: () => planCall.current,
        note,
        shoot: () => {
          framesTaken += 1;
          return looks().ask({ mine, token: `frame-${String(framesTaken)}` })();
        },
      });
      const onPlanEffect = planEffectHandler({
        act,
        framing: () => void framing(),
        gateLog,
        looking,
        note,
        show: showSpeech,
      });
      const onPlanCallEvent = planCallEventHandler({
        act,
        answer: (call) => void answerTool({ ...call, mine, typed: false }),
        claim: claimOnHeld,
        fail: failOnHeld,
        held: () => planCall.current,
        claimed: claimedCalls,
        closing: () => closing.current === mine,
        current: () => stillMine({ current: generation.current, mine }),
        ended: stop,
        journal: transcript.tool,
        note,
        progress: () => {
          setProgressCue((count) => count + 1);
        },
        announce: ({ cue }) => {
          setAnnounceCues((kept) => withHerald({ cue, kept }));
        },
        // Held until the page's own floor is free at the stage the deadline puts it in (`QuietRollover.observed`).
        rollover: (ask) => {
          rollover.asked({
            ...ask,
            callId: thisCall,
            standing: () => ({
              closing: closing.current === mine,
              current: stillMine({ current: generation.current, mine }),
            }),
          });
        },
        // What the owner typed into the Messenger mid-call, from whichever window: heard, shown and written as the owner's turn.
        typedIn: typedInHandler({ act, gateLog, show: showSpeech }),
        turnStarted: openCardSeams.triage.turnStarted,
        usage: transcript.usage,
        // A voice call speaks rather than writes to the page, but what the thread handed it is kept on the call file,
        // so a line the owner heard can be told apart from the line the thread wrote.
        written: transcript.written,
      });

      conn.onEvent((event) => {
        if (!stillMine({ current: generation.current, mine })) {
          return;
        }
        const folded = foldPlanEvent({ event, turns: planTurns.current });
        planTurns.current = folded.turns;
        folded.effects.forEach(onPlanEffect);
      });
      // Until `connect` settles, its rejection is the one report of a setup failure: the SDK emits `closed` first.
      let settingUp = true;
      conn.onConnectionEvent((event) => {
        const why = connectionStopWhy({ event, settingUp });
        if (why !== undefined && stillMine({ current: generation.current, mine })) {
          stop({ why });
        }
      });

      say("minting the session");
      let minted: LiveMeta | undefined;
      try {
        await conn.connect({
          exchangeSdp: async (offer, { signal }) => {
            const answer = await mintOffer({ instance: windowInstance(), mode, offer, signal, voice: planVoice });
            const current = stillMine({ current: generation.current, mine });
            planCall.current = followMinted({
              current,
              minted: answer.minted,
              onEvent: (event) => {
                onPlanCallEvent(event);
                voiceRecord.event({ event });
              },
            });
            // Only this call's own mint may say what it carries: an older start answering late must not clear it.
            standingData.current = standingReads({ packed: answer.packed });
            minted = answer.minted;
            return answer.sdp;
          },
          timeoutMs: PAGE_SETUP_TIMEOUT_MS,
        });
        settingUp = false;
      } catch (cause) {
        settingUp = false;
        if (stillMine({ current: generation.current, mine })) {
          stop({ why: setupFailureOf({ cause }) });
        }
        return;
      }
      if (!stillMine({ current: generation.current, mine })) {
        conn.close();
        return;
      }
      if (minted === undefined) throw new Error("the session connected without being minted"); // `start` stops it
      transcript.open({ call: thisCall, minted });
      setLive(minted);
      setStep(undefined);
      dropCue.current.wentLive();
      setLink("live");
      // A rollover's successor going live is no reconnect: no back cue, no reconnect step, nothing the owner hears. Settled
      // before the link watch, so a link already lost reads as this call's own drop.
      const rolledOver = rollover.opened();
      unwatchLink.current = watchCallLink({
        current: () => stillMine({ current: generation.current, mine }),
        dropCue: dropCue.current,
        end: stop,
        peer: conn.peerConnection,
        show: (shown) => {
          setStep(shown.step);
          setLink(shown.link);
        },
      });
      if (rolledOver) {
        return;
      }
      // Back from a drop: its cue. Fresh: the reopen window, armed only on one the owner reopened within the minute.
      openLiveCall({ callId: minted.callId, chain, current: stillWanted, mode, sounding, thisCall, transcript });
    },
    [
      act,
      answerTool,
      conversationOpened,
      freshCall,
      holdMic,
      looks,
      note,
      openMic,
      openCardSeams,
      rollover,
      sounding,
      stop,
      storedPlan.value,
      transcript,
      openNow,
      shownNow,
    ],
  );

  // Setup throws outside `openCall`'s own catches (a synchronous `new AudioContext()`, say) still end the call,
  // so neither the microphone nor the console's poll hold outlives a failed start. `openCall` bumps
  // `generation` before its first await, so `mine` is this attempt's and a newer call is never stopped.
  const start = useCallback(
    async ({ mode }: { mode: CallOpenMode }): Promise<void> => {
      if (mode === "fresh") {
        // One conversation at a time (`./useTypedTalk.ts`): a typed answer still coming waits; the offer ends an idle one.
        if (!typed.yieldToCall({ refused: setFailure })) return;
        // The owner's press is a new call, never an attempt of a reconnect still waiting.
        reconnectWait.clear();
        chain.current = undefined;
      }
      const attempt = openCall({ mode });
      const mine = generation.current;
      await attempt.catch((cause: unknown) => {
        if (stillMine({ current: generation.current, mine })) stop({ why: setupFailureOf({ cause }) });
      });
    },
    [openCall, reconnectWait, stop, typed],
  );
  useEffect(() => {
    reopen.current = () => {
      void start({ mode: "reconnect" });
    };
    rollOn.current = {
      open: () => void start({ mode: "rollover" }),
      release: ({ why }) => {
        reconnectWait.clear();
        releaseCall({ journal: undefined, why });
      },
    };
  }, [reconnectWait, releaseCall, rollOn, start]);
  // The live call told to the shell, and one its renderer died under ended and reconnected (`./useCrashRecovery.ts`).
  useCrashRecovery({ currentCall: transcript.current, desktop, failed: setFailure, generation, live, reopen });

  /**
   * The owner's restart, for a setting that cannot change a running call — the plan voice is minted with it. The owner's end of the
   * old call, then a new one in the voice picked now; the screen share ends with the old call, as any hang-up ends it.
   */
  const restart = useCallback((): void => {
    hangUp();
    void start({ mode: "fresh" });
  }, [hangUp, start]);

  // The owner's nudge, asking the voice to take its turn when the owner's words went unanswered, and the page's own nudge over a
  // promise that started nothing, each on the plan call held now.
  const posts = useHeldPosts({ act, closing, generation, note, offer: nudgeOffer, planCall });
  useEffect(() => {
    postsNow.current = posts;
  }, [posts]);
  // A reconnect holds the build and the page exactly as the live call did: a swap in the gap would reload the page,
  // and a reload ends the call for good.
  const isLive = link === "live" || link === "reconnecting";
  const { held: shownHeld, waiting: shownWaiting } = useCallHold({ live: isLive });
  const callActiveElsewhere = desktop?.callActiveElsewhere === true;
  const startRoute = desktop?.startRoute;
  const screenSight: ScreenSight = desktop?.captureScreen === undefined ? "share" : "native";
  const state = useMemo<VoiceState>(
    () => ({
      activePlanVoice,
      announceCues,
      audio: route,
      bars,
      consultation,
      // The meeting whose join pill is up, and how the owner dismisses it (`./useMeetingWatch.ts`).
      ...pill,
      earlier,
      earlierReading,
      liveMedium,
      runningList,
      shownAt,
      unread,
      failure,
      frameTaken,
      held: shownHeld,
      ...sample,
      live,
      muted,
      openCard,
      pageTitle,
      bandPlace,
      callActive: localCallActive,
      callActiveAnywhere: localCallActive || callActiveElsewhere,
      inFlight,
      nudge: posts.nudge,
      phase: status.phase,
      progressCue,
      relays,
      screenFocus: focus.control,
      screenSight,
      segments,
      sharing,
      status,
      shareScreen: () => void shareScreen(),
      planVoice: storedPlan.value,
      setPlanVoice: (next: string) => {
        if (isStoredTalkPlanVoice(next)) {
          storedPlan.set(next);
        }
      },
      restart,
      canStart: startRoute !== undefined,
      // The route of the render that drew the control, never the seam ref: the ref catches up only in an effect, so a
      // talk button drawn on the hydrating render would otherwise press into the route-less seam before it. A browser
      // tab's render has no route, so it still starts nothing, whatever drew the press.
      start: () => {
        runVoiceStart({ route: startRoute, startHere: async () => start({ mode: "fresh" }) });
      },
      step,
      stop: hangUp,
      stopShare,
      toggleMute,
      tools,
      traceCue,
      triageClock: triageHeld.triageClock,
      triageDings: triageHeld.triageDings,
      triagePress,
      typed,
      waiting: shownWaiting,
      workRunning,
    }),
    [
      activePlanVoice,
      announceCues,
      bandPlace,
      bars,
      callActiveElsewhere,
      consultation,
      earlier,
      earlierReading,
      liveMedium,
      shownAt,
      unread,
      sample,
      failure,
      focus.control,
      frameTaken,
      hangUp,
      inFlight,
      live,
      localCallActive,
      muted,
      pill,
      posts.nudge,
      openCard,
      pageTitle,
      progressCue,
      relays,
      restart,
      route,
      runningList,
      screenSight,
      segments,
      shareScreen,
      sharing,
      shownHeld,
      status,
      shownWaiting,
      start,
      startRoute,
      step,
      workRunning,
      stopShare,
      storedPlan,
      toggleMute,
      tools,
      traceCue,
      triageHeld.triageClock,
      triageHeld.triageDings,
      triagePress,
      typed,
    ],
  );

  return (
    <PageVoiceContext.Provider value={registration}>
      <VoiceContext.Provider value={state}>
        {children}
        {/* The speaker lives here, never on a page, so navigation cannot unmount it mid-sentence. */}
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <audio ref={speaker} className="hidden" autoPlay />
      </VoiceContext.Provider>
    </PageVoiceContext.Provider>
  );
}
