/**
 * THE ASKED-FOR-AND-MISSING COLLECTOR — find every instance over
 * the window where the owner asked for something and a session reported that it did not exist, or wrongly reported
 * that it did not exist. Examples: editing a Slack message as the owner; adding images when posting to
 * Slack as the owner. These are candidates for weekend work precisely because each one names its own fix.
 *
 * ## What is mechanical here, and what deliberately is not
 *
 * No model runs in this program (AGENTS.md rule 2), so the two heuristic buckets in
 * {@link ./askedForMissingHeuristics.ts} answer "did a session
 * report a gap" the same blunt way {@link classKeyOf}'s header answers "is this the same kind of friction": a
 * fixed, lowercase substring match against {@link ./askedForMissingHeuristics.ABSENCE_MARKERS}.
 * The set is not a taxonomy and it earns
 * its place the same way {@link NAMED_FRICTION_CLASSES} does — by a measurement over this fleet's own words,
 * reproducible with:
 *
 * ```
 * python3 -c "
 * import json
 * markers = ['trap:','does not exist',\"doesn't exist\",'no such','not supported',\"isn't supported\",
 *   'no way to','no flag','no verb','not implemented',\"hasn't been built\",'has not been built',
 *   \"isn't wired\",'not wired','missing capability','not available']
 * n = tot = 0
 * for line in open('$HOME/.slopweaver/sessions/sessions.jsonl'):
 *   d = json.loads(line) if line.strip() else None
 *   if not d or d.get('kind') != 'noted': continue
 *   tot += 1
 *   n += any(m in d['note'].lower() for m in markers)
 * print(n, 'of', tot)
 * "
 * ```
 *
 * Measured: 10 of 589 `noted` events and 9 of 388 run-journal `question`/`answered` events
 * matched — a small, plausible share rather than everything or nothing.
 *
 * Five structured substrates carry this signal today, in three confidence tiers (see the dials in
 * {@link collectAskedForMissing}):
 *
 * 1. **`ledgers/loop-breakage.jsonl`** — the owner's own named source, and the best one: every row is
 *    ALREADY an agent's own curated report of one thing it asked the system to do that broke, with `what` it
 *    tried, `error` what the system said back, and (81 of 110 rows, measured) `didInstead` — the
 *    workaround the owner's examples name. Nothing filters this bucket by
 *    {@link ./askedForMissingHeuristics.ABSENCE_MARKERS}: the
 *    whole ledger already is this collector's subject, the same way `collectPainPointFriction`'s ledger needs
 *    no filter because every row it holds is already a tripped voice rule.
 *    Its older rows were hand-appended by a `printf >>` rather than
 *    written by one typed verb — `python3 -c "import json; [json.loads(l) for l in
 *    open('$HOME/.slopweaver/ledgers/loop-breakage.jsonl')]"` measured 7 of 117 lines failing to decode
 *    — and new rows come from one writer (`live/turn/loopBreakage.ts`, `slopweaver turn breakage`) and
 *    carry a required `cause` this collector does not need. The old rows stay as they are, so a bad line is
 *    still counted into residue rather than dropped, exactly as `collectRunJournalFriction` treats one.
 * 2. **SendFeedback drafts of `type: "missing_capability"`** — the exact, zero-ambiguity typed case; the tool
 *    itself is where a session is told to file one when a missing capability blocked a reasonable request.
 * 3. **The supervisor's own session ledger** (`sessions/sessions.jsonl`, `noted` events) — where a session
 *    reports a trap or a gap it found, in its own words, for whoever reads the fleet next.
 * 4. **The handover run journals' `question`/`answered` events** — a run's blocking question to the owner
 *    often names the missing thing directly (measured case: "there is no notion write verb on…").
 * 5. **The owner's active directives in the store** (`owner_directive`, read by the verb through the owner-judgement
 *    port and handed in) — a standing ruling is sometimes written BECAUSE a capability
 *    turned out not to exist, and its `text` is short and capped, so the same marker set costs nothing extra
 *    to run over it.
 *
 * One source the owner's own ruling named is deliberately NOT read here, and
 * {@link ASKED_FOR_MISSING_UNREAD_NOTICE} says so in the residue every run rather than silently doing less
 * than asked: the `~/.slopweaver/morning/*.md` reports and the fleet briefing are free prose (the briefing is
 * a rendered HTML artifact, never persisted as data) rather than something a `jq` one-liner can read, and
 * `collect.ts`'s own header already rules out a lexical sweep over transcript-shaped prose for this package —
 * a measured 68% over-count on the same kind of sweep, two months apart, is why Tier 3 substrates are not
 * read anywhere here. `loop-breakage.jsonl` is the one exception the owner's own ruling earns: unlike a
 * transcript, every row in it is already a bounded, single-incident record rather than free-running prose.
 *
 * Pure reads through the injected seam; no model, no network.
 */
