/**
 * The escape-hatch rows for `slopweaver supervisor tick-record` and `supervisor tick close` — every way a
 * supervisor tick can be recorded or closed with something on the board left undone.
 *
 * One category of `./registry.ts`'s register; `ESCAPE_HATCHES` spreads it in at its position, directly before
 * the talk rows. Add a row for a new tick refusal HERE.
 */

import type { EscapeHatch } from "./types.js";

/** Every hatch on recording or closing a supervisor tick, in register order. */
export const SUPERVISOR_TICK_HATCHES = [
  {
    caught:
      "this sweep left capacity free while a ready board row under one of the outcomes the owner KEPT on their Workstreams register had nobody on it, and the draft neither spawned into it nor recorded a hold rationale naming it — the fleet is expected to use its capacity, not sit idle",
    command: "slopweaver supervisor tick-record",
    exceptions: [
      "the fleet is at a ceiling the machine gauge cannot see — a Claude usage refusal inside the sessions themselves",
      "every unspawned row under that outcome is blocked on something this tick cannot clear, and the reason is already on the page rather than in this draft",
    ],
    id: "uncovered-outcome",
    key: { kind: "env", variable: "SLOPWEAVER_ALLOW_UNCOVERED_OUTCOME" },
    lane: "ambient",
    reader: "src/cli/commands/supervisor/tickRecordRun.ts",
    standing: "proposed",
  },
  {
    caught:
      "this tick READ the machine holding and neither found an anomalous-load investigation open nor said " +
      "why it was leaving the hold alone (anomalous machine load must be structurally impossible to miss — " +
      "`machine capacity` once published a capacity-hold naming a stalled hook and nobody acted on it)",
    command: "slopweaver supervisor tick-record",
    exceptions: [
      "the hold is on a FOREIGN subject no fleet act can dispatch into — `opendirectoryd` at 65% and `mds` at 15.6% were both live in one reading",
      "the dispatch register itself is unwritable, so no row can be created to satisfy the gate in the first place",
    ],
    id: "undispatched-load",
    key: { kind: "env", variable: "SLOPWEAVER_ALLOW_UNDISPATCHED_LOAD" },
    lane: "ambient",
    reader: "src/cli/commands/supervisor/tickRecordRun.ts",
    standing: "proposed",
  },
  {
    caught:
      "this tick read NO machine hold and left a groomed, ready p0–p2 doc row with no seat on it, spawned none " +
      "of them and named none in a hold-rationale (measured: five ticks in a row spawned " +
      "nothing at load 4 to 10 against a hold of 22 while 31 such rows sat ready)",
    command: "slopweaver supervisor tick-record",
    exceptions: [
      "the fleet is at a ceiling neither gauge can see — a Claude usage refusal inside the sessions themselves",
      "the reconciliation this tick read is the only one obtainable and is known stale against the board — rows it calls ready were paused or closed after it was taken",
    ],
    id: "idle-capacity",
    key: { kind: "env", variable: "SLOPWEAVER_ALLOW_IDLE_CAPACITY" },
    lane: "ambient",
    reader: "src/cli/commands/supervisor/tickRecordRun.ts",
    standing: "proposed",
  },
  {
    caught:
      "this tick read a broken automation's `recipe-failing-*` finding with no seat on it, spawned none onto it and " +
      "named it in no hold-rationale (the fleet self-heals: it spins up its own seats to fix broken " +
      "integrations — a Notion resync's finding once sat unseatable for twelve hours until the owner saw it failing on their own sidebar)",
    command: "slopweaver supervisor tick-record",
    exceptions: [
      "the reconciliation this tick read is known stale — the finding was settled or seated after it was taken",
      "the board itself is being repaired this tick and the chair has checked every failure finding by hand",
    ],
    id: "unseated-recipe-failure",
    key: { kind: "env", variable: "SLOPWEAVER_ALLOW_UNSEATED_RECIPE_FAILURE" },
    lane: "ambient",
    reader: "src/cli/commands/supervisor/tickRecordRun.ts",
    standing: "proposed",
  },
  {
    caught:
      "the supervisor's `talk unread` cursor is behind a stretch of the owner's speech on a console-voice call that is not " +
      "still growing past a read of it, or the call files could not be read (every word of the owner's transcripts with the " +
      "conversational voice AI must reach the supervisor — measured: the voice relayed a summary and dropped three whole steers in one day)",
    command: "slopweaver supervisor tick-record",
    exceptions: [
      "a call file is known corrupt or was rewritten by a repair, `talk unread` refuses it, and it is being repaired this tick (a GONE file is no exception: `talk quarantine` accepts its loss on the record)",
      "the cursor store itself is being repaired and the chair has read the call files by hand this tick",
    ],
    id: "unread-voice-words",
    key: { kind: "env", variable: "SLOPWEAVER_ALLOW_UNREAD_VOICE_WORDS" },
    lane: "ambient",
    reader: "src/cli/commands/supervisor/tickRecordRun.ts",
    standing: "proposed",
  },
  {
    caught:
      "a steer the owner spoke over a Queue card was registered before this tick started and carries no action, or the " +
      "ledgers that judge it could not be read (a steer goes unpicked only when no fleet session has capacity — measured: seven of the owner's steers sat " +
      "for hours in one day while the chair's passes ran)",
    command: "slopweaver supervisor tick-record",
    exceptions: [
      "the relay ledger or the board is being repaired this tick and the chair has read every steer by hand",
      "a steer's card landing failed and the landing is being re-run this tick, so its action cannot be written yet",
    ],
    id: "unpicked-steers",
    key: { kind: "env", variable: "SLOPWEAVER_ALLOW_UNPICKED_STEERS" },
    lane: "ambient",
    reader: "src/cli/commands/supervisor/tickRecordSteers.ts",
    standing: "proposed",
  },
  {
    caught:
      "a held Slack draft with the owner's approval, recorded before this tick, is unsent with no hold saying why, the owner's " +
      "words on a card naming a held draft went unjudged, or the register or a landed card would not read (an approved send must not sit unsent the next day)",
    command: "slopweaver supervisor tick-record",
    exceptions: [
      "the release is refused on a live check (the thread moved, a voice gate) and the chair is re-cutting it this tick",
      "a landed card's record will not read on this build and the seat is being rebuilt this tick",
    ],
    id: "approved-draft-held",
    key: { kind: "env", variable: "SLOPWEAVER_ALLOW_APPROVED_DRAFT_HELD" },
    lane: "ambient",
    reader: "src/cli/commands/supervisor/tickRecordApprovedDrafts.ts",
    standing: "proposed",
  },
  {
    caught:
      "this tick read a stopped recipe set with no seat on its repair row, spawned none and held neither the row nor " +
      "every recipe in it, or could not read the set whole (measured: about ten stopped-recipe " +
      "floating notes in a day — the notes stay, and the repair should never have had to come to the owner)",
    command: "slopweaver supervisor tick close",
    exceptions: [
      "the recipe-stopped reading is known stale — every recipe in it ran or was taken after the capture",
      "the slot ledger itself is being repaired this tick and the chair has checked every stopped recipe by hand",
    ],
    id: "unseated-stopped-recipes",
    key: { kind: "env", variable: "SLOPWEAVER_ALLOW_UNSEATED_STOPPED_RECIPES" },
    lane: "ambient",
    reader: "src/cli/commands/supervisor/tickCloseStoppedRecipes.ts",
    standing: "proposed",
  },
  {
    caught:
      "the chair's words say there is no work — nothing to seat, an empty queue, no runnable row — while the " +
      "reconciliation it read holds open rows, or could not be read to back the claim (measured: " +
      "an empty-queue claim over 116 open rows, 84 held only for naming no repo)",
    command: "slopweaver supervisor tick close",
    exceptions: [
      "the reconcile reading is known stale — the chair re-read the board after the capture and it is empty",
      "the sentence quotes the owner's own words back to them verbatim, and the rest of the tick says what the board holds",
    ],
    id: "no-work-claim",
    key: { kind: "env", variable: "SLOPWEAVER_ALLOW_NO_WORK_CLAIM" },
    lane: "ambient",
    reader: "src/cli/commands/supervisor/tickCloseNoWorkClaim.ts",
    standing: "proposed",
  },
  {
    caught:
      "a deliverable the owner explicitly steered is at risk — a named risk, a question to them, a clock-park, a seat given " +
      "up or dead, or their time passed — and its floating note is not up, or the risk could not be read (a steered " +
      "deliverable at risk gets a floating note and a voice cut-in the minute it is known)",
    command: "slopweaver supervisor tick close",
    exceptions: [
      "the hand register itself is being repaired this tick and the card cannot be appended until it is",
      "the owner is on a live call with the chair this tick and has already been told the risk in their own words",
    ],
    id: "unescalated-steer-risk",
    key: { kind: "env", variable: "SLOPWEAVER_ALLOW_UNESCALATED_STEER_RISK" },
    lane: "ambient",
    reader: "src/cli/commands/supervisor/steerRiskRead.ts",
    standing: "proposed",
  },
  {
    caught:
      "the fleet health verdict is tripped — automations failing above a share, resyncs dying mid-run, or the " +
      "bot off Slack — and its floating note is not open in the hand register, or the verdict could not be read " +
      "(measured: all three stood in one day and none reached the owner)",
    command: "slopweaver supervisor tick close",
    exceptions: [
      "the hand register itself is being repaired this tick and the card cannot be appended until it is",
      "the slot ledger is being migrated and the chair has told the owner by hand what is failing",
    ],
    id: "unescalated-fleet-health",
    key: { kind: "env", variable: "SLOPWEAVER_ALLOW_UNESCALATED_FLEET_HEALTH" },
    lane: "ambient",
    reader: "src/cli/commands/supervisor/fleetHealthRead.ts",
    standing: "proposed",
  },
] as const satisfies readonly EscapeHatch[];
