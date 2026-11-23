/**
 * THE ARTIFACT COLLECTORS — Tier 1 substrates that are not ledgers of events but piles somebody left behind:
 * SendFeedback drafts, and the door's holds, which are not a file at all but the store's `door_event` rows, read by
 * the caller and handed in. The third, the per-PR proof reservations, is `./collectPrProof.ts`.
 *
 * Pure folds over the injected seam and the injected rows; no model, no network.
 */
import { join } from "node:path";

import type { Result } from "#lib/result.js";

import type { DoorFrictionEntry } from "../admit/doorLedgerPort.js";
import type { DoorStoreError } from "../admit/doorStoreErrors.js";
import { isRecord } from "../lib/parsers.js";
import { agreeing, countOf } from "./countPhrase.js";
import {
  type CollectorReading,
  classOr,
  field,
  foldSightings,
  inWindow,
  namesAnInstant,
  oneLine,
  type ReflectWindow,
  type Sighting,
  type SubstrateReader,
} from "./substrate.js";

/** A read field, or `whenEmpty` in its place when the record carried none — `field` reads an absent key as `""`. */
function orWhenEmpty({ text, whenEmpty }: { text: string; whenEmpty: string }): string {
  return text === "" ? whenEmpty : text;
}

/** One decoded draft, or the reason it could not be read. */
function draftSighting({ name, text, window }: { name: string; text: string | undefined; window: ReflectWindow }): {
  readonly sighting?: Sighting;
  readonly fresh?: true;
  readonly why?: string;
} {
  if (text === undefined) {
    return { why: `feedback draft ${name} could not be read` };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { why: `feedback draft ${name} is not valid JSON, so its report is invisible to this pass` };
  }
  if (!isRecord(parsed)) {
    return {};
  }
  const createdAt = field({ key: "created_at", record: parsed });
  const kind = orWhenEmpty({ text: field({ key: "type", record: parsed }), whenEmpty: "unclassified" });
  // ONE class for all of them, not one per draft. The hand-run's finding was "three unread SendFeedback
  // drafts" — a pile nothing consumes — and five drafts written on one day are five instances of that, not
  // five findings. The titles ride in the evidence.
  const evidence = `${kind}: ${oneLine({ text: field({ key: "title", record: parsed }) })} (${orWhenEmpty({ text: createdAt, whenEmpty: "undated" })})`;
  if (inWindow({ tsIso: createdAt, window })) {
    return {
      fresh: true,
      sighting: { classKey: "feedback-drafts-written-and-unread", evidence, locus: "SendFeedback", tsIso: createdAt },
    };
  }
  // "Older than this window" is a claim about the draft's own date: an undated draft is unknown,
  // and one dated after the window is outside what this pass looks at.
  if (!namesAnInstant({ tsIso: createdAt })) {
    return {
      why: `feedback draft ${name} carries no readable created_at, so whether it predates this window is unknown`,
    };
  }
  if (Date.parse(createdAt) > Date.parse(window.toIso)) {
    return {};
  }
  return {
    sighting: {
      classKey: "feedback-drafts-older-than-the-window-and-unread",
      evidence,
      locus: "SendFeedback backlog",
      tsIso: window.toIso,
    },
  };
}

/**
 * Read the SendFeedback drafts — free, structured, pre-triaged friction queued locally.
 *
 * Two findings, and the second is the standing one. A draft written inside the window is a
 * fresh report. Drafts written BEFORE the window and still sitting on disk are the standing finding: they
 * were queued locally for a human to approve and nothing here approves them. What a finding says is only
 * what the files show — that a draft is still on disk — never that nothing reads it:
 * `collectAskedForMissing.ts` reads the same directory, and no file records who else did.
 *
 * COST IS 2 RATHER THAN 1, corrected against a hand-run's graded ordering. Cost 1 is reserved for
 * a fix that is a single edit; consuming a draft pile needs a consumption path BUILT, however pre-triaged
 * each draft already is. At cost 1 this class scored 15 and took the top of the brief, ranking above the
 * defect the owner ranked first.
 *
 * @param draftsDir the harness's `feedback/drafts` directory
 * @param reader the filesystem seam
 * @param window the run's bounds
 * @returns the findings, what was read, and what could not be
 */
