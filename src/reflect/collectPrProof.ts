/**
 * THE PR-PROOF COLLECTOR — the per-PR proof reservations, read for pull requests the fleet touched below gold and for
 * reservations nothing ever confirmed. Its sibling artifact collectors are in `./collectArtifacts.ts`; which pull
 * request a record is about is `./prIdentity.ts`.
 *
 * Pure folds over the injected seam; no model, no network.
 */
import { join } from "node:path";

import { isOneOf, isRecord } from "../lib/parsers.js";
import { agreeing, countOf } from "./countPhrase.js";
import type { FrictionFinding } from "./finding.js";
import {
  groupByIdentity,
  latestReading,
  type PrEntry,
  type PrReading,
  prIdentity,
  unprovenDistinct,
} from "./prIdentity.js";
import {
  type CollectorReading,
  field,
  foldSightings,
  inWindow,
  oneLine,
  type ReflectWindow,
  type Sighting,
  type SubstrateReader,
} from "./substrate.js";

/**
 * The class of a reading-order form no reviewer has graded yet. It carries neither grade prefix, so no recorded
 * grade string — `unreviewed` included — can produce it.
 */
const NO_REVIEW_CLASS = "review-not-recorded";

/** The class of a recorded grade outside {@link RECORDED_GRADES}, which no sentence can safely interpolate. */
const UNRECOGNISED_GRADE_CLASS = "grade-not-recognised";

/**
 * The grades a retired description recorded (its review and its older proof form shared them). A C3 description
 * publishes no grade at all. The collector reads raw JSON, so a grade outside these is malformed rather than a grade
 * (a lone comma, for one).
 */
const RECORDED_GRADES: readonly string[] = ["gold", "silver", "bronze", "unproven"];

/** The instant a record is about: its confirmation, else its reservation. */
function recordStamp({ record }: { record: Readonly<Record<string, unknown>> }): string {
  const confirmedIso = field({ key: "confirmedIso", record });
  if (confirmedIso.length > 0) {
    return confirmedIso;
  }
  return field({ key: "reservedIso", record });
}

/** What one PR reservation says about the day, if anything. */
function prSighting({
  record,
  name,
  window,
}: {
  record: Readonly<Record<string, unknown>>;
  name: string;
  window: ReflectWindow;
}): PrReading {
  const reservedIso = field({ key: "reservedIso", record });
  const confirmedIso = field({ key: "confirmedIso", record });
  const stamp = recordStamp({ record });
  if (!inWindow({ tsIso: stamp, window })) {
    return {};
  }
  const locus = recordLabel({ name, record });
  if (confirmedIso.length === 0) {
    const reserved = reservedIso === "" ? "at an unrecorded time" : reservedIso;
    return {
      stranded: {
        classKey: "reserved-but-never-confirmed",
        evidence: `${locus}: reserved ${reserved} and not confirmed by the time the window closed`,
        locus: "github pr reservation",
        tsIso: stamp,
      },
    };
  }
  const form = record["form"];
  const graded = isRecord(form) ? recordedGrade({ form }) : undefined;
  if (graded === undefined) {
    return {};
  }
  return {
    grade: {
      classKey: graded.classKey,
      evidence: `${locus}: ${graded.said}`,
      locus: `github pr ${graded.noun}`,
      tsIso: stamp,
    },
    gradeSaid: graded.said,
  };
}

/** A record's label: its locus, else its file name. */
function recordLabel({ name, record }: { name: string; record: Readonly<Record<string, unknown>> }): string {
  const locus = field({ key: "locus", record });
  if (locus.length > 0) {
    return locus;
  }
  return name;
}

