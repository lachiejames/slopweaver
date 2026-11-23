/**
 * The fleet's nouns of the noun barrel: the board, its sessions and its ledgers and registers (`handover`,
 * `fleet`, `cmux`, `session`, `transcripts`, `supervisor`, `sweep`, `knowledge`, `hand`, `monitor`, `autonomy`,
 * `reading`, `gold`, `value`, `automation`, `workstreams`, `witness`, `incident`, `org-health`), what reaches the owner
 * (`talk`, `page`, `pane`, `briefing`, `session-start`, `browser`) and the supervisor stream, grants, private terms
 * and hatches (`events`, `grant`, `private-terms`, `hatch`).
 *
 * `./index.ts` spreads this array into `MANIFEST_MODULES`. A new noun of this family appends ONE row here; a
 * family file nearing the 300-code-line cap splits again rather than growing past it.
 */

import type { NounManifestModule } from "../manifest.js";
import { automationManifest } from "./automation.js";
import { autonomyManifest } from "./autonomy.js";
import { briefingManifest } from "./briefing.js";
import { browserManifest } from "./browser.js";
import { cmuxManifest } from "./cmux.js";
import { eventsManifest } from "./events.js";
import { fleetManifest } from "./fleet.js";
import { goldManifest } from "./gold.js";
import { grantManifest } from "./grant.js";
import { handManifest } from "./hand.js";
import { handoverManifest } from "./handover.js";
import { hatchManifest } from "./hatch.js";
import { incidentManifest } from "./incident.js";
import { knowledgeManifest } from "./knowledge.js";
import { monitorManifest } from "./monitor.js";
import { orgHealthManifest } from "./orgHealth.js";
import { pageManifest } from "./page.js";
import { paneManifest } from "./pane.js";
import { privateTermsManifest } from "./privateTerms.js";
import { readingManifest } from "./reading.js";
import { rulingManifest } from "./ruling.js";
import { sessionManifest } from "./session.js";
import { sessionStartManifest } from "./sessionStart.js";
import { supervisorManifest } from "./supervisor.js";
import { sweepManifest } from "./sweep.js";
import { talkManifest } from "./talk.js";
import { transcriptsManifest } from "./transcripts.js";
import { valueManifest } from "./value.js";
import { witnessManifest } from "./witness.js";
import { workstreamsManifest } from "./workstreams.js";

