/**
 * What became of one line typed for the supervisor's chat, as the turn record, the report and the voice read it —
 * the vocabulary `./supervisorDelivery.ts` writes, kept apart from the sender so a reader of a delivery never imports
 * the cmux reach.
 *
 * A `failed` or `skipped` delivery names a closed {@link DeliveryRefusal}, so a reader branches on the class and
 * displays `detail`, cmux's own words. The owner asked for this after every relay was refused by cmux's
 * `cmuxOnly` layer and the record could not say so as a class.
 */
import type { ComposerReading } from "../cmux/composer.js";
import { type CmuxError, keystrokeMayHaveLanded } from "../cmux/errors.js";
import type { SessionHarnessError } from "../sessionHarness/errors.js";

/**
 * What became of one relay's line. `attempting` is written BEFORE the paste, so a crash mid-send is visible. `held` is
 * a relay the chair's courier holds for the next quiet batch (`./chairWake.ts`): on the board, not yet in the chat.
 */
export type DeliveryKind =
  "typed" | "queued" | "stranded" | "unconfirmed" | "skipped" | "failed" | "attempting" | "held";

/** The two kinds that say nothing was typed, and so carry a {@link DeliveryRefusal}. */
type RefusedKind = Extract<DeliveryKind, "skipped" | "failed">;

/**
 * Which process typed the line: the relay's own (`direct`), or the pinned chair's courier (`courier`,
 * `./relayCourier.ts`), which a relay from a console started outside cmux is handed to.
 */
export type DeliveryVia = "direct" | "courier";

/**
 * Why a `failed` or `skipped` delivery typed nothing — a closed class a reader branches on, where `detail` is cmux's
 * own words to display. `cmux-access-denied` is the failure where a console started outside cmux holds no
 * capability token and cmux's `cmuxOnly` layer refuses it. `unclassified` is only ever READ, off a stored turn
 * that names no class.
 */
export type DeliveryRefusal =
  | "cmux-access-denied"
  | "cmux-unreachable"
  | "no-pinned-supervisor"
  | "multiple-pinned-supervisors"
  | "composer-busy"
  | "composer-unreadable"
  | "cmux-send-failed"
  | "courier-unavailable"
  | "unclassified";

/** Every {@link DeliveryRefusal}, for a reader that validates a stored one. */
export const DELIVERY_REFUSALS: readonly DeliveryRefusal[] = [
  "cmux-access-denied",
  "cmux-unreachable",
  "no-pinned-supervisor",
  "multiple-pinned-supervisors",
  "composer-busy",
  "composer-unreadable",
  "cmux-send-failed",
  "courier-unavailable",
  "unclassified",
];

/**
 * One delivery outcome, as the turn record and the report carry it. A `failed` or `skipped` one names its refusal
 * class, so the compiler refuses one written without it.
 */
export type Delivery =
  | {
      readonly kind: Exclude<DeliveryKind, RefusedKind>;
      /** One plain sentence: where it went, or why it did not. */
      readonly detail: string;
      readonly atIso: string;
      readonly via: DeliveryVia;
    }
  | {
      readonly kind: RefusedKind;
      readonly detail: string;
      readonly atIso: string;
      readonly via: DeliveryVia;
      readonly refusal: DeliveryRefusal;
    };

/**
 * Why the supervisor's composer must not be typed into right now, or `undefined` when it may.
 *
 * @param composer what the box holds
 * @returns the reason to type nothing and its class, or `undefined`
 */
export function composerRefusal({ composer }: { composer: ComposerReading }):
  | {
      readonly why: string;
      readonly refusal: Extract<DeliveryRefusal, "composer-busy" | "composer-unreadable">;
    }
  | undefined {
  if (composer.kind === "typed") {
    return {
      refusal: "composer-busy",
      why: "the owner has unsent words in the supervisor's box, and a paste would splice into them",
    };
  }
  if (composer.kind === "unreadable") {
    return {
      refusal: "composer-unreadable",
      why: `the supervisor's box could not be read (${composer.reason}), and an unread box is not an empty one`,
    };
  }
  return undefined;
}

/**
 * The refusal class of a failure to list workspaces: cmux's `cmuxOnly` refusal of a process it did not start —
 * raw, or as the session harness carries it across the seam — or any other way the socket would not serve.
 *
 * @param error what the list call failed with, cmux's own or the harness's
 * @returns `cmux-access-denied` for the typed access refusal, else `cmux-unreachable`
 */
export function listRefusalOf({
  error,
}: {
  error: CmuxError | SessionHarnessError;
}): Extract<DeliveryRefusal, "cmux-access-denied" | "cmux-unreachable"> {
  if (error.code === "SOCKET_UNAVAILABLE" && error.reason === "access-denied") {
    return "cmux-access-denied";
  }
  if (error.code === "HARNESS_UNAVAILABLE" && error.accessDenied === true) {
    return "cmux-access-denied";
  }
  return "cmux-unreachable";
}

/**
 * What a failed reach into the supervisor's chat records. A connection lost or a call timed out mid-reach cannot say
 * whether cmux applied a keystroke before its reply was lost — the socket never replays one for exactly that reason
 * (`../cmux/socket.ts`) — so the line may be in the chat, and it is `unconfirmed`, never `failed`: a `failed` turn is
 * one the voice tells the owner only reached the board. A reply that arrived but could not be read is the same: cmux may
 * have applied the keystroke it answers. Any other failure is cmux answering that it did not take the call.
 *
 * @param error what the reach failed with
 * @param atIso when it failed
 * @param via which process was typing
 * @returns `unconfirmed` for an ambiguous transport failure, else `failed (cmux-send-failed)`
 */
export function sendFailureOf({ error, atIso, via }: { error: CmuxError; atIso: string; via: DeliveryVia }): Delivery {
  if (keystrokeMayHaveLanded({ error })) {
    return {
      atIso,
      detail: `cmux lost the line mid-send, so it may or may not be in the supervisor's chat: ${error.message}`,
      kind: "unconfirmed",
      via,
    };
  }
  return { atIso, detail: `cmux refused the line: ${error.message}`, kind: "failed", refusal: "cmux-send-failed", via };
}

/**
 * The delivery a reach outcome amounts to.
 *
 * @param disposition what the surface said became of the line
 * @param workspaceRef the supervisor's ref, named in the sentence
 * @param atIso when the reach finished
 * @param via which process typed it
 * @returns the delivery to record
 */
export function deliveryOfDisposition({
  disposition,
  workspaceRef,
  atIso,
  via,
}: {
  disposition: "submitted" | "queued" | "unknown" | "stranded" | "resubmitted";
  workspaceRef: string;
  atIso: string;
  via: DeliveryVia;
}): Delivery {
  switch (disposition) {
    case "submitted":
    case "resubmitted":
      return {
        atIso,
        detail: `typed into the supervisor's chat (${workspaceRef}) as a turn from the owner`,
        kind: "typed",
        via,
      };
    case "queued":
      return {
        atIso,
        detail: `typed into the supervisor's chat (${workspaceRef}), queued behind its running turn`,
        kind: "queued",
        via,
      };
    case "stranded":
      return {
        atIso,
        detail: `pasted into the supervisor's box (${workspaceRef}) but not submitted; it is sitting there unsent`,
        kind: "stranded",
        via,
      };
    case "unknown":
      return {
        atIso,
        detail: `pasted into the supervisor's chat (${workspaceRef}); the screen did not confirm it was taken`,
        kind: "unconfirmed",
        via,
      };
    default: {
      const never: never = disposition;
      return never;
    }
  }
}
