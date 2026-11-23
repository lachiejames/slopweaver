/**
 * `handover register`'s instant: when the owner said it, derived from the flags and the anchor rather than typed. Its own
 * file so `./askRowRun.ts` stays under the file-size ratchet; the seam is the derivation, which reads nothing but the
 * flags and, for a transcript anchor, that one turn.
 */

import { homedir } from "node:os";
import { join } from "node:path";

import { slackTsFromPermalink, slackTsToIso } from "../../../lib/slackTs.js";
import { findOwnerTurn } from "../../../supervisor/chairTranscript.js";
import { parseTurnPointer } from "../../../transcripts/pointer.js";

/**
 * When the owner said it, from the three sources in precedence order — and never from a human's arithmetic.
 *
 * `--asked-ts` and a Slack `--anchor` both go through `lib/slackTs.ts`, so the row's instant is DERIVED from
 * the message's own identity rather than typed alongside it. That ordering is the fix for the measured
 * defect: a run hand-converted a Slack `ts` to an instant 80 minutes wrong, wrote that
 * value into this exact field, and the error then reached two cron schedules and two deadman deadlines. An
 * explicitly passed `--asked-iso` still wins over the anchor — it is the escape hatch for an ask that did
 * not arrive in Slack — but it is now REFUSED unless it parses, where before any string was written through.
 *
 * @param values the parsed flag values
 * @returns the instant, or the sentence refusing the flag that could not supply one
 * @internal — exported only so the derivation order is unit-testable without a filesystem.
 */
export function askedInstant({
  values,
}: {
  values: Readonly<Record<string, unknown>>;
}): { readonly askedIso: string } | { readonly refusal: string } {
  const askedTs = typeof values["asked-ts"] === "string" ? values["asked-ts"] : undefined;
  if (askedTs !== undefined) {
    const derived = slackTsToIso({ ts: askedTs });
    return derived === undefined ? { refusal: `--asked-ts ${askedTs} is not a Slack ts` } : { askedIso: derived };
  }
  const askedIso = typeof values["asked-iso"] === "string" ? values["asked-iso"] : undefined;
  if (askedIso !== undefined) {
    if (Number.isNaN(Date.parse(askedIso))) {
      return { refusal: `--asked-iso ${askedIso} is not an instant — pass --asked-ts to derive one` };
    }
    return { askedIso };
  }
  const anchor = typeof values["anchor"] === "string" ? values["anchor"] : undefined;
  const fromAnchor = anchor === undefined ? undefined : slackTsFromPermalink({ permalink: anchor });
  const derived = fromAnchor === undefined ? undefined : slackTsToIso({ ts: fromAnchor });
  // No flag and no Slack anchor names an instant: the ask is being registered as it is heard, so it is now.
  if (derived === undefined) {
    return { askedIso: new Date().toISOString() };
  }
  return { askedIso: derived };
}

/**
 * The instant a TRANSCRIPT anchor names, read off the turn itself — the one derivation that needs a file.
 *
 * A `transcript:<sessionId>#<turnUuid>` anchor addresses a turn the owner typed into a session
 * (`../../../transcripts/pointer.ts`), and the turn's own record carries when the owner typed it. Reading it here
 * does two things at once: the row's `askedIso` is derived rather than typed, and a pointer naming no turn in
 * that transcript is REFUSED at registration, so a row can never be anchored to a turn that does not exist —
 * which would make the intake check count it as witnessed while pointing at nothing.
 *
 * Only consulted when no explicit instant was passed, so `--asked-iso` stays the escape hatch it already is;
 * an explicit instant, or an anchor that is not a transcript pointer, is {@link askedInstant}'s to derive.
 *
 * @param values the parsed flag values
 * @returns the instant, or the refusal
 */
export function registeredInstant({
  values,
}: {
  values: Readonly<Record<string, unknown>>;
}): { readonly askedIso: string } | { readonly refusal: string } {
  if (typeof values["asked-ts"] === "string" || typeof values["asked-iso"] === "string") {
    return askedInstant({ values });
  }
  const anchor = typeof values["anchor"] === "string" ? values["anchor"] : undefined;
  const pointer = anchor === undefined ? undefined : parseTurnPointer({ text: anchor });
  if (pointer === undefined) {
    return askedInstant({ values });
  }
  const turn = findOwnerTurn({ pointer, projectsDir: join(homedir(), ".claude", "projects") });
  if (turn.isErr()) {
    return { refusal: `--anchor ${anchor!}: ${turn.error.message}` };
  }
  if (turn.value.timestamp === "") {
    return { refusal: `--anchor ${anchor!} names a turn with no recorded instant — pass --asked-iso` };
  }
  return { askedIso: turn.value.timestamp };
}