/** The fleet's nouns, each one `{ noun, summary, verbs }` row. */
export const FLEET_MANIFEST_MODULES: readonly NounManifestModule[] = [
  {
    noun: "events",
    summary: "The supervisor stream: what the Slack listener and the recipe scheduler publish about themselves",
    verbs: eventsManifest,
  },
  {
    noun: "grant",
    summary: "The journalled grant: one decision the owner already made, carried to the session that performs it",
    verbs: grantManifest,
  },
  {
    noun: "private-terms",
    summary:
      "The owner's private words, kept hands-free with the owner's meaning, and the in-context review a write a meant term matched waits on",
    verbs: privateTermsManifest,
  },
  {
    noun: "ruling",
    summary: "The owner's standing rulings by category, in the owner's words: record, list, seed, and the one view",
    verbs: rulingManifest,
  },
  {
    noun: "incident",
    summary: "A live incident investigated unasked: judge the channels, and post the investigation's one floating note",
    verbs: incidentManifest,
  },
  {
    noun: "talk",
    summary:
      "The console voice: compose its call on the ChatGPT plan; read this checkout, the board, the glossary, the knowledge register and the supervisor history bounded; and relay the owner's spoken steer to the board",
    verbs: talkManifest,
  },
  {
    noun: "hatch",
    summary: "Take and read a journalled escape hatch — the outbound lane of src/hatch/registry.ts",
    verbs: hatchManifest,
  },
  {
    noun: "handover",
    summary: "The orchestration-doc board: what is runnable now, what is waiting, and on what",
    verbs: handoverManifest,
  },
  {
    noun: "fleet",
    summary: "The board's single pane of glass: every workstream's git, PR and probe state, measured at call time",
    verbs: fleetManifest,
  },
  {
    noun: "cmux",
    summary: "Spawn a real Claude Code session in a handover doc's worktree via cmux, or close one",
    verbs: cmuxManifest,
  },
  {
    noun: "session",
    summary: "The supervisor's own ledger: which chats it knows about, and what it has learned about each",
    verbs: sessionManifest,
  },
  {
    noun: "transcripts",
    summary:
      "Structured, typed access to this machine's Claude session transcripts — sessions, human turns, counts, tool errors",
    verbs: transcriptsManifest,
  },
  {
    noun: "page",
    summary: "The local page a session ends in: one authored fragment published as a document, frozen, with an address",
    verbs: pageManifest,
  },
  {
    noun: "org-health",
    summary: "The organisation's incidents, read off its incident channel like a status page, acknowledged locally",
    verbs: orgHealthManifest,
  },
  {
    noun: "pane",
    summary: "The owner's own open pull requests, ranked, with why each is blocked and on whom",
    verbs: paneManifest,
  },
  {
    noun: "supervisor",
    summary: "The supervisor role's own files: the rendered sweep prompt, and the state doc's size caps",
    verbs: supervisorManifest,
  },
  {
    noun: "sweep",
    summary:
      "Find superseded context by the evidence it carries, delete it by default, and journal every act so a wrong one is one command to undo",
    verbs: sweepManifest,
  },
  {
    noun: "knowledge",
    summary:
      "The knowledge register: what an investigation LEARNED, with its verdict and the command that re-checks it",
    verbs: knowledgeManifest,
  },
  {
    noun: "hand",
    summary:
      "The hand-step register: the narrow set of steps only the owner's hands can take, the floating note that " +
      "carries one, and the push lane that reaches the owner about them",
    verbs: handManifest,
  },
  {
    noun: "monitor",
    summary:
      "The local Datadog: named conditions over this machine's own ledgers, the floating card each one " +
      "fires, and the cmux notification filter that leaves room for it",
    verbs: monitorManifest,
  },
  {
    noun: "autonomy",
    summary:
      "The autonomy ledger: every act taken under graduated autonomy, why it was obvious, and the owner's word on it",
    verbs: autonomyManifest,
  },
  {
    noun: "reading",
    summary:
      "The readings ledger: the last document each slow verb printed, who took it and when it was true — " +
      "what a console page shows instead of taking the read itself",
    verbs: readingManifest,
  },
  {
    noun: "gold",
    summary: "The gold-debt ledger: what a silver or bronze merge still owes, what blocks it, and how it was settled",
    verbs: goldManifest,
  },
  {
    noun: "value",
    summary: "The weekly value sample: five finished asks with their cost and outcome, and whether each got used",
    verbs: valueManifest,
  },
  {
    noun: "automation",
    summary: "The automations: which are due, claimed exactly once, run here or seated (`recipe` still answers)",
    verbs: automationManifest,
  },
  {
    noun: "session-start",
    summary: "The ranked list of what is actually waiting on you, read from the board rather than from memory",
    verbs: sessionStartManifest,
  },
  {
    noun: "briefing",
    summary: "Render the fleet-briefing page from a typed form, and check one against its required shape",
    verbs: briefingManifest,
  },
  {
    noun: "browser",
    summary: "Which of your own Chrome profiles every browser leg reads, and whether it is signed in",
    verbs: browserManifest,
  },
  {
    noun: "workstreams",
    summary:
      "The owner's outcomes register — every workstream they drive, each bar derived from a cited timeline from the problem raised to the loop closed with the team — that the console's Workstreams page reads",
    verbs: workstreamsManifest,
  },
  {
    noun: "witness",
    summary: "Check another bot's claim with a visible worker, post only what is material with proof, correct it once",
    verbs: witnessManifest,
  },
];
