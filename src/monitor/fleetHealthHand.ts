/**
 * Whether a failing fleet-health row waits on the OWNER's hand, which open card is that step, and where it happens.
 *
 * Reading this note's list of failing `resync-atlas-*` rows, the owner can act without going to the supervisor to
 * ask: a sign-in to a provider in the browser, or to Google locally, is a button put in front of them. The steps that
 * still need the owner's hand are sign-ins, and anything outside the work Chrome profile, such as a registered
 * plan's Slopweaver email address.
 *
 * ## Joined off the OPEN hand register, never authored
 *
 * A row's step is the owner's only when an open card says so, and the card is found by a key the fleet already wrote, in
 * this order: the `resync-signed-out` card for the host its newest attempt stopped at; then a card whose `row` is the
 * board row of the seat repairing it; then a card whose `row` is the finding its failure hold pauses it on. Two cards
 * on one key: the newest posted leads, and the rest are counted, never dropped.
 *
 * ## Where it happens: a CLOSED set, read off typed fields
 *
 * Never off a card's `where` prose, which is authored. {@link placeOf} reads, in order: a registered plan's address
 * named on the card (the plan register's own data — the slopweaver.ai accounts), the window the fleet opened
 * through the Chrome pin (the recorded work profile, by construction), a `resync-signed-out` card (its monitor
 * declares work Chrome), and a command to paste (a terminal). A card carrying none of them says only that its card
 * says where — the residue, stated rather than guessed.
 *
 * Pure: the open steps and the keys in, one step per row out.
 */

import { checklistCommands } from "../hand/checklist.js";
import type { PlanEmail } from "../hand/planSignIn.js";
import type { HandStep } from "../hand/step.js";
import { MONITOR_STEP_PREFIX, monitorDefinition, occurrenceBase } from "./registry.js";
import { signInHostKey } from "./resyncSignedOut.js";
import { RESYNC_SIGNED_OUT } from "./resyncSignedOutDefinition.js";

/** Where the owner's step for a row happens. */
export type HandPlace =
  /** On an account outside the work Chrome profile — a registered plan's address. */
  | { readonly kind: "account"; readonly email: string }
  /** In the work Chrome profile. */
  | { readonly kind: "work-chrome" }
  /** In a terminal on this Mac, pasting a command. */
  | { readonly kind: "terminal" }
  /** Nothing typed on the card says — its card does. */
  | { readonly kind: "card" };

/** The owner's step for one failing row: what it is, where, and the open card that is it. */
export interface YourStep {
  /** The act, in the owner's words: `sign in to go.xero.com`, or the card's own sentence. */
  readonly act: string;
  readonly place: HandPlace;
  /** The open card's step id — a row with no open card has no step of the owner's. */
  readonly card: string;
  /** How many other open cards wait on the same key. */
  readonly more: number;
}

/** What one failing row is joined on. */
export interface FailingRowKeys {
  readonly recipeId: string;
  /** The host its newest attempt stopped at, when the owner's sign-in card for it is carried and NOT yet Done. */
  readonly signInHost: string | undefined;
  /** The board row of the seat repairing it, when one has taken it. */
  readonly repairRow: string | undefined;
  /** The board finding its failure hold pauses it on, when one does. */
  readonly holdFinding: string | undefined;
}

/**
 * Where a card's step happens, from its typed fields alone.
 *
 * @param step the open card
 * @param plans every registered plan's alias and cached address
 * @returns the place, `card` when no typed field says
 */
export function placeOf({ step, plans }: { step: HandStep; plans: readonly PlanEmail[] }): HandPlace {
  const words = [step.what, step.where]
    .filter((part) => part !== undefined)
    .join(" ")
    .toLowerCase();
  const email = plans
    .map((plan) => plan.email)
    .find((address) => address !== undefined && words.includes(address.toLowerCase()));
  if (email !== undefined) {
    return { email, kind: "account" };
  }
  if (step.opened !== undefined || step.id.startsWith(signInPrefix())) {
    return { kind: "work-chrome" };
  }
  if (step.literal !== undefined || checklistCommands({ checklist: step.checklist }).length > 0) {
    return { kind: "terminal" };
  }
  return { kind: "card" };
}

/**
 * The owner's step for each failing row that has one; a row absent from the result is the fleet's.
 *
 * @param rows each failing row's join keys
 * @param openSteps every open card on the hand register
 * @param plans every registered plan's alias and cached address
 * @returns the owner's step, by recipe id
 */
export function yourSteps({
  rows,
  openSteps,
  plans,
}: {
  rows: readonly FailingRowKeys[];
  openSteps: readonly HandStep[];
  plans: readonly PlanEmail[];
}): ReadonlyMap<string, YourStep> {
  const newestFirst = openSteps.toSorted((a, b) => b.postedIso.localeCompare(a.postedIso) || a.id.localeCompare(b.id));
  const steps = new Map<string, YourStep>();
  for (const row of rows) {
    const step = yourStep({ newestFirst, plans, row });
    if (step !== undefined) {
      steps.set(row.recipeId, step);
    }
  }
  return steps;
}

/** One row's step: its sign-in, else a card on its repair row, else a card on its hold's finding. */
function yourStep({
  row,
  newestFirst,
  plans,
}: {
  row: FailingRowKeys;
  newestFirst: readonly HandStep[];
  plans: readonly PlanEmail[];
}): YourStep | undefined {
  if (row.signInHost !== undefined) {
    const base = `${signInPrefix()}${signInHostKey({ host: row.signInHost })}`;
    const cards = newestFirst.filter((step) => occurrenceBase({ id: step.id }) === base);
    const lead = cards[0];
    // A wall with no open card has no button to put in front of the owner, so it is not the owner's yet: it reads what the fleet
    // is doing, like any other row, until the card is on the register.
    if (lead !== undefined) {
      return {
        act: `sign in to ${row.signInHost}`,
        card: lead.id,
        more: cards.length - 1,
        place: { kind: "work-chrome" },
      };
    }
  }
  for (const boardRow of [row.repairRow, row.holdFinding]) {
    if (boardRow === undefined) {
      continue;
    }
    const cards = newestFirst.filter((step) => step.row === boardRow);
    const lead = cards[0];
    if (lead !== undefined) {
      return { act: lead.what, card: lead.id, more: cards.length - 1, place: placeOf({ plans, step: lead }) };
    }
  }
  return undefined;
}

/**
 * Whether a `fleet-unhealthy` note is on the owner's screen — an open card is not enough, because Later takes the
 * note down and leaves its card open, and a button the owner has put away must never re-raise a note.
 *
 * @param openSteps every open card on the hand register
 * @param showing whether one open card's note is on the owner's screen now
 * @returns true when an open card this monitor posted has its note up
 */
export function fleetNoteUp({
  openSteps,
  showing,
}: {
  openSteps: readonly HandStep[];
  showing: (stepId: string) => boolean;
}): boolean {
  const prefix = `${MONITOR_STEP_PREFIX}${monitorDefinition({ monitorId: "fleet-unhealthy" }).prefix}-`;
  return openSteps.some((step) => step.id.startsWith(prefix) && showing(step.id));
}

/** The step-id opening every `resync-signed-out` card carries: `mon-signin-`. */
function signInPrefix(): string {
  return `${MONITOR_STEP_PREFIX}${RESYNC_SIGNED_OUT.prefix}-`;
}
