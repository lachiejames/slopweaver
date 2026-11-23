/**
 * Where each home register lives on disk, for `slopweaver store share`.
 *
 * Split out of `shareRun.ts` along the one seam it had: these switches resolve a path from the state-home
 * contract and touch nothing, while that file walks the paths and asks the store for row counts.
 */

import type { stateHomePaths } from "../../../stateHome.js";
import type { HomeRegister } from "../../../store/homeRegisters.js";

/** The path keys {@link treePathOf} resolves: the trees and artifact directories, after every record file. */
type TreePathKey =
  | "corpusBronze"
  | "atlasRoot"
  | "publishedPages"
  | "bakeoff"
  | "datadogShotsDir"
  | "evidenceDir"
  | "proofDir"
  | "datadogHits"
  | "datadogCatalogueRoot";

/** The path keys {@link recordPathOf} resolves: the identity, plan, Codex, landing and knowledge-domain record files. */
type RecordPathKey =
  | "identityJson"
  | "profileJson"
  | "plansJson"
  | "codexSignInDir"
  | "landingPressesJsonl"
  | "landingReadsJson"
  | "codexSupersessionsJsonl"
  | "knowledgeDomainsJson"
  | "ownerDirectivesJson"
  | "standingAsksJsonl"
  | "steerKindsJsonl";

/** The path keys {@link fleetPathOf} resolves: the cmux, fleet, org-health and singleton record files. */
type FleetPathKey =
  | "cmuxSessionActivityJson"
  | "cmuxEventCursorJson"
  | "fleetConfigJson"
  | "fleetResumeJsonl"
  | "cmuxReviveJsonl"
  | "orgHealthIncidentsJson"
  | "orgHealthSightingsJson"
  | "orgHealthAcknowledgementsJsonl"
  | "gmailTriageRulesJson"
  | "browserJson"
  | "staleSeatNoticesJson";

/**
 * Resolve a register's absolute path through the one state-home contract.
 *
 * Every arm reads `stateHomePaths()` rather than joining onto the home, which is what
 * `src/__tests__/unit/stateHome.guard.test.ts` enforces; the two ledger arms join onto the `ledgers`
 * DIRECTORY that contract already resolved, which is the same shape `src/reflect/brief.ts` uses.
 *
 * Switches rather than one table: a `Record` whose entries read `key: (paths) => paths.key` is a
 * property naming itself, which `whole-file-json`'s name index cannot resolve, so every ledger read behind
 * that name would drop out of the gate. The ledgers and journals are resolved here, the install's own
 * record files in {@link recordPathOf}, the fleet's in {@link fleetPathOf}, the trees in {@link treePathOf}.
 *
 * @param register the row to resolve
 * @param paths the resolved state-home contract
 * @returns its absolute path, or `undefined` for a `declared-only` register that has none
 */
export function registerPathOf({
  register,
  paths,
}: {
  register: HomeRegister;
  paths: ReturnType<typeof stateHomePaths>;
}): string | undefined {
  // Read once: both switches must judge the same key, so the tree arm never re-reads the property.
  const { pathKey } = register;
  switch (pathKey) {
    case "handovers":
      return paths.handovers;
    case "runs":
      return paths.runs;
    case "knowledgeLessonsJsonl":
      return paths.knowledgeLessonsJsonl;
    case "identityJson":
    case "profileJson":
    case "plansJson":
    case "codexSignInDir":
    case "landingPressesJsonl":
    case "landingReadsJson":
    case "codexSupersessionsJsonl":
    case "knowledgeDomainsJson":
    case "ownerDirectivesJson":
    case "standingAsksJsonl":
    case "steerKindsJsonl":
      return recordPathOf({ pathKey, paths });
    case "cmuxSessionActivityJson":
    case "cmuxEventCursorJson":
    case "fleetConfigJson":
    case "fleetResumeJsonl":
    case "cmuxReviveJsonl":
    case "orgHealthIncidentsJson":
    case "orgHealthSightingsJson":
    case "orgHealthAcknowledgementsJsonl":
    case "gmailTriageRulesJson":
    case "browserJson":
    case "staleSeatNoticesJson":
      return fleetPathOf({ pathKey, paths });
    case undefined:
      return undefined;
    case "corpusBronze":
    case "atlasRoot":
    case "publishedPages":
    case "bakeoff":
    case "datadogShotsDir":
    case "evidenceDir":
    case "proofDir":
    case "datadogHits":
    case "datadogCatalogueRoot":
      return treePathOf({ pathKey, paths });
    default: {
      const exhaustive: never = pathKey;
      return exhaustive;
    }
  }
}