/**
 * The below-gold class a confirmed record's form carries, read in whichever shape the record was written.
 *
 * A record written before the reading-order description carries `form.proof.grade`, the author's own grade. A
 * record written since carries `form.review.grade`, a reviewer's. A form with no review yet carries NO grade: the
 * solved badge shows `unproven` for one (`outbound/github/derive.ts`), but `unproven` is also a grade a reviewer
 * records, so the two stay apart here as {@link NO_REVIEW_CLASS} — a sentence saying a pull request "is graded"
 * needs a grade somebody gave.
 *
 * A C3 form (it carries an `explainer`) publishes no grade, so it yields no finding: the reader reports no
 * published grade and never infers one.
 *
 * @returns the class, its noun and evidence words, or `undefined` for gold, a C3 form, or a proof form with no grade
 */
function recordedGrade({
  form,
}: {
  form: Readonly<Record<string, unknown>>;
}): { readonly classKey: string; readonly noun: string; readonly said: string } | undefined {
  if (form["explainer"] !== undefined) {
    return undefined;
  }
  // A reviewer's grade outranks the author's own: a form carrying both is judged by its review.
  // A grade that is PRESENT is read raw: a number or an empty string is a grade this reader does not
  // recognise, never "no review recorded yet" and never silently no finding.
  const review = form["review"];
  if (isRecord(review) && review["grade"] !== undefined) {
    return belowGold({ classPrefix: "solved-", grade: review["grade"], noun: "review" });
  }
  const proof = form["proof"];
  if (isRecord(proof)) {
    if (proof["grade"] === undefined) {
      return undefined;
    }
    return belowGold({ classPrefix: "proof-graded-", grade: proof["grade"], noun: "proof" });
  }
  return { classKey: NO_REVIEW_CLASS, noun: "review", said: "no review recorded yet" };
}

/** A recorded grade, read raw, as its below-gold class: `undefined` for gold, its own class for one not recognised. */
function belowGold({
  classPrefix,
  grade,
  noun,
}: {
  classPrefix: string;
  grade: unknown;
  noun: string;
}): { readonly classKey: string; readonly noun: string; readonly said: string } | undefined {
  if (typeof grade !== "string" || !isOneOf(grade, RECORDED_GRADES)) {
    return {
      classKey: UNRECOGNISED_GRADE_CLASS,
      noun,
      said: `${noun} grade ${JSON.stringify(grade)} is not one this reader knows`,
    };
  }
  if (grade === "gold") {
    return undefined;
  }
  return { classKey: `${classPrefix}${grade}`, noun, said: `${noun} graded ${grade}` };
}

/**
 * The cost a below-gold class states: a grade somebody gave, or the absence of any review.
 *
 * An unrecognised grade states none: "whether it is proven is unknown" is a status, not a cost to
 * the owner or the fleet, so the finding is held in the backlog rather than put in front of the owner to grade.
 *
 * @param classKey the class, `solved-<grade>`, `proof-graded-<grade>`, {@link NO_REVIEW_CLASS} or
 *   {@link UNRECOGNISED_GRADE_CLASS}
 * @param count how many pull requests the class holds
 * @returns the sentence the finding opens on, or `undefined` for an unrecognised grade
 */
function belowGoldConsequence({ classKey, count }: { classKey: string; count: number }): string | undefined {
  if (classKey === UNRECOGNISED_GRADE_CLASS) {
    return undefined;
  }
  const grade = gradeOfClassKey({ classKey });
  const prs = `${countOf({ count, many: "pull requests", one: "pull request" })} the fleet touched in this window`;
  const owes = `${agreeing({ count, many: "each still owes", one: "it still owes" })} proof that it works end to end`;
  if (classKey === NO_REVIEW_CLASS) {
    return `${prs} ${agreeing({ count, many: "have", one: "has" })} no review grade yet, so ${owes}`;
  }
  return `${prs} ${agreeing({ count, many: "are", one: "is" })} graded ${grade}, not gold, so ${owes}`;
}

/** The grade a below-gold class key names: `solved-unproven` reads `unproven`, `proof-graded-silver` `silver`. */
function gradeOfClassKey({ classKey }: { classKey: string }): string {
  for (const prefix of ["proof-graded-", "solved-"]) {
    if (classKey.startsWith(prefix)) {
      return classKey.slice(prefix.length);
    }
  }
  return classKey;
}

