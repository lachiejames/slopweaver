/**
 * Whether every ratchet bump a pull request declares has an independent witness — the AUTHORITY half of the
 * rule that the session implementing a pull request must not be the one deciding to bump its ratchet, for the
 * same reason Codex plans and reviews every pull request. CI holds the structure
 * (`src/devLint/baselineAgainstMain.ts`: every loosening is declared by a committed manifest); this holds the
 * authority, at the two landing verbs, from the pass records OUTSIDE the tree being judged.
 *
 * ## What counts as a witness, and why each condition is there
 *
 * A pass-ledger row whose own record says, field by field, never through rendered text:
 *
 *  - **provider `codex`.** A Claude fallback review is the implementing brain judging its own bump, which is
 *    the one thing the ruling forbids. A capped Codex means the bump WAITS; it never means a fallback.
 *  - **a review, verdict `CLEAN`.** A plan judges no claim; anything but CLEAN is not a yes.
 *  - **CURRENT for the pull request's head**, judged by the ledger's own freshness rule, and **not superseded**
 *    — or STALE and CARRIED, below.
 *  - **zero uncommitted bytes at capture.** A review of HEAD-plus-edits judged code that is not what lands.
 *  - **a base that is a fixed commit the pull request's base branch holds.** Freshness recomputes a review's
 *    diff from its base REF, so a moving one (`HEAD`, a branch the author controls) reviewed an empty diff at
 *    one commit and recomputes an empty diff at every later one, which reads CURRENT for code nobody reviewed.
 *    A full SHA main already holds recomputes honestly.
 *  - **the property id {@link witnessPropertyId} names, and a statement byte-equal to {@link witnessClaim}.**
 *    Both are rendered from the manifest's digest, so whoever runs the review cannot soften the claim.
 *
 * A CURRENT, unretired `BROKEN` review under the manifest's property id also refuses, whatever claim it judged
 * and whatever else stands beside it: a re-run until something says CLEAN would otherwise bury the finding the
 * first review made. The property id carries the manifest's digest, so only a review of THIS bump can hold it.
 *
 * ## A stale witness is carried only when its patch AND its floor are unchanged
 *
 * The witness's base is a pinned commit, so after a conflict-free rebase the ledger re-diffs the head against the
 * OLD base, folds in everything main gained, and calls the row STALE. An identical patch after a rebase gets no
 * second review, so a STALE row counts as current for THIS question when all of these hold:
 *
 *  - the record carries a usable diff digest (`recordedReviewDiffSha256`, `./diffCarry.ts`) equal to the diff the
 *    head presents against the landing base — the patch identity the landing floor's own carry uses;
 *  - its base is pinned, as above;
 *  - every file the manifest's rows name — a ratchet row's baseline, a policy row's own source file — has the same
 *    content at that base and the landing base. The same patch on a different floor is a different claim, so a
 *    match there with a moved floor is `floor-moved`.
 *
 * An UNKNOWN row, a record with no usable digest, and a row no record backs never carry: an old record is stale,
 * never grandfathered. Every fact is read from git by `./baselineBumpFloor.ts`; none comes from a caller. The same
 * rule decides whether a `BROKEN` row still refuses, so a rebase cannot bury a finding over the same patch either.
 * The ledger itself is untouched: the row still reads STALE everywhere else.
 *
 * A row is joined to its record by artifact id alone, and the verdict comes from the row while the patch comes
 * from the record. So an id two records share joins to neither: otherwise a row could take its verdict from one
 * review and its patch from another. That row reads as having no record, which never witnesses.
 *
 * What the two checks do NOT prove: that main left alone everything the claim's reasoning leaned on. A change to
 * comparator code, or to a source file a row's entry names, passes both while leaving the baseline bytes as they
 * were. The landing comparison still re-measures every row's exact `from -> to`, so a changed measure is refused
 * there; a changed JUSTIFICATION with an unchanged measure is the residue.
 *
 * NOT bound to main's commit, on purpose: each row pins its own `from -> to` against main, so a main that moved
 * the baseline makes CI refuse the manifest and a re-declared one carries a new digest, so a new witness. A
 * main that moved anything else leaves the justification standing. Nor is it a hold GitHub enforces — like the
 * pairing floor, it binds through the one door (AGENTS.md rule 3), at the moment of the landing verb.
 *
 * Pure. `./baselineBumpWitnessRun.ts` reads the manifests and the records; this decides.
 */

