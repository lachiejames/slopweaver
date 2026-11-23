/**
 * The conservation identities a slice must satisfy — the checks themselves, all pure.
 *
 * Each one answers a different question about a different seam, and each is written so that it can FAIL.
 * That is the property to protect: an identity whose check cannot go red is worse than no check, because it
 * manufactures the confidence the whole exercise exists to earn. Every check here has a matching test that
 * breaks it on purpose and confirms the red.
 *
 * ## The one that would not have worked
 *
 * "Everything fetched is either written or deduplicated" reads like an arithmetic identity and is not one.
 * The writer defines `deduped` RESIDUALLY, as `input − written` ({@link ./corpusWriter}), so the equation
 * balances by construction and stays balanced after an unclassified loss — its own comments record exactly
 * that happening. So {@link checkCaptureWrite} does not check arithmetic. It checks that every projected
 * record's `(identity, fingerprint)` pair is actually present on the other side, which is a claim the
 * residual cannot satisfy for free.
 *
 * ## Why `self` is the first subject, and where it is blind
 *
 * `self` needs no network, no auth and no token, so a failing check means the harness is wrong rather than
 * that an API was odd. It is also blind in two measured ways, both handled rather than hidden: 0 of its
 * 54,987 records exceed the 1,200-character prompt cap, so truncation is structurally unexercisable there
 * (hence the declared synthetic fixture), and it has no bare-`sourceId` collisions at all, so
 * {@link checkKeyInjectivity} is reported as VACUOUS on `self` instead of being reported as passing.
 */

import { identityOf, recordIdentity } from "./latestRecords.js";
import { recordContentFingerprint } from "./recordSerialisation.js";
import { sharedKeys } from "./sharedKeys.js";
import { comparePins, FIELD_DISPOSITIONS, type SlicePin, type SliceSentinel } from "./slice.js";
import type { CorpusRecord } from "./types.js";

/** The seven identities, named so a report and an exit code can refer to the same thing. */
type IdentityName =
  | "discovery"
  | "capture-write"
  | "projection"
  | "reconstruction"
  | "retrieval-handoff"
  | "idempotence"
  | "key-injectivity";

/**
 * What one identity concluded.
 *
 * `vacuous` is a third state rather than a flavour of `held`, and it is load-bearing: a check that had
 * nothing to examine has established NOTHING, and reporting that as a pass is precisely how a green harness
 * comes to sit over a lossy corpus. It does not fail the run — a slice legitimately may not exercise every
 * seam — but it is printed differently and counted separately.
 */
export interface IdentityResult {
  readonly identity: IdentityName;
  readonly status: "held" | "broken" | "vacuous";
  /** One line saying what was actually measured, present whatever the status. */
  readonly detail: string;
  /** The specifics when broken — never empty for a `broken` result, always empty otherwise. */
  readonly residue: readonly string[];
}

/** How many residue lines a check names before it starts counting instead. */
const RESIDUE_LIMIT = 10;

/** Cap a residue list, appending a count line when it was truncated — so a report never hides its own size. */
function capResidue({ lines }: { lines: readonly string[] }): readonly string[] {
  if (lines.length <= RESIDUE_LIMIT) {
    return lines;
  }
  return [...lines.slice(0, RESIDUE_LIMIT), `… and ${String(lines.length - RESIDUE_LIMIT)} more`];
}

/**
 * DISCOVERY — everything the walk saw is either read, declined by policy, or declined by our own guardrail.
 *
 * A FAULT is not accounted for, and that asymmetry is the whole check. The existing conservation law
 * (`ingested = indexed + Σ skipped`) cannot see this seam at all, because `ingested` counts rows that were
 * READ: a file never read appears on neither side, so three files vanished from a real root while every
 * printed number stayed balanced.
 *
 * @param entriesSeen how many entries the walk encountered in total
 * @param filesRead how many of them it read
 * @param declinedByReason the count of declines per typed reason
 * @param faultReasons the reasons that mean something went wrong rather than something was declined
 * @returns whether discovery is fully accounted for
 */