/**
 * Fold the two PR-reservation sighting buckets into findings.
 *
 * @param grades pull requests the fleet touched below gold
 * @param stranded reservations nothing ever confirmed
 * @returns the findings, in the order a brief prints them
 */
function proofFindings({
  grades,
  stranded,
}: {
  grades: readonly Sighting[];
  stranded: readonly Sighting[];
}): readonly FrictionFinding[] {
  return [
    ...foldSightings({
      // `confirmedIso` is re-stamped by every description write (`performWrite.ts`), a create or an update, AND by
      // an identity backfill that writes no description at all (`prLedger.ts`'s `backfillPrIdentity`), and says nothing of a merge: so the record supports "the fleet touched it in this window", never
      // "written", "opened" or "landed".
      consequence: ({ classKey, count }) => belowGoldConsequence({ classKey, count }),
      cost: 3,
      // An unrecognised grade owes nothing provable: its line says what it is, never "gold is owed".
      describe: ({ classKey, count, sample }) => {
        const prs = `${countOf({ count, many: "pull requests", one: "pull request" })} the fleet touched in this window`;
        if (classKey === UNRECOGNISED_GRADE_CLASS) {
          return `${prs} ${agreeing({ count, many: "carry", one: "carries" })} a grade this reader does not recognise: ${oneLine({ text: sample, width: 90 })}`;
        }
        return `${prs} ${agreeing({ count, many: "have", one: "has" })} no gold grade, so gold is still owed: ${oneLine({ text: sample, width: 90 })}`;
      },
      impact: 2,
      safety: 4,
      sightings: grades,
      source: "pr-proof",
    }),
    ...foldSightings({
      cost: 2,
      describe: ({ count }) =>
        `${countOf({ count, many: "pull request reservations", one: "pull request reservation" })} ${agreeing({ count, many: "were", one: "was" })} made in this window and not confirmed by the time it closed`,
      impact: 2,
      safety: 4,
      sightings: stranded,
      source: "pr-proof",
    }),
  ];
}

/** What one reservation file contributed: an entry, a residue line, or nothing; and whether it decoded at all. */
interface FileRead {
  readonly entry?: PrEntry;
  readonly residue?: string;
  readonly unidentified?: string;
  readonly decoded: boolean;
}

/**
 * One reservation file as an entry.
 *
 * A grade counts PULL REQUESTS, and only GitHub's identity says which one: a graded record with
 * neither node id nor number may be a retargeted copy of another, so its grade is not counted as a distinct one. It
 * still joins its group with the grade withheld: its confirmation is real and settles the reservations
 * before it, while the grade it carries is what the residue line says is not counted.
 */
function readReservation({
  name,
  text,
  window,
}: {
  name: string;
  text: string | undefined;
  window: ReflectWindow;
}): FileRead {
  if (text === undefined) {
    return { decoded: false };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { decoded: false, residue: `PR reservation ${name} is not valid JSON` };
  }
  if (!isRecord(parsed)) {
    return { decoded: false };
  }
  const stamp = recordStamp({ record: parsed });
  if (!inWindow({ tsIso: stamp, window })) {
    return { decoded: true };
  }
  const sighted = prSighting({ name, record: parsed, window });
  const identity = prIdentity({ name, record: parsed });
  const label = recordLabel({ name, record: parsed });
  const withheld = sighted.grade !== undefined && !identity.github;
  const { grade: _withheld, ...ungraded } = sighted;
  const read = withheld ? ungraded : sighted;
  return {
    decoded: true,
    entry: { keys: identity.keys, label, read, stampMs: Date.parse(stamp) },
    ...(withheld ? { unidentified: label } : {}),
  };
}

/**
 * The could-not-verify lines for pull requests no count includes: graded records with no GitHub identity, groups
 * whose identities do not establish how many pull requests they are, and pull requests whose latest records disagree.
 */
