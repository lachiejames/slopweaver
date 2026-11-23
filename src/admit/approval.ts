/**
 * What makes `requiresApproval` a fact instead of a label.
 *
 * ## The defect this closes
 *
 * `DoorMeta.requiresApproval` was a boolean nothing read. A verb set it, the ledger recorded it, `catalog`
 * printed `[approval]` beside the verb — and the request went through `DEFAULT_GATES`, which is empty, so
 * nothing asked anyone anything. `slopweaver write vanta deactivate` carried that label while stopping
 * monitoring on a compliance finding, and a reader of the catalog would have been right to believe it.
 *
 * The fix is not a static check that some file mentions a gate. It is a rule inside {@link
 * ../admit/door.admitDoor}: a request whose `meta.requiresApproval` is true and whose gate list contains no
 * APPROVAL GATE is `hold`, so the effect never runs. The claim cannot be printed unbacked because the door
 * refuses the request that makes it — no allowlist, no exemption marker, and nothing to remember at a call
 * site beyond telling the truth in `meta`.
 *
 * ## Why the brand is a symbol on the function
 *
 * A gate is `(request) => findings`, and "did an approval gate run?" cannot be read off its OUTPUT: a gate
 * that returns nothing has either approved the request or is a gate about something else entirely. So the
 * property is carried on the gate itself, by {@link approvalGate}, and a gate that was not built through
 * that wrapper never counts. `Symbol.for` rather than a bare string key so the mark cannot collide with a
 * field some gate closure happens to carry.
 *
 * ## What an approval gate is, and what none of them proves
 *
 * An approval gate HOLDS unless the caller shows evidence the owner approved this exact act — today, a
 * digest over the content, compared at the moment of sending ({@link ../outbound/gmail/approvalGate},
 * {@link ../atlas/vanta/deactivateApproval}). A `hold` carries no override token, so
 * `$SLOPWEAVER_DOOR_OVERRIDE` cannot waive it; an approval an environment variable can supply is the
 * decorative label again.
 *
 * **It does not authenticate a human.** The same process that prints a digest can compute one. What it buys
 * is that the act takes a SECOND deliberate step with the preview already on screen, against content that
 * cannot have changed underneath it, and that the unapproved attempt is recorded in the ledger rather than
 * silently skipped. That is a real, bounded property, and the bound is written down here because a gate
 * believed to do more than it does is worse than one whose limit is stated.
 *
 * Pure: types and two predicates, no I/O.
 */
import type { DoorFinding, DoorGate, DoorRequest } from "./types.js";

/**
 * The mark {@link approvalGate} puts on a gate. `Symbol.for` so two copies of this module in one process
 * agree, and so no ordinary property name can impersonate it.
 */
const APPROVAL_GATE_MARK = Symbol.for("slopweaver.admit.approvalGate");

/** A gate that satisfies a request's `requiresApproval` claim — built only by {@link approvalGate}. */
export type ApprovalGate = DoorGate & { readonly [APPROVAL_GATE_MARK]: true };

/** The finding code the door fires when a request claims approval no gate in its list can supply. */
export const APPROVAL_UNBACKED_CODE = "door.approval-unbacked";

/**
 * Mark a gate as the thing that decides a request's approval.
 *
 * @param gate the decision itself — it must `hold` when the caller showed no approval evidence
 * @returns the same function, marked, so {@link isApprovalGate} recognises it
 */
export function approvalGate({ gate }: { gate: DoorGate }): ApprovalGate {
  return Object.assign(gate, { [APPROVAL_GATE_MARK]: true } as const);
}

/**
 * Whether this gate was built by {@link approvalGate}.
 *
 * Positional because a type predicate cannot destructure (TS1230).
 *
 * @returns true when the gate carries the approval mark
 */
export function isApprovalGate(gate: DoorGate): gate is ApprovalGate {
  return APPROVAL_GATE_MARK in gate && gate[APPROVAL_GATE_MARK] === true;
}

/**
 * The `hold` a request earns by advertising an approval nothing in its gate list can give it.
 *
 * A `hold` rather than a `warn` on purpose: a warn must carry an override token by the door's own type, and
 * an unbacked safety claim that an environment variable clears is the defect, not a milder form of it.
 *
 * @param request the request that made the claim, named in the finding so a reader knows which verb lied
 * @returns the finding
 */
export function approvalUnbackedFinding({ request }: { request: DoorRequest }): DoorFinding {
  const action = request.action.kind === "verb" ? `${request.action.noun} ${request.action.verb}` : request.action.tool;
  return {
    code: APPROVAL_UNBACKED_CODE,
    correction:
      "either pass a gate built with approvalGate() that HOLDS unless the caller showed the owner's " +
      "approval evidence, or set meta.requiresApproval to false so nothing advertises a check that does " +
      "not run. There is no override — this hold is not waivable by $SLOPWEAVER_DOOR_OVERRIDE",
    severity: "hold",
    summary:
      `${action} declares requiresApproval, and no gate in its list can decide an approval — the claim is ` +
      "backed by nothing, so the door refuses it rather than letting the label pass for a check",
  };
}
