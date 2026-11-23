/**
 * The escape-hatch REGISTER — every way through every policy refusal in this install, declared once.
 *
 * ## What a row is for
 *
 * One escape hatch class per kind of refusal, with the command and the list of exceptions as required fields,
 * gives agents enough information to make the right call. A row
 * is that: the command, why it is caught, when an exception is legitimate, and the exact incantation. A gate
 * imports its row and calls {@link ../hatch/render.hatchRefusal}; it never writes a refusal string.
 *
 * ## Two claims here are CHECKED, and the rest is prose
 *
 * `src/devLint/escapeHatch.ts` fails when an override variable — a `SLOPWEAVER_ALLOW_*` literal, or any quoted name or key
 * with an `ALLOW` or `OVERRIDE` component (`src/devLint/overrideVariable.ts`) — appears in a scanned tree without a row here, and when a row's {@link EscapeHatch.reader} does not actually name
 * its own variable. So the SET and the WIRING cannot drift; `caught` and `exceptions` are prose an owner
 * ruling narrows.
 *
 * Naming a variable is not the same as being RELEASED by it, and the gap was real: `spent-plan` named its
 * reader correctly for a day while the variable released nothing, because `cmux/spawn.ts` read it in a
 * parameter default any caller's explicit argument skipped. `src/devLint/hatchRelease.ts` is the second
 * checked claim — no hatch read may be written as a parameter default.
 *
 * ## Every row is `ruled`, and by whom
 *
 * The owner reviewed a page listing every escape hatch and ruled that every exception stands, both hatchless
 * gates get one, and a hatch is journalled and expiring on outbound only. So every exception list in
 * the category files is the owner's word rather than a session's proposal, and {@link HatchStanding} records which.
 * A NEW row starts `proposed` and stays that way until the owner has seen it — the axis is not decorative.
 *
 * The journalling half of that ruling is a separate change: the outbound rows keep an ambient variable
 * until the grant lane exists, and this comment is the record that they are owed one.
 *
 * ## Two names that read like hatches and open nothing
 *
 * `SLOPWEAVER_ALLOW_REMOTE_AHEAD` appears twice in `src/` and is a doc comment explaining that no such
 * override exists; `SLOPWEAVER_ALLOW_RAWER` exists only inside a docs-coverage test asserting it is a
 * DIFFERENT variable from `SLOPWEAVER_ALLOW_RAW`. Neither is a row, deliberately. Reproduce:
 * `grep -rn 'SLOPWEAVER_ALLOW_REMOTE_AHEAD\|SLOPWEAVER_ALLOW_RAWER' src --include='*.ts'`.
 *
 * ## One ARRAY, composed from one category file per surface
 *
 * `src/devLint/escapeHatch.ts` imports {@link ESCAPE_HATCHES} and asks whether a suffix or token has a row
 * in it. It never reads any file's TEXT for a declaration, so a row's FILE is not what makes it findable:
 * every row lives in a `./*Hatches.ts` category file named for the surface it guards, and this file holds
 * no rows at all — it spreads each category in, in register order, and
 * `src/__tests__/unit/hatch/registryCategories.test.ts` pins every seam of that order.
 *
 * A new row goes in the category file for the surface it guards, at the position it reads best. A refusal
 * on a surface no category covers gets a new category file, spread in here beside its nearest neighbour,
 * with its own case in that test. A category file nearing the
 * 300-code-line cap splits again along its own surfaces.
 */
