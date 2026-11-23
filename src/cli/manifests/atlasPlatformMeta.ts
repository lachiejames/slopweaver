/**
 * The manifest row every registered platform gets, built from its registration rather than written by hand.
 *
 * Before this, each platform's row was a fifty-line literal in one of nine manifest files, restating the verb
 * list its `*Platform.ts` already held — the same list a THIRD time, free to drift from the other two in any
 * of 36 rows. A new atlas needed a manifest row copied from its nearest sibling. Now the row is derived: the
 * verb list from the registration's rows, the usage block from each row's advertised flags, the summary,
 * example and door from its catalogue entry. `helpFlagOptOut` and `manifestLoaderTests` read manifest SOURCE
 * for `import("../commands/…")` specifiers; the one loader here is `platformRun.js`, which is what every
 * platform row loaded before too, so neither gate sees less than it did.
 *
 * It is deliberately the GENERIC row's metadata only: the Slack rows (`atlasSlack.ts`) and the estate rows
 * (`atlasEstate.ts`) spell their own, because neither is a platform row.
 */

import { atlasCatalogueSummary, atlasPlatformVerbNames } from "../../atlas/kit/verbs.js";
import type { AtlasPlatformRegistration } from "../../atlas/registry.js";
import { lazy, type VerbManifestEntry } from "../manifest.js";

/**
 * The `read` and `coverage` flag tails, as a manifest usage block prints them.
 *
 * @internal
 */
export const ATLAS_READ_COVERAGE_USAGE_LINES =
  "  read [--kind <k>] [--surface <s>] [--id <id>] [--query <words>] [--include-stale]\n" +
  "       [--after <entity-id>] [--limit <1..1000>] [--json] [--home <dir>]\n" +
  "  coverage [--kind <k>] [--surface <s>] [--state <coverage-state>] [--open-only] [--json] [--home <dir>]\n";

/**
 * The `render` verb's own flag tail, as a manifest usage block prints it.
 *
 * Hoisted rather than repeated: every platform row names every flag reachable beneath it, so this block
 * appeared verbatim in fourteen rows of `atlas.ts` alone and pushed that file past the file-size ratchet.
 * One constant is also one place to change when the verb grows a flag.
 *
 * @internal
 */
export const ATLAS_RENDER_USAGE_LINES =
  "  render [--out <path>] [--fragment] [--json] [--max-rows <n>] [--never-hit-cap <n>]\n" +
  "         [--screenshot-budget-mib <n>] [--no-screenshots] [--max-page-mib <n>] [--home <dir>]\n";

/**
 * The `restore` verb's own flag tail, as a manifest usage block prints it.
 *
 * @internal
 */
export const ATLAS_RESTORE_USAGE_LINES =
  "  restore [--archive <archive-id> --confirm archive-current] [--json] [--home <dir>]\n";

/**
 * The `render` and `restore` flag tails together — what a platform row prints for the kit verbs.
 *
 * @internal
 */
export const ATLAS_KIT_FLAG_LINES = ATLAS_RENDER_USAGE_LINES + ATLAS_RESTORE_USAGE_LINES;

/**
 * The `reset` verb's own flag tail, as a manifest usage block prints it.
 *
 * Separate from {@link ATLAS_KIT_FLAG_LINES} because `reset` is the one CONDITIONAL kit verb: a platform
 * answers it only when its registration carries a `readReset`, and a row advertising a flag tail for a verb
 * the platform refuses would be worse than one advertising nothing.
 *
 * @internal
 */
export const ATLAS_RESET_USAGE_LINES = "  reset --confirm archive [--json] [--home <dir>]\n";

/**
 * The usage block one platform's manifest row advertises: every verb, then every flag reachable beneath it.
 *
 * Every flag is named here because the row is the deepest manifest match a reader or a canon check resolves
 * to, so a flag advertised only by the verb beneath it would read as unadvertised — which is how
 * documentation drifts from the surface it documents.
 *
 * @param registration the platform's row
 * @returns the usage block, ending without a trailing newline
 */
function atlasPlatformManifestUsage({ registration }: { registration: AtlasPlatformRegistration }): string {
  const own = registration.verbs.flatMap((verb) => verb.usage.map((line) => `  ${line}\n`)).join("");
  // An explicit branch rather than a `&&`-guarded concatenation: `reset` is conditional on the registration,
  // and a row for a platform that does not answer it must not advertise its flags.
  const resetLines = registration.readReset === undefined ? "" : ATLAS_RESET_USAGE_LINES;
  return (
    `usage: slopweaver atlas ${registration.platform} <${atlasPlatformVerbNames({ hasReset: registration.readReset !== undefined, ownVerbs: registration.verbs }).join(" | ")}>\n` +
    ATLAS_READ_COVERAGE_USAGE_LINES +
    ATLAS_KIT_FLAG_LINES +
    resetLines +
    own
  ).trimEnd();
}

/**
 * The manifest row for one registered platform.
 *
 * @param registration the platform's row
 * @returns the lazy manifest entry, whose loader resolves the same platform through the registry
 */
export function atlasPlatformManifestRow({
  registration,
}: {
  registration: AtlasPlatformRegistration;
}): VerbManifestEntry {
  const { platform } = registration;
  const { summary, example, doorRouted } = registration.catalogue;
  const catalogueSummary = atlasCatalogueSummary({ platform, summary });
  return lazy({
    load: () => import("../commands/atlas/platformRun.js").then((m) => m.atlasPlatformCommand({ platform })),
    meta: {
      createsWorkItem: false,
      diagnostic: true,
      doorRouted,
      dryParseSafe: true,
      // Every platform row is local-state: `read`, `coverage` and `render` are pure reads of files a sync
      // already wrote, `restore` MOVES generation directories under the state home, and a sync or a walk
      // reads its provider and writes only under $SLOPWEAVER_HOME. A row that wrote to a provider would not
      // be an atlas.
      effect: "local-state",
      example,
      parseRejectIsIoFree: true,
      summary: catalogueSummary,
      usage: atlasPlatformManifestUsage({ registration }),
    },
  });
}
