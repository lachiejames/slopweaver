/**
 * The `talk` verbs the console voice reads to KNOW something — a word, where a row came from, the knowledge
 * register, the owner's past turns, everything they have said and ruled, where the last call left off, what came after a Slack message, a Slack channel's latest, which meeting of theirs is
 * starting now, which steered deliverable is at risk, and what it can itself do. Every usage here
 * is quoted from `commands/talk/knowUsage.ts`, the leaf these verbs share, and `talk.ts` spreads this map into
 * the noun's manifest.
 */
import {
  TALK_CAPABILITIES_USAGE,
  TALK_FIND_CARD_USAGE,
  TALK_GLOSSARY_USAGE,
  TALK_HISTORY_USAGE,
  TALK_KNOWLEDGE_USAGE,
  TALK_MEETING_DUE_USAGE,
  TALK_ORIGIN_USAGE,
  TALK_RECALL_USAGE,
  TALK_RECENT_USAGE,
  TALK_SLACK_AFTER_USAGE,
  TALK_SLACK_CHANNEL_USAGE,
  TALK_SLACK_OPEN_USAGE,
  TALK_SLACK_SEND_OUTCOME_USAGE,
  TALK_STEER_RISK_USAGE,
} from "../commands/talk/knowUsage.js";
import { lazy, type VerbManifestEntry } from "../manifest.js";

const talkGlossaryMeta = {
  createsWorkItem: false,
  diagnostic: false,
  doorRouted: false,
  dryParseSafe: true,
  effect: "none",
  example: 'slopweaver talk glossary --term "JumpCloud atlas" --json',
  parseRejectIsIoFree: true,
  summary:
    "The fleet's own words, each in one plain sentence — what the console voice says a word like atlas or seat means",
  usage: TALK_GLOSSARY_USAGE,
} as const;

const talkOriginMeta = {
  createsWorkItem: false,
  diagnostic: false,
  doorRouted: false,
  dryParseSafe: true,
  effect: "none",
  example: "slopweaver talk origin --slug atlas-jumpcloud --json",
  parseRejectIsIoFree: true,
  summary:
    "Where a board row came from: the owner's exact words behind it, its transcript anchors resolved, or that a session found it and they never asked",
  usage: TALK_ORIGIN_USAGE,
} as const;

const talkKnowledgeMeta = {
  createsWorkItem: false,
  diagnostic: false,
  doorRouted: false,
  dryParseSafe: true,
  effect: "none",
  example: 'slopweaver talk knowledge --query "jumpcloud atlas" --json',
  parseRejectIsIoFree: true,
  summary:
    "What the knowledge register already knows about a question, as one bounded JSON document the console voice reads",
  usage: TALK_KNOWLEDGE_USAGE,
} as const;

const talkHistoryMeta = {
  createsWorkItem: false,
  diagnostic: false,
  doorRouted: false,
  dryParseSafe: true,
  effect: "none",
  example: 'slopweaver talk history --phrase "jumpcloud atlas" --json',
  parseRejectIsIoFree: true,
  summary:
    "The owner's turns across the supervisor chain and the chair's replies that mention a phrase, newest first — 'what did I ask about X'",
  usage: TALK_HISTORY_USAGE,
} as const;

const talkRecallMeta = {
  createsWorkItem: false,
  diagnostic: false,
  doorRouted: false,
  dryParseSafe: true,
  effect: "none",
  example: 'slopweaver talk recall --words "xero steer" --json',
  parseRejectIsIoFree: true,
  summary:
    "Everything the owner has said and ruled, all time: their call transcripts, relayed steers, rulings and the knowledge register, counted per source then the newest hits with pointers — '--open <pointer>' reads one whole",
  usage: TALK_RECALL_USAGE,
} as const;

