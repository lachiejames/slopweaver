/**
 * What one voice tool call came to, and every seam the tools reach on the page. Split from `talkToolRun.ts` to keep it
 * under the line cap.
 */
import type { ResponseFunctionCallOutputItemList } from "openai/resources/responses/responses";

import type { CardWalk, CardWalkMoveFields } from "../../lib/cardWalk";
import type { TeamFixAsk } from "../../lib/discussFirst";
import type { FileImagePayload } from "../../lib/fileImage";
import type { PageView } from "../../lib/pageVoice";
import type { RelayOutward } from "../../lib/relayAnswer";
import type { GateEntry } from "../../lib/relayGate";
import type { ActionItemsAnswer } from "../../lib/talkActionItems";
import type { CandidateRulingWire } from "../../lib/talkRelayRequestWire";
import type { TriageRulingWire } from "../../lib/triageWords";
import type { VoicePartialFailure } from "../../lib/voiceFailureToast";
import type { WorkspacePlacer } from "../../lib/workspacePlacement";
import type { DraftEditSeams } from "./draftEditRun";
import type { FocusSeams } from "./focusRun";
import type { MeetingSkipSeams } from "./meetingSkipRun";
import type { OpenCardSeams } from "./openCardRun";
import type { runVerbTool } from "./talkToolCalls";
import type { CheckInVerdict, StageSettingChange } from "./talkToolRunArgs";
import type { TriageWalkSeams } from "./triageRun";

/** What one tool call came to. */
export interface ToolRan {
  readonly answer: unknown;
  readonly image: ResponseFunctionCallOutputItemList | undefined;
  readonly detail: string;
  readonly refused: boolean;
  /** Whether the answer hands the model third-party text, which the relay gate must count as a read. */
  readonly readText: boolean;
  /** What a call that answered still failed to do — `open_card`'s refused openings — for the console's toast. */
  readonly partialFailures: readonly VoicePartialFailure[];
  /**
   * The visit a `triage_next` put in front of the owner, posted with its answer so the call times only that card's two
   * minutes (`../../lib/triagePresented.ts`); absent from every other answer.
   */
  readonly triageVisit?: string;
}

/** The keys the latest `action_items` answer this call served the owner: replaced whole on each answer, read by a relay. */
export interface ServedCardsSeam {
  readonly read: () => ReadonlySet<string>;
  readonly write: (input: { readonly keys: readonly string[] }) => void;
}

/**
 * The Queue walk on this call (`../../lib/cardWalk.ts`), reset when the owner starts a call: the cards the voice resolved,
 * the card open on the page now, and where a move is written down (`talk transcript` acts on it).
 */
export interface CardWalkSeam {
  readonly read: () => CardWalk;
  readonly write: (input: { readonly walk: CardWalk }) => void;
  /** The card open on the page right now — its `?open=` key — or `undefined` when none is. */
  readonly openKeyNow: () => string | undefined;
  /** Write one move onto the call now running. */
  readonly record: (input: { readonly move: CardWalkMoveFields }) => void;
  /**
   * Which walk on which call this is: a fresh-call press, or any new call id — a typed conversation, a rollover —
   * changes it, so an open that outlived its walk or its call touches neither the later walk nor the later call.
   */
  readonly stamp: () => string;
}

/** One Queue tool call's own deadline, from the record read it began with to its answer. */
export interface QueueCall {
  /** Why the console cannot be moved to a card, asking the screen again inside this call's deadline. */
  readonly undrawnWhy: (input: { readonly key: string }) => Promise<string | undefined>;
  /** `ask`'s answer if it comes inside this call's deadline, else `late`, never waited on past it. */
  readonly within: <T>(input: { readonly ask: () => Promise<T>; readonly late: T }) => Promise<T>;
}

