/**
 * The effectful shells for the `calendar` write verbs — `book`, `edit`, `reschedule`, `cancel`, `respond`
 * and `commit`. The seams are injected, so the shells — parse, preview, the door decision, the exit code —
 * are unit tested with plain fakes, a temporary home, and the REAL door.
 *
 * ## One door call per attempt, held or not
 *
 * A prepare verb whose write reaches anyone but the owner goes through the door WITHOUT an approval, so it
 * is refused and the refusal is journalled — a fact worth having about a surface that reaches other people,
 * and exactly what `gmail send` without `--approve` does. `commit <intent-id> --anchor <where the owner said yes>` is
 * the second step (`./commitAnchor.ts`), `--approve <digest>` the other spelling of it. A write that reaches
 * nobody but the owner is admitted on the first call and applied at once.
 *
 * The preview is printed BEFORE the door decides, on every path.
 */
import { DEFAULT_GATES } from "../../../admit/door.js";
import { type NotPerformed, notPerformedLines } from "../../../admit/doorRefusal.js";
import { throughDoor } from "../../../admit/effects.js";
import { APPROVED_AT_FIELD, APPROVED_BY_FIELD } from "../../../admit/ledger.js";
import type { DoorGate, DoorRequest } from "../../../admit/types.js";
import { renderCalendarWriteOutcomeText, renderCalendarWritePlanText } from "../../../live/calendar/renderWrite.js";
import type { CalendarWritePlan } from "../../../live/calendar/writePlan.js";
import { type CalendarWriteApproval, calendarWriteApprovalGate } from "../../../outbound/calendar/approvalGate.js";
import { parseCalendarWriteForm } from "../../../outbound/calendar/form.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { type AnchoredYes, anchoredYes, previewedDigest } from "./commitAnchor.js";
import { calendarErrorLines } from "./errors.js";
import {
  type CalendarWriteVerb,
  parseCalendarCommitArgs,
  parseCalendarWriteArgs,
  STDIN_SENTINEL,
} from "./writeCore.js";
import { type CalendarWriteDeps, productionCalendarWriteDeps } from "./writeDeps.js";

const VERB_ARG_OFFSET = 4;

/**
 * Whether this attempt has to carry a matching digest.
 *
 * TWO independent reasons, and the second is the one an outward-only test misses. A plan that reaches
 * anyone but the owner always holds. And a COMMIT always holds, whatever the rebuilt plan now says, because
 * a commit exists only to redeem an approval and the digest is what binds that approval to one exact
 * change. Without the second, an intent prepared while a guest was on the event could be committed with any
 * digest at all once the guest had since been removed elsewhere — the rebuilt plan reads inward, so nothing
 * compared what was approved against what is about to be sent, and a cancellation of a DIFFERENT version of
 * the event went through on a stale approval. A first-call inward prepare still applies at once.
 *
 * @param plan the plan as rebuilt against the event Google holds now
 * @param phase whether this is a first-call prepare or a commit redeeming an approval
 * @returns true iff the approval gate governs this attempt
 */
function holdsForApproval({ plan, phase }: { plan: CalendarWritePlan; phase: WritePhase }): boolean {
  return phase === "commit" || plan.outward.outward;
}

/** Which call this is: the verb that previews and may apply, or the commit that redeems an approval. */
type WritePhase = "prepare" | "commit";

/**
 * The door request for one write attempt — counts and ids, never content. An anchored commit carries WHERE and WHEN
 * the owner's yes was said, which the door ledger records beside its verdict; never the owner's words.
 */
function writeDoorRequest({
  plan,
  home,
  phase,
  yes,
}: {
  plan: CalendarWritePlan;
  home: string;
  phase: WritePhase;
  yes: AnchoredYes | undefined;
}): DoorRequest {
  return {
    action: { kind: "verb", noun: "calendar", verb: plan.intent.form.kind },
    artifact: {
      ...(yes === undefined ? {} : { [APPROVED_AT_FIELD]: yes.atIso, [APPROVED_BY_FIELD]: yes.anchor }),
      attendeesAfter: plan.attendeesAfter.length,
      attendeesBefore: plan.attendeesBefore.length,
      digest: plan.digest,
      eventId: plan.intent.eventId,
      intentId: plan.intent.intentId,
      mutation: plan.mutation.kind,
      sendUpdates: plan.sendUpdates,
    },
    meta: {
      createsWorkItem: false,
      effect: "external-write",
      home,
      requiresApproval: holdsForApproval({ phase, plan }),
    },
  };
}

