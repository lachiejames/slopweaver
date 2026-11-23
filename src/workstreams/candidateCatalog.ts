/**
 * The ONE set of candidates every Workstreams verb reads: the outcomes the owner stated (`stated-candidates.json` in the
 * state home) first, in the order the owner stated them, then the mined ones (`candidates.json`) in their file order.
 *
 * There is one way of doing things: a stated outcome and a mined one differ only in where the
 * proposal came from, so they share one listing, one set of reaction words and one promotion; only a keep writes an
 * outcome, onto the register. Nothing here is an outcome, and composing a catalog writes nothing.
 *
 * Pure: `./candidateStore.ts`'s `readCandidateCatalog` is the effectful edge that reads both files.
 */
import { err, ok, type Result } from "#lib/result.js";

import { type CandidatesError, CandidatesErrors } from "./candidateErrors.js";
import { type Candidate, type CandidatesFile, candidateSetProblems } from "./candidates.js";

/** Where the mined half of a catalog came from, as its file records it; `null` when nothing has been mined yet. */
export type MinedProvenance = Pick<CandidatesFile, "minedFrom" | "minedIso" | "minedSources">;

/** Every candidate the owner can answer, and what the register needs to carry a yes onto a tile. */
export interface CandidateCatalog {
  /** Stated ones first, in the owner's statement order, then the mined ones in file order. */
  readonly candidates: readonly Candidate[];
  /** Every Slack conversation a mined candidate's evidence links into, named; a stated one links into none. */
  readonly channels: CandidatesFile["channels"];
  /** The mined file's provenance, or `null` before any mining pass. */
  readonly mined: MinedProvenance | null;
}

/**
 * Compose the catalog from the stated candidates and the mined file, refusing a set in which an id, a number or a name is
 * carried twice across the two — the owner's reply names a candidate by id or number, so a clash would hand the owner's word to the
 * wrong one. Neither input is changed.
 *
 * @param mined the mined candidates file, or `null` when there is none yet
 * @param stated the stated candidates, the state home's `stated-candidates.json` outside a test
 * @returns the catalog, or every clash named
 */
export function candidateCatalog({
  mined,
  stated,
}: {
  mined: CandidatesFile | null;
  stated: readonly Candidate[];
}): Result<CandidateCatalog, CandidatesError> {
  if (mined === null) {
    const problems = candidateSetProblems({ candidates: stated });
    if (problems.length > 0) {
      return err(CandidatesErrors.invalid({ problems }));
    }
    return ok({ candidates: [...stated], channels: {}, mined: null });
  }
  const candidates = [...stated, ...mined.candidates];
  const problems = candidateSetProblems({ candidates });
  if (problems.length > 0) {
    return err(CandidatesErrors.invalid({ problems }));
  }
  return ok({
    candidates,
    channels: { ...mined.channels },
    mined: { minedFrom: mined.minedFrom, minedIso: mined.minedIso, minedSources: [...mined.minedSources] },
  });
}
