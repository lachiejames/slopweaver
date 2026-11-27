/**
 * The real filesystem and git answers `./orphanedEvidence.ts` asks for, and the two landing reads' one call over
 * them. IO edge, memoised per read so one landing press asks each question once however many records share a
 * checkout or a commit.
 */

import { lstatSync } from "node:fs";
import { gitAncestry, gitSucceeds } from "../devLint/gitAtCommit.js";
import type { FallbackReceiptScan } from "./fallbackDocuments.js";
import {
  type OrphanProbes,
  type OrphanSubject,
  type RecordedPathState,
  recordedBranchesOf,
  rehomeOrphanedReceipts,
  rehomeOrphanedRecords,
} from "./orphanedEvidence.js";
import type { CodexArtifactRecord } from "./types.js";

/**
 * The pass records with each re-provable orphan re-homed into a qualifying checkout, over the real filesystem and
 * git — what the bump witness folds.
 *
 * @param qualified the qualifying surviving checkouts, in the order the read ranked them
 * @returns the records, in the same order
 */
export function reprovedRecords({
  qualified,
  records,
  subject,
}: {
  qualified: readonly { readonly root: string }[];
  records: readonly CodexArtifactRecord[];
  subject: OrphanSubject;
}): readonly CodexArtifactRecord[] {
  const targets = qualified.map((checkout) => checkout.root);
  // This read applies no branch continuity, so the records ARE what was scanned.
  const recordedBranches = recordedBranchesOf({ receipts: undefined, records });
  return rehomeOrphanedRecords({ probes: productionOrphanProbes(), recordedBranches, records, subject, targets });
}

/** The records and receipts one landing read folds. */
interface LandingEvidence {
  readonly scan: { readonly records: readonly CodexArtifactRecord[] };
  readonly receipts: FallbackReceiptScan;
}

/**
 * The pass records AND fallback receipts with each re-provable orphan re-homed — what the pairing floor folds.
 *
 * @param qualified the qualifying surviving checkouts, in the order the read ranked them
 * @param scanned the records and receipts exactly as read off disk, before branch continuity: the branch each one
 *   RECORDED is the one an orphan is held to
 * @param evidence the same, after branch continuity — what is re-homed and returned
 * @returns both, re-proved orphans re-homed and everything else unchanged
 */
export function reprovedLandingEvidence({
  qualified,
  scanned,
  evidence,
  subject,
}: {
  qualified: readonly { readonly root: string }[];
  scanned: LandingEvidence;
  evidence: LandingEvidence;
  subject: OrphanSubject;
}): { readonly records: readonly CodexArtifactRecord[]; readonly receipts: FallbackReceiptScan } {
  const probes = productionOrphanProbes();
  const targets = qualified.map((checkout) => checkout.root);
  const recordedBranches = recordedBranchesOf({ receipts: scanned.receipts, records: scanned.scan.records });
  return {
    receipts: rehomeOrphanedReceipts({ probes, receipts: evidence.receipts, recordedBranches, subject, targets }),
    records: rehomeOrphanedRecords({ probes, recordedBranches, records: evidence.scan.records, subject, targets }),
  };
}

/**
 * Whether a recorded checkout path is there. `lstat`, so a dangling symlink at the path reads as PRESENT — a
 * path still standing, which keeps today's qualification — and only `ENOENT`/`ENOTDIR` reads as gone; a
 * permission or I/O failure is `unknown`, never a deletion.
 *
 * @param path the recorded checkout path
 * @returns the classified answer
 */
export function recordedPathState({ path }: { path: string }): RecordedPathState {
  try {
    lstatSync(path);
    return "present";
  } catch (error) {
    const code = error instanceof Error && "code" in error ? error.code : undefined;
    return code === "ENOENT" || code === "ENOTDIR" ? "missing" : "unknown";
  }
}

/**
 * The production probes, each answer cached for the life of the returned object — build one per landing read.
 *
 * @returns probes over the real filesystem and git
 */
function productionOrphanProbes(): OrphanProbes {
  const paths = new Map<string, RecordedPathState>();
  const held = new Map<string, boolean>();
  const ancestry = new Map<string, "yes" | "no" | "error">();
  return {
    ancestry: ({ root, ancestor, descendant }) => {
      const key = `${root}\u0000${ancestor}\u0000${descendant}`;
      const cached = ancestry.get(key);
      if (cached !== undefined) {
        return cached;
      }
      const answer = gitAncestry({ ancestor, descendant, root });
      ancestry.set(key, answer);
      return answer;
    },
    holdsCommit: ({ root, commit }) => {
      const key = `${root}\u0000${commit}`;
      const cached = held.get(key);
      if (cached !== undefined) {
        return cached;
      }
      const answer = gitSucceeds({ args: ["cat-file", "-e", `${commit}^{commit}`], root });
      held.set(key, answer);
      return answer;
    },
    pathState: ({ path }) => {
      const cached = paths.get(path);
      if (cached !== undefined) {
        return cached;
      }
      const answer = recordedPathState({ path });
      paths.set(path, answer);
      return answer;
    },
  };
}