import { isRecord } from "#lib/parsers.js";
import { witnessClaim, witnessCommand, witnessPropertyId } from "../devLint/baselineBump.js";
import type { NewManifest } from "../devLint/baselineComparison.js";
import { recordedReviewDiffSha256 } from "./diffCarry.js";
import type { LedgerEntry } from "./ledger.js";
import type { CodexArtifactRecord } from "./types.js";

/**
 * The finding subject both landing verbs refuse under. It is NOT an acknowledgeable subject and is never
 * folded into `--acknowledge` or `--acknowledge-all`: the only way through is the witness itself.
 */
export const BASELINE_BUMP_SUBJECT = "baseline-bump-unwitnessed";

/** One reason a review row carrying the witness property id still does not witness the manifest. */
export type WitnessRejection =
  | "not-codex"
  | "not-a-review"
  | "not-adversarial"
  | "not-clean"
  | "not-current"
  | "superseded"
  | "record-missing"
  | "dirty-capture"
  | "base-unpinned"
  | "claim-differs"
  | "floor-moved";

/** The sentence each rejection prints. */
const REJECTION_TEXT: Readonly<Record<WitnessRejection, string>> = {
  "base-unpinned":
    "its --base is not a full commit SHA the pull request's base branch holds, so its freshness cannot be trusted",
  "claim-differs": "its property statement is not the manifest's exact claim",
  "dirty-capture": "it read uncommitted bytes on top of its HEAD",
  "floor-moved":
    "its reviewed patch matches the landing patch, but a file this manifest's rows name differs at the landing base or could not be read",
  "not-a-review": "it is not a review pass",
  "not-adversarial":
    "it is not an r3 pass — only the adversarial review, which tries to break the claim, witnesses one",
  "not-clean": "its verdict is not CLEAN",
  "not-codex": "it is not a Codex pass (a Claude fallback cannot witness a bump; a capped Codex means wait)",
  "not-current": "it is not current for the pull request's head",
  "record-missing": "no pass record backs it, so its claim and capture cannot be checked",
  superseded: "it has been retired with `codex supersede`",
};

/** One ledger row that carried the witness property id, and why it did not count. */
interface WitnessCandidate {
  readonly artifactId: string;
  readonly rejections: readonly WitnessRejection[];
}

/** A manifest the landing must refuse on, with everything the refusal names. */
export interface UnwitnessedManifest {
  readonly path: string;
  readonly digest: string;
  readonly propertyId: string;
  /** Every row carrying the property id, each with its rejections; empty when no review was ever taken. */
  readonly candidates: readonly WitnessCandidate[];
  /** Rows that are CURRENT, unretired and `BROKEN` under this property id, whatever claim each judged — each refuses on its own. */
  readonly contradictedBy: readonly string[];
  /** The exact command that takes the witness. */
  readonly command: string;
}

/** The statement a review record judged, read through `unknown` because disk JSON is only shallow-decoded. */
function statementOf({ record }: { record: CodexArtifactRecord }): unknown {
  const property: unknown = record.scope.mode === "review" ? record.scope.property : undefined;
  return isRecord(property) ? property["statement"] : undefined;
}

/**
 * The git evidence a stale witness is judged against, read by `./baselineBumpFloor.ts` and never supplied by a
 * caller of a landing verb.
 */
export interface BaselineBumpCarryEvidence {
  /** The review base refs proven full commit SHAs the landing base holds. */
  readonly pinnedBases: ReadonlySet<string>;
  /** The diff the head presents against the landing base; `undefined` when no witness asks or git failed. */
  readonly landingDiffSha256: string | undefined;
  /** Manifest digest → the pinned review bases whose row files equal the landing base's. */
  readonly floorHeldBasesByDigest: ReadonlyMap<string, ReadonlySet<string>>;
}

/** Whether a row counts as current for the witness question, and if not, which way it failed. */
type WitnessFreshness = "current" | "floor-moved" | "not-current";

/** What every row of one manifest is judged against. */
interface WitnessJudging {
  readonly pinnedBases: ReadonlySet<string>;
  /** The diff the head presents against the landing base; `undefined` carries no stale row. */
  readonly landingDiffSha256: string | undefined;
  /** The pinned bases whose row files equal the landing base's, for this manifest. */
  readonly floorHeldBases: ReadonlySet<string>;
}

/**
 * Whether one ledger row is current FOR THE WITNESS QUESTION. A CURRENT row is. A STALE row is carried only when
 * the record behind it carries a usable diff digest equal to the landing patch, its base is pinned, and the
 * manifest's floor held between that base and the landing base; a matching patch on a moved floor is
 * `floor-moved`. An UNKNOWN row, or one no record backs, never carries. Pure.
 *
 * @param entry the ledger row
 * @param record the pass record behind it; `undefined` when none backs it
 * @param judging the pinned bases, the landing patch and this manifest's held floor
 * @returns the row's witness freshness
 */
