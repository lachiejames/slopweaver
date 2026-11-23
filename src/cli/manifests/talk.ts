/**
 * Lazy manifest for the `talk` noun — the console's voice tab, its bounded read of this checkout, and the
 * one press that puts a conversation on the board.
 *
 * `offer` is the only verb in this product that calls a model API, which is why its `effect` is
 * `external-read` and why `docs/security/voice-boundary.md` § "The console-voice boundary" exists. `relay` is `local-state`
 * rather than `external-write`: it writes a board row and keeps the owner's screen picture under
 * `$SLOPWEAVER_HOME`, and its supervisor delivery types one line into the owner's own supervisor chat on this
 * machine — no provider and no other person.
 *
 * `transcript`, `relay` and `land` land the owner's words on the console card they had open (`src/talk/cardLanding.ts`), and
 * `relay` on every other Queue card its `--also-answers` names: a ruling on an ask, or a dispatch row for any other
 * card, which is why each `createsWorkItem`.
 *
 * The verbs the voice reads to know something — glossary, origin, knowledge, history, recent, slack-after — are
 * declared in `talkKnow.ts` and spread in here; the reads of this checkout and of any local file, `code` and
 * `file`, and `attach`, which keeps a file the owner attached for `file` to read, in `talkFiles.ts`; the two that type into
 * the pinned chair, `courier` and `wake-chair`, in `talkChair.ts`; the running list, `list` and `list-add`, in
 * `talkList.ts`; the call-record diagnostics, `cut-ins` and `fidelity`, in `talkCallReads.ts`; the reads of the
 * calls as written down, `calls` and `call-tools`, in `talkCalls.ts`; the unread cursor's verbs, `unread`,
 * `unread-adopt`, `quarantine` and `cursor-retire`, in `talkUnread.ts`.
 */
import {
  TALK_CARDS_USAGE,
  TALK_CHECK_INS_USAGE,
  TALK_LAND_USAGE,
  TALK_LAPS_USAGE,
  TALK_LOG_USAGE,
  TALK_OFFER_USAGE,
  TALK_PACK_USAGE,
  TALK_RELAY_USAGE,
  TALK_RESTORE_USAGE,
  TALK_ROW_USAGE,
  TALK_STEERS_USAGE,
  TALK_SUPERVISOR_USAGE,
  TALK_THREAD_USAGE,
  TALK_TRANSCRIPT_USAGE,
} from "../commands/talk/usage.js";
import { TALK_VERB_USAGE } from "../commands/talk/verbUsage.js";
import { lazy, type VerbManifestEntry } from "../manifest.js";
import { talkCallReadsManifest } from "./talkCallReads.js";
import { talkCallsManifest } from "./talkCalls.js";
import { talkChairManifest } from "./talkChair.js";
import { talkFilesManifest } from "./talkFiles.js";
import { talkKnowManifest } from "./talkKnow.js";
import { talkListManifest } from "./talkList.js";
import { talkUnreadManifest } from "./talkUnread.js";

const talkOfferMeta = {
  createsWorkItem: false,
  diagnostic: false,
  doorRouted: false,
  dryParseSafe: true,
  effect: "external-read",
  example: "slopweaver talk offer --voice sol --json",
  parseRejectIsIoFree: true,
  summary:
    "Print what a console voice call on the owner's ChatGPT plan is launched with — the codex app-server, the voice and the prompts",
  usage: TALK_OFFER_USAGE,
} as const;

const talkRelayMeta = {
  createsWorkItem: true,
  diagnostic: false,
  doorRouted: false,
  dryParseSafe: true,
  effect: "local-state",
  example: 'slopweaver talk relay --turn <uuid> --say "look at the staging pool" --json',
  parseRejectIsIoFree: true,
  summary:
    "Register a steer the owner talked through with the console voice, or typed in its steer composer (--typed), as a board row, their words first and a picture of their screen or the image they attached, landing them on the card they answer and every --also-answers card — idempotent on its turn",
  usage: TALK_RELAY_USAGE,
} as const;

const talkRowMeta = {
  createsWorkItem: false,
  diagnostic: false,
  doorRouted: false,
  dryParseSafe: true,
  effect: "none",
  example: "slopweaver talk row --slug acme-ask-6-sep-turn-95-1-give --json",
  parseRejectIsIoFree: true,
  summary:
    "One board row, whole and bounded, the owner's own words first, with its run journal's question and every local file they name — what the console voice reads before it explains a card or places a deliverable",
  usage: TALK_ROW_USAGE,
} as const;

const talkLogMeta = {
  createsWorkItem: false,
  diagnostic: false,
  doorRouted: false,
  dryParseSafe: true,
  effect: "none",
  example: "slopweaver talk log",
  parseRejectIsIoFree: true,
  summary: "What the console voice has relayed, each row naming the board slug it created — never that it was seen",
  usage: TALK_LOG_USAGE,
} as const;

