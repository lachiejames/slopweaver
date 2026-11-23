/**
 * The copy-tray offer a relay carries — the exact message the voice put in the owner's tray before they reacted to it.
 *
 * Without it, a relayed reaction to a tray draft reaches the board with only the owner's heard words, so the row says
 * "send that" and nothing says what "that" was. The page records each landed offer in its relay gate's log and sends
 * the newest one since the last relay (`site/lib/relayGate.ts`'s `offeredSince`); the route stages it as a file
 * (`--offered-file`), and this module is what the verb accepts of it.
 *
 * The offer is the VOICE's draft, never the owner's words: their heard words stay the only authority on whether they
 * approved, rejected or amended it, and nothing here classifies that. What this buys is that the row carries every byte
 * of what the owner was looking at, so a reader of their words can tell what they were about.
 *
 * Pure: no filesystem, no clock.
 */
import { createHash } from "node:crypto";

import { err, ok, type Result } from "../lib/result.js";
import { safeJsonStringify } from "../lib/safeJson.js";

import { CALL_OFFER_FIELDS } from "./callOffer.js";
import { type TalkError, TalkErrors } from "./errors.js";

/** One copy-tray offer as a relay carries it: the five fields the page's `CopyOfferWire` sends, and nothing else. */
export interface RelayOffer {
  /** `offer-<made>`, the page's id for it. */
  readonly id: string;
  /** When it was asked, as canonical decimal digits — the tray's order. */
  readonly made: string;
  /** The head: what showed at once, and all of the message when there is no fold. */
  readonly text: string;
  /** The rest, behind "Show more", or `undefined` when the whole message showed at once. */
  readonly belowFold: string | undefined;
  /** The tray's label for it, or `undefined` when it had none. */
  readonly label: string | undefined;
}

/**
 * Read one copy-tray offer out of a parsed value: the call file's own bounds (`./callOffer.ts`), and an id that is the
 * page's `offer-<made>` for the same `made`, since the page never mints any other.
 *
 * @param value the parsed contents of `--offered-file`
 * @returns the offer, or an `OFFERED_INVALID` refusal naming what is wrong with it
 */
export function relayOfferOf({ value }: { value: unknown }): Result<RelayOffer, TalkError> {
  const parsed = CALL_OFFER_FIELDS.offer.safeParse(value);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => {
      if (issue.path.length === 0) {
        return issue.message;
      }
      return `${issue.path.map(String).join(".")}: ${issue.message}`;
    });
    return err(TalkErrors.offeredInvalid({ why: `is not one copy-tray offer — ${issues.join("; ")}` }));
  }
  const { belowFold, id, label, made, text } = parsed.data;
  if (id !== `offer-${made}`) {
    return err(
      TalkErrors.offeredInvalid({ why: `names id ${id}, but the page's id for made ${made} is offer-${made}` }),
    );
  }
  return ok({ belowFold, id, label, made, text });
}

/**
 * Why a draft refuses an offer beside a typed steer or the words-alone retry: neither carries anything the voice
 * wrote, so neither can carry the voice's draft.
 */
export const OFFERED_SPOKEN_ONLY =
  "rides a spoken relay only: a words-alone retry or a typed steer carries nothing the voice wrote";

/**
 * What a relay's digest binds of its offer: one line naming the sha256 of all five fields, so a retry of the turn
 * carrying another offer, or none, compares different and is refused as a conflict rather than registered.
 *
 * @param offered the offer the relay carries, or `undefined` when it carries none
 * @returns the line, with its leading newline, to append to the digest's bound text; empty for no offer, so a relay
 *   without one digests exactly as it did before offers rode a relay
 */
export function relayOfferDigestLine({ offered }: { offered: RelayOffer | undefined }): string {
  if (offered === undefined) {
    return "";
  }
  const { belowFold, id, label, made, text } = offered;
  const canonical = safeJsonStringify({ label: "relay offer", value: { belowFold, id, label, made, text } });
  return `\noffered:${createHash("sha256").update(canonical, "utf8").digest("hex")}`;
}
