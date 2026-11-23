/**
 * Where the two surfaces disagree — an OUTPUT of this atlas, never a build-time check.
 *
 * Owner's ruling, `docs/atlas-intent/04-corroboration.md`: corroboration between the API and the browser is a thing the
 * atlas SHOWS, both records are kept regardless, and which surface wins when they differ is the owner's call once
 * they can see real instances. So this module reports the instances and resolves none of them.
 *
 * ## What can actually disagree here, and what cannot
 *
 * The API channel computes every console address from the registry's own slugs; the browser channel says
 * which of those a signed-in person could open. Three findings follow, and each is a different sentence:
 *
 * - **declared and unwitnessed** — the atlas knows the address and no browser has ever landed on it. On an
 *   install whose browser surface has never been filled this is every page, which is why it is reported as
 *   a count with a cause rather than as a per-page finding.
 * - **declared and unreachable** — a walk tried and could not open it. This is the one a reader acts on:
 *   either the route no longer exists, or the account's role does not reach it, and the walk's own reason
 *   says which.
 * - **witnessed and undeclared** — the walk landed somewhere this atlas's route table does not name. That
 *   is a page the registry's slugs could not have produced, which makes it the most interesting of the
 *   three: it is the console showing something the API's own view of the account does not.
 */
import {
  type AtlasPageDisagreement,
  type AtlasPageDisagreementReport,
  atlasPageDisagreementReport,
} from "../kit/pageDisagreement.js";

import type { HiveAtlasEntity } from "./model.js";

/**
 * One page the two channels do not agree about. Kit-owned, so two atlases' reports stay comparable.
 *
 * @internal
 */
export type HivePageDisagreement = AtlasPageDisagreement;

/**
 * Every disagreement one generation holds, plus the counts a reader needs to size them.
 *
 * @internal
 */
export type HiveDisagreementReport = AtlasPageDisagreementReport;

/**
 * Compare the two channels across every stored `page` entity.
 *
 * @param pages every `page` entity the generation holds
 * @returns the counts and every disagreement, sorted by provider id so a printed report is stable
 */
export function hiveDisagreementReport({ pages }: { pages: readonly HiveAtlasEntity[] }): HiveDisagreementReport {
  return atlasPageDisagreementReport({
    pages: pages.map((page) => ({
      declared: page.channels.api,
      providerId: page.providerId,
      witnessed: page.channels.browser,
    })),
    unwitnessedReason: "no console walk has landed on this address",
  });
}
