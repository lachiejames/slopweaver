/**
 * Building and decoding one {@link LessonRow} — the pure half of the register.
 *
 * No filesystem, no clock, no network: `recordedAtIso` is passed in, exactly like `../reflect/finding.ts`,
 * so every check here is testable without a seam.
 *
 * ## Normalisation is the whole identity mechanism
 *
 * {@link lessonId} hashes the domain and the NORMALISED claim, so two sessions that write the same lesson in
 * different casing or spacing produce the same id and the repeat becomes countable — the owner's
 * consolidation trigger (`./types.ts`'s overview). Normalisation is deliberately mechanical and slightly
 * over-merging: lowercase, collapse whitespace, drop terminal punctuation. It will NOT merge two wordings of
 * one lesson, and it is not supposed to — that is a reading task, and a clever matcher that merged two
 * different lessons would erase one of them from a store whose whole value is that nothing is erased.
 */
import { createHash } from "node:crypto";

import { isRecord } from "../lib/parsers.js";
import { err, ok, type Result } from "../lib/result.js";

import { domainStanding, type InstallKnowledgeDomains } from "./domainVocabulary.js";
import { type KnowledgeError, KnowledgeErrors } from "./errors.js";
import {
  LESSON_CLAIM_MAX,
  LESSON_DOMAIN_MAX,
  LESSON_DOMAIN_MIN,
  LESSON_DOMAIN_PATTERN,
  LESSON_LEARNER_DEFAULT,
  LESSON_LEARNERS,
  LESSON_SURFACES,
  LESSON_TIERS,
  LESSON_VERDICTS,
  type LessonLearner,
  type LessonRow,
  type LessonSurface,
  type LessonTier,
  type LessonVerdict,
} from "./types.js";

/** How many hex characters of the claim digest an id keeps. Matches `../handover/runStore.ts`'s docHash. */
const ID_LENGTH = 16;

/**
 * The comparable form of a claim — what the id is actually computed over.
 *
 * @param claim the claim as written
 * @returns the claim lowercased, with whitespace collapsed and terminal punctuation dropped
 */
export function normaliseClaim({ claim }: { claim: string }): string {
  return claim
    .toLowerCase()
    .replaceAll(/\s+/gu, " ")
    .trim()
    .replace(/[.!?]+$/u, "");
}

/**
 * The stable id for a lesson. Two recordings of the same claim in the same domain share it, whatever else
 * about them differs.
 *
 * The two halves are joined by an escaped NUL rather than by any printable character, so no domain-and-claim
 * pair can ever collide with a different pair that happens to contain the separator. Written as `\u0000`
 * because a raw NUL byte makes git render the whole file as `Binary files differ` — invisible in review.
 *
 * `learner` is deliberately NOT hashed in. The owner's correction of a claim the fleet recorded has to land on the
 * SAME id, because that shared id is the series showing how one belief moved — see `./types.ts`'s overview.
 *
 * @param domain the domain slug
 * @param claim the claim as written; normalised before hashing
 * @returns an `l-` prefixed short hex id
 */
export function lessonId({ domain, claim }: { domain: string; claim: string }): string {
  const digest = createHash("sha256")
    .update(`${domain}\u0000${normaliseClaim({ claim })}`)
    .digest("hex")
    .slice(0, ID_LENGTH);
  return `l-${digest}`;
}

/**
 * A non-empty trimmed string, or the reason it is not one.
 *
 * Exported because `./memoryRow.ts` needs the same check with the same wording — two copies of a validation
 * message is two messages that eventually disagree, which the `duplicate-windows` gate caught the moment the
 * second one was written.
 *
 * @param field the field's name as a writer typed it, so a refusal names what to fix
 * @param value the supplied text
 * @param max the longest it may be
 * @returns the trimmed text, or the reason it was refused
 */
export function requireText({
  field,
  value,
  max,
}: {
  field: string;
  value: string;
  max: number;
}): Result<string, KnowledgeError> {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return err(KnowledgeErrors.invalidField({ field, why: "is empty" }));
  }
  if (trimmed.length > max) {
    return err(
      KnowledgeErrors.invalidField({
        field,
        why: `is ${String(trimmed.length)} characters, over the ${String(max)} allowed`,
      }),
    );
  }
  return ok(trimmed);
}

/**
 * Whether a domain is a slug this register will accept.
 *
 * @param domain the candidate slug
 * @returns true when it matches the pattern and the length bounds
 */
export function isLessonDomain({ domain }: { domain: string }): boolean {
  return domain.length >= LESSON_DOMAIN_MIN && domain.length <= LESSON_DOMAIN_MAX && LESSON_DOMAIN_PATTERN.test(domain);
}

