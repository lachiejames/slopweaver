/**
 * The provider doors of the noun barrel, and the Slack bot's turn path: the work-tracking and document doors
 * (`linear`, `proposal`, `sop`, `notion`, `github`, `cycle`), the mail, drive and calendar doors (`gmail`,
 * `outlook`, `outlook-calendar`, `drive`, `calendar`), Slack and the bot's turn (`slack`, `listen`, `turn`, `queue`, `responders`),
 * and the cloud and write doors (`google`, `gcp`, `write`, `alias`, `vulnerability-fix`).
 *
 * `./index.ts` spreads this array into `MANIFEST_MODULES`. A new noun of this family appends ONE row here; a
 * family file nearing the 300-code-line cap splits again rather than growing past it.
 */

import type { NounManifestModule } from "../manifest.js";
import { aliasManifest } from "./alias.js";
import { calendarManifest } from "./calendar.js";
import { cycleManifest } from "./cycle.js";
import { driveManifest } from "./drive.js";
import { gcpManifest } from "./gcp.js";
import { githubManifest } from "./github.js";
import { gmailManifest } from "./gmail.js";
import { googleManifest } from "./google.js";
import { linearManifest } from "./linear.js";
import { listenManifest } from "./listen.js";
import { notionManifest } from "./notion.js";
import { outlookManifest } from "./outlook.js";
import { outlookCalendarManifest } from "./outlookCalendar.js";
import { proposalManifest } from "./proposal.js";
import { queueManifest } from "./queue.js";
import { respondersManifest } from "./responders.js";
import { slackManifest } from "./slack.js";
import { sopManifest } from "./sop.js";
import { turnManifest } from "./turn.js";
import { vulnerabilityFixManifest } from "./vulnerabilityFix.js";
import { writeManifest } from "./write.js";

/** The provider doors and the bot's turn path, each one `{ noun, summary, verbs }` row. */
export const DOOR_MANIFEST_MODULES: readonly NounManifestModule[] = [
  {
    noun: "linear",
    summary: "Read current Linear objects, and file or re-render issues from a typed form through the door",
    verbs: linearManifest,
  },
  {
    noun: "proposal",
    summary: "Compose, gate and publish a golden proposal — a typed form in, a Notion page out",
    verbs: proposalManifest,
  },
  {
    noun: "sop",
    summary: "Compose, gate and publish a standard operating procedure — a typed form in, a Notion page out",
    verbs: sopManifest,
  },
  {
    noun: "notion",
    summary: "Read one current Notion object, or create, update, move and archive a page through the door",
    verbs: notionManifest,
  },
  {
    noun: "github",
    summary: "Read current GitHub objects, and govern pull-request branch, description and ready operations",
    verbs: githubManifest,
  },
  {
    noun: "gmail",
    summary: "The mail door: authorise a Google mailbox by consent, then list and read messages with stated bounds",
    verbs: gmailManifest,
  },
  {
    noun: "outlook",
    summary: "The Outlook mail door: authorise a personal Microsoft mailbox, then read, organise, draft and send",
    verbs: outlookManifest,
  },
  {
    noun: "outlook-calendar",
    summary: "The Outlook calendar door: read a personal Microsoft account's calendars and events, with stated bounds",
    verbs: outlookCalendarManifest,
  },
  {
    noun: "drive",
    summary: "The Drive door: authorise a Google Drive by consent, then list and read files with stated bounds",
    verbs: driveManifest,
  },
  {
    noun: "calendar",
    summary: "Read a Google Calendar, find free time, book or move; anything to a person waits or is refused",
    verbs: calendarManifest,
  },
  {
    noun: "slack",
    summary: "Send to Slack: a form-filled message, thread reply, or image — as you or as the bot, via the door",
    verbs: slackManifest,
  },
  {
    noun: "listen",
    summary: "Answer when the bot is tagged in Slack — Socket Mode in, one reply out, through the door",
    verbs: listenManifest,
  },
  {
    noun: "turn",
    summary: "Answer a Slack mention in-thread — live checklist, cited answer, and what the corpus could not see",
    verbs: turnManifest,
  },
  {
    noun: "queue",
    summary: "The replies the door held rather than sent: read them, release one through the door, or drop it",
    verbs: queueManifest,
  },
  {
    noun: "responders",
    summary: "Read and edit responders.json — the list gating who may address the bot and reply",
    verbs: respondersManifest,
  },
  {
    noun: "cycle",
    summary: "Linear cycle hygiene and overdue project updates, as proposals with their evidence — nothing is written",
    verbs: cycleManifest,
  },
  {
    noun: "google",
    summary:
      "Google Cloud credentials a seat needs — read whether they work, and wait on the owner's sign-in rather than run it",
    verbs: googleManifest,
  },
  {
    noun: "gcp",
    summary:
      "The door for Google Cloud reads and writes in place of raw gcloud — Cloud Run, Secret Manager, service accounts, APIs and Artifact Registry, every write previewed, approved by digest and additive unless --edit-existing says why",
    verbs: gcpManifest,
  },
  {
    noun: "write",
    summary:
      "Change state at a provider. Kept out of `atlas` because an atlas only ever reads — a generation records what was observed, never what this machine changed",
    verbs: writeManifest,
  },
  {
    noun: "vulnerability-fix",
    summary:
      "The standing vulnerability-fix flywheel: the open dependency-bump pull requests one author has standing, and the daily roster post that asks a reviewer for each",
    verbs: vulnerabilityFixManifest,
  },
  {
    noun: "alias",
    summary:
      "Provision the organisation-owned mailboxes an assistant plan signs up on — `<provider>-<label>@<zone>` forwarding rules, and the zone catch-all, on a Cloudflare zone this account holds",
    verbs: aliasManifest,
  },
];
