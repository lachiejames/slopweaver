/**
 * One relay, from the model's call to the line the page journals: the gate's verdict and the hand-off the model is
 * answered with AT ONCE, then the post, and the one words-alone retry a pre-claim refusal earns, behind it. The
 * rules are `site/lib/relayGate.ts`'s and `site/lib/relayRetry.ts`'s; this runs them against the page's state,
 * which the provider hands in as seams so the sequence is testable without a page.
 *
 * ## The voice never waits on the post
 *
 * The voice must not make the owner sit waiting on a relay: it says it has the steer and moves on to the next
 * thing. Each `talk relay` post takes 4–8s — it registers a row and types a line into the supervisor's chat — and a
 * delegated turn held on the tool answer for all of it. So {@link handOffRelay} answers synchronously, by type, and
 * the post runs on the page's serial queue while the call goes on. The supervisor reads every word of the call anyway
 * (`talk unread`), and where a steer went is journalled on its relay line, the turn file and `talk log`, which
 * `recent_steers` reads back when the owner asks whether it landed.
 *
 * ## A relay's outcome is journalled, never said
 *
 * The owner does not want relay failures reported to them, because the supervisor is reading what they say live
 * whether or not the voice relays it, and does not want the voice talking about whether something reached the
 * supervisor chat. So whatever a relay came to — refused, unknown, on the board but not in the chat —
 * stays on the relay's line, the turn file and `talk log`, and nothing here tells the console window or the voice.
 *
 * ## The boundary is taken when the relay is accepted
 *
 * The gate's `relayed` entry, the transcript's card stamp and the turn window are all reset the moment the model is
 * answered, not when the post comes back. Words the owner says while the post runs are the NEXT relay's, never swallowed
 * by a boundary pushed four seconds after them. The cost, accepted: a post that is refused twice, or whose outcome
 * is unknown, does not carry its words into a later relay — the line says so, and the call record holds them.
 */
import {
  discussFirstDecision,
  discussFirstWireOf,
  type PriorDiscussFirst,
  type TeamFixAsk,
} from "../../lib/discussFirst";
import { relayAboutJudged } from "../../lib/heardOver";
import { type CheckSend, type HandOffRuling, handedOffAnswer, type RelayOutward } from "../../lib/relayAnswer";
import type { GateEntry } from "../../lib/relayGate";
import type { RelayWorkspace } from "../../lib/relayWorkspace";
import type { CandidateRulingWire, TalkRelayWire } from "../../lib/talkRelayRequestWire";
import type { TriageRulingWire } from "../../lib/triageWords";
import type { WorkContext } from "../../lib/workContext";
import { acceptRelay } from "./relayAttemptAccept";
import { attemptRelay, RETRYING_DETAIL, type RelayPosted, relayOutcomeLine, replayPut } from "./relayAttemptPost";
import type { CheckInVerdict } from "./talkToolRunArgs";
import type { RelayLine, RelayReplay } from "./voiceContext";

/**
 * The page's state for the stretch of the owner's speech the next relay will carry. It is replaced whole when a relay is
 * accepted or a call opens, never cleared field by field, so a look that finishes late writes only into the window
 * it started in (`./screenLookSeam.ts`).
 */
export interface TurnWindow {
  /**
   * What the latest `read_screen` in this window took, at relay size — the only picture a relay may carry. Cleared
   * while a later look is in flight and when the share stops, so a frame older than the owner's latest ask never travels.
   */
  availableScreen: TalkRelayWire["screen"] | undefined;
  /** How many `read_screen` grabs started in this window are still running: while any is, a relay carries no picture. */
  looksRunning: number;
}

/**
 * A window no relay has been accepted in yet.
 *
 * @returns the empty window a call opens with, and each accepted relay leaves behind
 */
export function freshTurnWindow(): TurnWindow {
  return { availableScreen: undefined, looksRunning: 0 };
}

/**
 * The picture a relay carries: the frame a `read_screen` took on the owner's word in this window, else the plain statement
 * that none was taken. Never a capture of its own, and never a frame while any look is still running, since that look
 * may be the one the owner meant.
 *
 * @param available what the latest look in this window took
 * @param looking a look started in this window has not finished
 * @returns the relay's screen field
 */