const talkSlackAfterMeta = {
  createsWorkItem: false,
  diagnostic: false,
  // A READ, like `slack read-thread`: nothing leaves for Slack but the read itself, so no admit door. Unlike that
  // verb it never reaches the attachment stage and writes nothing, so the honest effect is a read out.
  doorRouted: false,
  dryParseSafe: true,
  effect: "external-read",
  example: "slopweaver talk slack-after --url https://acme.slack.com/archives/C123/p1785114398557099 --json",
  parseRejectIsIoFree: true,
  summary:
    "What came after one Slack message, read live from its link — one thread, named authors, nothing written — for the console voice",
  usage: TALK_SLACK_AFTER_USAGE,
} as const;

const talkSlackOpenMeta = {
  createsWorkItem: false,
  diagnostic: false,
  // A READ, exactly as `slack-after` is: one thread or conversation fetched, nothing written, no file downloaded.
  doorRouted: false,
  dryParseSafe: true,
  effect: "external-read",
  example: "slopweaver talk slack-open --url https://acme.slack.com/archives/C123/p1785114398557099 --json",
  parseRejectIsIoFree: true,
  summary:
    "One Slack thread opened whole from its link, or the conversation around a DM message — read live, named authors, nothing written — the drill-in after `slack unread`",
  usage: TALK_SLACK_OPEN_USAGE,
} as const;

const talkSlackChannelMeta = {
  createsWorkItem: false,
  diagnostic: false,
  // A READ, exactly as `slack-open` is: the channel list and one history page fetched, nothing written, no file
  // downloaded.
  doorRouted: false,
  dryParseSafe: true,
  effect: "external-read",
  example: "slopweaver talk slack-channel --channel '#squad-platform' --json",
  parseRejectIsIoFree: true,
  summary:
    "One Slack channel read live from its name as the owner's screen shows it, a link or an id — the newest top-level messages with reply counts, named authors, nothing written — for the console voice",
  usage: TALK_SLACK_CHANNEL_USAGE,
} as const;

const talkSlackSendOutcomeMeta = {
  createsWorkItem: false,
  diagnostic: false,
  // A READ, exactly as `slack-after` is: the thread fetched live and two local registers read, nothing written.
  doorRouted: false,
  dryParseSafe: true,
  effect: "external-read",
  example:
    "slopweaver talk slack-send-outcome --url https://acme.slack.com/archives/C123/p1785114398557099 --since 2026-10-07T05:52:59Z --json",
  parseRejectIsIoFree: true,
  summary:
    "What became of a Slack send the owner asked for on a call — sent with its link, held with the reason, failed with the error, or not sent yet — for the console voice",
  usage: TALK_SLACK_SEND_OUTCOME_USAGE,
} as const;

const talkMeetingDueMeta = {
  createsWorkItem: false,
  diagnostic: false,
  // A READ, like `calendar list`: one window of the owner's primary calendar, nothing written.
  doorRouted: false,
  dryParseSafe: true,
  effect: "external-read",
  example: "slopweaver talk meeting-due --json",
  parseRejectIsIoFree: true,
  summary:
    "Which of the owner's meetings starts within two minutes or started in the last ten, with its join link and any published briefing page tagged to it — what the console reads while they are on a call so the voice tells them once",
  usage: TALK_MEETING_DUE_USAGE,
} as const;

const talkSteerRiskMeta = {
  createsWorkItem: false,
  diagnostic: false,
  doorRouted: false,
  dryParseSafe: true,
  effect: "none",
  example: "slopweaver talk steer-risk --json",
  parseRejectIsIoFree: true,
  summary:
    "Which deliverables the owner explicitly steered are at risk now — the open steer notes, each with its row and reason — what the console reads while they are on a call so the voice cuts in once per note",
  usage: TALK_STEER_RISK_USAGE,
} as const;

const talkCapabilitiesMeta = {
  createsWorkItem: false,
  diagnostic: false,
  doorRouted: false,
  dryParseSafe: true,
  effect: "none",
  example: "slopweaver talk capabilities slack --json",
  parseRejectIsIoFree: true,
  summary:
    "Which verbs of a noun the console voice can run, which in part, and which only a seat can and why — derived from the catalog, its read list and its tools",
  usage: TALK_CAPABILITIES_USAGE,
} as const;

