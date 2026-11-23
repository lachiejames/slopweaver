/**
 * The door's audit trail. Every decision the DOOR makes — pass, warn, hold, and any override that waived a
 * warning — is recorded in the store's `door_event` table (D15 provenance) through the REQUIRED
 * {@link DoorLedgerPort} (`./doorLedgerPort.ts`). Pure {@link doorDecisionRecord} builds the exact record;
 * `throughDoor` (`./effects.ts`) is the one writer of decisions, and it writes BEFORE it performs anything.
 * `$SLOPWEAVER_HOME/ledgers/door.jsonl` is only the source of the one-time `store import-fleet --only door`.
 *
 * ## The fourth status, and the half of "no silent refuse" it closes
 *
 * A gate that refuses BEFORE the door stops the send before `throughDoor` is ever reached, so for most of this
 * ledger's life such an attempt left NO row at all. MEASURED over an install's own 51.5 MB
 * ledger: 199,954 records, statuses pass 183,202, warn 16,720, hold 32, and nothing else. So the ledger
 * answered "what did we send" and could not answer "what did we try to send and get stopped on" — which cost
 * a code read whenever a refusal had to be measured from the code and the door ledger, because the ledger
 * could contribute nothing.
 *
 * {@link recordPreDoorRefusal} writes a `status: "refused"` row into the SAME table, so one query answers both
 * halves rather than joining two tables on a timestamp. Today exactly one gate emits one — the above-the-fold
 * voice gate (`../cli/aboveFoldDoor.ts`). Every OTHER pre-door refusal is still unrecorded: the bare-reference
 * gate (`../cli/bareRefDoor.ts`), the cited-controls gate (`../cli/citedControlsDoor.ts`), and
 * `noFoldRefusals` / `resolveAllMentions` / the unresolved-owner refusal in `../cli/commands/slack/runAdmit.ts`.
 * `slopweaver dev door --refusals` prints that bound on every run, including an empty one, because an empty
 * result must not read as "nothing stopped it".
 *
 * ## Audit without dumping the artifact
 *
 * An admitted action may carry an opaque `duplicateKey` on its artifact, which is recorded here. Only the KEY is
 * stored — a hash — never a target id and never a word of content.
 */
import { logger } from "../lib/logger.js";

import type { DoorLedgerPort } from "./doorLedgerPort.js";
import type { DoorDecision, DoorRequest } from "./types.js";

/** The artifact field an action carries its opaque re-send identity in (see the module note). */
const DUPLICATE_KEY_FIELD = "duplicateKey";

/**
 * The action, flattened to a stable, machine-safe label for the ledger. Also the key a gate matches prior
 * decisions on, so it is exported for that use.
 *
 * @param request the admitted request
 * @returns the label (`verb:<noun>.<verb>` or `raw-tool:<tool>`)
 */
export function doorActionLabel({ request }: { request: DoorRequest }): string {
  const { action } = request;
  return action.kind === "verb" ? `verb:${action.noun}.${action.verb}` : `raw-tool:${action.tool}`;
}

/** The artifact field carrying the anchor of the owner's own words an approval was given on. */
export const APPROVED_BY_FIELD = "approvedBy";

/** The artifact field carrying the instant those words were said, as the record dates them. */
export const APPROVED_AT_FIELD = "approvedAtIso";

/**
 * Where and when the owner approved this action, when the artifact carries BOTH as non-empty strings — a pointer and
 * an instant, never the owner's words. Half a pair is dropped rather than recorded, because an anchor with no instant (or the
 * reverse) would read as an authority the request did not fully state. Pure.
 */
function approvalOf({ request }: { request: DoorRequest }): { approvedBy: string; approvedAtIso: string } | undefined {
  const by = request.artifact[APPROVED_BY_FIELD];
  const at = request.artifact[APPROVED_AT_FIELD];
  if (typeof by === "string" && by.length > 0 && typeof at === "string" && at.length > 0) {
    return { approvedAtIso: at, approvedBy: by };
  }
  return undefined;
}