export function relayPictureFor({
  available,
  looking,
}: {
  available: TalkRelayWire["screen"] | undefined;
  looking: boolean;
}): TalkRelayWire["screen"] {
  if (available !== undefined && !looking) {
    return available;
  }
  return { kind: "none", reason: "not-taken-this-turn" };
}

/** What the page reaches for one hand-off — its own refs and calls, plain fakes in a test. */
export interface RelayHandOffSeams {
  /** Whether the session that called the tool is still the live one, and not hanging up. */
  readonly live: () => boolean;
  readonly gateLog: { readonly current: GateEntry[] };
  /**
   * Whether the owner's microphone was audible after the page received their latest words (`micAheadOfWords`): read
   * once at hand-off, because the transcript and the relay's call ride two transports with no ordering between them.
   */
  readonly micAhead: () => boolean;
  readonly standing: () => readonly string[];
  readonly turnWindow: { current: TurnWindow };
  /**
   * The relay's lines (`site/lib/heardOver.ts`'s `relayLines`): the card it is about, the card the voice's judgement
   * may land on, the console the owner's words over no card were said on, and one line recorded.
   */
  readonly lines: {
    readonly about: () => string;
    readonly judgeable: () => string;
    readonly spokenIn: () => WorkContext | undefined;
    readonly record: (input: { line: RelayLine }) => void;
  };
  /** The transcript's own boundary: what a later relay is about starts again from the owner's next words. */
  readonly relayed: () => void;
  readonly mintTurnId: () => string;
  /**
   * Whose work words over this card, or said on this console, are — read once at hand-off, the card's placement as
   * the page's Queue holds it then (`../../lib/relayWorkspace.ts`), or `undefined` for none.
   */
  readonly workspace: (input: { about: string; spokenIn: WorkContext | undefined }) => RelayWorkspace | undefined;
  /** Runs a post behind every post queued before it, never awaited by the tool answer. */
  readonly enqueue: (task: () => Promise<void>) => void;
  readonly post: (wire: TalkRelayWire) => Promise<RelayPosted>;
  /** The instant a relay is accepted, as ISO — the floor a Slack send's outcome is read after. */
  readonly nowIso: () => string;
  /**
   * Start watching a Slack send the owner asked for, so a held or failed one is said to them unasked and one that went is not
   * (`./slackSendWatch.ts`). Called
   * after the post is queued and never awaited, so the tool answer is not held on it.
   */
  readonly watchSend: (send: CheckSend) => void;
  /**
   * This call's discuss-first ledger (`../../lib/discussFirst.ts`): the relay that put the question for a repository,
   * and the claim made when one does. Kept across a reconnect and a quiet rollover, emptied when a fresh call opens.
   * A put whose own post did not certainly land holds its last wire, and the owner's answer posts it again first (`replay`).
   */
  readonly discussFirst: {
    readonly prior: (input: { repository: string }) => PriorDiscussFirst | undefined;
    readonly claim: (input: { repository: string; prior: PriorDiscussFirst }) => void;
    readonly holdReplay: (input: { repository: string; wire: TalkRelayWire }) => void;
    readonly takeReplay: (input: { repository: string }) => TalkRelayWire | undefined;
  };
}

/** The tool answer one `relay_steer` call is handed, its log line's detail, and whether it counts as refused. */
export interface RelayHandedOff {
  readonly answer: unknown;
  readonly detail: string;
  readonly refused: boolean;
}

/**
 * Answer one `relay_steer` call NOW: the gate's refusal, or the hand-off with its post queued behind it. Synchronous
 * by type, so nothing the post does can hold the model's turn. An accepted post runs even if the owner hangs up before it
 * reaches the head of the queue: the voice already went on, and the row carries only words the owner said on the call.
 *
 * @param say the voice's reading of the owner's steer
 * @param checkIn the check-in the owner's words are a verdict on, when they are one
 * @param candidateRuling the workstream candidate the owner's words rule on, when they do
 * @param triage the owner's triage ruling and the card the pass has open, which the relay is then about, when their words rule it
 * @param outward what the owner's words ask to be done outside the call; page-side only, never on the wire to `talk relay`
 * @param fix the fix the owner's words ask be raised on a team repository, when they ask for one
 * @param answersOpenCard the voice's judgement that the owner's words answer the card open as they began them
 * @param alsoAnswers the other Queue cards the voice judged the owner's words answer, already held to what this call served
 * @param seams the page's state and calls
 * @returns the tool answer, its log line's detail, and whether it counts as refused
 */