const talkRecentMeta = {
  createsWorkItem: false,
  diagnostic: false,
  doorRouted: false,
  dryParseSafe: true,
  effect: "none",
  example: "slopweaver talk recent --json",
  parseRejectIsIoFree: true,
  summary:
    "Where the last voice call left off — the owner's recent steers with what became of each, the calls as written down (a dropped one included), and the rulings and lessons recorded since, newest first",
  usage: TALK_RECENT_USAGE,
} as const;

const talkFindCardMeta = {
  createsWorkItem: false,
  diagnostic: false,
  doorRouted: false,
  dryParseSafe: true,
  effect: "none",
  example: "slopweaver talk find-card voice tools capability verbs browser",
  parseRejectIsIoFree: true,
  summary:
    "Is there already a card for this: every held draft on the owner's Queue and every board row ranked against their words by what it is about, never its slug, the drafts named first by the Queue key that opens them, each row with where it stands — on their Queue, a session on it, done — or one line saying there is none",
  usage: TALK_FIND_CARD_USAGE,
} as const;

const loadFindCard = () => import("../commands/talk/findCardRun.js").then((m) => m.talkFindCardCommand);
const loadCapabilities = () => import("../commands/talk/capabilitiesRun.js").then((m) => m.talkCapabilitiesCommand);
const loadGlossary = () => import("../commands/talk/glossaryRun.js").then((m) => m.talkGlossaryCommand);
const loadOrigin = () => import("../commands/talk/originRun.js").then((m) => m.talkOriginCommand);
const loadKnowledge = () => import("../commands/talk/knowledgeRun.js").then((m) => m.talkKnowledgeCommand);
const loadHistory = () => import("../commands/talk/historyRun.js").then((m) => m.talkHistoryCommand);
const loadRecall = () => import("../commands/talk/recallRun.js").then((m) => m.talkRecallCommand);
const loadRecent = () => import("../commands/talk/recentRun.js").then((m) => m.talkRecentCommand);
const loadMeetingDue = () => import("../commands/talk/meetingDueRun.js").then((m) => m.talkMeetingDueCommand);
const loadSteerRisk = () => import("../commands/talk/steerRiskRun.js").then((m) => m.talkSteerRiskCommand);
const loadSlackAfter = () => import("../commands/talk/slackAfterRun.js").then((m) => m.talkSlackAfterCommand);
const loadSlackOpen = () => import("../commands/talk/slackOpenRun.js").then((m) => m.talkSlackOpenCommand);
const loadSlackChannel = () => import("../commands/talk/slackChannelRun.js").then((m) => m.talkSlackChannelCommand);
const loadSlackSendOutcome = () =>
  import("../commands/talk/slackSendOutcomeRun.js").then((m) => m.talkSlackSendOutcomeCommand);

export const talkKnowManifest: Readonly<Record<string, VerbManifestEntry>> = {
  capabilities: lazy({ load: loadCapabilities, meta: talkCapabilitiesMeta }),
  "find-card": lazy({ load: loadFindCard, meta: talkFindCardMeta }),
  glossary: lazy({ load: loadGlossary, meta: talkGlossaryMeta }),
  history: lazy({ load: loadHistory, meta: talkHistoryMeta }),
  knowledge: lazy({ load: loadKnowledge, meta: talkKnowledgeMeta }),
  "meeting-due": lazy({ load: loadMeetingDue, meta: talkMeetingDueMeta }),
  origin: lazy({ load: loadOrigin, meta: talkOriginMeta }),
  recall: lazy({ load: loadRecall, meta: talkRecallMeta }),
  recent: lazy({ load: loadRecent, meta: talkRecentMeta }),
  "slack-after": lazy({ load: loadSlackAfter, meta: talkSlackAfterMeta }),
  "slack-channel": lazy({ load: loadSlackChannel, meta: talkSlackChannelMeta }),
  "slack-open": lazy({ load: loadSlackOpen, meta: talkSlackOpenMeta }),
  "slack-send-outcome": lazy({ load: loadSlackSendOutcome, meta: talkSlackSendOutcomeMeta }),
  "steer-risk": lazy({ load: loadSteerRisk, meta: talkSteerRiskMeta }),
};
