/**
 * Whose move a failing fleet-health row is, and the words its line says it in.
 *
 * The owner can act on a failing row without going to the supervisor to ask: a button is put in front of them. So
 * every failing row opens on {@link NEEDS_YOU} — the owner's open card, where it happens, and a marker the note draws as a control opening that
 * card (`./fleetHealthHand.ts`) — or on {@link NOTHING_FOR_YOU}, naming what the fleet is doing instead. What CHANGED
 * since the last note is `./fleetHealthDelta.ts`'s; this module only says whose move each row is.
 *
 * Pure: the joins in, a fate and its words out.
 */
import type { SignInProvider } from "../browser/signInPress.js";
import { detailActMarker, NEEDS_YOU, NOTHING_FOR_YOU } from "../hand/details.js";

import type { HandPlace, YourStep } from "./fleetHealthHand.js";

/** Whose next step one failing row is, and what — what its line says in place of, or ahead of, the exit code. */
export type RowFate =
  /** An open card of the owner's is the row's next step (`./fleetHealthHand.ts`). */
  | { readonly kind: "needs-you"; readonly step: YourStep }
  /**
   * The owner pressed Done on the card for `host`'s sign-in page its newest attempt stopped at; `held` while a failure
   * hold still pauses the row, so no attempt follows the owner's sign-in until its finding is settled.
   */
  | { readonly kind: "signed-in"; readonly host: string; readonly held: boolean }
  /**
   * Its newest attempt stopped at a Datadog or GitHub sign-in, which is the fleet's to press, not the owner's;
   * `provider` names the `browser sign-in` look the seated session takes, and `held` says a failure hold
   * still pauses the row, so no seat runs it until its finding is settled.
   */
  | { readonly kind: "fleet-presses"; readonly host: string; readonly provider: SignInProvider; readonly held: boolean }
  /** A seat has taken its repair (`slopweaver automation repair`); `seat` is that seat's board row. */
  | { readonly kind: "repairing"; readonly seat: string }
  /** A failure hold pauses it on its board finding until a fix lands (`../live/automation/failureHold.ts`). */
  | { readonly kind: "held" }
  /** Nothing stops it: its next slot runs it again. */
  | { readonly kind: "retrying" };

/**
 * Each failing row's fate, most specific first: an open card of the owner's (`./fleetHealthHand.ts`), then a sign-in the
 * fleet presses itself, then a sign-in the owner pressed Done on, then a seat's repair, then a failure hold, else its next slot.
 *
 * @param failing every recipe id failing or dying in the window
 * @param yours the owner's open step for each row that has one
 * @param signedIn the host each row's newest attempt stopped at, for a row whose sign-in card the owner pressed Done on
 * @param fleetPresses the host and provider each row's newest attempt stopped at, for a wall the fleet presses itself
 * @param repairing the seat's board row, for each row a seat has taken the repair of
 * @param held the rows a failure hold pauses
 * @returns each failing row's fate, by recipe id
 */
export function rowFatesOf({
  failing,
  yours,
  signedIn,
  fleetPresses,
  repairing,
  held,
}: {
  failing: readonly string[];
  yours: ReadonlyMap<string, YourStep>;
  signedIn: ReadonlyMap<string, string>;
  fleetPresses: ReadonlyMap<string, { readonly host: string; readonly provider: SignInProvider }>;
  repairing: ReadonlyMap<string, string>;
  held: ReadonlySet<string>;
}): ReadonlyMap<string, RowFate> {
  const fates = new Map<string, RowFate>();
  for (const id of failing) {
    const step = yours.get(id);
    const pressed = fleetPresses.get(id);
    const host = signedIn.get(id);
    const seat = repairing.get(id);
    if (step !== undefined) {
      fates.set(id, { kind: "needs-you", step });
    } else if (pressed !== undefined) {
      fates.set(id, { held: held.has(id), host: pressed.host, kind: "fleet-presses", provider: pressed.provider });
    } else if (host !== undefined) {
      fates.set(id, { held: held.has(id), host, kind: "signed-in" });
    } else if (seat !== undefined) {
      fates.set(id, { kind: "repairing", seat });
    } else if (held.has(id)) {
      fates.set(id, { kind: "held" });
    } else {
      fates.set(id, { kind: "retrying" });
    }
  }
  return fates;
}

/**
 * What a failing row's line says after its timing: whose move it is, and — for the owner's — the act, where it happens and
 * the marker the note draws as the owner's button.
 *
 * @param fate whose move the row is
 * @param why the ledger's reason for its latest failure, kept only where the move is the fleet's
 * @returns the clause, e.g. `Needs you — sign in to go.xero.com, in your work Chrome [hand:mon-signin-go-xero-com]`
 */
export function fateClause({ fate, why }: { fate: RowFate; why: string }): string {
  // The exit code says nothing the owner can act on; the owner's step, where it happens and the card that is it are the line.
  if (fate.kind === "needs-you") {
    const { step } = fate;
    const more = step.more === 0 ? "" : ` (+${String(step.more)} more open)`;
    return `${NEEDS_YOU} — ${step.act}, ${placePhrase({ place: step.place })}${more}${detailActMarker({ id: step.card })}`;
  }
  if (fate.kind === "signed-in") {
    const signedIn = `${NOTHING_FOR_YOU} — you pressed Done on its ${fate.host} sign-in`;
    if (fate.held) {
      return `${signedIn}; it stays paused on its failure finding until that is settled, then its next attempt says whether it got past`;
    }
    return `${signedIn}, so its next attempt says whether it got past`;
  }
  if (fate.kind === "fleet-presses") {
    const pressed = `${NOTHING_FOR_YOU} — the fleet presses its ${fate.host} sign-in itself`;
    if (fate.held) {
      return `${pressed}; it stays paused on its failure finding until that is settled`;
    }
    return `${pressed}: its next seat runs \`slopweaver browser sign-in --provider ${fate.provider}\``;
  }
  // Ahead of the why, which is free text of any length: a line is fitted to the note's cap from the end.
  return `${NOTHING_FOR_YOU} — ${fleetPhrase({ fate })}; ${why}`;
}

/**
 * The words a line says its place in — and, for anything off the work Chrome profile, says so plainly.
 *
 * @param place where the step happens (`./fleetHealthHand.ts` § placeOf)
 * @returns the phrase, e.g. `in your work Chrome`
 */
export function placePhrase({ place }: { place: HandPlace }): string {
  switch (place.kind) {
    case "account": {
      return `outside your work Chrome, as ${place.email}`;
    }
    case "work-chrome": {
      return "in your work Chrome";
    }
    case "terminal": {
      return "in a terminal on this Mac, outside Chrome";
    }
    case "card": {
      return "where its card says";
    }
    default: {
      const unreachable: never = place;
      return unreachable;
    }
  }
}

/** What the fleet is doing about a row whose next step is not the owner's. */
function fleetPhrase({ fate }: { fate: Extract<RowFate, { kind: "repairing" | "held" | "retrying" }> }): string {
  if (fate.kind === "repairing") {
    return `seat ${fate.seat} is repairing it`;
  }
  if (fate.kind === "held") {
    return "paused on its failure finding until a fix lands";
  }
  return "its next slot runs it again";
}