import { join } from "node:path";

import { isRecord } from "../lib/parsers.js";
import {
  ownerDirectiveSightings,
  type ReflectOwnerJudgement,
  runJournalAskSightings,
  sessionNoteSightings,
} from "./askedForMissingHeuristics.js";
import { countOf } from "./countPhrase.js";
import type { FrictionFinding } from "./finding.js";
import {
  type CollectorReading,
  classOr,
  field,
  foldSightings,
  inWindow,
  jsonlRecords,
  oneLine,
  type ReflectWindow,
  type Sighting,
  type SubstrateReader,
} from "./substrate.js";

/**
 * Read `ledgers/loop-breakage.jsonl` — every row already the subject of this collector, so nothing here
 * filters by {@link ./askedForMissingHeuristics.ABSENCE_MARKERS}. See the module header for why this hand-written ledger is read at all,
 * against `collect.ts`'s own standing rule that a hand-written ledger is not.
 *
 * @param ledgerPath the `ledgers/loop-breakage.jsonl` path
 * @param reader the filesystem seam
 * @param window the run's bounds
 * @returns the sightings, and how many rows decoded
 */
function loopBreakageSightings({
  ledgerPath,
  reader,
  window,
}: {
  ledgerPath: string;
  reader: SubstrateReader;
  window: ReflectWindow;
}): { readonly sightings: readonly Sighting[]; readonly rowsRead: number; readonly residue: readonly string[] } {
  const text = reader.readText(ledgerPath);
  if (text === undefined) {
    return { residue: [], rowsRead: 0, sightings: [] };
  }
  const { records, skipped } = jsonlRecords({ text });
  const sightings: Sighting[] = [];
  for (const record of records) {
    const tsIso = field({ key: "at", record });
    if (!inWindow({ tsIso, window })) {
      continue;
    }
    const what = field({ key: "what", record });
    const error = field({ key: "error", record });
    const didInstead = field({ key: "didInstead", record });
    const evidence = [
      what,
      error.length > 0 ? `→ ${error}` : "",
      didInstead.length > 0 ? `did instead: ${didInstead}` : "",
    ]
      .filter((part) => part.length > 0)
      .join(" ");
    sightings.push({
      classKey: classOr({ fallback: "loop-breakage-without-a-reason", text: `${what} ${error}` }),
      evidence: oneLine({ text: evidence, width: 180 }),
      locus: "loop-breakage",
      tsIso,
    });
  }
  return {
    residue:
      skipped > 0
        ? [
            `${countOf({ count: skipped, many: "loop-breakage lines", one: "loop-breakage line" })} did not decode, so that many are invisible`,
          ]
        : [],
    rowsRead: records.length,
    sightings,
  };
}

/**
 * Read the SendFeedback drafts filed as `missing_capability` — the exact, structured case.
 *
 * Deliberately re-reads the same directory `collectFeedbackDrafts` reads: that collector folds every draft
 * type into one "unread pile" finding, which is the right shape for its own question ("is anything
 * consuming this queue at all"). This is a different question — "did the owner ask for something a session
 * had to tell the owner does not exist" — so a `missing_capability` draft is evidence for both, read twice rather
 * than threaded through a shared cache that would couple two unrelated collectors' output shapes.
 *
 * @param draftsDir the harness's `feedback/drafts` directory
 * @param reader the filesystem seam
 * @param window the run's bounds
 * @returns the sightings, and what could not be read
 */
function missingCapabilitySightings({
  draftsDir,
  reader,
  window,
}: {
  draftsDir: string;
  reader: SubstrateReader;
  window: ReflectWindow;
}): { readonly sightings: readonly Sighting[]; readonly residue: readonly string[] } {
  const sightings: Sighting[] = [];
  const residue: string[] = [];
  for (const name of reader
    .listNames(draftsDir)
    .filter((entry) => entry.endsWith(".json"))
    .toSorted((a, b) => a.localeCompare(b))) {
    const text = reader.readText(join(draftsDir, name));
    if (text === undefined) {
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      residue.push(`feedback draft ${name} is not valid JSON, so it is invisible to the asked-for-missing pass`);
      continue;
    }
    if (!isRecord(parsed) || field({ key: "type", record: parsed }) !== "missing_capability") {
      continue;
    }
    const createdAt = field({ key: "created_at", record: parsed });
    if (!inWindow({ tsIso: createdAt, window })) {
      continue;
    }
    const title = field({ key: "title", record: parsed });
    sightings.push({
      classKey: classOr({ fallback: "missing-capability-draft-without-a-title", text: title }),
      evidence: `SendFeedback missing_capability: ${oneLine({ text: title })}`,
      locus: "SendFeedback missing_capability",
      tsIso: createdAt,
    });
  }
  return { residue, sightings };
}

