/**
 * The `codex-plan-signed-out` declaration — the card a registered Codex plan with nothing usable signed into it puts in
 * front of the owner: the address they sign in with, and why routing skipped the plan. Its own module because the wording is
 * the whole of it, and `./registry.ts` lists it in its place in `MONITORS`.
 */
import { fitLine } from "../hand/push/notice.js";
import { UNBLOCKS_CAP, WHAT_CAP } from "../hand/step.js";

import type { MonitorDefinition } from "./registry.js";
import type { MonitorSubject } from "./types.js";

/** What a `codex-plan-signed-out` card says either side of the plan's alias. */
const CODEX_WHAT_OPEN = "Sign Codex plan ";
const CODEX_WHAT_CLOSE = " back in — paste the copied command into your terminal";

/** What a `codex-plan-signed-out` card says after the plan's address. */
const CODEX_EMAIL_CLOSE = " — paste the copied command into your terminal";

/**
 * The `codex-plan-signed-out` card's sentence, leading on the address the owner signs in with.
 *
 * A plan sign-in names the plan's email address, because an alias alone makes the owner
 * guess which account it is (`../hand/planSignIn.ts`, which the register's append enforces). The alias follows in
 * brackets while the cap has room and is dropped before the address is: the address is the half the owner needs. A
 * plan whose register row caches no address keeps the alias sentence, since there is nothing else to name.
 *
 * MEASURED with `slopweaver plans list`: the longest registered pair, `ada-owner-codex-3@slopweaver.ai`
 * on `codex-three`, draws 114 characters against the cap of 120.
 *
 * @param subject the unusable store, whose `id` is its alias and `email` its cached address
 * @returns the one sentence, never longer than the cap
 */
function codexWhat({ subject }: { subject: MonitorSubject }): string {
  if (subject.email === undefined) {
    return `${CODEX_WHAT_OPEN}${subject.id}${CODEX_WHAT_CLOSE}`;
  }
  const named = `Sign in as ${subject.email} on Codex (${subject.id})${CODEX_EMAIL_CLOSE}`;
  if (named.length <= WHAT_CAP) {
    return named;
  }
  const bare = `Sign in as ${subject.email} on Codex${CODEX_EMAIL_CLOSE}`;
  if (bare.length <= WHAT_CAP) {
    return bare;
  }
  // The joint leads, so a cut for a long address never drops what the step is about (`../hand/headlinePurpose.ts`).
  return fitLine({ cap: WHAT_CAP, text: `Sign in to Codex so its plan works again: ${subject.email}` });
}

/**
 * What a `codex-plan-signed-out` card says is waiting on the owner, which also answers why routing "tried a different plan", and how that differed from the
 * plan it fell back from.
 *
 * It never tried to sign in: routing takes every plan in one pool, and a store with nothing signed in had never
 * been capped, so it ranked first and every pass failed until it was skipped. Skipping it is the same fallback a
 * capped plan gets; the one difference is what brings it back — a cap resets on its own, a sign-out never does.
 *
 * The failure is what gets fitted, never the explanation: the pause reason is free text of any length, and a
 * cut-off answer would be the one part of the card the owner needs. The store path is left to the
 * command on the owner's pasteboard, which names it whole — a sandbox path fitted
 * into this line cut the sentence to "nothing is signed in at." So this line interpolates the plan's alias, a
 * fixed failure phrase and the owner's own pause reason, and never the store's `codexHome`.
 *
 * @param subject the unusable store, whose `label` says what failed
 * @returns the line, fitted to the register's cap
 */
function codexUnblocks({ subject }: { subject: MonitorSubject }): string {
  const room = UNBLOCKS_CAP - CODEX_UNBLOCKS_CLOSE.length;
  // `\s` misses the C1 controls (U+0085 NEXT LINE among them) and the format controls (U+202E, which reverses
  // the text after it on screen), so every control and format character folds too.
  const failure = `${subject.id}: ${subject.label}`.replaceAll(/[\s\p{Cc}\p{Cf}]+/gu, " ").trim();
  if (failure.length <= room) {
    return `${failure}${CODEX_UNBLOCKS_CLOSE}`;
  }
  // A cut is marked, never silent: a pause reason is the owner's own free text and can run to any length. The ellipsis
  // ends the cut sentence, so neither its trailing punctuation nor the close's own full stop is kept beside it.
  const cut = fitLine({ cap: room, text: failure }).replace(/[\s;:,.]+$/, "");
  return `${cut}… ${CODEX_UNBLOCKS_CLOSE.slice(". ".length)}`;
}

/** The half of a `codex-plan-signed-out` card's `unblocks` that answers why the plan was skipped, kept whole. */
const CODEX_UNBLOCKS_CLOSE =
  ". Codex skips it for the next signed-in plan, as for a capped one, but a cap resets itself and a sign-out never does";

/** `codex-plan-signed-out`: one floating work card per Codex plan nothing usable is signed into. */
export const CODEX_PLAN_SIGNED_OUT: MonitorDefinition = {
  blurb: "A registered Codex plan has nothing usable signed into it, so routing skips a plan the owner pays for.",
  context: "work",
  floats: true,
  id: "codex-plan-signed-out",
  perSubject: true,
  prefix: "codex",
  resolves:
    "the store carries a sign-in newer than the live read that refused it, or the next live read finds it signed in",
  source:
    "the plan register's Codex rows, each store's auth.json shape, and the codex_sign_in_observation rows — what the fleet's live read last refused",
  unblocks: ({ subject }) => codexUnblocks({ subject }),
  what: ({ subject }) => codexWhat({ subject }),
  where: "Your own terminal — the card clears on the new sign-in, and returns if the next Codex read refuses it",
};