const talkCheckInsMeta = {
  createsWorkItem: false,
  diagnostic: false,
  doorRouted: false,
  dryParseSafe: true,
  effect: "none",
  example: "slopweaver talk check-ins --skip 5",
  parseRejectIsIoFree: true,
  summary:
    "The owner's check-ins as the console voice reads them, a page at a time off the autonomy register — each rule's newest act, what was done, the reason the fleet gave and its evidence, the rule clearing the most cards first",
  usage: TALK_CHECK_INS_USAGE,
} as const;

const talkPackMeta = {
  createsWorkItem: false,
  diagnostic: false,
  doorRouted: false,
  dryParseSafe: true,
  effect: "local-state",
  example: "slopweaver talk pack --write",
  parseRejectIsIoFree: true,
  summary:
    "Gather the console voice's context pack — asks waiting on the owner with their words, live seats, their last day of supervisor turns, the day's landings, their check-ins by rule — and with --write keep it for talk offer",
  usage: TALK_PACK_USAGE,
} as const;

const talkSupervisorMeta = {
  createsWorkItem: false,
  diagnostic: false,
  doorRouted: false,
  dryParseSafe: true,
  effect: "none",
  example: "slopweaver talk supervisor --json",
  parseRejectIsIoFree: true,
  summary:
    "The owner's recent turns and the pinned supervisor's replies, newest first and byte-capped — what the console voice reads to pick up that conversation",
  usage: TALK_SUPERVISOR_USAGE,
} as const;

const talkVerbMeta = {
  createsWorkItem: false,
  diagnostic: false,
  doorRouted: false,
  dryParseSafe: true,
  // The gateway itself writes nothing; what it runs is read-only by the closed list in `src/talk/modelReads.ts`,
  // and some of those reads reach a provider — GitHub, Linear, Datadog — so the honest effect is a read out.
  effect: "external-read",
  example:
    "slopweaver talk verb --request 7b226e6f756e223a22636174616c6f67222c2276657262223a227472656573222c2261726773223a5b222d2d6a736f6e225d7d --json",
  parseRejectIsIoFree: true,
  summary:
    "Run one read-only slopweaver verb the console voice named — checked against a closed list, run as a child, answered as one bounded document",
  usage: TALK_VERB_USAGE,
} as const;

const talkTranscriptMeta = {
  createsWorkItem: true,
  diagnostic: false,
  doorRouted: false,
  dryParseSafe: true,
  effect: "local-state",
  example: "slopweaver talk transcript --call <uuid> --entries-file ./batch.jsonl --json",
  parseRejectIsIoFree: true,
  summary:
    "Append a batch of a console-voice call's lines (a file, or `-` for stdin) to its file under the home as the call runs, every secret masked first, so a dropped call still leaves their words — then land every finished utterance on the card they had open",
  usage: TALK_TRANSCRIPT_USAGE,
} as const;

const talkThreadMeta = {
  createsWorkItem: false,
  diagnostic: false,
  doorRouted: false,
  dryParseSafe: true,
  effect: "none",
  example: "slopweaver talk thread --json",
  parseRejectIsIoFree: true,
  summary:
    "What the owner and the console voice said to each other across calls and typed conversations, oldest first — their speech only, what the messenger opens on",
  usage: TALK_THREAD_USAGE,
} as const;

const talkLandMeta = {
  createsWorkItem: true,
  diagnostic: false,
  doorRouted: false,
  dryParseSafe: true,
  effect: "local-state",
  example:
    'slopweaver talk land --card pr:acme.widgets.42 --words "ship it" --anchor call:<uuid>#s-4 --decided 2026-09-26T01:15:00.000Z --json',
  parseRejectIsIoFree: true,
  summary:
    "Land words the owner said over one card on a second card they also answer — the same anchor, words and instant — so both leave their queue",
  usage: TALK_LAND_USAGE,
} as const;

const talkCardsMeta = {
  createsWorkItem: false,
  diagnostic: false,
  doorRouted: false,
  dryParseSafe: true,
  effect: "none",
  example: "slopweaver talk cards --json",
  parseRejectIsIoFree: true,
  summary:
    "The console cards the owner's own words are holding off their queue, each with what they said and the row acting on it, and any ledger line that did not read",
  usage: TALK_CARDS_USAGE,
} as const;

const talkSteersMeta = {
  createsWorkItem: false,
  diagnostic: false,
  doorRouted: false,
  dryParseSafe: true,
  effect: "none",
  example: "slopweaver talk steers --json",
  parseRejectIsIoFree: true,
  summary:
    "What became of each steer the owner spoke over a Queue card this week — waiting on the chair, settled by what acted on it, or back on their Queue and why",
  usage: TALK_STEERS_USAGE,
} as const;