function uncountedResidue({
  latest,
  unidentified,
}: {
  latest: readonly ReturnType<typeof latestReading>[];
  unidentified: readonly string[];
}): readonly string[] {
  const residue: string[] = [];
  if (unidentified.length > 0) {
    residue.push(
      `${countOf({ count: unidentified.length, many: "graded pull request records", one: "graded pull request record" })} carried no GitHub node id and no valid pull request number, so which pull request ${agreeing({ count: unidentified.length, many: "each names", one: "it names" })} is unknown and ${agreeing({ count: unidentified.length, many: "their grades are", one: "its grade is" })} not counted: ${unidentified.join(", ")}`,
    );
  }
  const ambiguous = latest.filter((held) => held.ambiguous);
  if (ambiguous.length > 0) {
    // Never fewer than two records: one record carries at most one node id and one number.
    const records = ambiguous.reduce((total, held) => total + held.records, 0);
    residue.push(
      `${String(records)} pull request records carry GitHub identities that do not establish how many pull requests they are (two node ids, two numbers, or a node id and a number no one record ties together), so none is counted: ${ambiguous.flatMap(({ labels }) => labels).join(", ")}`,
    );
  }
  const conflicted = latest.filter((held) => held.conflicted && !held.ambiguous).map(({ label }) => label);
  if (conflicted.length > 0) {
    residue.push(
      `${countOf({ count: conflicted.length, many: "pull requests", one: "pull request" })} carried two records at the same instant that disagree, so ${agreeing({ count: conflicted.length, many: "their state is", one: "its state is" })} unknown and not counted: ${conflicted.join(", ")}`,
    );
  }
  return residue;
}

/**
 * Read the per-PR reservations for proof grades and for reservations nothing ever confirmed.
 *
 * A `silver` or `bronze` grade is not a defect — doctrine allows one when gold genuinely was not feasible —
 * so the finding is the PATTERN: the same repository landing below gold repeatedly is gold OWED
 * accumulating, which is worth naming once rather than blocking on. A reservation with no confirmation is
 * the other half: a PR the door reserved and nothing finished.
 *
 * One reading per pull request, the latest: a consequence counts PULL REQUESTS, so a second record
 * naming the same pull request — a stray copy, a retargeted base — is never a second one. Two records equally latest
 * that DISAGREE leave its state unknown, counted under could-not-verify rather than as a grade.
 *
 * @param prsDir the `ledgers/github-prs` directory
 * @param reader the filesystem seam
 * @param window the run's bounds
 * @returns the findings, what was read, and what could not be
 */
export function collectPrProofFriction({
  prsDir,
  reader,
  window,
}: {
  prsDir: string;
  reader: SubstrateReader;
  window: ReflectWindow;
}): CollectorReading {
  const names = reader
    .listNames(prsDir)
    .filter((entry) => entry.endsWith(".json"))
    .toSorted((a, b) => a.localeCompare(b));
  const reads = names.map((name) => readReservation({ name, text: reader.readText(join(prsDir, name)), window }));
  const groups = groupByIdentity({ entries: reads.flatMap(({ entry }) => (entry === undefined ? [] : [entry])) });
  const unproven = unprovenDistinct({ groups });
  const latest = groups.map((group, index) => {
    const reading = latestReading({ group });
    return { ...reading, ambiguous: reading.ambiguous || unproven.has(index) };
  });
  const unidentified = reads.flatMap((read) => (read.unidentified === undefined ? [] : [read.unidentified]));
  const counted = latest.filter((held) => !held.conflicted && !held.ambiguous);
  return {
    findings: proofFindings({
      grades: counted.flatMap(({ read }) => (read.grade === undefined ? [] : [read.grade])),
      stranded: counted.flatMap(({ unconfirmed }) => unconfirmed),
    }),
    residue: [
      ...reads.flatMap(({ residue }) => (residue === undefined ? [] : [residue])),
      ...uncountedResidue({ latest, unidentified }),
    ],
    rowsRead: reads.filter(({ decoded }) => decoded).length,
    source: "pr-proof",
  };
}