/**
 * The identity, plan, Codex and landing half of {@link registerPathOf}: the install's own record files.
 *
 * @param pathKey a record key the main switch names and hands over, so a key added to neither fails to compile
 * @param paths the resolved state-home contract
 * @returns its absolute path
 */
function recordPathOf({
  pathKey,
  paths,
}: {
  pathKey: RecordPathKey;
  paths: ReturnType<typeof stateHomePaths>;
}): string {
  switch (pathKey) {
    case "identityJson":
      return paths.identityJson;
    case "profileJson":
      return paths.profileJson;
    case "plansJson":
      return paths.plansJson;
    case "codexSignInDir":
      return paths.codexSignInDir;
    case "landingPressesJsonl":
      return paths.landingPressesJsonl;
    case "landingReadsJson":
      return paths.landingReadsJson;
    case "codexSupersessionsJsonl":
      return paths.codexSupersessionsJsonl;
    case "knowledgeDomainsJson":
      return paths.knowledgeDomainsJson;
    case "ownerDirectivesJson":
      return paths.judgement.ownerDirectivesJson;
    case "standingAsksJsonl":
      return paths.judgement.standingAsksJsonl;
    case "steerKindsJsonl":
      return paths.judgement.steerKindsJsonl;
    default: {
      const exhaustive: never = pathKey;
      return exhaustive;
    }
  }
}

/**
 * The fleet half of {@link registerPathOf}: the cmux, fleet, org-health and singleton record files.
 *
 * @param pathKey a fleet key the record-file switch names and hands over, so a key added to neither fails to compile
 * @param paths the resolved state-home contract
 * @returns its absolute path
 */
function fleetPathOf({ pathKey, paths }: { pathKey: FleetPathKey; paths: ReturnType<typeof stateHomePaths> }): string {
  switch (pathKey) {
    case "cmuxSessionActivityJson":
      return paths.cmuxSessionActivityJson;
    case "cmuxEventCursorJson":
      return paths.cmuxEventCursorJson;
    case "fleetConfigJson":
      return paths.fleetConfigJson;
    case "fleetResumeJsonl":
      return paths.fleetResumeJsonl;
    case "cmuxReviveJsonl":
      return paths.cmuxReviveJsonl;
    case "orgHealthIncidentsJson":
      return paths.orgHealthIncidentsJson;
    case "orgHealthSightingsJson":
      return paths.orgHealthSightingsJson;
    case "orgHealthAcknowledgementsJsonl":
      return paths.orgHealthAcknowledgementsJsonl;
    case "gmailTriageRulesJson":
      return paths.gmailTriageRulesJson;
    case "browserJson":
      return paths.browserJson;
    case "staleSeatNoticesJson":
      return paths.staleSeatNoticesJson;
    default: {
      const exhaustive: never = pathKey;
      return exhaustive;
    }
  }
}

/**
 * The tree half of {@link registerPathOf}: the corpus, atlas and artifact directories.
 *
 * @param pathKey a tree key the record-file switch names and hands over, so a key added to neither fails to compile
 * @param paths the resolved state-home contract
 * @returns its absolute path
 */
function treePathOf({ pathKey, paths }: { pathKey: TreePathKey; paths: ReturnType<typeof stateHomePaths> }): string {
  switch (pathKey) {
    case "corpusBronze":
      return paths.corpus.bronze;
    case "atlasRoot":
      return paths.atlas.root;
    case "publishedPages":
      return paths.publishedPages;
    case "bakeoff":
      return paths.bakeoff;
    case "datadogShotsDir":
      return paths.datadogShotsDir;
    case "evidenceDir":
      return paths.evidenceDir;
    case "proofDir":
      return paths.proofDir;
    case "datadogHits":
      return paths.datadogHits;
    case "datadogCatalogueRoot":
      return paths.datadogCatalogue.root;
    default: {
      const exhaustive: never = pathKey;
      return exhaustive;
    }
  }
}