export function checkDiscovery({
  entriesSeen,
  filesRead,
  declinedByReason,
  faultReasons,
}: {
  entriesSeen: number;
  filesRead: number;
  declinedByReason: Readonly<Record<string, number>>;
  faultReasons: ReadonlySet<string>;
}): IdentityResult {
  const declined = Object.values(declinedByReason).reduce((total, n) => total + n, 0);
  const residue: string[] = [];
  const unaccounted = entriesSeen - filesRead - declined;
  if (unaccounted !== 0) {
    residue.push(
      `${String(entriesSeen)} seen but ${String(filesRead)} read + ${String(declined)} declined = ${String(filesRead + declined)} (${String(unaccounted)} unaccounted)`,
    );
  }
  for (const [reason, count] of Object.entries(declinedByReason)) {
    if (faultReasons.has(reason)) {
      residue.push(`${String(count)} entr(ies) declined as \`${reason}\`, which is a fault rather than a policy`);
    }
  }
  if (entriesSeen === 0) {
    return {
      detail: "the walk saw nothing, so discovery established nothing",
      identity: "discovery",
      residue: [],
      status: "vacuous",
    };
  }
  return {
    detail: `${String(entriesSeen)} seen = ${String(filesRead)} read + ${String(declined)} declined, every decline named`,
    identity: "discovery",
    residue: capResidue({ lines: residue }),
    status: residue.length === 0 ? "held" : "broken",
  };
}

/**
 * CAPTURE/WRITE — every projected record is present in what was stored, by identity AND content.
 *
 * Deliberately NOT the arithmetic `projected = written + deduped`: `deduped` is a residual, so that equation
 * balances even when records were lost. This compares the actual pairs.
 *
 * Two failures, kept apart because they have different fixes. ABSENT means the write never landed. SHADOWED
 * means it landed and no reader will ever see it — a distinction found by running this against a real corpus,
 * where 22 records of the owner's own memory files were reported absent while sitting on disk the whole time.
 *
 * @param projected the records the projector produced
 * @param stored the LATEST-view records — what every reader actually sees
 * @param physical every row on disk, superseded ones included — what the writer actually wrote
 * @returns whether every projected record both landed and is readable
 */
export function checkCaptureWrite({
  projected,
  stored,
  physical,
}: {
  projected: readonly CorpusRecord[];
  stored: readonly CorpusRecord[];
  physical: readonly CorpusRecord[];
}): IdentityResult {
  const pairOf = (record: CorpusRecord): string =>
    `${recordIdentity({ record })}|${recordContentFingerprint({ record })}|${record.tsIso}`;
  const inLatest = new Set(stored.map(pairOf));
  const onDisk = new Set(physical.map(pairOf));

  const absent: CorpusRecord[] = [];
  const shadowed: CorpusRecord[] = [];
  for (const record of projected) {
    const pair = pairOf(record);
    if (inLatest.has(pair)) {
      continue;
    }
    // Present on disk but not in the view every reader uses. Dogfooding turned this up as 22 real records
    // of the owner's own memory files: bronze is append-only, `supersedes` breaks a timestamp tie by
    // preferring the LONGER serialisation, and a `self` record's `tsIso` is its event time — which does not
    // move when the text is edited. So editing a note to say something SHORTER writes a row that loses to
    // its own stale predecessor, and every query keeps serving the old text forever.
    (onDisk.has(pair) ? shadowed : absent).push(record);
  }
  if (projected.length === 0) {
    return {
      detail: "nothing was projected, so the write seam was not exercised",
      identity: "capture-write",
      residue: [],
      status: "vacuous",
    };
  }
  const lost = absent.length + shadowed.length;
  return {
    detail: `${String(projected.length)} projected record(s), ${String(projected.length - lost)} readable in bronze${shadowed.length > 0 ? ` · ${String(shadowed.length)} written but SHADOWED by a longer stale twin` : ""}`,
    identity: "capture-write",
    residue: capResidue({
      lines: [
        ...absent.map((record) => `absent from bronze: ${record.source}/${record.container}/${record.sourceId}`),
        ...shadowed.map(
          (record) =>
            `written but never read: ${record.sourceId} — an older, longer row with the same timestamp wins the latest view`,
        ),
      ],
    }),
    status: lost === 0 ? "held" : "broken",
  };
}

/**
 * PROJECTION — every top-level field a record carries is classified, none falls off the edge.
 *
 * The universe is the declared `CorpusRecord` keys, per the owner's ruling, with `raw` counted as one opaque
 * blob rather than recursed into. A key present on a record but absent from the disposition map is the
 * failure this catches: it means a field is being captured and nobody has said whether it reaches a model.
 *
 * @param records the records to inspect
 * @returns whether every field present on every record has a declared disposition
 */
