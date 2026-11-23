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
 *  - **CURRENT for the pull request's head**, judged by the ledger's own freshness rule, and **not superseded**.
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
  | "claim-differs";

/** The sentence each rejection prints. */
const REJECTION_TEXT: Readonly<Record<WitnessRejection, string>> = {
  "base-unpinned":
    "its --base is not a full commit SHA the pull request's base branch holds, so its freshness cannot be trusted",
  "claim-differs": "its property statement is not the manifest's exact claim",
  "dirty-capture": "it read uncommitted bytes on top of its HEAD",
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
 * Every reason one ledger row fails to witness a claim; empty means it witnesses. Pure.
 *
 * @param entry the ledger row, already known to carry the witness property id
 * @param record the pass record behind it, joined by artifact id; `undefined` when none backs it
 * @param claim the exact claim the manifest renders
 * @param pinnedBases the review base refs already proven full commit SHAs the pull request's base branch holds
 * @returns the rejections, in a fixed order
 */
export function witnessRejections({
  entry,
  record,
  claim,
  pinnedBases,
}: {
  entry: LedgerEntry;
  record: CodexArtifactRecord | undefined;
  claim: string;
  pinnedBases: ReadonlySet<string>;
}): readonly WitnessRejection[] {
  if (record === undefined) {
    return [...entryRejections({ entry }), "record-missing"];
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
    [typeof baseRef !== "string" || !pinnedBases.has(baseRef), "base-unpinned"],
    [statementOf({ record }) !== claim, "claim-differs"],
  ];
  return [...entryRejections({ entry }), ...failed.filter(([fails]) => fails).map(([, rejection]) => rejection)];
}

/**
 * The rejections the ledger row alone decides. Pure.
 *
 * @param entry the ledger row
 * @returns the rejections, in a fixed order
 */
function entryRejections({ entry }: { entry: LedgerEntry }): readonly WitnessRejection[] {
  const failed: readonly (readonly [boolean, WitnessRejection])[] = [
    [entry.provider !== "codex", "not-codex"],
    [entry.mode !== "review", "not-a-review"],
    [entry.pass !== "r3", "not-adversarial"],
    [entry.verdict !== "CLEAN", "not-clean"],
    [entry.freshness.kind !== "current", "not-current"],
    [entry.superseded !== undefined, "superseded"],
  ];
  return failed.filter(([fails]) => fails).map(([, rejection]) => rejection);
}

/**
 * The manifests no review witnesses, each with what was found instead. Pure — the property the landing
 * verbs refuse on.
 *
 * @param manifests every bump manifest new against the pull request's base
 * @param entries the pull request's ledger rows, judged against its head
 * @param records every pass record read, which the rows are joined back to by artifact id
 * @param baseSha the pull request's base commit, named in the command that takes the witness
 * @param pinnedBases the review base refs already proven full commit SHAs the pull request's base branch holds
 * @returns every unwitnessed manifest; empty when each has a witness and no current BROKEN review
 */
export function unwitnessedManifests({
  manifests,
  entries,
  records,
  baseSha,
  pinnedBases,
}: {
  manifests: readonly NewManifest[];
  entries: readonly LedgerEntry[];
  records: readonly CodexArtifactRecord[];
  baseSha: string;
  pinnedBases: ReadonlySet<string>;
}): readonly UnwitnessedManifest[] {
  const byId = new Map(records.map((record) => [record.artifactId, record]));
  const out: UnwitnessedManifest[] = [];
  for (const { path, manifest } of manifests) {
    const propertyId = witnessPropertyId({ digest: manifest.digest });
    const claim = witnessClaim({ manifest });
    const carrying = entries.filter((entry) => entry.propertyId === propertyId);
    const candidates = carrying.map((entry) => ({
      artifactId: entry.artifactId,
      rejections: witnessRejections({ claim, entry, pinnedBases, record: byId.get(entry.artifactId) }),
    }));
    const contradictedBy = carrying
      .filter((entry) => entry.verdict === "BROKEN" && entry.freshness.kind === "current")
      .filter((entry) => entry.superseded === undefined)
      .map((entry) => entry.artifactId);
    if (contradictedBy.length > 0 || !candidates.some((candidate) => candidate.rejections.length === 0)) {
      const command = witnessCommand({ base: baseSha, manifest });
      out.push({ candidates, command, contradictedBy, digest: manifest.digest, path, propertyId });
    }
  }
  return out;
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
