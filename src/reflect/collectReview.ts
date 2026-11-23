/**
 * THE REVIEW-VERDICT COLLECTOR — a substrate the owner named by name.
 *
 * The owner's hypothesis: review rounds are finding the SAME issues repeatedly, because if one
 * spawned session gets a thing wrong another is likely to get the same thing wrong. So mine the verdicts
 * across asks for repeated claim classes, and propose the fix that removes the class — a packet check, a
 * composition rule — rather than another round. The measured case behind it: one ask ran five rounds over
 * two hours, and the door refused the post for a missing asker mention AFTER two rounds that never checked
 * for one.
 *
 * That sits directly under two of the owner's three north-star metrics: mean time to respond
 * decreasing, and correctness not decreasing at all. An extra review round costs the first and buys
 * nothing on the second when the round is re-finding what the last one found.
 *
 * Pure reads through the injected seam; no model, no network.
 */
import { join } from "node:path";

import { absentAs } from "#lib/absent.js";
import { isRecord } from "../lib/parsers.js";
import { agreeing, countOf } from "./countPhrase.js";
import type { FrictionFinding } from "./finding.js";
import {
  type CollectorReading,
  classOr,
  field,
  foldSightings,
  inWindow,
  oneLine,
  type ReflectWindow,
  type Sighting,
  type SubstrateReader,
} from "./substrate.js";

/**
 * Rounds at which an ask is an outlier rather than an ordinary two-pass review.
 *
 * @internal
 */
export const REVIEW_ROUND_LIMIT = 3;

/** The claim and outcome fields this pass reads off a verdict file, tolerant of anything else it carries. */
interface VerdictReading {
  readonly atIso: string;
  readonly outcome: string;
  readonly claims: readonly { readonly text: string; readonly support: string; readonly impact: string }[];
}

/** Rebuild the instant a superseded verdict was written from its filename, which is where it is recorded. */
function verdictIsoFromName({ name }: { name: string }): string | undefined {
  const match = /(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z/.exec(name);
  if (match === null) {
    return undefined;
  }
  return `${match[1]!}T${match[2]!}:${match[3]!}:${match[4]!}.${match[5]!}Z`;
}

/** Decode one verdict file into the two fields this pass reads. */
function readVerdict({ text, atIso }: { text: string; atIso: string }): VerdictReading | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!isRecord(parsed) || !Array.isArray(parsed["claims"])) {
    return undefined;
  }
  const claims = parsed["claims"].flatMap((claim: unknown) =>
    isRecord(claim) && typeof claim["text"] === "string"
      ? [
          {
            impact: field({ key: "impact", record: claim }),
            support: field({ key: "support", record: claim }),
            text: claim["text"],
          },
        ]
      : [],
  );
  return { atIso, claims, outcome: field({ key: "outcome", record: parsed }) };
}

/** Every verdict file in one ask's directory, oldest first, with the instant each was written. */
function askVerdicts({ askDir, reader }: { askDir: string; reader: SubstrateReader }): readonly VerdictReading[] {
  const recordText = reader.readText(join(askDir, "record.json"));
  let spawnedAt = "";
  if (recordText !== undefined) {
    try {
      const record: unknown = JSON.parse(recordText);
      spawnedAt = isRecord(record) ? field({ key: "spawnedAt", record }) : "";
    } catch {
      spawnedAt = "";
    }
  }
  return reader
    .listNames(askDir)
    .filter((name) => name.startsWith("verdict") && name.endsWith(".json"))
    .flatMap((name) => {
      const text = reader.readText(join(askDir, name));
      if (text === undefined) {
        return [];
      }
      const verdict = readVerdict({
        atIso: absentAs({ value: verdictIsoFromName({ name }), whenAbsent: spawnedAt }),
        text,
      });
      return verdict === undefined ? [] : [verdict];
    })
    .toSorted((a, b) => a.atIso.localeCompare(b.atIso));
}