export function checkProjection({ records }: { records: readonly CorpusRecord[] }): IdentityResult {
  const declared = new Set(Object.keys(FIELD_DISPOSITIONS));
  const undeclared = new Map<string, number>();
  for (const record of records) {
    for (const key of Object.keys(record)) {
      if (!declared.has(key)) {
        undeclared.set(key, (undeclared.get(key) ?? 0) + 1);
      }
    }
  }
  if (records.length === 0) {
    return { detail: "no records to classify", identity: "projection", residue: [], status: "vacuous" };
  }
  const indexed = Object.entries(FIELD_DISPOSITIONS).filter(([, d]) => d === "indexed").length;
  return {
    detail: `${String(declared.size)} field(s) classified (${String(indexed)} indexed) across ${String(records.length)} record(s)`,
    identity: "projection",
    residue: capResidue({
      lines: [...undeclared].map(
        ([key, n]) => `field \`${key}\` carried by ${String(n)} record(s) has no declared disposition`,
      ),
    }),
    status: undeclared.size === 0 ? "held" : "broken",
  };
}

/**
 * RECONSTRUCTION — the text handed onward reconstructs EXACTLY from what the record holds.
 *
 * The owner ruled the subject to be the projected record body against a pinned capture, so this compares a
 * record's rendered body to the passage(s) selected from it. Any difference that is not itself declared is
 * loss: a chunker that cuts at one size while a consumer clips at a smaller one shows up here and nowhere
 * else.
 *
 * ## Why a green result here is usually a lie
 *
 * Passage selection returns a body VERBATIM when it already fits the budget, so on a slice where no record
 * exceeds the budget this check compares every body to itself and cannot fail. That is not a hypothetical
 * shape — it is `self`, exactly: 0 of its 54,987 records exceed the 1,200-character prompt cap, because the
 * projector budgets sections to fit it. Reporting that as `held` would be the harness flattering itself on
 * the one identity the owner is most confident about.
 *
 * So the count that decides the status is `atRisk` — bodies actually longer than the budget. None at risk
 * means the check examined nothing that could fail, and the honest word for that is VACUOUS.
 *
 * @param pairs each record's rendered body beside the text actually selected from it
 * @param budget the character budget selection was performed at, used to count what was genuinely at risk
 * @param corpusExposure the corpus-wide over-budget count, so a vacuous result is a fact rather than a shrug
 * @returns whether every body reconstructs, or vacuous when none could have failed
 */
export function checkReconstruction({
  pairs,
  budget,
  corpusExposure,
}: {
  pairs: readonly { readonly label: string; readonly body: string; readonly selected: string }[];
  budget: number;
  corpusExposure?: { readonly overBudget: number; readonly ofRecords: number } | undefined;
}): IdentityResult {
  if (pairs.length === 0) {
    return { detail: "no bodies to reconstruct", identity: "reconstruction", residue: [], status: "vacuous" };
  }
  const broken = pairs.filter((pair) => pair.selected !== pair.body);
  const atRisk = pairs.filter((pair) => pair.body.length > budget).length;
  if (atRisk === 0 && broken.length === 0) {
    return {
      detail: `${String(pairs.length)} bod(ies) all fit the ${String(budget)}-char budget, so selection returned each verbatim — this slice cannot exercise reconstruction${exposureNote({ corpusExposure })}`,
      identity: "reconstruction",
      residue: [],
      status: "vacuous",
    };
  }
  return {
    detail: `${String(pairs.length - broken.length)} of ${String(pairs.length)} record bod(ies) reconstruct exactly from what was selected (${String(atRisk)} over the ${String(budget)}-char budget, so genuinely at risk)${exposureNote({ corpusExposure })}`,
    identity: "reconstruction",
    residue: capResidue({
      lines: broken.map(
        (pair) =>
          `${pair.label}: body ${String(pair.body.length)} chars, selected ${String(pair.selected.length)} chars (${String(pair.body.length - pair.selected.length)} lost)`,
      ),
    }),
    status: broken.length === 0 ? "held" : "broken",
  };
}

/**
 * The corpus-wide truncation exposure, appended to whatever this slice could establish itself.
 *
 * A vacuous result that says only "this slice cannot exercise reconstruction" is honest and useless: it
 * leaves the reader unable to tell an untested seam from an untestable one. Naming how many records the
 * WIDER corpus holds over the budget answers that — measured, 37,926 of 369,759 — and it is the doc's own
 * requirement that the dropped-character count be stated rather than hidden. It is reported, never failed on:
 * driving it to zero belongs to another doc, and a harness that refuses to run until an unrelated defect is
 * fixed is one nobody runs. Pure.
 *
 * @param corpusExposure the corpus-wide count, when the caller measured one
 * @returns a trailing clause, or the empty string when nothing was measured
 */
