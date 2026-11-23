/**
 * One descriptor exclusion as an atlas page prints it — the contract's own two predicates applied once, so
 * the page never re-judges a ground.
 */
import { type AtlasExclusion, isRefusedExclusion, withholdsRecords } from "./contract.js";

/** One exclusion, with the two predicates the contract already owns applied so the page never re-judges. */
export interface AtlasPageExclusion {
  readonly ground: string;
  readonly because: string;
  readonly refused: boolean;
  readonly withholdsRecords: boolean;
}

/**
 * Project one exclusion for the page.
 *
 * @param exclusion the descriptor's own row
 * @returns the row, with whether it is refused and whether it withholds records already decided
 */
export function pageExclusion({ exclusion }: { exclusion: AtlasExclusion }): AtlasPageExclusion {
  return {
    because: exclusion.because,
    ground: exclusion.ground,
    refused: isRefusedExclusion({ exclusion }),
    withholdsRecords: withholdsRecords({ exclusion }),
  };
}
