/**
 * The shell half of `tick close`'s fleet health gate (`../../../supervisor/fleetHealthGate.ts`): one rehearsal pass
 * of `fleet-unhealthy` over the live hand register, the gate's hatch, and the refusal it prints.
 *
 * A rehearsal and never `--fire`: the close DECIDES before it writes anything (`./tickClosePrepare.ts`), so the gate
 * reads whether the card is open and its note up, and leaves posting or raising it to the command its refusal names.
 */
import { claudePlanProbesPort } from "../../../claude/planProbes.js";
import { codexFleetCapPort } from "../../../codex/fleetCapPort.js";
import { codexSignInPort } from "../../../codex/signInPort.js";
import { CONSOLE_URL_ENV, consoleBaseFrom } from "../../../hand/consoleLink.js";
import type { NoteStanding } from "../../../hand/note/raise.js";
import { type HandRegisterRead, readOpenHandSteps } from "../../../hand/store.js";
import { hatchFor } from "../../../hatch/lookup.js";
import { hatchOpen } from "../../../hatch/open.js";
import { hatchRefusalLines } from "../../../hatch/render.js";
import { parseIsoMs } from "../../../lib/date.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { productionFseventsdSeams } from "../../../monitor/fseventsdBloatedSource.js";
import { monitorNoteStanding } from "../../../monitor/kindAnswerGate.js";
import { openIdsForMonitor } from "../../../monitor/openCards.js";
import { runMonitorPass } from "../../../monitor/pass.js";
import { monitorDefinition } from "../../../monitor/registry.js";
import type { MonitorId } from "../../../monitor/types.js";
import { orgHealthPort } from "../../../orgHealth/port.js";
import { pagePublishedInStore } from "../../../pages/published.js";
import { planRegisterPort } from "../../../plans/port.js";
import {
  type EscalationRead,
  type EscalationVerdict,
  FLEET_HEALTH_MONITOR,
} from "../../../supervisor/fleetHealthGate.js";
import { claudeProjectsDir } from "../../../transcripts/source.js";

/** The command that posts the card, which every refusal names. */
const FLEET_HEALTH_FIRE_COMMAND = `slopweaver monitor check --only ${FLEET_HEALTH_MONITOR} --fire`;

/**
 * Whether the `unescalated-fleet-health` hatch is open for this invocation.
 *
 * @returns true when the ambient variable is set
 */
export function fleetHealthHatchOpen(): boolean {
  return hatchOpen({
    env: process.env,
    id: "unescalated-fleet-health",
    nowIso: new Date().toISOString(),
  });
}

/**
 * Run one rehearsal pass of the fleet health monitor over the live register.
 *
 * @param home the state home the ledgers and the register live under
 * @param nowIso the tick's own instant, which the verdict is judged at
 * @param noteClock the wall clock each open card's note is judged at
 * @returns the pass, or why it could not run
 */
export async function readFleetHealthLive({
  home,
  nowIso,
  noteClock,
}: {
  home: string;
  nowIso: string;
  noteClock: () => string;
}): Promise<EscalationRead> {
  return readEscalationLive({ home, monitorId: FLEET_HEALTH_MONITOR, noteClock, nowIso });
}

/**
 * Run one rehearsal pass of one escalating monitor over the live register, with its open cards' notes.
 *
 * @param home the state home the ledgers and the register live under
 * @param monitorId the escalating monitor to rehearse
 * @param nowIso the tick's own instant, which the verdict is judged at
 * @param noteClock the wall clock each open card's note is judged at, read once its files have been: a live panel
 *   beats about once a second, so judged at the tick's instant — taken before the close's slower reads — its newest
 *   beat is in the future, which the liveness check rightly refuses, and every note on the owner's screen reads as gone
 * @returns the pass, or why it could not run
 */