function exposureNote({
  corpusExposure,
}: {
  corpusExposure?: { readonly overBudget: number; readonly ofRecords: number } | undefined;
}): string {
  if (corpusExposure === undefined) {
    return "";
  }
  return ` · corpus-wide ${String(corpusExposure.overBudget)} of ${String(corpusExposure.ofRecords)} record(s) EXCEED the budget and lose text here (reported, not this doc's to fix)`;
}

/**
 * RETRIEVAL + HANDOFF — every sentinel is retrievable AND survives into the bytes a model would be handed.
 *
 * The dropped-character count is REPORTED, never required to be zero: driving it to zero belongs to a
 * different doc, and a harness that refuses to run until an unrelated defect is fixed is useless. A sentinel
 * that is retrievable but missing from the prompt is the interesting failure — it means the record was found
 * and then clipped away.
 *
 * @param observations one per sentinel: whether it was retrieved, and whether the prompt bytes contain it
 * @param droppedChars how many characters the prompt budget dropped across the slice
 * @returns whether every sentinel reached the handoff boundary
 */
export function checkRetrievalHandoff({
  observations,
  droppedChars,
}: {
  observations: readonly {
    readonly sentinel: SliceSentinel;
    readonly retrieved: boolean;
    readonly inPrompt: boolean;
  }[];
  droppedChars: number;
}): IdentityResult {
  if (observations.length === 0) {
    return {
      detail: "the slice declares no sentinels, so nothing was traced to the handoff",
      identity: "retrieval-handoff",
      residue: [],
      status: "vacuous",
    };
  }
  const residue = observations.flatMap((o) => {
    if (!o.retrieved) {
      return [`sentinel not retrievable by its own query: ${JSON.stringify(o.sentinel.query)}`];
    }
    return o.inPrompt ? [] : [`sentinel retrieved but CLIPPED before the prompt: ${JSON.stringify(o.sentinel.text)}`];
  });
  return {
    detail: `${String(observations.length - residue.length)} of ${String(observations.length)} sentinel(s) reached the handoff boundary · ${String(droppedChars)} char(s) dropped by the per-record shard budget (reported, not required to be zero)`,
    identity: "retrieval-handoff",
    residue: capResidue({ lines: residue }),
    status: residue.length === 0 ? "held" : "broken",
  };
}

/**
 * IDEMPOTENCE — an unchanged rerun reproduces the pin exactly.
 *
 * Observation timestamps may advance; identity and content may not. The pin excludes the observation
 * timestamp by construction because it reuses the writer's content fingerprint, which does too.
 *
 * @param before the pin recorded at capture
 * @param after the pin computed on this run
 * @returns whether the two captures are the same capture
 */
export function checkIdempotence({ before, after }: { before: SlicePin; after: SlicePin }): IdentityResult {
  // An EMPTY pin reproduces an empty pin, always. Left as `held` that single true-by-construction result was
  // enough to stop an otherwise entirely vacuous run from being reported as inconclusive — a slice over a
  // missing root and an absent corpus exited zero saying "nothing was lost". Zero records is nothing to be
  // idempotent about.
  if (before.records === 0 && after.records === 0) {
    return {
      detail: "both pins cover zero records, so reproducing one proves nothing",
      identity: "idempotence",
      residue: [],
      status: "vacuous",
    };
  }
  const residue = comparePins({ after, before });
  return {
    detail:
      residue.length === 0
        ? `pin reproduced exactly: ${String(after.records)} record(s), digest ${after.digest.slice(0, 12)}`
        : "the pinned fixture CHANGED, so this run is not comparable to the pin",
    identity: "idempotence",
    residue: capResidue({ lines: residue }),
    status: residue.length === 0 ? "held" : "broken",
  };
}