const talkLapsMeta = {
  createsWorkItem: false,
  diagnostic: false,
  doorRouted: false,
  dryParseSafe: true,
  effect: "none",
  example: "slopweaver talk laps --since 14d",
  parseRejectIsIoFree: true,
  summary:
    "How many laps each Queue card took to reach the owner — its looks, its laps split into the fleet's and the world's, and the steers they gave between",
  usage: TALK_LAPS_USAGE,
} as const;

const talkRestoreMeta = {
  createsWorkItem: false,
  diagnostic: false,
  doorRouted: false,
  dryParseSafe: true,
  effect: "local-state",
  example:
    'slopweaver talk restore --card pr:acme.widgets.42 --anchor run:<slug> --why "a general remark, not about this PR" --json',
  parseRejectIsIoFree: true,
  summary:
    "Put a card their words pulled back on their queue — an ask they answered is asked again — when what they said was not about it",
  usage: TALK_RESTORE_USAGE,
} as const;

const loadOffer = () => import("../commands/talk/offerRun.js").then((m) => m.talkOfferCommand);
const loadRelay = () => import("../commands/talk/relayRun.js").then((m) => m.talkRelayCommand);
const loadRow = () => import("../commands/talk/rowRun.js").then((m) => m.talkRowCommand);
const loadSupervisor = () => import("../commands/talk/supervisorRun.js").then((m) => m.talkSupervisorCommand);
const loadPack = () => import("../commands/talk/packRun.js").then((m) => m.talkPackCommand);
const loadCheckIns = () => import("../commands/talk/checkInsRun.js").then((m) => m.talkCheckInsCommand);
const loadLog = () => import("../commands/talk/logRun.js").then((m) => m.talkLogCommand);
const loadVerb = () => import("../commands/talk/verbRun.js").then((m) => m.talkVerbCommand);
const loadTranscript = () => import("../commands/talk/transcriptRun.js").then((m) => m.talkTranscriptCommand);
const loadThread = () => import("../commands/talk/threadRun.js").then((m) => m.talkThreadCommand);
const loadLand = () => import("../commands/talk/cardsRun.js").then((m) => m.talkLandCommand);
const loadCards = () => import("../commands/talk/cardsRun.js").then((m) => m.talkCardsCommand);
const loadRestore = () => import("../commands/talk/cardsRun.js").then((m) => m.talkRestoreCommand);
const loadLaps = () => import("../commands/talk/lapsRun.js").then((m) => m.talkLapsCommand);
const loadSteers = () => import("../commands/talk/steersRun.js").then((m) => m.talkSteersCommand);

export const talkManifest: Readonly<Record<string, VerbManifestEntry>> = {
  ...talkKnowManifest,
  // `calls` and `call-tools`, the reads of the calls as written down, are declared in `./talkCalls.ts`.
  ...talkCallsManifest,
  cards: lazy({ load: loadCards, meta: talkCardsMeta }),
  "check-ins": lazy({ load: loadCheckIns, meta: talkCheckInsMeta }),
  // `cut-ins` and `fidelity` are declared in `./talkCallReads.ts` and spread in here.
  ...talkCallReadsManifest,
  // `code` and `file` are declared in `./talkFiles.ts` and spread in here.
  ...talkFilesManifest,
  land: lazy({ load: loadLand, meta: talkLandMeta }),
  laps: lazy({ load: loadLaps, meta: talkLapsMeta }),
  // `list` and `list-add` are declared in `./talkList.ts` and spread in here.
  ...talkListManifest,
  log: lazy({ load: loadLog, meta: talkLogMeta }),
  offer: lazy({ load: loadOffer, meta: talkOfferMeta }),
  pack: lazy({ load: loadPack, meta: talkPackMeta }),
  relay: lazy({ load: loadRelay, meta: talkRelayMeta }),
  restore: lazy({ load: loadRestore, meta: talkRestoreMeta }),
  row: lazy({ load: loadRow, meta: talkRowMeta }),
  steers: lazy({ load: loadSteers, meta: talkSteersMeta }),
  supervisor: lazy({ load: loadSupervisor, meta: talkSupervisorMeta }),
  thread: lazy({ load: loadThread, meta: talkThreadMeta }),
  transcript: lazy({ load: loadTranscript, meta: talkTranscriptMeta }),
  // `cursor-retire`, `quarantine`, `unread` and `unread-adopt`, the unread cursor's verbs, are declared in
  // `./talkUnread.ts`.
  ...talkUnreadManifest,
  verb: lazy({ load: loadVerb, meta: talkVerbMeta }),
  // `courier` and `wake-chair`, the two that type into the pinned chair, are declared in `./talkChair.ts`.
  ...talkChairManifest,
};