function witnessFreshness({
  entry,
  record,
  judging,
}: {
  entry: LedgerEntry;
  record: CodexArtifactRecord | undefined;
  judging: WitnessJudging;
}): WitnessFreshness {
  if (entry.freshness.kind === "current") {
    return "current";
  }
  const { floorHeldBases, landingDiffSha256, pinnedBases } = judging;
  if (entry.freshness.kind !== "stale" || record === undefined || landingDiffSha256 === undefined) {
    return "not-current";
  }
  const baseRef: unknown = record.scope.mode === "review" ? record.scope.baseRef : undefined;
  if (typeof baseRef !== "string" || !pinnedBases.has(baseRef)) {
    return "not-current";
  }
  if (recordedReviewDiffSha256({ record }) !== landingDiffSha256) {
    return "not-current";
  }
  return floorHeldBases.has(baseRef) ? "current" : "floor-moved";
}

/**
 * Every reason one ledger row fails to witness a claim; empty means it witnesses. Pure.
 *
 * @param entry the ledger row, already known to carry the witness property id
 * @param record the pass record behind it, joined by artifact id; `undefined` when none backs it
 * @param claim the exact claim the manifest renders
 * @param judging the pinned bases, the landing patch and this manifest's held floor
 * @returns the rejections, in a fixed order
 */
export function witnessRejections({
  entry,
  record,
  claim,
  judging,
}: {
  entry: LedgerEntry;
  record: CodexArtifactRecord | undefined;
  claim: string;
  judging: WitnessJudging;
}): readonly WitnessRejection[] {
  const freshness = witnessFreshness({ entry, judging, record });
  if (record === undefined) {
    return [...entryRejections({ entry, freshness }), "record-missing"];
  }
  // Through `unknown`: `isRecordShaped` never inspects `tree`, so a count from disk is not known to be a number.
  const dirtyBytes: unknown = record.tree?.dirtyBytes;
  // The pass is read from BOTH the ledger row and the record behind it, so neither copy alone can vouch for an r3
  // the other contradicts.
  const recordPass: unknown = record.scope.mode === "review" ? record.scope.pass : undefined;
  const baseRef: unknown = record.scope.mode === "review" ? record.scope.baseRef : undefined;
  const failed: readonly (readonly [boolean, WitnessRejection])[] = [
    [recordPass !== "r3" && entry.pass === "r3", "not-adversarial"],
    [dirtyBytes !== 0, "dirty-capture"],
    [typeof baseRef !== "string" || !judging.pinnedBases.has(baseRef), "base-unpinned"],
    [statementOf({ record }) !== claim, "claim-differs"],
    [freshness === "floor-moved", "floor-moved"],
  ];
  return [
    ...entryRejections({ entry, freshness }),
    ...failed.filter(([fails]) => fails).map(([, rejection]) => rejection),
  ];
}

/**
 * The rejections the ledger row and its witness freshness decide. Pure. A `floor-moved` row is not also
 * `not-current`: its own rejection names the actionable cause.
 *
 * @param entry the ledger row
 * @param freshness the row's witness freshness
 * @returns the rejections, in a fixed order
 */
function entryRejections({
  entry,
  freshness,
}: {
  entry: LedgerEntry;
  freshness: WitnessFreshness;
}): readonly WitnessRejection[] {
  const failed: readonly (readonly [boolean, WitnessRejection])[] = [
    [entry.provider !== "codex", "not-codex"],
    [entry.mode !== "review", "not-a-review"],
    [entry.pass !== "r3", "not-adversarial"],
    [entry.verdict !== "CLEAN", "not-clean"],
    [freshness === "not-current", "not-current"],
    [entry.superseded !== undefined, "superseded"],
  ];
  return failed.filter(([fails]) => fails).map(([, rejection]) => rejection);
}

/**
 * Every pass record keyed by its artifact id, leaving out any id more than one record carries. Pure. Whichever
 * order the records arrive in, a shared id joins to nothing rather than to the last record read.
 *
 * @param records every pass record read
 * @returns each record whose artifact id no other record carries, keyed by that id
 */
function recordsByUniqueId({
  records,
}: {
  records: readonly CodexArtifactRecord[];
}): ReadonlyMap<string, CodexArtifactRecord> {
  const byId = new Map<string, CodexArtifactRecord>();
  const shared = new Set<string>();
  for (const record of records) {
    if (byId.has(record.artifactId)) {
      shared.add(record.artifactId);
    }
    byId.set(record.artifactId, record);
  }
  for (const artifactId of shared) {
    byId.delete(artifactId);
  }
  return byId;
}