/** What one ask contributed, before anything is folded across asks. */
interface AskReading {
  readonly late: readonly Sighting[];
  readonly rounds: readonly Sighting[];
  /** Class key to the unresolved claim text, for the across-asks tally. */
  readonly unresolved: readonly { readonly classKey: string; readonly text: string; readonly atIso: string }[];
}

/** The classes an ask's FIRST verdict already checked, so a later one can be told apart from a repeat. */
function firstRoundClasses({ verdict }: { verdict: VerdictReading }): ReadonlySet<string> {
  return new Set(verdict.claims.map((claim) => classOr({ fallback: "claim-with-no-words", text: claim.text })));
}

/** The sample a claim class keeps. Its first unresolved claim meets no sample before it, so its words become one. */
function classSample({
  prior,
  claim,
}: {
  prior: { readonly sample: string } | undefined;
  claim: { readonly text: string };
}): string {
  if (prior === undefined) {
    return claim.text;
  }
  return prior.sample;
}

/**
 * Mine one ask's verdicts. Pure — the reading is supplied.
 *
 * @param ask the ask directory's name, which every evidence line points at
 * @param verdicts its verdicts, oldest first, already filtered to the window
 * @returns the late checks, the round outlier, and the unresolved claims for the across-asks tally
 */
function askReading({ ask, verdicts }: { ask: string; verdicts: readonly VerdictReading[] }): AskReading {
  const last = verdicts[verdicts.length - 1]!;
  const lastOutcome = last.outcome === "" ? "unrecorded" : last.outcome;
  // `last.outcome` was just read, so the list is not empty and its first verdict is there too.
  const first = firstRoundClasses({ verdict: verdicts[0]! });
  const late: Sighting[] = [];
  const unresolved: { classKey: string; text: string; atIso: string }[] = [];
  for (const claim of last.claims) {
    const classKey = classOr({ fallback: "claim-with-no-words", text: claim.text });
    if (verdicts.length >= 2 && !first.has(classKey)) {
      // ONE class, deliberately, rather than one per claim. The finding is structural — the packet did not
      // carry this check in round one — and the fix that removes it is a packet check, not a fix for
      // whichever sentence happened to surface it. Keyed per claim, this collector emitted 32 candidates in
      // a single 24h window and spent its whole share of the cap restating one defect.
      late.push({
        classKey: "a-check-first-performed-in-a-late-review-round",
        evidence: `${ask} round ${String(verdicts.length)}: "${oneLine({ text: claim.text, width: 90 })}"`,
        locus: "turn review packet",
        tsIso: last.atIso,
      });
    }
  }
  for (const verdict of verdicts) {
    for (const claim of verdict.claims) {
      if (claim.support !== "supported") {
        unresolved.push({
          atIso: verdict.atIso,
          classKey: classOr({ fallback: "claim-with-no-words", text: claim.text }),
          text: claim.text,
        });
      }
    }
  }
  return {
    late,
    rounds:
      verdicts.length >= REVIEW_ROUND_LIMIT
        ? [
            {
              classKey: "review-rounds-repeat-on-one-ask",
              evidence: `${ask}: ${String(verdicts.length)} rounds, last outcome ${lastOutcome}`,
              locus: "turn review rounds",
              tsIso: last.atIso,
            },
          ]
        : [],
    unresolved,
  };
}

/**
 * Fold what every ask contributed into the three findings this collector reports.
 *
 * @param readings one entry per ask that had a verdict inside the window
 * @param repeated the across-asks tally of unresolved claim classes
 * @returns the findings, in the order a brief prints them
 */
