/**
 * The git evidence the ratchet-bump witness (`./baselineBumpWitness.ts`) needs to carry a STALE witness across a
 * rebase that changed neither its patch nor its floor. The effectful half; the pure half decides.
 *
 * Three facts, each read here from git and none supplied by a caller:
 *
 *  - **Which review bases are pinned**: a full commit SHA the landing base already holds. Freshness recomputes a
 *    review's diff from its base REF, so a moving one (`HEAD`, a branch the author controls) recomputes an empty
 *    diff at every commit and would read CURRENT for code nobody reviewed.
 *  - **The landing patch**: the sha256 of the diff the pull request head presents against the base it lands on,
 *    hashed exactly as `codex review` records one (`commitDiffSha256`, `./diffsNow.ts`) — the patch identity the
 *    landing floor's own carry uses (`./diffCarry.ts`).
 *  - **Which pinned bases hold this manifest's floor**: every file the manifest's rows name has the same
 *    content at the review's base and at the landing base. The same patch on a different floor is a different
 *    claim, so a rebase that moved what the bump is measured against voids the witness.
 *
 * Every git failure leaves a fact ABSENT, never guessed: a missing digest or an unheld base leaves a stale witness
 * stale, which is the one direction this read may fail in.
 */

import { isRecord } from "#lib/parsers.js";
import { witnessPropertyId } from "../devLint/baselineBump.js";
import { gitSucceeds } from "../devLint/gitAtCommit.js";
import type { BaselineBumpCarryEvidence } from "./baselineBumpWitness.js";
import type { BumpRecord } from "./bumpRecordStore.js";
import { commitDiffSha256 } from "./diffsNow.js";
import type { CodexArtifactRecord } from "./types.js";

/** A full git object name, the only review base ref that cannot move. */
const FULL_SHA = /^[0-9a-f]{40}$/u;

/**
 * Every full-SHA base ref a review under each property id was taken against. Pure. Read through `unknown`,
 * because a record from disk is only shallow-decoded.
 *
 * @param records every pass record read
 * @param propertyIds the witness property ids asked about
 * @returns property id → its reviews' full-SHA base refs
 */
function reviewBasesById({
  records,
  propertyIds,
}: {
  records: readonly CodexArtifactRecord[];
  propertyIds: ReadonlySet<string>;
}): ReadonlyMap<string, ReadonlySet<string>> {
  const byId = new Map<string, Set<string>>();
  for (const record of records) {
    if (record.scope.mode !== "review") {
      continue;
    }
    const property: unknown = record.scope.property;
    const id = isRecord(property) ? property["id"] : undefined;
    const ref: unknown = record.scope.baseRef;
    if (typeof id !== "string" || !propertyIds.has(id) || typeof ref !== "string" || !FULL_SHA.test(ref)) {
      continue;
    }
    const bases = byId.get(id);
    if (bases === undefined) {
      byId.set(id, new Set([ref]));
    } else {
      bases.add(ref);
    }
  }
  return byId;
}

/**
 * Whether the files a manifest's rows name (a ratchet row's baseline, a policy row's source file) are identical at
 * a pinned review base and the landing base. The base itself holds reflexively; anything else asks
 * `git diff --quiet`, whose every non-zero outcome — a difference, a bad object, a timeout — reads as not held.
 * Each row file is a name, never a pathspec: `--literal-pathspecs` stops a file named like pathspec magic, such as
 * `:(exclude,glob)**`, from excluding every path and reading a changed floor as held. `--no-ext-diff` and
 * `--no-textconv` stop an external diff helper or a conversion filter, from config or the environment, from
 * answering for git. IO edge.
 *
 * @param base the pinned review base
 * @param baseSha the landing base
 * @param files the manifest's row files, sorted and unique
 * @param root a checkout holding both commits
 * @returns `true` only when git proved the files unchanged
 */
function floorHeld({
  base,
  baseSha,
  files,
  root,
}: {
  base: string;
  baseSha: string;
  files: readonly string[];
  root: string;
}): boolean {
  if (base === baseSha) {
    return true;
  }
  const args = ["--literal-pathspecs", "diff", "--quiet", "--no-ext-diff", "--no-textconv", base, baseSha, "--"];
  return gitSucceeds({ args: [...args, ...files], root });
}

/**
 * Read the pinned bases, the landing patch and each manifest's held floor in one pass over the records. A ledger
 * with no review under any manifest's witness property id costs no git call. IO edge.
 *
 * @param baseSha the commit the pull request lands on — the landing branch's tip for a native-stack member
 * @param headSha the pull request head being judged
 * @param manifests the eligible bump records whose witnesses are asked about
 * @param records every pass record the scan read
 * @param root a full-history checkout holding both commits
 * @returns the evidence; a manifest with no held base maps to an empty set
 */
export function readBaselineBumpCarryEvidence({
  baseSha,
  headSha,
  manifests,
  records,
  root,
}: {
  baseSha: string;
  headSha: string;
  manifests: readonly BumpRecord[];
  records: readonly CodexArtifactRecord[];
  root: string;
}): BaselineBumpCarryEvidence {
  const asking = manifests.map(({ manifest }) => ({ id: witnessPropertyId({ digest: manifest.digest }), manifest }));
  const basesById = reviewBasesById({ propertyIds: new Set(asking.map(({ id }) => id)), records });
  const asked = new Set([...basesById.values()].flatMap((bases) => [...bases]));
  const pinnedBases = new Set(
    [...asked].filter((ref) => gitSucceeds({ args: ["merge-base", "--is-ancestor", ref, baseSha], root })),
  );
  const floorHeldBasesByDigest = new Map<string, ReadonlySet<string>>();
  for (const { id, manifest } of asking) {
    const files = [...new Set(manifest.loosenings.map((row) => row.file))].toSorted();
    const own = basesById.get(id);
    const candidates = own === undefined ? [] : [...own].filter((base) => pinnedBases.has(base));
    const held = candidates.filter((base) => floorHeld({ base, baseSha, files, root }));
    floorHeldBasesByDigest.set(manifest.digest, new Set(held));
  }
  if (pinnedBases.size === 0) {
    return { floorHeldBasesByDigest, landingDiffSha256: undefined, pinnedBases };
  }
  const digest = commitDiffSha256({ base: baseSha, commit: headSha, cwd: root });
  return { floorHeldBasesByDigest, landingDiffSha256: digest.isOk() ? digest.value : undefined, pinnedBases };
}