/**
 * The domain a WRITER may use: a slug, and one the closed vocabulary holds (`./domains.ts`).
 *
 * Three refusals, each naming its own fix: not a slug at all, a retired spelling (naming the domain it folded
 * into), or a slug neither the committed vocabulary nor this install's own in its store hold (naming the
 * verb that adds one, and the home to add it under). Every builder a writer reaches calls this; a restore does not, for the reason
 * `./domains.ts` gives.
 *
 * @param domain the slug as supplied
 * @param installDomains this install's own domains and aliases, read once at the verb's edge
 * @returns the slug, or the refusal
 */
export function requireKnowledgeDomain({
  domain,
  installDomains,
}: {
  domain: string;
  installDomains: InstallKnowledgeDomains;
}): Result<string, KnowledgeError> {
  if (!isLessonDomain({ domain })) {
    return err(KnowledgeErrors.invalidDomain({ domain }));
  }
  const standing = domainStanding({ domain, installDomains });
  if (standing.kind === "alias") {
    return err(KnowledgeErrors.domainRetired({ canonical: standing.canonical, domain }));
  }
  if (standing.kind === "unknown") {
    return err(KnowledgeErrors.domainNotConfigured({ domain, home: installDomains.home }));
  }
  return ok(domain);
}

/**
 * The claim a new recording retires, or the reason it cannot name that one.
 *
 * Only what is checkable without the store: present, and not the writer's OWN claim — a claim retiring itself
 * would hide the very recording that did it. That the target exists and is the same kind is the store edge's
 * check (`./memoryRecordStore.ts`'s `recordMemory`), because only the table knows.
 *
 * @param supersedes the claim id as supplied, or undefined when this recording replaces nothing
 * @param id the writer's own claim id
 * @returns the trimmed id, null when there is none, or the refusal
 */
export function requireSupersedes({
  supersedes,
  id,
}: {
  supersedes: string | undefined;
  id: string;
}): Result<string | null, KnowledgeError> {
  if (supersedes === undefined) {
    return ok(null);
  }
  const target = supersedes.trim();
  if (target.length === 0) {
    return err(KnowledgeErrors.invalidField({ field: "supersedes", why: "is empty" }));
  }
  if (target === id) {
    return err(
      KnowledgeErrors.supersedesRefused({
        supersedes: target,
        why: "it is this recording's own claim — record a new verdict on it instead",
      }),
    );
  }
  return ok(target);
}

/** A lesson's three free-text fields, each trimmed and bounded, or the first that failed. */
function requireLessonTexts({
  claim,
  evidence,
  run,
}: {
  claim: string;
  evidence: string;
  run: string;
}): Result<{ claim: string; evidence: string; run: string }, KnowledgeError> {
  const claimText = requireText({ field: "claim", max: LESSON_CLAIM_MAX, value: claim });
  if (claimText.isErr()) {
    return err(claimText.error);
  }
  const evidenceText = requireText({ field: "evidence", max: LESSON_CLAIM_MAX * 4, value: evidence });
  if (evidenceText.isErr()) {
    return err(evidenceText.error);
  }
  const runText = requireText({ field: "run", max: LESSON_DOMAIN_MAX * 4, value: run });
  if (runText.isErr()) {
    return err(runText.error);
  }
  return ok({ claim: claimText.value, evidence: evidenceText.value, run: runText.value });
}

/**
 * Build a validated row from what a caller supplied, deriving the id.
 *
 * Every closed vocabulary is checked here rather than at the CLI edge, so a row built by a future caller
 * that is not the CLI cannot skip the check.
 *
 * @param domain which system the lesson is about
 * @param claim the lesson in one sentence
 * @param evidence what was actually observed
 * @param learner whose lesson it is — the fleet's, or the owner's own
 * @param run the board row it was learned on, or `ad-hoc`
 * @param recordedAtIso the instant to stamp; passed in so this stays pure
 * @param repro the command that settles it again, when there is one
 * @param caveat what the evidence does not establish
 * @param supersedes the claim id this recording retires, when it replaces one
 * @param installDomains this install's own domains and aliases, which the domain is checked against
 * @returns the row, or the first field that failed
 */