/** What the tools reach on the page: the Queue's answer, the page, the shared screen, a file picture, the relay. */
export interface ToolSeams {
  /** The Queue walk `read_card` and `open_card` step on. */
  readonly cardWalk: CardWalkSeam;
  readonly actionItems: () => ActionItemsAnswer;
  /**
   * Read the Queue's record fresh, and the Queue on screen beside it, before a Queue tool answers
   * (`./useQueueRecord.ts`): `actionItems` and `cards` then answer from that read.
   * Never rejects; a source it could not read is named unread in what answers. What it returns is THIS call's own
   * deadline, so an overlapping call's later read never lends it more time.
   */
  readonly readQueueRecord: () => Promise<QueueCall>;
  readonly view: () => PageView;
  readonly screenShot: () => Promise<{
    answer: unknown;
    output: ResponseFunctionCallOutputItemList | undefined;
    detail: string;
  }>;
  /** One verb tool's round trip through `/api/talk/tool/<name>` — `runVerbTool`, a plain fake in a test. */
  readonly verb: typeof runVerbTool;
  /** A picture `file_read` returned, fitted and re-encoded the way a screen frame is. */
  readonly fileImage: (input: { image: FileImagePayload }) => Promise<{
    answer: unknown;
    output: ResponseFunctionCallOutputItemList | undefined;
    detail: string;
  }>;
  /** Answers at once, never a Promise: the post runs behind the answer (`./relayAttempt.ts`'s `handOffRelay`). */
  readonly relay: (input: {
    say: string;
    checkIn: CheckInVerdict | undefined;
    candidateRuling: CandidateRulingWire | undefined;
    triage: { readonly ruling: TriageRulingWire; readonly key: string } | undefined;
    outward: RelayOutward;
    fix: TeamFixAsk | undefined;
    answersOpenCard: boolean;
    /** The other Queue cards the owner's words also answer, each already checked against what this call served them. */
    alsoAnswers: readonly string[];
  }) => { answer: unknown; detail: string; refused: boolean };
  /**
   * The card keys the latest `action_items` answer this call listed, reset when the owner starts a call
   * (`./useOpenCardSeams.ts`): the only keys `relay_steer`'s `also_answers` may name.
   */
  readonly servedCards: ServedCardsSeam;
  /** The page's triage pass and its clock (`./triageRun.ts`), which a relay carrying the owner's triage ruling records on. */
  readonly triage: TriageWalkSeams;
  /** Flip one stage switch, through the same hook the Settings modal's own switches use. */
  readonly stageSetting: (input: StageSettingChange) => void;
  /** The call's relay-gate record, read for what the owner was heard saying before `openCards` may go off. */
  readonly gateLog: () => readonly GateEntry[];
  /** What the owner said they would do, held by the page's drift watch (`./focusRun.ts`, `./useFrontWindowNotices.ts`). */
  readonly focus: FocusSeams;
  /** The meetings the owner said they have had or will not go to, held by the page's meeting watch (`./meetingSkipRun.ts`). */
  readonly meetingSkip: MeetingSkipSeams;
  /**
   * `read_card`'s and `open_card`'s rows and briefing read, and `open_card`'s switch and console move
   * (`./openCardRun.ts`); its page and thread ride `verb`.
   */
  readonly actLookup: OpenCardSeams["actLookup"];
  readonly cards: OpenCardSeams["cards"];
  readonly openCardsOn: OpenCardSeams["openCardsOn"];
  readonly presentConsole: OpenCardSeams["presentConsole"];
  readonly readBriefing: OpenCardSeams["readBriefing"];
  /**
   * Why the console cannot be moved to a card. The page's own answers that no record was read; a Queue tool's record
   * read replaces it with that call's own screen ask, held inside its deadline (`./talkToolRun.ts`).
   */
  readonly undrawnWhy: OpenCardSeams["undrawnWhy"];
  /** `focus_screen`: lift one region of the last look on the owner's screen, through the page's gate (`./useScreenFocus.ts`). */
  readonly screenFocus: (input: {
    args: Record<string, unknown>;
  }) => Promise<{ answer: unknown; detail: string; refused: boolean }>;
  /**
   * `offer_copy`: put one draft of the owner's words on their running list (`talk list-add --origin voice`, `src/talk/runningList.ts`),
   * kept with the newest ten across calls and restarts, in a spoken or a typed conversation alike. `requestId` is the
   * tool call's own stable token, passed as the list's request id, so a retried add of the same call is the same item
   * rather than a second one. Its answer and detail are fixed words, never the message: on a call the message goes on
   * the call's record once, as its own `offered` line, never again inside a tool line's detail. It settles only once
   * the owner's voice rules have judged the message (`../../lib/copyVoiceCheck.ts`).
   */
  readonly offerCopy: (input: {
    args: Record<string, unknown>;
    requestId: string;
  }) => Promise<{ answer: unknown; detail: string; refused: boolean }>;
  /** The live edit of the parked draft on the card the owner has open (`./draftEditRun.ts`), aimed by the page. */
  readonly draftEdit: DraftEditSeams;
  /** The organisation's address readers, which say whether a fix `relay_steer` names is on a team repository. */
  readonly placer: WorkspacePlacer;
}