export function collectFeedbackDrafts({
  draftsDir,
  reader,
  window,
}: {
  draftsDir: string;
  reader: SubstrateReader;
  window: ReflectWindow;
}): CollectorReading {
  const fresh: Sighting[] = [];
  const stale: Sighting[] = [];
  const residue: string[] = [];
  let rowsRead = 0;
  for (const name of reader
    .listNames(draftsDir)
    .filter((entry) => entry.endsWith(".json"))
    .toSorted((a, b) => a.localeCompare(b))) {
    const read = draftSighting({ name, text: reader.readText(join(draftsDir, name)), window });
    if (read.why !== undefined) {
      residue.push(read.why);
      continue;
    }
    if (read.sighting === undefined) {
      continue;
    }
    rowsRead += 1;
    (read.fresh === true ? fresh : stale).push(read.sighting);
  }
  return {
    findings: [
      ...foldSightings({
        cost: 2,
        describe: ({ count }) =>
          `${countOf({ count, many: "SendFeedback drafts", one: "SendFeedback draft" })} ${agreeing({ count, many: "were", one: "was" })} written in this window and ${agreeing({ count, many: "are", one: "is" })} still on disk`,
        impact: 3,
        safety: 5,
        sightings: fresh,
        source: "feedback-drafts",
      }),
      ...foldSightings({
        cost: 2,
        describe: ({ count }) =>
          `${countOf({ count, many: "SendFeedback drafts", one: "SendFeedback draft" })} older than this window ${agreeing({ count, many: "are", one: "is" })} still on disk`,
        impact: 3,
        safety: 5,
        sightings: stale,
        source: "feedback-drafts",
      }),
    ],
    residue,
    rowsRead,
    source: "feedback-drafts",
  };
}

/**
 * Fold the door's holds and overrides in the window into findings.
 *
 * A hold is the door refusing an outbound act; an override is somebody going around it. Both are the door
 * telling you something about the day. The rows come from the store's `door_event` through
 * `DoorLedgerPort.readDoorFriction`, which answers ATTRIBUTED rows only — a row from before the last proven
 * test write is `unattributable` and never reaches this fold, which is what retired the standing "poisoned
 * substrate" notice the file reader carried. A store that could not be read is a residue line, never an empty
 * reading.
 *
 * @param friction the window's held and overridden decisions, or why the store could not answer
 * @param window the run's bounds
 * @returns the findings, what was read, and anything that could not be established
 */
export function collectDoorHolds({
  friction,
  window,
}: {
  friction: Result<readonly DoorFrictionEntry[], DoorStoreError>;
  window: ReflectWindow;
}): CollectorReading {
  if (friction.isErr()) {
    return {
      findings: [],
      residue: [`the door's holds and overrides could not be read: ${friction.error.message}`],
      rowsRead: 0,
      source: "door-holds",
    };
  }
  const sightings: Sighting[] = [];
  for (const entry of friction.value) {
    const { tsIso, status, overridden } = entry;
    if (!inWindow({ tsIso, window })) {
      continue;
    }
    if (status !== "hold" && overridden.length === 0) {
      continue;
    }
    const action = orWhenEmpty({ text: entry.action, whenEmpty: "unnamed-action" });
    const detail = overridden.length > 0 ? `overridden: ${overridden.join(", ")}` : "held";
    sightings.push({
      classKey: classOr({ fallback: "door-refusal", text: `${status} ${detail}` }),
      evidence: `${action}: ${oneLine({ text: detail })}`,
      locus: `door ${action}`,
      tsIso,
    });
  }
  return {
    findings: foldSightings({
      cost: 3,
      describe: ({ count, locus, sample }) =>
        `the door held or was overridden ${countOf({ count, many: "times", one: "time" })} on ${locus}: ${oneLine({ text: sample, width: 100 })}`,
      impact: 3,
      safety: 3,
      sightings,
      source: "door-holds",
    }),
    residue: [],
    rowsRead: friction.value.length,
    source: "door-holds",
  };
}
