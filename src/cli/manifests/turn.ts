/**
 * Lazy manifest for the `turn` noun — the agent surface's HANDLER half, driven by hand.
 *
 * The split is the feature: `brief` builds a question, the visible session judges it and hands the decision
 * to `dispatch`, which executes the chosen tier — `resume` runs inside the worker session `dispatch` opened,
 * `review` opens the independent reviewer for a composed answer with a packet CODE composed (so the session
 * pressing the button never briefs its own reviewer), `status` lets an inline/subagent-tier turn push its
 * own live checklist update mid-turn, and `answer` is the only verb that ever posts the actual reply.
 * `ignore` is the standing "never reconsider this exact message" registry, checked at every one of the
 * others' own entrances.
 * `brief`/`resume`/`review` declare `effect: "local-state"` and no door: they read/write local files and (for
 * a fresh-session tier `dispatch` opens, or the reviewer `review` opens) a cmux workspace, but never post to
 * Slack or run a model. `dispatch`
 * itself is `external-write` + `doorRouted: true` too now — its `no-response` decision deletes the capture
 * checklist through the real door — though `requiresApproval` stays false there, since that cleanup is
 * routine and never pauses. `status` is `external-write` + `doorRouted: true` for the same reason: it always
 * edits the already-posted checklist through the door, never pausing either. `answer` keeps the same pair for
 * its own, unrelated reason (it is the only verb that ever posts the answer itself). `ignore` JOINED that
 * group rather than being born in it: ignoring is a terminal ending, so it now settles the reaction, card and
 * thinking indicator an already-captured ask raised — the card edit goes through the real door, exactly like
 * `dispatch`'s cleanup, and `requiresApproval` stays false for the same reason. All of them are what the
 * door-coverage ratchet verifies. `ignore-conversation` is `ignore`'s channel-keyed sibling and carries the
 * same door/no-pause posture for the same reason: a fresh add settles every already-captured, unresolved
 * ask the now-suppressed channel currently has, through the real door.
 *
 * `ledger` is the only verb that reads the turn record sets TOGETHER — one row per ask with the five spans
 * of its turn and a mean/median footer, `effect: "none"` and no door, because every other reader here is
 * scoped to one live turn: `dispatch --sweep` sees only OPEN dispatches, `watch` sees one brief, and
 * `ledgers/turn-completions.jsonl` had no reader at all before it.
 *
 * `block`/`unblock`/`blocked` and their front door `reach` are the BLOCKED-ON-THE-OWNER feature, declared in
 * `./turnBlock.ts` and spread in here.
 *
 * Deliberately no default: `slopweaver turn` alone prints the verb list rather than posting to a workspace.
 */
import { TURN_BREAKAGE_EXAMPLE, TURN_BREAKAGE_USAGE } from "../commands/turn/breakageUsage.js";
import { TURN_LEDGER_USAGE } from "../commands/turn/ledgerUsage.js";
import { TURN_RETIRE_CARD_USAGE } from "../commands/turn/retireCardUsage.js";
import { TURN_SATISFIED_USAGE } from "../commands/turn/satisfiedUsage.js";
import {
  TURN_BRIEF_USAGE,
  TURN_DISPATCH_USAGE,
  TURN_FREEZE_USAGE,
  TURN_IGNORE_CONVERSATION_USAGE,
  TURN_IGNORE_USAGE,
  TURN_RESUME_USAGE,
  TURN_REVIEW_USAGE,
  TURN_SETTLE_REACTION_USAGE,
  TURN_STATUS_USAGE,
  TURN_USAGE,
  TURN_WATCH_USAGE,
} from "../commands/turn/usage.js";
import { lazy, type VerbManifestEntry } from "../manifest.js";
import { turnBlockManifest } from "./turnBlock.js";

