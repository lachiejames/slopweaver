/**
 * The effectful edge that reads the DERIVED roster (`corpus/silver/index/identities.json`) and the freshness
 * verdict a consumer needs before trusting it. The parsing is pure (`./derivedRoster.ts`) and so is the
 * comparison (`./derive/freshness.ts`); everything that touches the disk is here, behind `safeFs`, so a
 * missing home is an empty roster and never a throw.
 *
 * The verdict compares the WATERMARK STAMP derive wrote beside the roster against a fresh observation of the
 * same sources — not two mtimes, which is what this used to do. An mtime comparison called the roster stale
 * after any refresh at all, including one that ingested nothing, so the warning it produced was noise on most
 * runs and indistinguishable from the one time it mattered.
 */
import { readFileSync } from "node:fs";
import { silverIdentitiesPath } from "../corpus/corpusPaths.js";
import { safeFs } from "../lib/safeBoundary.js";
import {
  type DeriveFreshness,
  deriveFreshness,
  type FreshnessObservation,
  type FreshnessStamp,
} from "./derive/freshness.js";
import { observeSources, readFreshnessStamp } from "./derive/stamp.js";
import { type DerivedRoster, EMPTY_DERIVED_ROSTER, parseDerivedRosterFile } from "./derivedRoster.js";

/** Why a roster and a stamp from two different derives are not trusted together. */
const UNPAIRED_WHY =
  "its freshness stamp was written by a different derive than the roster beside it, so what the roster was " +
  "derived from is unknowable";

/**
 * Read the derived roster plus the freshness verdict for it.
 *
 * @param home the Slopweaver home
 * @param rosterRevision the identity roster revision of the snapshot the caller resolves people with, so the
 *   verdict and the records it vouches for describe one roster
 * @returns the parsed roster, whether it still reflects what has been ingested, and the stamp and observation
 *   that verdict was computed from — `absent` whenever the stamp was not written by the derive that wrote the
 *   roster, so a verdict settled against the ask never vouches for a roster its stamp did not describe
 */
export function loadDerivedRoster({ home, rosterRevision }: { home: string; rosterRevision: number | null }): {
  readonly roster: DerivedRoster;
  readonly freshness: DeriveFreshness;
  readonly stamp: FreshnessStamp | undefined;
  readonly observed: FreshnessObservation;
} {
  // The STAMP first. Derive writes the roster and then the stamp, so from ONE derive a stamp read before the
  // roster can only be as new as the roster or older — never newer.
  const stamp = readFreshnessStamp({ home });
  const path = silverIdentitiesPath({ home });
  const read = safeFs({ execute: () => readFileSync(path, "utf8"), operation: "readDerivedRoster", path });
  const observed = observeSources({ home, rosterRevision });
  if (read.isErr()) {
    return {
      freshness: deriveFreshness({ artefactPresent: false, observed, stamp }),
      observed,
      roster: EMPTY_DERIVED_ROSTER,
      stamp,
    };
  }
  const file = parseDerivedRosterFile({ content: read.value });
  // Read order cannot help when TWO derives run at once: the later-finishing one can overwrite the roster
  // while the stamp on disk is still the other's, and that stamp — observed after a send's ask — would settle
  // an older roster. Both files name the observation they came from, so a pair that disagrees is no derive's
  // output at all, and is treated as a roster whose sources are unknowable.
  if (stamp !== undefined && file.observedAtIso !== stamp.observedAtIso) {
    return { freshness: { kind: "absent", why: UNPAIRED_WHY }, observed, roster: file.roster, stamp };
  }
  return {
    freshness: deriveFreshness({ artefactPresent: true, observed, stamp }),
    observed,
    roster: file.roster,
    stamp,
  };
}
