/**
 * THE LEDGER COLLECTORS — two of the three Tier 1 substrates that are plain append-only ledgers: the dev-gate
 * outcomes and the code-written pain points. The third, the handover run journals, is `./collectRunJournal.ts`.
 *
 * Everything the loop needs already exists on disk. Nothing read it. These read it.
 *
 * ## What is read, in tiers, and what is deliberately not
 *
 * Tier 1 is code-written and high precision. This file holds two of its six substrates; the run journals are in
 * `./collectRunJournal.ts`, the review verdicts in `./collectReview.ts` and the drafts, proof reservations and door
 * holds in `./collectArtifacts.ts`. Tier 3 — a hand-written ledger, and transcripts through phase 1's structured
 * verbs — is not read anywhere: a hand-written ledger's absence is unknown rather than clean, and a lexical
 * sweep over transcripts counts its own output as evidence, measured twice two months apart at roughly a
 * 68% over-count.
 *
 * No network call, no corpus read, and no model (AGENTS.md rule 2). This is a local pass over local files.
 *
 * ## The dials, and where they came from
 *
 * Each collector states a base `impact`, `safety` and `cost` for its class of friction, and the rank is
 * `(impact * safety) / cost`. The bases are tuned against the eight findings of a hand-run, whose
 * ordering the owner graded: recurrence beats one-off severity, not-already-covered beats covered,
 * mechanically-checkable beats judgement-shaped, and a finding that corrupts the measuring instrument
 * outranks one that merely costs time.
 */
import { countOf } from "./countPhrase.js";
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
 * Read the dev-gate ledger for the checks that keep failing.
 *
 * Grouped by check name and by the class of its summary, so eleven failures of one probe defect read as one
 * finding naming eleven occurrences rather than as eleven findings. Safety is the highest in the file
 * because a gate failure states its own post-condition: the fix either makes the check pass or it does not.
 *
 * @param ledgerPath the `dev-gate.jsonl` path
 * @param reader the filesystem seam
 * @param window the run's bounds
 * @returns the findings, what was read, and what could not be
 */
export function collectDevGateFriction({
  ledgerPath,
  reader,
  window,
}: {
  ledgerPath: string;
  reader: SubstrateReader;
  window: ReflectWindow;
}): CollectorReading {
  const text = reader.readText(ledgerPath);
  if (text === undefined) {
    return {
      findings: [],
      residue: [`${ledgerPath} is absent, so no gate outcome could be read — unknown, not clean`],
      rowsRead: 0,
      source: "dev-gate",
    };
  }
  const { records, skipped } = jsonlRecords({ text });
  const sightings: Sighting[] = records
    .filter((record) => field({ key: "status", record }) === "fail")
    .filter((record) => inWindow({ tsIso: field({ key: "tsIso", record }), window }))
    .map((record) => {
      const named = field({ key: "check", record });
      const check = named === "" ? "unnamed-check" : named;
      const summary = field({ key: "summary", record });
      return {
        classKey: classOr({ fallback: "failed-without-a-summary", text: summary }),
        evidence: `${check}: ${oneLine({ text: summary })}`,
        locus: `dev-gate ${check}`,
        tsIso: field({ key: "tsIso", record }),
      };
    });
  return {
    findings: foldSightings({
      cost: 2,
      describe: ({ count, locus, sample }) =>
        `${locus} failed ${countOf({ count, many: "times", one: "time" })}, filed by the miner under one class: ${oneLine({ text: sample, width: 100 })}`,
      impact: 3,
      safety: 5,
      sightings,
      source: "dev-gate",
    }),
    residue:
      skipped > 0
        ? [
            `${countOf({ count: skipped, many: "dev-gate lines", one: "dev-gate line" })} did not decode, so that many gate outcomes are invisible`,
          ]
        : [],
    rowsRead: records.length,
    source: "dev-gate",
  };
}

/**
 * Read the pain-point ledger — the friction the door counted rather than felt and forgot.
 *
 * The most trustworthy count in the file, because nothing has to remember to write it: the as-me shell
 * appends whenever a configured voice rule matches, with no agent turn in the loop to skip it.
 *
 * @param ledgerPath the `pain-points.jsonl` path
 * @param reader the filesystem seam
 * @param window the run's bounds
 * @returns the findings, what was read, and what could not be
 */
export function collectPainPointFriction({
  ledgerPath,
  reader,
  window,
}: {
  ledgerPath: string;
  reader: SubstrateReader;
  window: ReflectWindow;
}): CollectorReading {
  const text = reader.readText(ledgerPath);
  if (text === undefined) {
    return {
      findings: [],
      residue: [`${ledgerPath} is absent, so no composition friction could be counted — unknown, not clean`],
      rowsRead: 0,
      source: "pain-points",
    };
  }
  const { records, skipped } = jsonlRecords({ text });
  const sightings: Sighting[] = records
    .filter((record) => inWindow({ tsIso: field({ key: "tsIso", record }), window }))
    .map((record) => {
      const reason = field({ key: "reason", record });
      const named = field({ key: "lane", record });
      const lane = named === "" ? "unnamed-lane" : named;
      return {
        classKey: classOr({ fallback: "pain-point-without-a-reason", text: reason }),
        evidence: `${lane} ${field({ key: "fieldPath", record })}: ${oneLine({ text: reason })}`,
        locus: `compose ${lane}`,
        tsIso: field({ key: "tsIso", record }),
      };
    });
  return {
    findings: foldSightings({
      cost: 2,
      describe: ({ count, locus, sample }) =>
        `${locus} tripped a composition rule ${countOf({ count, many: "times", one: "time" })}, filed by the miner under one class: ${oneLine({ text: sample, width: 100 })}`,
      impact: 2,
      safety: 4,
      sightings,
      source: "pain-points",
    }),
    residue:
      skipped > 0
        ? [
            `${countOf({ count: skipped, many: "pain-point lines", one: "pain-point line" })} did not decode, so that many are invisible to this pass`,
          ]
        : [],
    rowsRead: records.length,
    source: "pain-points",
  };
}