/** The standing notice about the one named source this collector does not read. See the module header. */
export const ASKED_FOR_MISSING_UNREAD_NOTICE =
  "the morning-report and fleet-briefing history are not read here — both are free prose (the briefing is a rendered HTML artifact, never persisted as data) and this package does not run a lexical sweep over transcript-shaped text (see collect.ts's own header for the measured over-count that rules it out)";

/**
 * Fold every bucket's sightings into findings, in three confidence tiers.
 *
 * `loop-breakage.jsonl` and a `missing_capability` draft are both curated-at-source — an agent or the tool
 * itself already decided the row belongs here — while `heuristic` (session notes, run-journal asks, owner
 * directives, pooled) is the same blunt substring match that classified them into this collector at all (see
 * the module header for what that costs in precision: 10 of 589, 9 of 388, both plausible rather than
 * certain).
 *
 * @param breakage the loop-breakage sightings
 * @param drafts the `missing_capability` draft sightings
 * @param heuristic the session-note, run-journal and owner-directive sightings, pooled
 * @returns the findings, most-confident tier first
 */
function askedForMissingFindings({
  breakage,
  drafts,
  heuristic,
}: {
  breakage: readonly Sighting[];
  drafts: readonly Sighting[];
  heuristic: readonly Sighting[];
}): readonly FrictionFinding[] {
  const describe = ({ count, locus, sample }: { count: number; locus: string; sample: string }): string =>
    `${countOf({ count, many: "times", one: "time" })} an owner ask was reported as missing (${locus}): ${oneLine({ text: sample, width: 100 })}`;
  return [
    ...foldSightings({ cost: 3, describe, impact: 4, safety: 5, sightings: breakage, source: "asked-for-missing" }),
    ...foldSightings({ cost: 3, describe, impact: 4, safety: 5, sightings: drafts, source: "asked-for-missing" }),
    ...foldSightings({ cost: 3, describe, impact: 4, safety: 3, sightings: heuristic, source: "asked-for-missing" }),
  ];
}

/**
 * Read every structured substrate for an owner ask a session reported as missing.
 *
 * @param loopBreakageLedger the `ledgers/loop-breakage.jsonl` path
 * @param feedbackDraftsDir the harness's `feedback/drafts` directory
 * @param sessionLogPath the `sessions/sessions.jsonl` path
 * @param runsDir the directory of `<slug>.jsonl` run journals
 * @param ownerJudgement the owner's active directives as read from the store, or why they could not be
 * @param reader the filesystem seam
 * @param window the run's bounds
 * @returns the findings, what was read, and what could not be
 */
export function collectAskedForMissing({
  loopBreakageLedger,
  feedbackDraftsDir,
  sessionLogPath,
  runsDir,
  ownerJudgement,
  reader,
  window,
}: {
  loopBreakageLedger: string;
  feedbackDraftsDir: string;
  sessionLogPath: string;
  runsDir: string;
  ownerJudgement: ReflectOwnerJudgement;
  reader: SubstrateReader;
  window: ReflectWindow;
}): CollectorReading {
  const breakage = loopBreakageSightings({ ledgerPath: loopBreakageLedger, reader, window });
  const drafts = missingCapabilitySightings({ draftsDir: feedbackDraftsDir, reader, window });
  const sessionNotes = sessionNoteSightings({ reader, sessionLogPath, window });
  const runJournal = runJournalAskSightings({ reader, runsDir, window });
  const directives = ownerDirectiveSightings({ ownerJudgement, window });
  return {
    findings: askedForMissingFindings({
      breakage: breakage.sightings,
      drafts: drafts.sightings,
      heuristic: [...sessionNotes.sightings, ...runJournal.sightings, ...directives.sightings],
    }),
    residue: [
      ASKED_FOR_MISSING_UNREAD_NOTICE,
      ...breakage.residue,
      ...drafts.residue,
      ...sessionNotes.residue,
      ...directives.residue,
    ],
    rowsRead: breakage.rowsRead + sessionNotes.rowsRead + runJournal.rowsRead,
    source: "asked-for-missing",
  };
}