export function handOffRelay({
  say,
  checkIn,
  candidateRuling,
  triage,
  outward,
  fix,
  answersOpenCard,
  alsoAnswers,
  seams,
}: {
  say: string;
  checkIn: CheckInVerdict | undefined;
  candidateRuling: CandidateRulingWire | undefined;
  triage: { readonly ruling: TriageRulingWire; readonly key: string } | undefined;
  outward: RelayOutward;
  fix: TeamFixAsk | undefined;
  answersOpenCard: boolean;
  alsoAnswers: readonly string[];
  seams: RelayHandOffSeams;
}): RelayHandedOff {
  const shut = ({ about, why }: { about: string; why: string }): RelayHandedOff => {
    seams.lines.record({ line: { about, detail: why, heard: "", outcome: "shut", say, turnId: undefined } });
    return { answer: { relayed: false, why }, detail: "the gate shut", refused: true };
  };
  // Read before the boundary below resets what the owner's words were said over. A verdict on a check-in the voice read
  // them answers THAT act, whatever card is open — the owner walks them hands-free.
  // A triage ruling answers the card the pass put in front of them, the one it names, the same way.
  // Otherwise the card open as they began is only where they spoke: the relay is about it, and lands on it, only when
  // the voice judged their words answer it, and never a hand step (measured: "Uh, good morning" had taken one off the
  // owner's Queue). The open card still places the relay's workspace either way. Words that began over the last card
  // and ended over the one still open — "Next card, please", then the owner's answer — land on that card when the voice
  // judged them its answer (`relayJudgeable`).
  let about: string;
  let placedBy: string;
  if (checkIn !== undefined) {
    about = checkIn.key;
    placedBy = about;
  } else if (triage !== undefined) {
    about = triage.key;
    placedBy = about;
  } else {
    const spokenOver = seams.lines.about();
    about = relayAboutJudged({ answersOpenCard, spokenOver: seams.lines.judgeable() });
    placedBy = about !== "" ? about : spokenOver;
  }
  const answersCard = about !== "" ? ({ answersCard: true } as const) : {};
  // A check-in or triage key the relay is now about is never also landed a second way.
  const also = alsoAnswers.filter((key) => key !== about);
  const alsoLine = also.length === 0 ? {} : { alsoAnswers: also };
  const spokenIn = seams.lines.spokenIn();
  if (!seams.live()) {
    return shut({ about, why: "the owner hung up before the relay was sent" });
  }
  const window = seams.turnWindow.current;
  let prior: PriorDiscussFirst | undefined;
  if (fix !== undefined) {
    prior = seams.discussFirst.prior({ repository: fix.repository });
  }
  const discussFirst = discussFirstDecision({ ask: fix, prior });
  const accepted = acceptRelay({
    about,
    alsoAnswers: also,
    candidateRuling,
    checkIn,
    discussFirst: discussFirstWireOf({ decision: discussFirst }),
    log: seams.gateLog.current,
    micAhead: seams.micAhead(),
    picture: relayPictureFor({ available: window.availableScreen, looking: window.looksRunning > 0 }),
    say,
    standing: seams.standing(),
    triageRuling: triage?.ruling,
    turnId: seams.mintTurnId(),
    workspace: seams.workspace({ about: placedBy, spokenIn }),
  });
  if (accepted.kind === "shut") {
    return shut({ about, why: accepted.why });
  }
  const sinceIso = seams.nowIso();
  seams.gateLog.current.push({ kind: "relayed" });
  seams.relayed();
  seams.turnWindow.current = freshTurnWindow();
  const { heard, wire } = accepted;
  // The owner's verdict rides each line so a park leaves its card on the Queue, parked, instead of collapsing it.
  const verdict = triage === undefined ? {} : { triageVerdict: triage.ruling.verdict };
  // Claimed before the answer goes back, as a meeting line is before it is spoken: a lost answer never asks twice.
  if (discussFirst.kind === "put") {
    seams.discussFirst.claim({ prior: { turnId: wire.turnId }, repository: discussFirst.repository });
  }
  const line = ({
    detail,
    outcome,
    shownSay,
    firstRefusal,
    replay,
  }: {
    detail: string;
    outcome: RelayLine["outcome"];
    shownSay: string;
    firstRefusal?: string | undefined;
    replay?: RelayReplay | undefined;
  }) => {
    // Each reason rides apart from the line's own sentence, so the viewer folds it.
    const refusal = firstRefusal === undefined ? {} : { firstRefusal };
    const replayed = replay === undefined ? {} : { replay };
    seams.lines.record({
      line: {
        about,
        detail,
        heard,
        outcome,
        say: shownSay,
        turnId: wire.turnId,
        ...refusal,
        ...replayed,
        ...verdict,
        ...answersCard,
        ...alsoLine,
      },
    });
  };
  line({ detail: "running talk relay", outcome: "sending", shownSay: accepted.shownSay });
  seams.enqueue(async () => {
    let shownSay = accepted.shownSay;
    // The wire this relay last posted: a put that did not land holds it, so the owner's answer has a turn on record to name.
    let lastSent = wire;
    const holdUnlanded = () => {
      if (discussFirst.kind === "put") {
        seams.discussFirst.holdReplay({ repository: discussFirst.repository, wire: lastSent });
      }
    };
    let replay: RelayReplay | undefined;
    if (discussFirst.kind === "override") {
      replay = await replayPut({
        post: seams.post,
        replay: seams.discussFirst.takeReplay({ repository: discussFirst.repository }),
      });
    }
    try {
      const { posted, firstWhy } = await attemptRelay({
        hooks: {
          post: (sent) => {
            lastSent = sent;
            return seams.post(sent);
          },
          retrying: ({ why }) => {
            shownSay = "(dropped: the first relay was refused)";
            line({ detail: RETRYING_DETAIL, firstRefusal: why, outcome: "sending", shownSay });
          },
        },
        wire,
      });
      if (posted.outcome !== "relayed") {
        holdUnlanded();
      }
      const ran = relayOutcomeLine({ firstWhy, posted });
      line({ detail: ran.detail, firstRefusal: ran.firstRefusal, outcome: ran.lineOutcome, replay, shownSay });
    } catch (cause) {
      holdUnlanded();
      const why = cause instanceof Error ? cause.message : String(cause);
      line({ detail: why, outcome: "unknown", replay, shownSay });
    }
  });
  let ruling: HandOffRuling | undefined;
  if (checkIn !== undefined) {
    ruling = { covers: checkIn.covers, kind: "check-in" };
  } else if (candidateRuling !== undefined) {
    ruling = { kind: "candidate" };
  } else if (triage !== undefined) {
    ruling = { kind: "triage", rewrite: triage.ruling.verdict === "rewrite" };
  }
  const answer = handedOffAnswer({ discussFirst, outward, ruling, sinceIso });
  let detail = "handed off, posting in the background";
  if (answer.checkSend !== undefined) {
    seams.watchSend(answer.checkSend);
    detail = `${detail}; watching the Slack send`;
  }
  return { answer, detail, refused: false };
}

/**
 * The relay lines the page draws after one more: a relay's later line replaces its earlier one in place, and a line
 * of a new relay goes on the end, the oldest dropping past `kept`. A line of a call the owner has since left for
 * another only ever replaces its own relay's line: appended, it would push out a line the call they are on holds.
 *
 * @param held the lines drawn now
 * @param line the relay line just recorded
 * @param kept the most lines drawn
 * @param overtaken the line's call is no longer the page's: another call began after it
 * @returns the lines to draw
 */
export function keptRelayLines({
  held,
  line,
  kept,
  overtaken,
}: {
  held: readonly RelayLine[];
  line: RelayLine;
  kept: number;
  overtaken: boolean;
}): readonly RelayLine[] {
  const index = line.turnId === undefined ? -1 : held.findIndex((entry) => entry.turnId === line.turnId);
  if (index === -1 && overtaken) {
    return held;
  }
  if (index === -1) {
    return [...held.slice(-(kept - 1)), line];
  }
  return [...held.slice(0, index), line, ...held.slice(index + 1)];
}
