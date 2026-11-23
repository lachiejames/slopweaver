/**
 * The fixtures `candidates.test.ts` builds its cases from: the parsed candidates file and its catalog, the
 * workstream a yes on c-002 makes, and the reaction rows a test does not care to spell out.
 */
import { unwrap } from "#lib/result.js";
import { candidateCatalog } from "../../../workstreams/candidateCatalog.js";
import { parseCandidatesFile, type ReactionRow } from "../../../workstreams/candidates.js";
import { entryFromCandidate } from "../../../workstreams/candidateTile.js";
import type { Ending } from "../../../workstreams/planSoFar.js";
import type { WorkstreamAggregate } from "../../../workstreams/store/types.js";

import { validCandidates } from "./candidatesFixture.js";
import { countingMintId } from "./storeRegisterFixture.js";

/** The fixture's three mined candidates, parsed. */
export const file = unwrap(parseCandidatesFile({ value: validCandidates() }));

/** The fixture's mined candidates as a catalog of their own, so the document's counts are the fixture's three. */
export const catalog = unwrap(candidateCatalog({ mined: file, stated: [] }));

/**
 * The fixture's c-002 as the workstream a word on the fixture's reaction day makes, its ids minted from 1.
 * @returns the promoted workstream aggregate
 */
export function promotedC002({ ending = null }: { ending?: Ending | null } = {}): WorkstreamAggregate {
  return unwrap(
    entryFromCandidate({
      candidate: file.candidates[1]!,
      definition: null,
      ending,
      mintId: countingMintId(),
      reactedOn: "2026-10-02",
      reactionAnchor: null,
      taken: new Set(),
    }),
  );
}

/** No definitions picked and no drafts parked. */
export const NOTHING_ELSE = { definitions: [], drafts: [], proposals: [], titles: [], whoFirst: [] } as const;

/** Every placing field a row carries, none set. */
export const UNPLACED = {
  coveredBy: null,
  milestoneOf: null,
  outcomeOf: null,
  owner: null,
  sameAs: null,
  steer: null,
  supersededBy: null,
} as const;

/**
 * One reaction row with the fields a test does not care about filled.
 * @returns the row
 */
export function row({
  candidate,
  reaction,
  promotedAs = null,
  iso = "2026-10-02T13:00:00.000Z",
  heard = null,
}: {
  candidate: string;
  reaction: ReactionRow["reaction"];
  promotedAs?: string | null;
  iso?: string;
  heard?: string | null;
}): ReactionRow {
  const name = file.candidates.find((one) => one.id === candidate)!.name;
  return {
    ...UNPLACED,
    anchor: null,
    bySession: "test",
    candidate,
    heard,
    iso,
    name,
    promotedAs,
    reaction,
    reason: null,
    via: "word",
  };
}

/**
 * An abandoned row, carrying the reason and anchor its schema requires.
 * @returns the row
 */
export function abandonedRow({ candidate }: { candidate: string }): ReactionRow {
  return { ...row({ candidate, reaction: "abandoned" }), anchor: "talk-call:x#turn_y", reason: "dropped" };
}

/** The ending an abandoned word writes onto its workstream. */
export const ENDING = { anchor: "talk-call:x#turn_y", kind: "abandoned", on: "2026-10-02", reason: "dropped" } as const;
