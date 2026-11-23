/**
 * The `live` tree of the state home, classified entry by entry — the loss audit's live turn markers and tag
 * queue row, spread into `./authoredDirectories.ts`'s declaration and read by its deepest-row rule.
 *
 * `live` is not one class: the ask ledger, the turn markers, dispatches, reviews and the tag queue sit beside
 * 572 MB of browser session working files (measured: `du -sh ~/.slopweaver/live/browser`) and the
 * unredacted Slack and Gmail attachments a read fetched. So `live`, `live/slack` and `live/gmail` are `split`
 * and every entry under them is named here — a new one is printed by the import leg rather than read or
 * skipped in silence — while a file row carves the tag queue out of the listener's scratch process state.
 */
import type { HomeDirectoryClassification } from "./authoredDirectories.js";
import { exact } from "./homeClassificationRow.js";

/** Every `live` entry this installation has, in path order. */
export const LIVE_CLASSIFICATION: readonly HomeDirectoryClassification[] = [
  exact({
    because: "authored turn state beside process state and provider copies",
    directoryClass: "split",
    name: "live",
  }),
  exact({
    because: "what an interaction session observed and captured; process state that ends when the session closes",
    directoryClass: "scratch",
    name: "live/browser",
  }),
  exact({
    because: "whole ChatGPT conversations `chatgpt conversation` fetched, private, which ChatGPT re-serves",
    directoryClass: "scratch",
    name: "live/chatgpt",
  }),
  exact({
    because: "each plan's last usage reading, re-taken by the next `claude gauge` or `claude watch` tick",
    directoryClass: "scratch",
    name: "live/claude-usage",
  }),
  exact({
    because: "running Codex passes' holds on a limited account's week, each lapsing within its bound plus 15 minutes",
    directoryClass: "scratch",
    name: "live/codex-pass-reservations.json",
  }),
  exact({
    because: "every failed refresh the console started and why; nothing rebuilds it",
    directoryClass: "authored",
    name: "live/console-sync-failures.jsonl",
  }),
  exact({
    because: "each lint gate's last elapsed seconds, a scheduling hint the next whole-lane `dev lint` run rewrites",
    directoryClass: "scratch",
    name: "live/dev-lint-gate-seconds.json",
  }),
  exact({ because: "the supervisor stream and its readers' offsets", directoryClass: "authored", name: "live/events" }),
  exact({ because: "the browser relay's scratch for one page read", directoryClass: "scratch", name: "live/fathom" }),
  exact({
    because: "a once-a-day marker; losing it costs one republish",
    directoryClass: "scratch",
    name: "live/friction-review",
  }),
  exact({
    because: "the merge-hold lock and pull-request snapshots GitHub re-serves",
    directoryClass: "scratch",
    name: "live/github",
  }),
  exact({
    because: "every hold transition and how long it stood",
    directoryClass: "authored",
    name: "live/github/hold-ledger.jsonl",
  }),
  exact({ because: "mail bytes beside draft receipts", directoryClass: "split", name: "live/gmail" }),
  exact({
    because: "attachment bytes Gmail re-serves, private and unredacted, so never a row",
    directoryClass: "scratch",
    name: "live/gmail/attachments",
  }),
  exact({ because: "one receipt per board mail drafted", directoryClass: "authored", name: "live/gmail/board-drafts" }),
  exact({
    because: "the pinned mail a triage card draws, private and unredacted, re-fetched by `gmail card-mail --fetch`",
    directoryClass: "scratch",
    name: "live/gmail/card-mail",
  }),
  exact({
    because: "the exact ids each triage card showed the owner, which the owner's answer and a rule's check read",
    directoryClass: "authored",
    name: "live/gmail/triage-cards",
  }),
  exact({
    because: "the latest inbox reading, re-read by the next `gmail triage --write`",
    directoryClass: "scratch",
    name: "live/gmail/triage.json",
  }),
  exact({
    because: "the fixed documents each daily hygiene row replaces whole",
    directoryClass: "scratch",
    name: "live/hygiene",
  }),
  exact({
    because: "the listener's pid, heartbeat, connections and logs; its outcome is in the ask ledger",
    directoryClass: "scratch",
    name: "live/listener",
  }),
  exact({
    because: "every arm of the listener, and why",
    directoryClass: "authored",
    name: "live/listener/arms.jsonl",
  }),
  exact({
    because: "the tag queue `listen --follow --queue` records while no session answers",
    directoryClass: "authored",
    name: "live/listener/queue.jsonl",
  }),
  {
    because: "an old loop session's own scripts, captured output and pids",
    directoryClass: "scratch",
    name: "live/loop-",
    prefix: true,
  },
  exact({
    because: "what the machine gauge found at the time; a later reading cannot re-take it",
    directoryClass: "authored",
    name: "live/machine",
  }),
  exact({
    because: "attachment bytes Outlook re-serves, private and unredacted, so never a row",
    directoryClass: "scratch",
    name: "live/outlook/attachments",
  }),
  exact({
    because:
      "each provider's last Settings → Models sign-in, its lock and markers; the plan it made is in the register",
    directoryClass: "scratch",
    name: "live/plan-connections",
  }),
  exact({ because: "when each session last polled each target", directoryClass: "scratch", name: "live/poll-gate" }),
  exact({
    because: "automation definitions, their lifecycle and payloads, and the only copies of pre-repair state",
    directoryClass: "authored",
    name: "live/recipe",
  }),
  exact({ because: "a lock held while a row runs", directoryClass: "scratch", name: "live/recipe/locks" }),
  exact({ because: "screenshots taken as evidence", directoryClass: "authored", name: "live/recipe-shots" }),
  exact({
    because: "which seat passed the seat check under which pid; meaningless once that process is gone",
    directoryClass: "scratch",
    name: "live/seat-pass",
  }),
  exact({ because: "turn state beside the bytes a read fetched", directoryClass: "split", name: "live/slack" }),
  exact({ because: "the ask-lifecycle ledger", directoryClass: "authored", name: "live/slack/asks.jsonl" }),
  exact({
    because: "the latest `slack awaiting --write` reading, re-taken by the next",
    directoryClass: "scratch",
    name: "live/slack/awaiting.json",
  }),
  exact({ because: "the rapid-tag-burst queue", directoryClass: "authored", name: "live/slack/burst-queue.jsonl" }),
  exact({
    because: "thumbnails `slack channel-view` fetched, private and unredacted, which every read fetches again",
    directoryClass: "scratch",
    name: "live/slack/channel-media",
  }),
  exact({ because: "every validated draft of a turn", directoryClass: "authored", name: "live/slack/checkpoints" }),
  exact({ because: "every detective wave a turn planned", directoryClass: "authored", name: "live/slack/detectives" }),
  exact({ because: "one dispatch record per ask", directoryClass: "authored", name: "live/slack/dispatches" }),
  exact({
    because: "bodies `slack read-file` fetched — a huddle transcript among them — which Slack re-serves",
    directoryClass: "scratch",
    name: "live/slack/file-reads",
  }),
  exact({
    because: "the latest `slack finding-followups --write` reading, re-taken by the next",
    directoryClass: "scratch",
    name: "live/slack/finding-followups.json",
  }),
  exact({
    because: "per thread the bot sent into, the newest message a followup read already showed",
    directoryClass: "authored",
    name: "live/slack/followup-watermarks.json",
  }),
  exact({
    because: "the permanent ignore registry",
    directoryClass: "authored",
    name: "live/slack/ignored-asks.jsonl",
  }),
  exact({
    because: "the permanent conversation ignore registry",
    directoryClass: "authored",
    name: "live/slack/ignored-conversations.jsonl",
  }),
  exact({
    because: "the latest `slack owed --write` reading, re-taken by the next",
    directoryClass: "scratch",
    name: "live/slack/owed.json",
  }),
  exact({
    because: "where every post landed, and the one register of threads the bot sent into",
    directoryClass: "authored",
    name: "live/slack/placements.jsonl",
  }),
  exact({ because: "each ask's stages and card writes", directoryClass: "authored", name: "live/slack/progress" }),
  exact({
    because: "the capture queue a listener appended",
    directoryClass: "authored",
    name: "live/slack/queue.jsonl",
  }),
  exact({
    because: "the recovery sweep's watermark and per-thread checkpoints",
    directoryClass: "authored",
    name: "live/slack/recovery-sweep.json",
  }),
  exact({
    because: "each review's locator, packet and verdict",
    directoryClass: "authored",
    name: "live/slack/reviews",
  }),
  exact({
    because: "every delete of a superseded answer, intent and result",
    directoryClass: "authored",
    name: "live/slack/supersessions.jsonl",
  }),
  exact({
    because: "attachments `slack read-thread` fetched, private and unredacted, which Slack re-serves",
    directoryClass: "scratch",
    name: "live/slack/thread-files",
  }),
  exact({ because: "each turn's decisions about itself", directoryClass: "authored", name: "live/slack/turn-journal" }),
  exact({
    because: "each turn's TURN_READY / TURN_FAILED completion signal",
    directoryClass: "authored",
    name: "live/slack/turn-markers",
  }),
  exact({
    because: "every witnessed message a worker was dispatched for and how it ended; what stops a second post",
    directoryClass: "authored",
    name: "live/slack/witness-outcomes.jsonl",
  }),
  exact({
    because: "the threads the listener is witnessing; nothing else holds the set",
    directoryClass: "authored",
    name: "live/slack/witness-state.json",
  }),
  exact({
    because: "each worker's statement of which session it is",
    directoryClass: "authored",
    name: "live/slack/worker-sessions",
  }),
  exact({
    because: "a respawn booted and not yet confirmed; stale once it is",
    directoryClass: "scratch",
    name: "live/standing",
  }),
  exact({
    because: "each corpus refresh run's progress, per-container writes and finish; nothing rebuilds it",
    directoryClass: "authored",
    name: "live/sync-runs",
  }),
  exact({ because: "the code-owner-to-colleague reviewer map", directoryClass: "authored", name: "live/vuln" }),
];
