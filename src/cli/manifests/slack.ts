/**
 * Lazy manifest for the `slack` noun — slopweaver's first OUTBOUND surface. There is deliberately NO
 * default verb: `slopweaver slack` alone must print the verb list, never pick a send for you.
 * `image` is deliberately absent: media rides on the message it belongs to as `--media` — the card on the
 * bot lane, the last drip message on the as-me lane — never as its own message. Both verbs
 * serve BOTH lanes — `--as bot` renders the measured card, `--as me` renders a freeform drip — because the
 * destination and the threading are the same question either way; only the artifact differs. Each verb's
 * meta declares `effect: "external-write"` + `doorRouted: true`, which is what the door-coverage ratchet
 * verifies; the command module (and with it the Slack client) loads only when a verb is dispatched.
 *
 * The lifecycle verbs `correct`, `delete` and `edit` (`slackCorrectVerb`, `slackDeleteVerb`, `slackEditVerb`) and the
 * shared `slackWriteMeta` live in `./slackLifecycle.ts` and are exported from there only; this file imports all four
 * and places each verb by name, so `delete` and `edit` keep the key order `--help` lists them in.
 */
import { SLACK_REPEATS_USAGE } from "../commands/slack/repeatsUsage.js";
import { POLL_USAGE, POST_USAGE, REPLY_USAGE, SLACK_DRAFT_USAGE } from "../commands/slack/slackUsage.js";
import { SLACK_STATUS_USAGE } from "../commands/slack/statusUsage.js";
import { SLACK_TAGGED_USAGE } from "../commands/slack/taggedUsage.js";
import { SLACK_UNREAD_USAGE } from "../commands/slack/unreadUsage.js";
import {
  SLACK_ALERT_SUMMARY_USAGE,
  SLACK_CANVAS_USAGE,
  SLACK_CHANNEL_USAGE,
  SLACK_DM_USAGE,
  SLACK_PROBE_USAGE,
  SLACK_READ_FILE_USAGE,
  SLACK_READ_THREAD_USAGE,
  SLACK_SAVED_USAGE,
  SLACK_SHOT_USAGE,
  SLACK_VOICE_RULES_USAGE,
  SLACK_WHEN_USAGE,
} from "../commands/slack/verbUsage.js";
import { lazy, type VerbManifestEntry } from "../manifest.js";
import { slackChannelViewManifest } from "./slackChannelView.js";
import { slackCorrectVerb, slackDeleteVerb, slackEditVerb, slackWriteMeta } from "./slackLifecycle.js";
import { slackRepliedManifest } from "./slackReplied.js";
import { slackSnapshotsManifest } from "./slackSnapshots.js";