export function buildLessonRow({
  domain,
  claim,
  verdict,
  tier,
  surface,
  learner,
  evidence,
  run,
  recordedAtIso,
  repro,
  caveat,
  supersedes,
  installDomains,
}: {
  installDomains: InstallKnowledgeDomains;
  domain: string;
  claim: string;
  verdict: LessonVerdict;
  tier: LessonTier;
  surface: LessonSurface;
  learner: LessonLearner;
  evidence: string;
  run: string;
  recordedAtIso: string;
  repro: string | undefined;
  caveat: string | undefined;
  supersedes?: string | undefined;
}): Result<LessonRow, KnowledgeError> {
  const domainChecked = requireKnowledgeDomain({ domain, installDomains });
  if (domainChecked.isErr()) {
    return err(domainChecked.error);
  }
  const texts = requireLessonTexts({ claim, evidence, run });
  if (texts.isErr()) {
    return err(texts.error);
  }
  const id = lessonId({ claim: texts.value.claim, domain });
  const retires = requireSupersedes({ id, supersedes });
  if (retires.isErr()) {
    return err(retires.error);
  }
  const base = { ...texts.value, domain, id, learner, recordedAtIso, surface, tier, verdict };
  const withRepro = repro === undefined || repro.trim().length === 0 ? base : { ...base, repro: repro.trim() };
  const withCaveat =
    caveat === undefined || caveat.trim().length === 0 ? withRepro : { ...withRepro, caveat: caveat.trim() };
  if (retires.value === null) {
    return ok(withCaveat);
  }
  return ok({ ...withCaveat, supersedes: retires.value });
}

// Each guard below is a single-parameter type predicate rather than one generic `memberOf`, because
// TypeScript error TS1230 forbids destructuring in a type-predicate signature — so the one-parameter
// positional form is the compiler's decision, not this file's, and `named-object-params` exempts it for
// exactly that reason. Three tiny guards also keep the narrowing exact at each call site.

/** Whether an unknown value is a member of the verdict vocabulary. */
function isVerdict(value: unknown): value is LessonVerdict {
  return LESSON_VERDICTS.some((entry) => entry === value);
}

/** Whether an unknown value is a member of the tier vocabulary. */
function isTier(value: unknown): value is LessonTier {
  return LESSON_TIERS.some((entry) => entry === value);
}

/** Whether an unknown value is a member of the surface vocabulary. */
function isSurface(value: unknown): value is LessonSurface {
  return LESSON_SURFACES.some((entry) => entry === value);
}

/** Whether an unknown value is a member of the learner vocabulary. */
function isLearner(value: unknown): value is LessonLearner {
  return LESSON_LEARNERS.some((entry) => entry === value);
}

/**
 * The learner a stored line carries, or the reason it carries an unreadable one.
 *
 * ABSENT is the only tolerated shape and it means the fleet: every row written before the field existed has
 * no property here at all, and reading one as anything else would invent an attribution nobody made
 * (`./types.ts`'s `LESSON_LEARNER_DEFAULT`). A property that IS present and outside the vocabulary is
 * corruption, refused exactly like a bad verdict — a line saying `"learner": "ada"` is a hand edit, and
 * silently rewriting it to `fleet` would put a row on the wrong side of the register's one split.
 */
function storedLearner({ value }: { value: unknown }): LessonLearner | undefined {
  if (value === undefined) {
    return LESSON_LEARNER_DEFAULT;
  }
  return isLearner(value) ? value : undefined;
}

/**
 * Decode one stored line back into a row, checking every closed vocabulary again.
 *
 * Re-validated on the way IN rather than trusted, because the register is a plain append-only file a human
 * is expected to be able to read and, one day, will be tempted to edit.
 *
 * @param line one line of the register
 * @param lineNumber the 1-based line number, carried into a corruption error so the file can be inspected
 * @returns the row, or a corruption error naming the line
 */
export function parseLessonLine({
  line,
  lineNumber,
}: {
  line: string;
  lineNumber: number;
}): Result<LessonRow, KnowledgeError> {
  let decoded: unknown;
  try {
    decoded = JSON.parse(line);
  } catch {
    return err(KnowledgeErrors.corruptRow({ lineNumber }));
  }
  if (!isRecord(decoded)) {
    return err(KnowledgeErrors.corruptRow({ lineNumber }));
  }
  const { id, domain, claim, verdict, tier, surface, learner, evidence, recordedAtIso, run, repro, caveat } = decoded;
  const textsOk =
    typeof id === "string" &&
    typeof domain === "string" &&
    typeof claim === "string" &&
    typeof evidence === "string" &&
    typeof recordedAtIso === "string" &&
    typeof run === "string";
  const learnerRead = storedLearner({ value: learner });
  if (!textsOk || !isVerdict(verdict) || !isTier(tier) || !isSurface(surface) || learnerRead === undefined) {
    return err(KnowledgeErrors.corruptRow({ lineNumber }));
  }
  const base: LessonRow = {
    claim,
    domain,
    evidence,
    id,
    learner: learnerRead,
    recordedAtIso,
    run,
    surface,
    tier,
    verdict,
  };
  const withRepro = typeof repro === "string" ? { ...base, repro } : base;
  return ok(typeof caveat === "string" ? { ...withRepro, caveat } : withRepro);
}