export const turnManifest: Readonly<Record<string, VerbManifestEntry>> = {
  answer: lazy({
    load: () => import("../commands/turn/run.js").then((m) => m.turnAnswerCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: true,
      dryParseSafe: true,
      effect: "external-write",
      example:
        "slopweaver turn answer --brief ~/.slopweaver/briefs/C123-1712345678.000100.json --answer ./answer.json --decision ./decision.json",
      parseRejectIsIoFree: true,
      summary:
        "Post the answer a visible session composed: a live checklist, a grounded cited card, and what it could not see",
      usage: TURN_USAGE,
    },
  }),
  breakage: lazy({
    load: () => import("../commands/turn/breakage.js").then((m) => m.turnBreakageCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      // A local append to `ledgers/loop-breakage.jsonl` through the one sanctioned writer; nothing leaves the
      // machine, so no door.
      doorRouted: false,
      dryParseSafe: true,
      effect: "local-state",
      example: TURN_BREAKAGE_EXAMPLE,
      parseRejectIsIoFree: true,
      summary: "Record one loop breakage only a session can judge — refused without a cause",
      usage: TURN_BREAKAGE_USAGE,
    },
  }),
  ...turnBlockManifest,
  brief: lazy({
    load: () => import("../commands/turn/brief.js").then((m) => m.turnBriefCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: true,
      effect: "local-state",
      example:
        "slopweaver turn brief --channel C123 --message-ts 1712345678.000100 --thread-ts 1712345678.000100 " +
        '--user U0OWNER --text "what are my open PRs?"',
      parseRejectIsIoFree: true,
      summary: "Turn one Slack mention into a question the visible session judges — never a pre-decided route",
      usage: TURN_BRIEF_USAGE,
    },
  }),
  dispatch: lazy({
    load: () => import("../commands/turn/dispatch.js").then((m) => m.turnDispatchCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      // `external-write`/`doorRouted: true` since the `no-response` decision now deletes the capture
      // checklist through the real door — the ONLY mode that mutates Slack; inline/subagent-instruction/
      // fresh-session/poll/sweep all still only read or write local state. `requiresApproval` stays false:
      // the cleanup is routine and never pauses, matching this repo's own no-approval-pauses doctrine —
      // see `deleteCapturedChecklist` (`../../live/turn/poster.ts`) for the actual runtime gate.
      doorRouted: true,
      dryParseSafe: true,
      effect: "external-write",
      example:
        "slopweaver turn dispatch --brief ~/.slopweaver/briefs/C123-1712345678.000100.json --decision ./decision.json",
      parseRejectIsIoFree: true,
      summary:
        "Execute the tier a composed RoutingDecision named — inline/subagent instructions, or a real fresh workspace",
      usage: TURN_DISPATCH_USAGE,
    },
  }),
  watch: lazy({
    load: () => import("../commands/turn/watch.js").then((m) => m.turnWatchCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      // `external-write`: every tick is a real `chat.update` on the turn's card, routed through the same
      // door `turn status` and the sweep already use. No approval pause — a progress edit is the routine
      // send this repo's own no-approval-pauses doctrine names, and a ticker that stopped for one would
      // freeze the card it exists to keep moving.
      doorRouted: true,
      dryParseSafe: true,
      effect: "external-write",
      example: "slopweaver turn watch --brief ~/.slopweaver/briefs/C123-1712345678.000100.json --interval-seconds 90",
      parseRejectIsIoFree: true,
      summary: "Keep this turn's card current from its own logs, every N seconds, with no model in the loop",
      usage: TURN_WATCH_USAGE,
    },
  }),
  freeze: lazy({
    load: () => import("../commands/turn/freeze.js").then((m) => m.turnFreezeCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: true,
      effect: "local-state",
      example:
        "slopweaver turn freeze --ask C123/1712345678.000100 --out src/__tests__/fixtures/replay/my-incident " +
        '--incident "the sweep abandoned a live worker" --through dispatched',
      parseRejectIsIoFree: true,
      summary: "Freeze one failed turn's own files into a redacted replay fixture a test can re-run offline",
      usage: TURN_FREEZE_USAGE,
    },
  }),
  ledger: lazy({
    load: () => import("../commands/turn/ledger.js").then((m) => m.turnLedgerCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: true,
      doorRouted: false,
      dryParseSafe: true,
      effect: "none",
      example: "slopweaver turn ledger --since 2026-09-15T00:00:00Z",
      parseRejectIsIoFree: true,
      summary: "One row per ask with the five spans of its turn, and the mean/median footer under them",
      usage: TURN_LEDGER_USAGE,
    },
  }),
  ignore: lazy({
    load: () => import("../commands/turn/ignore.js").then((m) => m.turnIgnoreCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: true,
      dryParseSafe: true,
      effect: "external-write",
      example: 'slopweaver turn ignore --channel C123 --message-ts 1712345678.000100 --reason "not worth another turn"',
      parseRejectIsIoFree: true,
      summary: "Permanently ignore one exact ask — never reconsidered again, at any entrance",
      usage: TURN_IGNORE_USAGE,
    },
  }),
  "ignore-conversation": lazy({
    load: () => import("../commands/turn/ignoreConversation.js").then((m) => m.turnIgnoreConversationCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      // Same reasoning as `ignore`: a fresh add settles the live indicators of every already-captured,
      // unresolved ask this channel currently has, through the real door.
      doorRouted: true,
      dryParseSafe: true,
      effect: "external-write",
      example: 'slopweaver turn ignore-conversation --channel D0SYN000001 --reason "every tag here is ignorable"',
      parseRejectIsIoFree: true,
      summary: "Permanently ignore (or un-ignore, or list) EVERY tag in one whole conversation",
      usage: TURN_IGNORE_CONVERSATION_USAGE,
    },
  }),
  "retire-card": lazy({
    load: () => import("../commands/turn/retireCard.js").then((m) => m.turnRetireCardCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      // `external-write` because it DELETES a real Slack message; door-routed so that delete is in the ledger,
      // the only record left once the card is gone. The default gate set is empty, so routing means RECORDED.
      doorRouted: true,
      dryParseSafe: true,
      effect: "external-write",
      example:
        "slopweaver turn retire-card --channel C123 --message-ts 1712345678.000100 --working-ts 1712345680.000200",
      parseRejectIsIoFree: true,
      summary: "Delete one orphaned progress card an ended ask left behind, named exactly — never a live one",
      usage: TURN_RETIRE_CARD_USAGE,
    },
  }),
  satisfied: lazy({
    load: () => import("../commands/turn/satisfied.js").then((m) => m.turnSatisfiedCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      // `external-write` because it DELETES real messages and settles a real reaction; door-routed because
      // each of those writes belongs in the ledger — an ask closed with no message in the thread leaves the
      // door ledger as the only record that anything happened to it at all.
      doorRouted: true,
      dryParseSafe: true,
      effect: "external-write",
      example:
        "slopweaver turn satisfied --channel C123 --message-ts 1712345678.000100 " +
        '--answered-by-ts 1712345999.000200 --reason "the answer above covers exactly what this asked for"',
      parseRejectIsIoFree: true,
      summary: "Settle an ask another turn's answer already covers — retract its cards and post nothing",
      usage: TURN_SATISFIED_USAGE,
    },
  }),
  "settle-reaction": lazy({
    load: () => import("../commands/turn/settleReaction.js").then((m) => m.turnSettleReactionCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      // `external-write` because it calls `reactions.add`/`reactions.remove` on a real message, and
      // door-routed because an operator-initiated external write belongs in the ledger — the default gate
      // set is empty, so routing here means RECORDED, not refused. A turn's own terminal calls the SAME
      // convergence unrouted on purpose: that one is a courtesy the turn must survive losing, and has no
      // business blocking on a ledger append. `requiresApproval` stays false, matching this repo's
      // no-approval-pauses doctrine.
      doorRouted: true,
      dryParseSafe: true,
      effect: "external-write",
      example: "slopweaver turn settle-reaction --channel C123 --message-ts 1712345678.000100 --to completion",
      parseRejectIsIoFree: true,
      summary: "Converge one ask's tagged message to exactly ONE lifecycle reaction — the by-hand correction path",
      usage: TURN_SETTLE_REACTION_USAGE,
    },
  }),
  resume: lazy({
    load: () => import("../commands/turn/resume.js").then((m) => m.turnResumeCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: true,
      effect: "local-state",
      example: 'slopweaver turn resume --dispatch \'["C123","1712345678.000100","1712345678.000100"]\'',
      parseRejectIsIoFree: true,
      summary:
        "Runs inside a fresh visible session `turn dispatch` opened — loads its brief, then validates its answer",
      usage: TURN_RESUME_USAGE,
    },
  }),
  review: lazy({
    load: () => import("../commands/turn/review.js").then((m) => m.turnReviewCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: true,
      effect: "local-state",
      example:
        'slopweaver turn review --dispatch \'["C123","1712345678.000100","1712345678.000100"]\' --answer /tmp/answer.json',
      parseRejectIsIoFree: true,
      summary:
        "Open the independent reviewer for a composed answer — briefed by code from its bytes — and read its verdict",
      usage: TURN_REVIEW_USAGE,
    },
  }),
  status: lazy({
    load: () => import("../commands/turn/status.js").then((m) => m.turnStatusCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      // `external-write`/`doorRouted: true`, same reasoning as `dispatch`'s own sweep-tick checklist push:
      // this ALWAYS edits the checklist message through `advanceWorking`'s `throughDoor` call.
      // `requiresApproval` stays false — a courtesy checklist advance, routine and never pausing, the same
      // posture the sweep's own push already has.
      doorRouted: true,
      dryParseSafe: true,
      effect: "external-write",
      example:
        'slopweaver turn status --brief ~/.slopweaver/briefs/C123-1712345678.000100.json --status "3 prior decisions found in the corpus"',
      parseRejectIsIoFree: true,
      summary:
        "The session doing the work pushes its own live checklist update, self-reported instead of screen-scraped",
      usage: TURN_STATUS_USAGE,
    },
  }),
};