export const slackManifest: Readonly<Record<string, VerbManifestEntry>> = {
  // A READ that emits a FORM, and posts nothing. It is a sibling of `read-thread` rather than of `post`: the
  // effect axis is what the door-coverage gate reads, and there is no effect here to route. Keeping the sourcing
  // and the sending apart is also what lets a summary be looked at before anybody decides to send it — which is
  // the whole shape the owner asked for after an alert the owner disliked had already gone out.
  "alert-summary": lazy({
    load: () => import("../commands/slack/alertSummaryRun.js").then((m) => m.slackAlertSummaryCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: true,
      // `external-read` rather than `local-state`: it reads Slack and writes nothing at all, not even under the
      // home. It spends no model call either — every number is `live/slack/alertTally.ts`'s pure count, and the
      // card's one sentence is the OPERATOR's, supplied by `--lead` and validated against those counts.
      effect: "external-read",
      example: "slopweaver slack alert-summary --channel D123 --window 7d --form",
      parseRejectIsIoFree: true,
      summary: "Count the alert notifications in a channel over a window, and emit the card's form — posts nothing",
      usage: SLACK_ALERT_SUMMARY_USAGE,
    },
  }),
  // The three WORKSPACE-SHAPE verbs. They are not sends and are grouped apart from `post`/`reply` on one
  // axis that matters: each changes what the workspace CONTAINS, and each one's retraction is weaker than a
  // message's. A channel can only be archived (the name stays taken forever), a DM cannot be closed for the
  // other person, and a canvas has to be deleted on purpose. They share `writeMeta` because all three are
  // door-routed external writes, and they carry their own usage blocks because they share no flag at all.
  canvas: lazy({
    load: () => import("../commands/slack/canvasRun.js").then((m) => m.slackCanvasCommand),
    meta: {
      ...slackWriteMeta,
      example: 'slopweaver slack canvas create --title "Runbook" --markdown ./runbook.md --dry-run',
      summary:
        "Create, rewrite or delete a Slack canvas — a standalone document, or THE canvas of a channel " +
        "(which everyone in it can read the moment it exists) — through the door",
      usage: SLACK_CANVAS_USAGE,
    },
  }),
  channel: lazy({
    load: () => import("../commands/slack/channelRun.js").then((m) => m.slackChannelCommand),
    meta: {
      ...slackWriteMeta,
      example: "slopweaver slack channel create --name design-review --invite seth,alex --dry-run",
      summary:
        "Create a Slack channel — named, described and populated in one irreversible step — invite people " +
        "into one that exists, or archive one, through the door",
      usage: SLACK_CHANNEL_USAGE,
    },
  }),
  correct: slackCorrectVerb,
  delete: slackDeleteVerb,
  dm: lazy({
    load: () => import("../commands/slack/dmRun.js").then((m) => m.slackDmCommand),
    meta: {
      ...slackWriteMeta,
      example: "slopweaver slack dm open --with seth,alex --dry-run",
      summary:
        "Open the DM or group DM for a set of people and print its id — idempotent, since Slack resolves " +
        "one user set to one conversation — through the door",
      usage: SLACK_DM_USAGE,
    },
  }),
  edit: slackEditVerb,
  // `owed` and `awaiting`, the two local corpus snapshots.
  ...slackSnapshotsManifest,
  // A live READ that deletes nothing: each duplicate it finds prints the `slack delete` that removes it
  // through the door, so the effect axis stays a read.
  repeats: lazy({
    load: () => import("../commands/slack/repeatsRun.js").then((m) => m.slackRepeatsCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: true,
      doorRouted: false,
      dryParseSafe: true,
      effect: "external-read",
      example: "slopweaver slack repeats --days 7 --as both",
      parseRejectIsIoFree: true,
      summary:
        "Audit every place you or the bot said the same thing twice in the last N days — same digest, or " +
        "same first line within a day — with the copy to keep and the delete for each other; deletes nothing",
      usage: SLACK_REPEATS_USAGE,
    },
  }),
  // A live READ of one thread that writes nothing: the done-check an ask anchored to a Slack message carries.
  ...slackRepliedManifest,
  // A live READ beside the corpus one: its search runs on the owner's user token, so the effect axis is external-read.
  tagged: lazy({
    load: () => import("../commands/slack/taggedRun.js").then((m) => m.slackTaggedCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: true,
      doorRouted: false,
      dryParseSafe: true,
      effect: "external-read",
      example: "slopweaver slack tagged --days 7",
      parseRejectIsIoFree: true,
      summary:
        "List every recent Slack message where a person tagged you, with its permalink and whether you have " +
        "spoken in the thread since — corpus first, then a live search of the tail; unread state is not exposed",
      usage: SLACK_TAGGED_USAGE,
    },
  }),
  // A live READ on the owner's user token: DM read markers, then `tagged`'s own two searches opened whole.
  unread: lazy({
    load: () => import("../commands/slack/unreadRun.js").then((m) => m.slackUnreadCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: true,
      doorRouted: false,
      dryParseSafe: true,
      effect: "external-read",
      example: "slopweaver slack unread --days 3",
      parseRejectIsIoFree: true,
      summary:
        "List your unread Slack DMs by Slack's own read marker, then every thread where a person has spoken " +
        "since your last word, one line each with the link `talk slack-open` reads whole — read live",
      usage: SLACK_UNREAD_USAGE,
    },
  }),
  // A poll is ONE verb with a nested `results` sub-command, not two verbs. The
  // meta is classified conservatively as `external-write` even though `poll results` performs no effect:
  // one manifest entry carries one `CommandMeta`, and over-declaring a read is the safe direction — the
  // alternative would be under-declaring the write, which the door-coverage ratchet exists to prevent.
  poll: lazy({
    load: () => import("../commands/slack/pollRun.js").then((m) => m.slackPollCommand),
    meta: {
      ...slackWriteMeta,
      example: "slopweaver slack poll --as bot --channel D123 --form - --dry-run",
      summary: "Post a Slack poll voted on by reactions, and read its votes back out of the local corpus",
      usage: POLL_USAGE,
    },
  }),
  // A read-only PROBE: one Web API call, reported as a shape. `external-read` and `doorRouted: false` for
  // the same reason `alert-summary` is — there is no effect to route, because the allowlist in
  // `atlas/slackApi/probePolicy.ts` makes a write unreachable rather than merely ungated. It is here rather
  // than under `atlas` because it CALLS Slack, and the atlas noun is the offline map.
  probe: lazy({
    load: () => import("../commands/slack/probeRun.js").then((m) => m.slackProbeCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: true,
      doorRouted: false,
      dryParseSafe: true,
      effect: "external-read",
      example: "slopweaver slack probe --method conversations.history channel=C123 limit=1",
      parseRejectIsIoFree: true,
      summary:
        "Call one READ-ONLY Slack Web API method and report the response SHAPE — field names, counts, " +
        "timing, never message bodies. The measurement instrument behind an API claim",
      usage: SLACK_PROBE_USAGE,
    },
  }),
  // `local-state`, not `external-write`, and the distinction is the verb's whole reason to exist. Recording
  // a draft appends one row to a JSONL under `$SLOPWEAVER_HOME` and posts NOTHING; the Slack calls it
  // makes (`conversations.info`, `auth.test`, and a `--thread-ts` root's `conversations.replies`) are reads.
  // A new as-me row's Codex draft beside it is one sealed pass, classed as `codex plan` is: the same opt-in
  // OpenAI boundary (`docs/security/codex-boundary.md`), posting nothing. There is no `release` sub-command here — a parked draft is sent by `slack post --as me --draft <id>`, or
  // `slack reply` for a thread reply, which is where the door, the render proof and the duplicate gate are.
  draft: lazy({
    load: () => import("../commands/slack/draftRun.js").then((m) => m.slackDraftCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: true,
      effect: "local-state",
      example:
        'slopweaver slack draft record --channel C123 --form - --why "the ISO group question" ' +
        '--self-evident "a question, it claims nothing"',
      parseRejectIsIoFree: true,
      summary:
        "Compose a message AS YOU, run every as-me check that needs no ability to post, and PARK it for " +
        "the owner to read in the console — nothing is sent",
      usage: SLACK_DRAFT_USAGE,
    } as const,
  }),
  post: lazy({
    load: () => import("../commands/slack/run.js").then((m) => m.slackPostCommand),
    meta: {
      ...slackWriteMeta,
      example: "slopweaver slack post --as me --channel D123 --shape top-level --form - --dry-run",
      summary: "Post to Slack as the bot (a card) or as yourself (a drip) — through the door",
      usage: POST_USAGE,
    },
  }),
  ...slackChannelViewManifest,
  "read-file": lazy({
    load: () => import("../commands/slack/readFileRun.js").then((m) => m.slackReadFileCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      // A READ, exactly as `read-thread` is: nothing leaves for Slack, so it does not go through the admit
      // door. It persists the fetched body under the home, which is why the effect is `local-state`.
      doorRouted: false,
      dryParseSafe: true,
      effect: "local-state",
      example: "slopweaver slack read-file https://acme.slack.com/docs/T0SYN000001/F0BTACLP1D0",
      parseRejectIsIoFree: true,
      summary:
        "Read one Slack file from an id or link — a canvas, a huddle's notes, and the huddle TRANSCRIPT " +
        "the notes point at, rendered with its speaker and timestamp lines intact",
      usage: SLACK_READ_FILE_USAGE,
    },
  }),
  "read-thread": lazy({
    load: () => import("../commands/slack/readThreadRun.js").then((m) => m.slackReadThreadCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      // A READ, not a write: nothing leaves for Slack, so it does not go through the admit door. It does
      // persist attachment bytes under the home, which is why the effect is `local-state` rather than none.
      doorRouted: false,
      dryParseSafe: true,
      effect: "local-state",
      example: "slopweaver slack read-thread https://acme.slack.com/archives/C123/p1785114398557099",
      parseRejectIsIoFree: true,
      summary:
        "Read Slack from a message link — complete by default, or agent-bounded around the addressed " +
        "reply and channel parent with exact residue and navigable permalinks",
      usage: SLACK_READ_THREAD_USAGE,
    },
  }),
  // The owner's own Later list. No published API reads it (`stars.list` answers starred channels only, measured),
  // so this opens Later in the owner's Chrome and keeps the one `saved.list` response the client
  // fetched for itself — no screenshot, no click, no cursor followed, no item changed.
  saved: lazy({
    load: () => import("../commands/slack/savedRun.js").then((m) => m.slackSavedCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: true,
      effect: "external-read",
      example: "slopweaver slack saved --json",
      parseRejectIsIoFree: true,
      summary:
        "Read your own Slack Later (saved-for-later) list off the call your client makes — pointers and " +
        "state, never message text, never a change to an item",
      usage: SLACK_SAVED_USAGE,
    },
  }),
  // The one Slack READ that is a picture rather than an API call, and the only verb in this repo that may
  // PHOTOGRAPH Slack's web client. It exists for the one question `conversations.history` cannot answer:
  // the fold is drawn by the CLIENT, not by the blocks, so only a photograph of the rendered message
  // settles whether a message shows "Show more". Doctrine rule 3's own answer — a slopweaver verb driving
  // the owner's browser IS the door — is what makes this the door rather than a bypass of one; `browser shot`
  // still refuses Slack by name, and that refusal is unchanged. Navigate-and-photograph only.
  shot: lazy({
    load: () => import("../commands/slack/shotRun.js").then((m) => m.slackShotCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: true,
      effect: "local-state",
      example: "slopweaver slack shot https://acme.slack.com/archives/C123/p1785114398557099 --out /tmp/m.png",
      parseRejectIsIoFree: true,
      summary:
        "Photograph ONE rendered Slack message in your own Chrome through the Playwright relay — the only " +
        "instrument that can answer whether a message renders folded behind Show more",
      usage: SLACK_SHOT_USAGE,
    },
  }),
  reply: lazy({
    load: () => import("../commands/slack/run.js").then((m) => m.slackReplyCommand),
    meta: {
      ...slackWriteMeta,
      example: "slopweaver slack reply --as me --channel D123 --thread-ts 1712345678.000100 --form - --dry-run",
      summary: "Reply in a Slack thread — a bot card, or a drip under your own name (through the door)",
      usage: REPLY_USAGE,
    },
  }),
  // A READ that pre-briefs the `--as me` composer: prints the operator's CURRENT response shape and exact
  // voice rules before a draft exists, so the shape reaches the composer and a rule the gate would refuse is
  // known up front rather than discovered by tripping it. See ../../outbound/voice/composerBrief.ts.
  // Read-only, so no door and no approval.
  // The owner's OWN status and presence, on the user token. `status show` performs no effect, and the entry is
  // over-declared as a write for the reason `poll`'s is: one entry carries one meta, and under-declaring
  // the write is the direction the door-coverage ratchet exists to prevent.
  status: lazy({
    load: () => import("../commands/slack/statusRun.js").then((m) => m.slackStatusCommand),
    meta: {
      ...slackWriteMeta,
      example:
        'slopweaver slack status set --text "Public holiday, back Monday" --emoji :palm_tree: --until end-of-day --zone Australia/Melbourne --dry-run',
      summary:
        "Set, clear or show YOUR Slack status (text, emoji, expiry) and set your presence away or auto, on your " +
        "user token — through the door",
      usage: SLACK_STATUS_USAGE,
    },
  }),
  "voice-rules": lazy({
    load: () => import("../commands/slack/voiceRulesRun.js").then((m) => m.slackVoiceRulesCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: true,
      doorRouted: false,
      dryParseSafe: true,
      effect: "none",
      example: "slopweaver slack voice-rules",
      parseRejectIsIoFree: true,
      summary:
        "Print the operator's CURRENT voice brief — their advisory response shape, then the enforced bans " +
        "(literal/word/phrase, plus paragraph spacing) — before an `--as me` draft is written; run this " +
        "first, not after a refusal; --check-stdin judges one message against the same bans, and " +
        "--slack-draft holds a Slack message to the parked-draft shape too and refuses one dense paragraph",
      usage: SLACK_VOICE_RULES_USAGE,
    },
  }),
  // Pure ARITHMETIC, not a read: no token, no network, no home, so it is the one verb here whose effect is
  // `none`. It exists because the conversion it does is the one a session kept doing in its head and
  // getting wrong — see ../commands/slack/whenCore.ts for the measured 80-minute miss.
  when: lazy({
    load: () => import("../commands/slack/whenRun.js").then((m) => m.slackWhenCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: true,
      effect: "none",
      example: "slopweaver slack when 1788220579.306599",
      parseRejectIsIoFree: true,
      summary:
        "Derive the instant a Slack ts (or a permalink carrying one) names — never convert one by hand, " +
        "and feed --json to any writer that needs the ISO",
      usage: SLACK_WHEN_USAGE,
    },
  }),
};