export async function readEscalationLive({
  home,
  monitorId,
  nowIso,
  noteClock,
}: {
  home: string;
  monitorId: MonitorId;
  nowIso: string;
  noteClock: () => string;
}): Promise<EscalationRead> {
  const nowMs = parseIsoMs({ tsIso: nowIso });
  if (nowMs === undefined) {
    return { kind: "unreadable", why: `the tick's instant ${nowIso} is not an ISO-8601 instant` };
  }
  const register = readWholeRegister({ home });
  if (register.kind === "unreadable") {
    return register;
  }
  const open = register.steps;
  const openIds = open.map((step) => step.id);
  const cards = openIdsForMonitor({ openIds, prefix: monitorDefinition({ monitorId }).prefix });
  const notes = readNoteStandings({ clock: noteClock, home, stepIds: cards });
  if (notes.isErr()) {
    return { kind: "unreadable", why: noteUnreadable(notes.error) };
  }
  const outcome = await runMonitorPass({
    consoleBase: consoleBaseFrom({ configured: process.env[CONSOLE_URL_ENV] }),
    fire: false,
    inputs: {
      claudeProbesPort: claudePlanProbesPort(),
      claudeProjectsDir: claudeProjectsDir(),
      fleetCapPort: codexFleetCapPort(),
      home,
      landingPath: undefined,
      nowIso,
      nowMs,
      only: monitorId,
      orgHealthPort: orgHealthPort(),
      pagePublished: pagePublishedInStore,
      processes: productionFseventsdSeams({ home }),
      registerPort: planRegisterPort(),
      signInPort: codexSignInPort(),
    },
    nowIso,
    openIds,
    openWithDecision: new Set(open.filter((step) => step.decision !== undefined).map((step) => step.id)),
    postedBy: "supervisor tick close",
    postedIds: register.postedIds,
    // A rehearsal never posts, so it never raises a note.
    openPage: () => Promise.resolve(err("a rehearsal opens no page")),
    raiseNote: () => err("a rehearsal raises no note"),
  });
  return { kind: "read", notes: notes.value, outcome };
}

/**
 * Read the open hand register WHOLE: a line that would not read may be this monitor's own card, so one unparsed
 * line refuses the read rather than judging the rest clean.
 *
 * @returns every open step and every posted id, or the escalation read's own unreadable verdict
 */
function readWholeRegister({
  home,
}: {
  home: string;
}):
  | ({ readonly kind: "steps" } & Pick<HandRegisterRead, "postedIds" | "steps">)
  | Extract<EscalationRead, { kind: "unreadable" }> {
  const register = readOpenHandSteps({ home });
  if (register.isErr()) {
    return { kind: "unreadable", why: `the hand register would not read: ${register.error.message}` };
  }
  const { postedIds, steps, unparsed } = register.value;
  if (unparsed.length > 0) {
    const lines = unparsed.map((problem) => problem.message).join("; ");
    return { kind: "unreadable", why: `${String(unparsed.length)} hand-register line(s) would not read: ${lines}` };
  }
  return { kind: "steps", postedIds, steps };
}

/**
 * Read where each card's note stands, stopping at the first that will not read.
 *
 * @param clock the wall clock each note is judged at
 * @returns each card's standing, or the note that would not read and why
 */
function readNoteStandings({
  clock,
  home,
  stepIds,
}: {
  clock: () => string;
  home: string;
  stepIds: Iterable<string>;
}): Result<{ stepId: string; standing: NoteStanding }[], { stepId: string; message: string }> {
  const notes: { stepId: string; standing: NoteStanding }[] = [];
  for (const stepId of stepIds) {
    // A muted kind's note, or one the owner holds until worse, reads dismissed: they took it down, so tick close must not
    // refuse forever over its absence.
    const standing = monitorNoteStanding({ clock, home, id: stepId });
    if (standing.isErr()) {
      return err({ message: standing.error.message, stepId });
    }
    notes.push({ standing: standing.value, stepId });
  }
  return ok(notes);
}

/** The unreadable verdict's line for a note that would not read. */
function noteUnreadable({ stepId, message }: { stepId: string; message: string }): string {
  return `the note of ${stepId} would not read: ${message}`;
}

/**
 * Render the fleet health gate's refusal: what the verdict says is failing, and the one command that posts it.
 *
 * @param verdict the refused or unreadable verdict
 * @returns the hatch's four lines, then one line per unposted card, then the way out
 */
export function fleetHealthRefusalLines({
  verdict,
}: {
  verdict: Exclude<EscalationVerdict, { kind: "clean" }>;
}): readonly string[] {
  const hatch = hatchFor({ id: "unescalated-fleet-health" });
  if (verdict.kind === "unreadable") {
    return [
      ...hatchRefusalLines({ detail: `the fleet health verdict could not be read — ${verdict.why}`, hatch }),
      `Fix what that names and re-run this; \`${FLEET_HEALTH_FIRE_COMMAND}\` prints the same reading. It refuses ` +
        "rather than passing, because a check that reports clean on an input it never saw is worse than no check.",
    ];
  }
  return [
    ...hatchRefusalLines({
      detail: `this tick read a TRIPPED fleet health verdict and its floating note is not up — ${verdict.label}`,
      hatch,
    }),
    ...verdict.unposted.map((line) => `  ${line}`),
    `Run the command a line names — \`${FLEET_HEALTH_FIRE_COMMAND} --by-session <this workspace>\` posts a card ` +
      "not yet posted — and re-run this. A refusal either prints is the defect to fix, never a reason to open the hatch.",
  ];
}