function reviewFindings({
  readings,
  repeated,
}: {
  readings: readonly { readonly ask: string; readonly reading: AskReading }[];
  repeated: readonly Sighting[];
}): readonly FrictionFinding[] {
  return [
    ...foldSightings({
      cost: 2,
      describe: ({ count }) =>
        `${countOf({ count, many: "review checks", one: "review check" })} ${agreeing({ count, many: "were", one: "was" })} first performed in a later review round rather than in round one — ${agreeing({ count, many: "each is a check", one: "a check" })} the packet does not carry`,
      impact: 4,
      safety: 4,
      sightings: readings.flatMap((one) => one.reading.late),
      source: "review-claims",
    }),
    ...foldSightings({
      cost: 3,
      describe: ({ sample }) =>
        `the same claim class goes unresolved across asks: ${oneLine({ text: sample, width: 110 })}`,
      impact: 4,
      safety: 3,
      sightings: repeated,
      source: "review-claims",
    }),
    ...foldSightings({
      cost: 3,
      describe: ({ count }) =>
        `${countOf({ count, many: "asks", one: "ask" })} needed ${String(REVIEW_ROUND_LIMIT)} or more review rounds — the outliers that skew mean time to respond`,
      impact: 4,
      safety: 3,
      sightings: readings.flatMap((one) => one.reading.rounds),
      source: "review-claims",
    }),
  ];
}

/**
 * Read the review verdicts across asks, for the classes of claim that keep coming back.
 *
 * This collector exists because the owner asked for it by name. It reports three shapes, ordered
 * here by how directly they answer that hypothesis:
 *
 * 1. **A check that only appeared late.** A claim class present in an ask's LAST verdict and absent from its
 *    FIRST is a check nothing performed until several rounds in. That is the measured case: the door refused
 *    a post for a missing asker mention after two rounds that never checked it. Its fix is a packet check,
 *    which is mechanically verifiable, so it carries the highest safety here.
 * 2. **A claim class unresolved across several asks** — the repeated-issue pattern itself.
 * 3. **An ask that took several rounds at all** — the mean-time-to-respond north star, whose current average
 *    is skewed by exactly these outliers.
 *
 * @param reviewsDir the per-ask review directories
 * @param reader the filesystem seam
 * @param window the run's bounds
 * @returns the findings, what was read, and what could not be
 */
export function collectReviewClaimClasses({
  reviewsDir,
  reader,
  window,
}: {
  reviewsDir: string;
  reader: SubstrateReader;
  window: ReflectWindow;
}): CollectorReading {
  const readings: { readonly ask: string; readonly reading: AskReading }[] = [];
  let rowsRead = 0;
  for (const ask of reader.listNames(reviewsDir).toSorted((a, b) => a.localeCompare(b))) {
    const verdicts = askVerdicts({ askDir: join(reviewsDir, ask), reader }).filter((verdict) =>
      inWindow({ tsIso: verdict.atIso, window }),
    );
    if (verdicts.length === 0) {
      continue;
    }
    rowsRead += verdicts.length;
    readings.push({ ask, reading: askReading({ ask, verdicts }) });
  }
  const asksByClass = new Map<string, { readonly asks: Set<string>; readonly sample: string; readonly last: string }>();
  for (const { ask, reading } of readings) {
    for (const claim of reading.unresolved) {
      const prior = asksByClass.get(claim.classKey);
      const asks = prior === undefined ? new Set<string>() : prior.asks;
      asks.add(ask);
      asksByClass.set(claim.classKey, {
        asks,
        last: claim.atIso,
        sample: classSample({ claim, prior }),
      });
    }
  }
  const repeated: Sighting[] = [...asksByClass.entries()]
    .filter(([, group]) => group.asks.size >= 2)
    .map(([classKey, group]) => ({
      classKey,
      evidence: `${countOf({ count: group.asks.size, many: "asks", one: "ask" })} carried an unresolved claim of this class: "${oneLine({ text: group.sample, width: 90 })}"`,
      locus: "turn review claims",
      tsIso: group.last,
    }));
  return {
    findings: reviewFindings({ readings, repeated }),
    residue:
      rowsRead === 0
        ? ["no review verdict fell inside the window, so nothing can be said about whether rounds repeat"]
        : [],
    rowsRead,
    source: "review-claims",
  };
}