/**
 * KEY INJECTIVITY — every composite identity maps to its own retrieval key.
 *
 * Retrieval indexes and resolves records by bare `sourceId` while the corpus keys them by
 * `(source, container, sourceId)`, so two different records that share a `sourceId` collapse into one entry
 * and a query can match the text of one and be handed the other, with a citation that looks correct.
 *
 * This MEASURES that collapse and refuses to call it fine; repairing it belongs to its own doc. On a slice
 * with no collisions at all — `self` has none — the result is VACUOUS rather than held, because a check that
 * had nothing to examine has proven nothing about the seam.
 *
 * It reads only the three identity fields, so a caller streaming the corpus hands it census entries rather than
 * records, and the collision grouping ({@link ./sharedKeys.sharedKeys}) builds no set for an unshared id.
 *
 * @param records the records (or census entries) to inspect
 * @returns whether the retrieval key is injective over this slice
 */
export function checkKeyInjectivity({
  records,
}: {
  records: readonly { readonly source: string; readonly container: string; readonly sourceId: string }[];
}): IdentityResult {
  const { keys, shared: collisions } = sharedKeys({
    pairs: records.map((record) => [record.sourceId, identityOf(record)] as const),
  });
  if (records.length === 0) {
    return { detail: "no records to key", identity: "key-injectivity", residue: [], status: "vacuous" };
  }
  if (collisions.length === 0) {
    return {
      detail: `${String(keys)} bare sourceId(s) over ${String(records.length)} record(s), no collisions — this slice cannot exercise the collapse`,
      identity: "key-injectivity",
      residue: [],
      status: "vacuous",
    };
  }
  const collapsed = collisions.reduce((total, [, identities]) => total + identities.size, 0);
  return {
    detail: `${String(collisions.length)} bare sourceId(s) collapse ${String(collapsed)} distinct composite identities`,
    identity: "key-injectivity",
    residue: capResidue({
      lines: collisions.map(
        ([id, identities]) => `sourceId \`${id}\` is shared by ${String(identities.size)} distinct records`,
      ),
    }),
    status: "broken",
  };
}

/**
 * Whether a set of results means the run FAILED — any broken identity, and nothing else.
 *
 * A vacuous result deliberately does not fail: a slice may legitimately not exercise a seam, and turning
 * that into a failure would push people toward slices chosen to go green. It is counted and printed
 * separately instead, which is the honest treatment.
 *
 * @param results every identity's result
 * @returns true when at least one identity is broken
 */
export function anyBroken({ results }: { results: readonly IdentityResult[] }): boolean {
  return results.some((result) => result.status === "broken");
}

/**
 * Whether the run established NOTHING — no identity actually held.
 *
 * A separate question from "did anything break", and the more dangerous one. An empty slice over a missing
 * root and an absent corpus makes every check vacuous and idempotence trivially true (an empty pin
 * reproduces an empty pin), so a run that examined nothing at all would otherwise print "nothing was lost
 * without saying so" and exit zero. That is the precise shape of the failure this capability exists to
 * prevent, wearing the capability's own clothes.
 *
 * Inconclusive is therefore neither pass nor fail: the caller gives it its own exit code.
 *
 * @param results every identity's result
 * @returns true when not one identity held
 */
export function provedNothing({ results }: { results: readonly IdentityResult[] }): boolean {
  return !results.some((result) => result.status === "held");
}

/**
 * The human report — one line per identity, then the residue beneath any that broke. Pure, so the exact
 * text is unit-testable and the shell only emits it.
 *
 * @param results every identity's result, in the order they were computed
 * @returns the lines to print
 */
export function renderSliceReport({ results }: { results: readonly IdentityResult[] }): readonly string[] {
  const glyph: Readonly<Record<IdentityResult["status"], string>> = {
    broken: "BROKEN ",
    held: "held   ",
    vacuous: "vacuous",
  };
  const lines: string[] = [];
  for (const result of results) {
    lines.push(`  ${glyph[result.status]} ${result.identity} — ${result.detail}`);
    for (const line of result.residue) {
      lines.push(`      ${line}`);
    }
  }
  const broken = results.filter((r) => r.status === "broken").length;
  const vacuous = results.filter((r) => r.status === "vacuous").length;
  if (broken > 0) {
    lines.push(`  ${String(broken)} identity(ies) BROKEN — the residue above is what was lost without saying so`);
  } else if (provedNothing({ results })) {
    lines.push(
      `  INCONCLUSIVE — all ${String(results.length)} identity(ies) were vacuous, so this run examined nothing and proved nothing`,
    );
  } else {
    lines.push(
      `  ${String(results.length - vacuous)} identity(ies) held, ${String(vacuous)} vacuous — nothing was lost without saying so`,
    );
  }
  return lines;
}