import { ANSWER_DOOR_HATCHES } from "./answerDoorHatches.js";
import { ATLAS_READ_HATCHES } from "./atlasReadHatches.js";
import { BRIEFING_RENDER_HATCHES } from "./briefingRenderHatches.js";
import { BROWSER_HATCHES } from "./browserHatches.js";
import { BUILT_CLI_HATCHES } from "./builtCliHatches.js";
import { CLAUDE_SESSION_HATCHES } from "./claudeSessionHatches.js";
import { CLAUDE_WATCH_HATCHES } from "./claudeWatchHatches.js";
import { CODEX_PASS_HATCHES } from "./codexPassHatches.js";
import { COMMAND_SCOPE_HATCHES } from "./commandScopeHatches.js";
import { CONTENT_INTEGRITY_HATCHES } from "./contentIntegrityHatches.js";
import { DATADOG_MONITOR_HATCHES } from "./datadogMonitorHatches.js";
import { DATA_PUBLICATION_HATCHES } from "./dataPublicationHatches.js";
import { DELIVERY_WORKFLOW_HATCHES } from "./deliveryWorkflowHatches.js";
import { GCP_HATCHES } from "./gcpHatches.js";
import { GITHUB_MERGE_HATCHES } from "./githubMergeHatches.js";
import { HANDOVER_ENDING_HATCHES } from "./handoverEndingHatches.js";
import { HANDOVER_OWNER_ACTION_HATCHES } from "./handoverOwnerActionHatches.js";
import { HANDOVER_REGISTER_HATCHES } from "./handoverRegisterHatches.js";
import { INTAKE_MARK_HATCHES } from "./intakeMarkHatches.js";
import { LISTEN_CONNECTION_HATCHES } from "./listenConnectionHatches.js";
import { LOCAL_TOOL_HATCHES } from "./localToolHatches.js";
import { OUTBOUND_DELIVERY_HATCHES } from "./outboundDeliveryHatches.js";
import { OUTBOUND_MESSAGE_HATCHES } from "./outboundMessageHatches.js";
import { PROOF_CAPTURE_HATCHES } from "./proofCaptureHatches.js";
import { PROOF_PATH_HATCHES } from "./proofPathHatches.js";
import { REPOSITORY_CONTEXT_HATCHES } from "./repositoryContextHatches.js";
import { RESPONDER_HATCHES } from "./responderHatches.js";
import { RUN_INTEGRITY_HATCHES } from "./runIntegrityHatches.js";
import { SLACK_POST_HATCHES } from "./slackPostHatches.js";
import { STATE_LIFECYCLE_HATCHES } from "./stateLifecycleHatches.js";
import { STATE_SNAPSHOT_HATCHES } from "./stateSnapshotHatches.js";
import { SUPERVISOR_SEAT_HATCHES } from "./supervisorSeatHatches.js";
import { SUPERVISOR_TICK_HATCHES } from "./supervisorTickHatches.js";
import { TALK_HATCHES } from "./talkHatches.js";
import { TOOL_ADMISSION_HATCHES } from "./toolAdmissionHatches.js";
import type { EscapeHatch } from "./types.js";
import { WORKFLOW_SEQUENCE_HATCHES } from "./workflowSequenceHatches.js";

/**
 * Every escape hatch this install ships, grouped in reading order: the door's own `warn` tokens, then the
 * ambient variables by the surface they guard — the outbound surfaces first, then the repository ones, then
 * the session and corpus ones. Each spread is one category file; the order of the spreads IS the register's
 * order, and a sibling test pins every seam.
 *
 * A refusal with no row here is the defect the register exists to make impossible. Add the row.
 */
export const ESCAPE_HATCHES = [
  ...HANDOVER_REGISTER_HATCHES,
  ...ANSWER_DOOR_HATCHES,
  ...RESPONDER_HATCHES,
  ...SLACK_POST_HATCHES,
  ...DELIVERY_WORKFLOW_HATCHES,
  ...STATE_SNAPSHOT_HATCHES,
  ...GITHUB_MERGE_HATCHES,
  ...OUTBOUND_MESSAGE_HATCHES,
  ...OUTBOUND_DELIVERY_HATCHES,
  ...BRIEFING_RENDER_HATCHES,
  ...LOCAL_TOOL_HATCHES,
  ...CONTENT_INTEGRITY_HATCHES,
  ...BROWSER_HATCHES,
  ...TOOL_ADMISSION_HATCHES,
  ...PROOF_PATH_HATCHES,
  ...PROOF_CAPTURE_HATCHES,
  ...REPOSITORY_CONTEXT_HATCHES,
  ...SUPERVISOR_TICK_HATCHES,
  ...TALK_HATCHES,
  ...INTAKE_MARK_HATCHES,
  ...SUPERVISOR_SEAT_HATCHES,
  ...HANDOVER_ENDING_HATCHES,
  ...HANDOVER_OWNER_ACTION_HATCHES,
  ...RUN_INTEGRITY_HATCHES,
  ...LISTEN_CONNECTION_HATCHES,
  ...CODEX_PASS_HATCHES,
  ...ATLAS_READ_HATCHES,
  ...BUILT_CLI_HATCHES,
  ...CLAUDE_SESSION_HATCHES,
  ...DATA_PUBLICATION_HATCHES,
  ...CLAUDE_WATCH_HATCHES,
  ...STATE_LIFECYCLE_HATCHES,
  ...COMMAND_SCOPE_HATCHES,
  ...WORKFLOW_SEQUENCE_HATCHES,
  ...DATADOG_MONITOR_HATCHES,
  ...GCP_HATCHES,
] as const satisfies readonly EscapeHatch[];