/**
 * The manifests no review witnesses, each with what was found instead. Pure — the property the landing
 * verbs refuse on.
 *
 * @param manifests every bump manifest new against the pull request's base
 * @param entries the pull request's ledger rows, judged against its head
 * @param records every pass record read, which the rows are joined back to by artifact id
 * @param baseSha the pull request's base commit, named in the command that takes the witness
 * @param evidence the pinned bases, the landing patch and each manifest's held floor
 * @returns every unwitnessed manifest; empty when each has a witness and no current BROKEN review
 */
export function unwitnessedManifests({
  manifests,
  entries,
  records,
  baseSha,
  evidence,
}: {
  manifests: readonly NewManifest[];
  entries: readonly LedgerEntry[];
  records: readonly CodexArtifactRecord[];
  baseSha: string;
  evidence: BaselineBumpCarryEvidence;
}): readonly UnwitnessedManifest[] {
  const byId = recordsByUniqueId({ records });
  const out: UnwitnessedManifest[] = [];
  for (const { path, manifest } of manifests) {
    const propertyId = witnessPropertyId({ digest: manifest.digest });
    const claim = witnessClaim({ manifest });
    const judging = judgingFor({ digest: manifest.digest, evidence });
    const carrying = entries.filter((entry) => entry.propertyId === propertyId);
    const candidates = carrying.map((entry) => ({
      artifactId: entry.artifactId,
      rejections: witnessRejections({ claim, entry, judging, record: byId.get(entry.artifactId) }),
    }));
    const contradictedBy = carrying
      .filter((entry) => entry.verdict === "BROKEN" && entry.superseded === undefined)
      .filter((entry) => witnessFreshness({ entry, judging, record: byId.get(entry.artifactId) }) === "current")
      .map((entry) => entry.artifactId);
    if (contradictedBy.length > 0 || !candidates.some((candidate) => candidate.rejections.length === 0)) {
      const command = witnessCommand({ base: baseSha, manifest });
      out.push({ candidates, command, contradictedBy, digest: manifest.digest, path, propertyId });
    }
  }
  return out;
}

/**
 * What one manifest's rows are judged against. A manifest the evidence holds no floor row for holds no base, which
 * leaves every stale witness of it stale. Pure.
 *
 * @param digest the manifest's digest
 * @param evidence the carry evidence for the whole landing
 * @returns the judging inputs
 */
function judgingFor({ digest, evidence }: { digest: string; evidence: BaselineBumpCarryEvidence }): WitnessJudging {
  const { landingDiffSha256, pinnedBases } = evidence;
  const held = evidence.floorHeldBasesByDigest.get(digest);
  if (held === undefined) {
    return { floorHeldBases: new Set<string>(), landingDiffSha256, pinnedBases };
  }
  return { floorHeldBases: held, landingDiffSha256, pinnedBases };
}

/**
 * One detail line for an unwitnessed manifest: which, why, and the command that takes the witness. Pure.
 *
 * @param unwitnessed the manifest and what was found instead of a witness
 * @returns the line
 */
export function unwitnessedDetail({ unwitnessed }: { unwitnessed: UnwitnessedManifest }): string {
  const { candidates, contradictedBy, path, propertyId, command } = unwitnessed;
  const why: string[] = [];
  if (contradictedBy.length > 0) {
    why.push(`review ${contradictedBy.join(", ")} is CURRENT and BROKEN under this manifest's property id`);
  }
  if (candidates.length === 0) {
    why.push(`no review carries property id ${propertyId}`);
  }
  for (const candidate of candidates.filter((one) => one.rejections.length > 0)) {
    why.push(`${candidate.artifactId}: ${candidate.rejections.map((code) => REJECTION_TEXT[code]).join(", ")}`);
  }
  return `${path} has no Codex witness (${why.join("; ")}); take it with: ${command}`;
}

/**
 * The closing line every refusal on this subject prints, naming the absence of an override and the fix — a
 * hold with no hatch says so (`.claude/rules/error-handling.md`). Pure.
 *
 * @returns the line
 */
export function baselineBumpHoldLine(): string {
  return (
    `${BASELINE_BUMP_SUBJECT} has no acknowledgement and no escape hatch: --acknowledge and --acknowledge-all ` +
    "do not reach it. Take the Codex witness review each line names on the pull request's head, then land again."
  );
}