/** The artifact's opaque duplicate key, when it carries one (a non-empty string). Pure. */
function duplicateKeyOf({ request }: { request: DoorRequest }): string | undefined {
  const value = request.artifact[DUPLICATE_KEY_FIELD];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Build the one record for a door decision. Pure + deterministic (runId/tsIso injected). Records the status, the
 * findings, and any overridden codes — enough to audit, without dumping artifact contents.
 *
 * Each finding carries its `summary` as well as its code, which is what makes the ledger show what was NOT sent as
 * clearly as what was: a withheld reply's whole value is the reason it was held, and a row reading
 * `withhold.reply` and nothing else would record that something was stopped without recording why. A summary is
 * policy prose a gate in this repo authored — it is not the artifact, so the "audit without dumping the content"
 * property is intact.
 *
 * @param request the admitted request
 * @param decision the door's verdict
 * @param tsIso the decision timestamp
 * @returns the record, field for field what `door.jsonl` lines carried
 */
export function doorDecisionRecord({
  request,
  decision,
  runId,
  tsIso,
}: {
  request: DoorRequest;
  decision: DoorDecision;
  runId: string;
  tsIso: string;
}): Readonly<Record<string, unknown>> {
  const duplicateKey = duplicateKeyOf({ request });
  // Only a PASS performs (`throughDoor`), so only a pass records the authority it was performed on: a held row
  // carrying `approvedBy` would read as an approved action that never ran.
  const approval = decision.status === "pass" ? approvalOf({ request }) : undefined;
  return {
    // A pointer and an instant, never content: the authority an approved action was performed on.
    ...approval,
    action: doorActionLabel({ request }),
    effect: request.meta.effect,
    findings: decision.findings.map((f) => ({ code: f.code, severity: f.severity, summary: f.summary })),
    overridden: decision.overridden.map((f) => f.code),
    runId,
    schemaVersion: 1,
    status: decision.status,
    tsIso,
    // Conditionally spread: an action with no re-send identity records exactly the record it always did.
    ...(duplicateKey !== undefined ? { duplicateKey } : {}),
    // Same spelling, same reason: a request that waived nothing writes the record it always wrote. Policy
    // metadata the guard authored, not artifact content, so the audit-without-dumping property is intact.
    // `hasOwn`, not `!== undefined`: an optional property read walks the prototype chain, so a polluted
    // `Object.prototype.acknowledgements` would write a waiver onto a request that carried none. Reading the
    // request's OWN key is the same cost and cannot be reached that way. Raised by a Codex review.
    // A LIST, and its own key: one invocation waives more than one subject, and the historical singular
    // `acknowledgement` key stays readable in the imported lines — `../store/fleet/doorEvent.ts` projects both
    // into the same column.
    ...(Object.hasOwn(request, "acknowledgements") &&
    request.acknowledgements !== undefined &&
    request.acknowledgements.length > 0
      ? { acknowledgements: request.acknowledgements }
      : {}),
  };
}

/**
 * Which pre-door gate refused. A CLOSED set this module owns, with exactly one member today.
 *
 * A category nobody emits is a category nobody can verify, so a member is added only alongside the code
 * that produces it — the same doctrine `PainPointKind` states for the pain-point ledger.
 */
type PreDoorGate = "above-the-fold-voice";

/** One rule that fired, named by the gate that authored it. Never a word of the authored prose. */
export interface PreDoorRefusalFinding {
  readonly code: string;
  /** The form field the rule fired against — the field, never its text. */
  readonly path: string;
  /** Why it fired, in the gate's own words. */
  readonly message: string;
}

/**
 * A send a gate stopped BEFORE the door, so `throughDoor` was never reached.
 *
 * `gate` is a closed union because this module authors it; `surface` and `hatch` are plain strings because
 * they are quoted from a layer above this one (the voice register's surface, and the escape hatch that gate
 * named), and a caller passes its own typed value into them.
 *
 * A row carries the SURFACE rather than the verb. The gate sits below the verb — `printedAboveFoldRefusals`
 * is handed a verdict and an output sink and knows nothing else — so naming the verb would mean threading a
 * label through ten call sites that each could state it wrongly, while the surface comes from the same
 * argument that decided the check. Adding the verb later is additive.
 */
export interface PreDoorRefusal {
  readonly gate: PreDoorGate;
  /** The outbound surface, as the voice register names it. */
  readonly surface: string;
  /** The escape hatch the refusal named, so a reader knows what would have let it through. */
  readonly hatch: string;
  readonly findings: readonly PreDoorRefusalFinding[];
  readonly runId: string;
  readonly tsIso: string;
}

/**
 * Build the one record for a pre-door refusal. Pure + deterministic (runId/tsIso injected).
 *
 * `status` is `"refused"`, which is a fourth value in the RECORD and deliberately not a fourth `DoorStatus`:
 * `admitDoor` must never be able to return it and no gate must be able to express it, so the type stays
 * three-valued and only this builder emits the fourth.
 *
 * `effect` is `"external-write"` rather than a caller field. Every site that can produce one of these is an
 * outbound compose being stopped (see `../cli/aboveFoldDoor.ts`), so it is a constant of the gate rather than
 * something a caller could state wrongly.
 *
 * `action` is `gate:<gate>`: the `gate:` namespace cannot collide with the `verb:<noun>.<verb>` every other row
 * carries, and it is deliberately not a verb name — see the note on `surface` above. The one legacy line written
 * before this field existed is read by the import's projector deriving this same string from `gate`.
 *
 * @param refusal what was stopped, and by which rules
 * @returns the record
 */
export function preDoorRefusalRecord({ refusal }: { refusal: PreDoorRefusal }): Readonly<Record<string, unknown>> {
  return {
    action: `gate:${refusal.gate}`,
    effect: "external-write",
    findings: refusal.findings.map((f) => ({ code: f.code, message: f.message, path: f.path })),
    gate: refusal.gate,
    hatch: refusal.hatch,
    runId: refusal.runId,
    schemaVersion: 1,
    status: "refused",
    surface: refusal.surface,
    tsIso: refusal.tsIso,
  };
}

/**
 * Record a pre-door refusal through the door ledger port.
 *
 * ## It NEVER throws, and `throughDoor` deliberately still refuses
 *
 * This runs at the moment a send is ALREADY being refused. A store outage left to surface here would replace an
 * actionable voice refusal with an unrelated store error, and the operator would never learn which rule fired. So
 * a write failure is loud in the log and invisible to the refusal, exactly as `painPoint.ts` argues for its own
 * sink.
 *
 * `throughDoor` must NOT adopt this: it records BEFORE an effect is performed, where a lost row means an
 * unrecorded external write.
 *
 * @param refusal what was stopped, and by which rules
 * @param home the state home whose store records it
 * @param ledger the door ledger the row is written through
 * @returns whether the row was written, and the reason it was not
 */
export async function recordPreDoorRefusal({
  refusal,
  home,
  ledger,
}: {
  refusal: PreDoorRefusal;
  home: string;
  ledger: DoorLedgerPort;
}): Promise<{ readonly written: true } | { readonly written: false; readonly why: string }> {
  let why: string;
  try {
    const written = await ledger.appendPreDoorRefusal({ home, refusal });
    if (written.isOk()) {
      return { written: true };
    }
    why = written.error.message;
  } catch (cause) {
    why = cause instanceof Error ? cause.message : String(cause);
  }
  logger.error({
    msg: `could not record a pre-door refusal: ${why} — the refusal itself stands, but the door ledger is short a row`,
  });
  return { why, written: false };
}
