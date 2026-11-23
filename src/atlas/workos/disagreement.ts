/**
 * Where the two surfaces disagree — an OUTPUT of this atlas, never a build-time check.
 *
 * Owner's ruling, `docs/atlas-intent/04-corroboration.md`: corroboration between the API and the browser is a thing the
 * atlas SHOWS, both records are kept regardless, and which surface wins when they differ is the owner's call once
 * the owner can see real instances. So this module reports the instances and resolves none of them.
 *
 * ## What can actually disagree here, and what cannot
 *
 * The API channel publishes every dashboard address this atlas declares; the browser channel says which of
 * those a signed-in person could open. Three findings follow, and each is a different sentence:
 *
 * - **declared and unwitnessed** — the atlas knows the address and no browser has ever landed on it. On an
 *   install whose browser surface has never been filled this is every page, which is why it is reported as
 *   a count with a cause rather than as a per-page finding.
 * - **declared and unreachable** — a walk tried and could not open it. This is the one a reader acts on:
 *   either the route no longer exists, or the account's dashboard role does not reach it, and the walk's
 *   own reason says which.
 * - **witnessed and undeclared** — the walk landed somewhere this atlas's route table does not name. That
 *   is the most interesting of the three here, because the dashboard is the ONE half whose route table
 *   cannot be checked any other way: its unauthenticated sign-in redirect is a catch-all
 *   (`dashboardPages.ts`), so a walk is the only thing that can ever prove this table wrong.
 */
import {
  type AtlasPageDisagreement,
  type AtlasPageDisagreementReport,
  atlasPageDisagreementReport,
} from "../kit/pageDisagreement.js";

import type { WorkosAtlasEntity } from "./model.js";

/**
 * One page the two channels do not agree about. Kit-owned, so two atlases' reports stay comparable.
 *
 * @internal
 */
export type WorkosPageDisagreement = AtlasPageDisagreement;

/**
 * Every disagreement one generation holds, plus the counts a reader needs to size them.
 *
 * @internal
 */
export type WorkosDisagreementReport = AtlasPageDisagreementReport;

/**
 * Compare the two channels across every stored `page` entity.
 *
 * @param pages every `page` entity the generation holds
 * @returns the counts and every disagreement, sorted by provider id so a printed report is stable
 */
export function workosDisagreementReport({ pages }: { pages: readonly WorkosAtlasEntity[] }): WorkosDisagreementReport {
  return atlasPageDisagreementReport({
    pages: pages.map((page) => ({
      declared: page.channels.api,
      providerId: page.providerId,
      witnessed: page.channels.browser,
    })),
    unwitnessedReason: "no dashboard walk has landed on this address",
  });
}

/**
 * One route family and how much of it the running API proved present.
 *
 * Distinct from the page report above, and both are `report`'s output: this half is the API channel
 * corroborating THIS REPOSITORY's candidate table rather than the two channels corroborating each other.
 * A family with absent rows is where the local denominator and the running server disagree, and naming it
 * is what turns `route-candidate-absent` from a pile of gaps into something a reader can act on.
 *
 * @internal
 */
export interface WorkosFamilyCoverage {
  readonly family: string;
  readonly present: number;
  readonly absent: number;
}

/** How many of one family's routes the running server answered, and how many it did not. */
interface FamilyTally {
  present: number;
  absent: number;
}

/** The counts a family already holds, or a fresh zeroed pair the first time one of its routes is graded. */
function familyCounts({ held }: { held: FamilyTally | undefined }): FamilyTally {
  if (held == null) {
    return { absent: 0, present: 0 };
  }
  return held;
}

/**
 * How each route family fared against the running server.
 *
 * @param operations every `operation` entity the generation holds
 * @returns one row per family, sorted by family name
 */
export function workosFamilyCoverage({
  operations,
}: {
  operations: readonly WorkosAtlasEntity[];
}): readonly WorkosFamilyCoverage[] {
  const tally = new Map<string, FamilyTally>();
  for (const operation of operations) {
    const detail = operation.channels.api?.detail;
    if (typeof detail !== "object" || detail === null || !("family" in detail) || !("verdict" in detail)) {
      continue;
    }
    const family = detail.family;
    const verdict = detail.verdict;
    if (typeof family !== "string" || typeof verdict !== "string") {
      continue;
    }
    const row = familyCounts({ held: tally.get(family) });
    if (verdict === "absent") {
      row.absent += 1;
    } else {
      row.present += 1;
    }
    tally.set(family, row);
  }
  return [...tally.entries()]
    .map(([family, counts]) => ({ absent: counts.absent, family, present: counts.present }))
    .toSorted((left, right) => left.family.localeCompare(right.family));
}
