/**
 * The `claude-plan-unusable` declaration — the card a registered Claude plan that its last probe found unusable puts in
 * front of the owner: the address the plan signs in with, what is wrong, and the owner's one step. Its own module because the
 * wording is the whole of it, and `./registry.ts` lists it in its place in `MONITORS`.
 */
import { isSignInFault } from "../claude/planProbeRecord.js";
import { fitLine } from "../hand/push/notice.js";
import { UNBLOCKS_CAP, WHAT_CAP } from "../hand/step.js";

import type { MonitorDefinition } from "./registry.js";
import type { MonitorSubject } from "./types.js";

/** What a sign-in card says after the plan's address. */
const SIGN_IN_CLOSE = " — paste the copied command into your terminal";

/**
 * What a repair card's sentence opens with. The owner's step is asking for the repair on the card itself: a steer
 * spoken with the card open reaches the chair naming the card, and the owner speaks only there and on the Queue. So
 * the card never dictates words to type into a session, which the posting form refuses
 * (`../hand/typedInstruction.ts`), and never names the fleet as the actor (`../hand/step.ts`'s `fleetActorPhrase`).
 */
const REPAIR_OPENING = "Ask on this card for ";

/**
 * What the register card's sentence opens with: the repair to ask for. The chair is the one session still running to
 * make it — every new seat refuses to boot while the register does not read.
 */
const REGISTER_OPENING = `${REPAIR_OPENING}a plans register repair — `;

/** The register card's `unblocks`: what stands still until it reads, said no wider than the gate makes it. */
const REGISTER_UNBLOCKS =
  "Every new Claude session refuses to start until the plans register reads again, because the usage limit you set on each plan cannot be read";

/**
 * Who the card names: the address, with the alias in brackets while the cap leaves room. A row caching no address is
 * named by its store directory instead, never the alias alone, which would make the owner guess which account it is
 * (`../hand/planSignIn.ts`; the plans skill: where the register maps no account, name the store).
 *
 * @param subject the faulted plan
 * @param room how many characters the name may take
 * @returns the name
 */
function planName({ subject, room }: { subject: MonitorSubject; room: number }): string {
  // Fitted HERE, never by cutting the whole sentence: a register's address or store path is unbounded, and a sentence
  // cut inside the name loses the half that says what the step is for, which the register refuses — so one long row
  // would cost its plan its card and hold every other plan's settling. The copied command
  // still carries the whole address.
  if (subject.email === undefined) {
    return fitLine({ cap: room, text: `the Claude store ${String(subject.claudeStoreDir)}` });
  }
  const named = `${subject.email} on Claude (${subject.id})`;
  if (named.length <= room) {
    return named;
  }
  return fitLine({ cap: room, text: `${subject.email} on Claude` });
}

/**
 * The card's one sentence: the owner's sign-in when the fault is one, else the repair no seat has started yet, asked
 * for on the card.
 *
 * @param subject the faulted plan, whose `claudeFault` decides the step
 * @returns the sentence, never longer than the cap
 */
function claudeWhat({ subject }: { subject: MonitorSubject }): string {
  if (subject.claudeRegisterFault !== undefined) {
    return fitLine({ cap: WHAT_CAP, text: `${REGISTER_OPENING}${subject.label}` });
  }
  const code = subject.claudeFault;
  if (code === undefined || isSignInFault({ code })) {
    const opening = subject.email === undefined ? "Sign in to " : "Sign in as ";
    const name = planName({ room: WHAT_CAP - opening.length - SIGN_IN_CLOSE.length, subject });
    return fitLine({ cap: WHAT_CAP, text: `${opening}${name}${SIGN_IN_CLOSE}` });
  }
  const repair = code === "USAGE_SHAPE_CHANGED" ? "a usage reader fix for " : "a new setup token for ";
  const opening = `${REPAIR_OPENING}${repair}`;
  const close = ", so the plan works again";
  const name = planName({ room: WHAT_CAP - opening.length - close.length, subject });
  return fitLine({ cap: WHAT_CAP, text: `${opening}${name}${close}` });
}

/** The half of the card's `unblocks` that says what doing nothing costs, kept whole. */
const UNBLOCKS_CLOSE = ". Routing skips the plan, so its paid usage goes unspent until a probe finds it working";

/**
 * What the card says is waiting on the owner: which plan, what is wrong, and since when — the failure fitted, never the
 * close.
 *
 * @param subject the faulted plan, whose `label` says what failed
 * @returns the line, fitted to the register's cap
 */
function claudeUnblocks({ subject }: { subject: MonitorSubject }): string {
  if (subject.claudeRegisterFault !== undefined) {
    return fitLine({ cap: UNBLOCKS_CAP, text: REGISTER_UNBLOCKS });
  }
  const room = UNBLOCKS_CAP - UNBLOCKS_CLOSE.length;
  const failure = `${subject.id}: ${subject.label}`.replaceAll(/[\s\p{Cc}\p{Cf}]+/gu, " ").trim();
  return `${fitLine({ cap: room, text: failure }).replace(/[\s;:,.]+$/, "")}${UNBLOCKS_CLOSE}`;
}

/**
 * `claude-plan-unusable`: one floating work card per unpaused Claude plan its last probe found unusable, and one for
 * the plans register when it does not read.
 */
export const CLAUDE_PLAN_UNUSABLE: MonitorDefinition = {
  blurb:
    "A registered Claude plan's last probe found it signed out, not set up on this machine, or failing — one card per plan; or the plans register itself does not read — one card for it.",
  context: "work",
  floats: true,
  id: "claude-plan-unusable",
  keepsNoteUp: true,
  perSubject: true,
  prefix: "claude",
  resolves:
    "the plan's next probe reads its usage, or the owner pauses the plan; the owner's Done holds the card until a probe re-tests it — and a register card, the next measured pass that reads the register",
  source:
    "the plan register's unpaused Claude rows (a read that fails is the register card), the store's claude-plan-probes row (what `claude gauge`, `claude watch` or the pre-spawn routing gate last probed), and the hand register",
  unblocks: ({ subject }) => claudeUnblocks({ subject }),
  what: ({ subject }) => claudeWhat({ subject }),
  where:
    "Your own terminal for a sign-in, or this card on the Queue for a repair — the card clears when a probe reads the plan",
};