/** Write each line to the diagnostic stream, in order. */
function writeDiagnostics({ deps, lines }: { deps: CalendarWriteDeps; lines: readonly string[] }): void {
  for (const line of lines) {
    deps.writeDiagnostic(line);
  }
}

/** The home the door journals into: the one `--home` named, else the seam's own state home. */
function doorHome({ deps, home }: { deps: CalendarWriteDeps; home: string | undefined }): string {
  if (home === undefined) {
    return deps.home();
  }
  return home;
}

/** Print every refusal line and exit non-zero. */
function reportRefusal({
  deps,
  command,
  through,
}: {
  deps: CalendarWriteDeps;
  command: string;
  through: NotPerformed;
}): number {
  writeDiagnostics({ deps, lines: notPerformedLines({ command, through }) });
  return EXIT_ERROR;
}

/**
 * Route a plan through the door and apply it when admitted, printing the preview first on every path.
 *
 * @param plan the planned write
 * @param approval what the commit carried as the owner's approval, absent on a prepare verb
 * @param yes where and when the owner's anchored yes was said, journalled at the door; absent unless `--anchor`
 * @param phase whether this is a first-call prepare or a commit redeeming an approval
 * @returns the process exit code
 */
async function performThroughDoor({
  deps,
  plan,
  approval,
  yes,
  home,
  json,
  command,
  phase,
}: {
  deps: CalendarWriteDeps;
  plan: CalendarWritePlan;
  approval: CalendarWriteApproval | undefined;
  yes: AnchoredYes | undefined;
  home: string | undefined;
  json: boolean;
  command: string;
  phase: WritePhase;
}): Promise<number> {
  const resolvedHome = doorHome({ deps, home });
  const gates: readonly DoorGate[] = holdsForApproval({ phase, plan })
    ? [calendarWriteApprovalGate({ approval, expected: plan.digest, intentId: plan.intent.intentId })]
    : DEFAULT_GATES;
  const routed = await throughDoor({
    gates,
    home: resolvedHome,
    ledger: deps.doorLedger,
    perform: () => deps.apply({ home, plan }),
    request: writeDoorRequest({ home: resolvedHome, phase, plan, yes }),
  });
  if (!routed.performed) {
    if (json) {
      // A recording refusal is not a policy verdict: the door's decision may even read `pass`, so the store's
      // own message rides beside it rather than the refusal being relabelled as a hold.
      const recording = routed.kind === "recording-refused" ? { error: routed.error.message } : {};
      deps.writeOut(JSON.stringify({ applied: false, decision: routed.decision, ...recording, plan }, undefined, 2));
    }
    return reportRefusal({ command, deps, through: routed });
  }
  if (routed.result.isErr()) {
    deps.writeDiagnostic(routed.result.error.message);
    return EXIT_ERROR;
  }
  if (json) {
    deps.writeOut(JSON.stringify({ applied: true, approvedBy: yes, outcome: routed.result.value, plan }, undefined, 2));
    return EXIT_OK;
  }
  deps.writeOut(renderCalendarWriteOutcomeText({ outcome: routed.result.value }));
  if (yes !== undefined) {
    deps.writeOut(
      `approved on the owner's word: ${yes.anchor} (${yes.atIso}), recorded on intent ${plan.intent.intentId}`,
    );
  }
  return EXIT_OK;
}

/**
 * Run one prepare verb against injected edges.
 *
 * @param verb which write verb
 * @param rest argv after the verb
 * @param deps the seams
 * @returns the process exit code
 */
export async function runCalendarWrite({
  verb,
  rest,
  deps,
}: {
  verb: CalendarWriteVerb;
  rest: readonly string[];
  deps: CalendarWriteDeps;
}): Promise<number> {
  const parsed = parseCalendarWriteArgs({ rest, verb });
  if (parsed.isErr()) {
    writeDiagnostics({ deps, lines: calendarErrorLines({ error: parsed.error }) });
    return EXIT_USAGE;
  }
  const { home, eventId, formSource, json } = parsed.value;
  const formJson = formSource === STDIN_SENTINEL ? await deps.readStdin() : formSource;
  const form = parseCalendarWriteForm({ json: formJson, verb });
  if (form.isErr()) {
    writeDiagnostics({ deps, lines: form.error });
    return EXIT_USAGE;
  }
  const planned = await deps.prepare({ eventId, form: form.value, home, intentId: deps.newIntentId() });
  if (planned.isErr()) {
    deps.writeDiagnostic(planned.error.message);
    return EXIT_ERROR;
  }
  printPreview({ deps, json, plan: planned.value });
  return performThroughDoor({
    approval: undefined,
    command: `slopweaver calendar ${verb}`,
    deps,
    home,
    json,
    phase: "prepare",
    plan: planned.value,
    yes: undefined,
  });
}

