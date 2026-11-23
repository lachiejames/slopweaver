/**
 * The documents `tickRecordGates.test.ts` hands the seven tick-record gates: a draft, reconciliations, voice, steer
 * and approved-draft reads, the capacity obligation and the hatch sets. Pure data, apart from its cases.
 */
import type { SupervisorTickDraft } from "../../../../../cli/commands/supervisor/tickRecordCore.js";
import type { SlackDraftItem } from "../../../../../outbound/slack/draftRegister.js";
import type { CapacityObligation } from "../../../../../plans/laneShape.js";
import type { ApprovedDraftRead } from "../../../../../supervisor/approvedDraftGate.js";
import type { JudgedSteer, UnpickedSteerRead } from "../../../../../supervisor/unpickedSteerGate.js";
import type { VoiceUnreadVerdict } from "../../../../../supervisor/voiceUnreadGate.js";
import type { UnreadWord } from "../../../../../talk/unreadWords.js";

/** A draft that read a free machine and did nothing. */
export const FREE_DRAFT: SupervisorTickDraft = {
  actions: [],
  handoff: "handoff-9291",
  judgements: [],
  sources: { capacity: { facts: { dispatchCovering: 0, hold: false, holdSubjects: [], load1: 3.77 }, status: "read" } },
  startedIso: "2026-09-21T00:20:00.000Z",
  tickId: "handoff-9291-tick-288",
  workspace: "workspace:1",
};

/** A reconciliation over an observed fleet with one ready p2 doc nobody is on, and no outcomes to judge. */
export const ONE_DOC = {
  aligned: [],
  duplicateRecipeFailures: [],
  fleet: "observed",
  held: [],
  misaligned: [],
  ready: [{ groomed: true, id: "the-doc", kind: "doc", priority: "p2", ready: true, standing: "ready" }],
  unprioritised: [],
};

/** A Notion finding as the board held it: repoless, so blocked, in `held`, with nobody on it. */
export const NOTION = "recipe-failing-resync-corpus-notion-2026-10-12t13-00-00.000z-a1";

/** {@link ONE_DOC} plus the unseated Notion finding. */
export const NOTION_UNSEATED = {
  ...ONE_DOC,
  held: [{ groomed: true, id: NOTION, kind: "ask", priority: "p1", ready: false, standing: "blocked" }],
  repolessRows: [NOTION],
};

/** Every hatch open but the idle one. */
export const IDLE_ONLY = {
  approvedDrafts: true,
  idle: false,
  load: true,
  recipeFailures: true,
  steers: true,
  sweep: true,
  voice: true,
};

/** A voice verdict with nothing unread. */
export const CLEAN: VoiceUnreadVerdict = { kind: "clean", stillSpoken: [] };

/** A stretch of the owner's still being spoken, grown since the chair read its start. */
export const GROWING: UnreadWord = {
  atIso: "2026-10-01T15:30:04.000Z",
  callId: "a0000053-0000-4000-8000-000000000056",
  cut: false,
  final: false,
  growingSinceRead: true,
  latestAtIso: "2026-10-01T15:30:04.000Z",
  nextRelay: undefined,
  pointer: "talk-call:a0000053-0000-4000-8000-000000000056#turn_000000000000000000003",
  revisions: [],
  segmentId: "turn_000000000000000000003",
  text: "I can actually see some of the things I've said in there",
};

/** A voice verdict with one stale word of the owner's unread. */
export const UNREAD: Extract<VoiceUnreadVerdict, { kind: "refused" }> = {
  kind: "refused",
  neverMarked: false,
  stillSpoken: [],
  unparseable: [],
  words: [
    {
      atIso: "2026-09-26T04:10:01.100Z",
      callId: "a0000035-0000-4000-8000-000000000038",
      cut: false,
      final: true,
      growingSinceRead: false,
      latestAtIso: "2026-09-26T04:10:01.100Z",
      nextRelay: undefined,
      pointer: "talk-call:a0000035-0000-4000-8000-000000000038#segment_0_163",
      revisions: [],
      segmentId: "segment_0_163",
      text: " put the policy proposal in Notion",
    },
  ],
};

/** A steer read with nothing in it. */
export const NO_STEERS: UnpickedSteerRead = { kind: "read", steers: [], undecodedRelays: 0 };

/** One steer of the owner's on a card, registered before {@link FREE_DRAFT} started, that a pass came and went over. */
export const MISSED: JudgedSteer = {
  cardKey: "ask:the-card",
  heard: "  ship the fix tonight  ",
  registeredAtIso: "2026-09-21T00:10:00.000Z",
  relaySlug: "talk-a00000390000",
  turnId: "a0000039-0000-4000-8000-000000000042",
  verdict: { kind: "reverted", passFinalisedIso: "2026-09-21T00:15:00.000Z", reason: "missed-pass" },
};

/** A steer read holding {@link MISSED}. */
export const ONE_MISSED: UnpickedSteerRead = { kind: "read", steers: [MISSED], undecodedRelays: 0 };

/** A draft register with nothing in it. */
export const NO_DRAFTS: Extract<ApprovedDraftRead, { kind: "read" }> = {
  items: [],
  answers: new Map(),
  kind: "read",
  landings: { bound: [], unreadable: [] },
  skippedLines: 0,
  unreadApproved: [],
  unsureIds: [],
};

/** A thread reply the owner approved on a call, recorded before {@link FREE_DRAFT} started, still held. */
export const APPROVED: SlackDraftItem = {
  draft: {
    advisory: [],
    approval: {
      anchor: "talk-call:541f50a8-0000-4000-8000-000000000001#turn_SendIt",
      atIso: "2026-09-21T00:05:00.000Z",
      heard: "Fuck, that is an excellent draft. Love it. Send it",
    },
    channel: "C0123456789",
    digest: "0123456789abcdef0123456789abcdef",
    form: "{}",
    id: "sd-0a1b2c3d",
    mentions: [],
    payload: { form: "plain", text: "sounds good", unfurl_links: false, unfurl_media: false },
    shape: "thread",
    threadTs: "1790000000.000100",
    tsIso: "2026-09-21T00:06:00.000Z",
    why: "reply to Seth",
  },
  id: "sd-0a1b2c3d",
  state: "held",
};

/** A draft read holding {@link APPROVED}. */
export const ONE_APPROVED: ApprovedDraftRead = {
  items: [APPROVED],
  answers: new Map(),
  kind: "read",
  landings: { bound: [], unreadable: [] },
  skippedLines: 0,
  unreadApproved: [],
  unsureIds: [],
};

/** Idle capacity still owed: a lane fills. */
export const OWED: CapacityObligation = { kind: "owed" };

/** Every hatch shut. */
export const ALL_SHUT = {
  approvedDrafts: false,
  idle: false,
  load: false,
  recipeFailures: false,
  steers: false,
  sweep: false,
  voice: false,
};
