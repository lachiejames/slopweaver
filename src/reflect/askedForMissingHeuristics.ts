/**
 * The heuristic buckets of the asked-for-and-missing pass: session notes, run-journal asks and owner directives,
 * each answering "did a session report a gap" by the same substring match over {@link ABSENCE_MARKERS}. The
 * buckets curated at source, the confidence tiers and how the marker set was measured are in
 * {@link ./collectAskedForMissing.ts}'s header, and that module folds what these readers return.
 *
 * Pure reads through the injected seam; no model, no network.
 */
import { join } from "node:path";

import { parseLedger, type RunEvent } from "../handover/ledger.js";
import type { OwnerDirective } from "../judgement/ownerDirective.js";
import { parseSessionLog } from "../sessions/session.js";
import {
  classOr,
  inWindow,
  jsonlNames,
  oneLine,
  type ReflectWindow,
  type Sighting,
  type SubstrateReader,
} from "./substrate.js";

/**
 * Substrings that make a piece of prose a report that something asked for did not exist. Case-insensitive,
 * deliberately blunt — see {@link ./collectAskedForMissing.ts}'s module header for how the set was measured and why
 * over-merging is the accepted trade.
 *
 * @internal
 */
export const ABSENCE_MARKERS = [
  "trap:",
  "does not exist",
  "doesn't exist",
  "no such",
  "not supported",
  "isn't supported",
  "no way to",
  "no flag",
  "no verb",
  "not implemented",
  "hasn't been built",
  "has not been built",
  "isn't wired",
  "not wired",
  "missing capability",
  "not available",
] as const;

/**
 * Whether a piece of prose reports something asked for as not existing.
 *
 * @internal
 * @param text the prose to test
 * @returns whether any absence marker occurs in it
 */
export function looksLikeAbsence({ text }: { text: string }): boolean {
  const lower = text.toLowerCase();
  return ABSENCE_MARKERS.some((marker) => lower.includes(marker));
}

/**
 * Read the supervisor's session ledger for `noted` events that report an absence.
 *
 * @param sessionLogPath the `sessions/sessions.jsonl` path
 * @param reader the filesystem seam
 * @param window the run's bounds
 * @returns the sightings and how many `noted` events were read
 */
export function sessionNoteSightings({
  sessionLogPath,
  reader,
  window,
}: {
  sessionLogPath: string;
  reader: SubstrateReader;
  window: ReflectWindow;
}): { readonly sightings: readonly Sighting[]; readonly rowsRead: number; readonly residue: readonly string[] } {
  const text = reader.readText(sessionLogPath);
  if (text === undefined) {
    return { residue: [], rowsRead: 0, sightings: [] };
  }
  const { events, unreadable } = parseSessionLog({ text });
  const sightings: Sighting[] = [];
  let rowsRead = 0;
  for (const event of events) {
    if (event.kind !== "noted") {
      continue;
    }
    rowsRead += 1;
    if (!inWindow({ tsIso: event.tsIso, window }) || !looksLikeAbsence({ text: event.note })) {
      continue;
    }
    sightings.push({
      classKey: classOr({ fallback: "session-note-without-a-classifiable-word", text: event.note }),
      evidence: `${event.sessionKey}: ${oneLine({ text: event.note, width: 140 })}`,
      locus: "session note",
      tsIso: event.tsIso,
    });
  }
  return {
    residue:
      unreadable.length > 0 ? [`${sessionLogPath} has ${String(unreadable.length)} line(s) that did not decode`] : [],
    rowsRead,
    sightings,
  };
}

/** One journal `question`/`answered` event as a sighting, or `undefined` when it is unremarkable. */
function journalAskSighting({
  event,
  slug,
  window,
}: {
  event: Extract<RunEvent, { kind: "answered" | "question" }>;
  slug: string;
  window: ReflectWindow;
}): Sighting | undefined {
  if (!inWindow({ tsIso: event.atIso, window })) {
    return undefined;
  }
  const prose = event.kind === "question" ? event.question : event.answer;
  if (!looksLikeAbsence({ text: prose })) {
    return undefined;
  }
  return {
    classKey: classOr({ fallback: "handover-ask-without-a-classifiable-word", text: prose }),
    evidence: `${slug} (${event.kind}): ${oneLine({ text: prose, width: 140 })}`,
    locus: `handover ${event.kind}`,
    tsIso: event.atIso,
  };
}

/**
 * Read every run journal's `question` and `answered` events for one that reports an absence.
 *
 * @param runsDir the directory of `<slug>.jsonl` run journals
 * @param reader the filesystem seam
 * @param window the run's bounds
 * @returns the sightings and how many `question`/`answered` events were read
 */
export function runJournalAskSightings({
  runsDir,
  reader,
  window,
}: {
  runsDir: string;
  reader: SubstrateReader;
  window: ReflectWindow;
}): { readonly sightings: readonly Sighting[]; readonly rowsRead: number } {
  const sightings: Sighting[] = [];
  let rowsRead = 0;
  for (const name of jsonlNames({ dir: runsDir, reader })) {
    const text = reader.readText(join(runsDir, name));
    if (text === undefined) {
      continue;
    }
    const slug = name.slice(0, -".jsonl".length);
    for (const event of parseLedger({ text }).events) {
      if (event.kind !== "question" && event.kind !== "answered") {
        continue;
      }
      rowsRead += 1;
      const sighting = journalAskSighting({ event, slug, window });
      if (sighting !== undefined) {
        sightings.push(sighting);
      }
    }
  }
  return { rowsRead, sightings };
}

/**
 * The owner's active directives as the caller read them from the store, or why the store could not be read.
 * Loaded by the verb, not here: this collector stays pure, and an unreadable store is residue, never zero.
 */
export type ReflectOwnerJudgement =
  | { readonly kind: "loaded"; readonly directives: readonly OwnerDirective[] }
  | { readonly kind: "unavailable"; readonly why: string };

/**
 * Read the owner's active directives for a standing ruling written because a capability turned out missing.
 *
 * A directive with no `modified` timestamp, or one outside the window, is skipped rather than included with
 * a blank stamp: every other bucket here is bound to the window, and a directive this pass cannot place in
 * time must not be the one exception that always fires.
 *
 * @param ownerJudgement the active directives, or why the store could not be read
 * @param window the run's bounds
 * @returns the sightings, and what could not be read
 */
export function ownerDirectiveSightings({
  ownerJudgement,
  window,
}: {
  ownerJudgement: ReflectOwnerJudgement;
  window: ReflectWindow;
}): { readonly sightings: readonly Sighting[]; readonly residue: readonly string[] } {
  if (ownerJudgement.kind === "unavailable") {
    return { residue: [`the owner directives could not be read from the store: ${ownerJudgement.why}`], sightings: [] };
  }
  const sightings = ownerJudgement.directives
    .filter(
      (directive) =>
        directive.source.modified !== null &&
        inWindow({ tsIso: directive.source.modified, window }) &&
        looksLikeAbsence({ text: directive.text }),
    )
    .map((directive): Sighting => ({
      classKey: classOr({ fallback: "owner-directive-without-a-classifiable-word", text: directive.text }),
      evidence: `directive ${directive.id}: ${oneLine({ text: directive.text, width: 140 })}`,
      locus: "owner directive",
      tsIso: directive.source.modified!,
    }));
  return { residue: [], sightings };
}