/** The preview a person reads before deciding — printed before the door decides, on every path. */
function printPreview({ deps, json, plan }: { deps: CalendarWriteDeps; json: boolean; plan: CalendarWritePlan }): void {
  if (!json) {
    deps.writeOut(renderCalendarWritePlanText({ plan }));
  }
}

/**
 * Run `calendar commit` against injected edges.
 *
 * @param rest argv after `calendar commit`
 * @param deps the seams
 * @returns the process exit code
 */
export async function runCalendarCommit({
  rest,
  deps,
}: {
  rest: readonly string[];
  deps: CalendarWriteDeps;
}): Promise<number> {
  const parsed = parseCalendarCommitArgs({ rest });
  if (parsed.isErr()) {
    writeDiagnostics({ deps, lines: calendarErrorLines({ error: parsed.error }) });
    return EXIT_USAGE;
  }
  const { home, intentId, approval, json } = parsed.value;
  const command = "slopweaver calendar commit";
  // The owner's words are read before Google is, so a record that cannot stand as the owner's yes refuses having read nothing else,
  // and never reaches the door as an approval the audit trail would then claim.
  let yes: AnchoredYes | undefined;
  if (approval?.kind === "anchor") {
    const read = deps.readOwnerWords({ anchor: approval.anchor, home: doorHome({ deps, home }) });
    const words = anchoredYes({ anchor: approval.anchor, read });
    if (words.isErr()) {
      deps.writeDiagnostic(words.error.message);
      return EXIT_ERROR;
    }
    yes = words.value;
  }
  const planned = await deps.prepareCommit({ home, intentId });
  if (planned.isErr()) {
    deps.writeDiagnostic(planned.error.message);
    return EXIT_ERROR;
  }
  const plan = planned.value;
  printPreview({ deps, json, plan });
  if (approval?.kind !== "anchor") {
    return performThroughDoor({ approval, command, deps, home, json, phase: "commit", plan, yes: undefined });
  }
  // An invariant: an anchored commit that reached here read the owner's whole words above.
  const heard = yes!;
  const bound = previewedDigest({ intentId, previewDigest: plan.intent.previewDigest });
  if (bound.isErr()) {
    deps.writeDiagnostic(bound.error.message);
    return EXIT_ERROR;
  }
  // The rebuilt plan's digest is checked against the one the preview printed, never against itself.
  const anchored: CalendarWriteApproval = { anchor: approval.anchor, kind: "anchor", previewDigest: bound.value };
  // The applied intent is the receipt of what was sent, so it is where the authority for sending it is kept.
  const receipt: CalendarWritePlan = { ...plan, intent: { ...plan.intent, approvedBy: heard } };
  return performThroughDoor({
    approval: anchored,
    command,
    deps,
    home,
    json,
    phase: "commit",
    plan: receipt,
    yes: heard,
  });
}

/** One command per prepare verb, sharing the production seams. */
function writeCommand({ verb }: { verb: CalendarWriteVerb }): ReturnType<typeof defineCommand> {
  return defineCommand({
    run: (argv) => runCalendarWrite({ deps: productionCalendarWriteDeps(), rest: argv.slice(VERB_ARG_OFFSET), verb }),
  });
}

/** `slopweaver calendar book`. */
export const calendarBookCommand = writeCommand({ verb: "book" });

/** `slopweaver calendar edit`. */
export const calendarEditCommand = writeCommand({ verb: "edit" });

/** `slopweaver calendar reschedule`. */
export const calendarRescheduleCommand = writeCommand({ verb: "reschedule" });

/** `slopweaver calendar cancel`. */
export const calendarCancelCommand = writeCommand({ verb: "cancel" });

/** `slopweaver calendar respond`. */
export const calendarRespondCommand = writeCommand({ verb: "respond" });

/** `slopweaver calendar commit`. */
export const calendarCommitCommand = defineCommand({
  run: (argv) => runCalendarCommit({ deps: productionCalendarWriteDeps(), rest: argv.slice(VERB_ARG_OFFSET) }),
});
