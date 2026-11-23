/**
 * The SANCTIONED-SEAM CATALOGUE — every repo file allowed to call a side-effecting primitive directly,
 * and the class that allows it. `src/admit/coverage.ts` is the scan that reads it; this is the list.
 *
 * One row per sanctioned file, each carrying its own reason, and the repository gains rows faster than it
 * loses them. The rows live in six category modules, spread into the one flat `SANCTIONED_SEAMS` below in a
 * fixed order, so a module is sanctioned in exactly one place and `./coverage.ts` reads one table:
 *
 * - `./sanctionedDevTooling.ts` — the `dev-tooling` rows: linters, lanes and test support;
 * - `./sanctionedHomeAtlasSeams.ts` — the home, Claude credentials, the store backup lane, ledgers, atlases;
 * - `./sanctionedBrowserWorkflowSeams.ts` — the browser relay and the verbs that write beside it;
 * - `./sanctionedWorkspaceSeams.ts` — cmux, worktrees, checkouts, live machine reads and Codex state;
 * - `./sanctionedCorpusLiveSeams.ts` — the corpus, the dev-gate read-only tools and the `src/live/**` stores;
 * - `./sanctionedOperationalSeams.ts` — outbound ledgers and the hand, supervisor and talk stores.
 *
 * A new row goes in the category file whose theme its module belongs to. A category file nearing 300 code
 * lines splits again; the cap is met by a split, never by a marker or a raised ceiling.
 */

import { BROWSER_WORKFLOW_SEAMS } from "./sanctionedBrowserWorkflowSeams.js";
import { CORPUS_LIVE_SEAMS } from "./sanctionedCorpusLiveSeams.js";
import { DEV_TOOLING_SEAMS } from "./sanctionedDevTooling.js";
import { HOME_ATLAS_SEAMS } from "./sanctionedHomeAtlasSeams.js";
import { OPERATIONAL_SEAMS } from "./sanctionedOperationalSeams.js";
import { WORKSPACE_SEAMS } from "./sanctionedWorkspaceSeams.js";

/** How a direct seam is accounted for. Anything not sanctioned is `open` (a failing finding). */
export type SeamClass = "door-internal" | "local-state" | "read-only-tool" | "dev-tooling" | "open";

/** The sanctioned direct-seam files, repo-relative → why they're allowed. A new seam OUTSIDE this list fails. */
export const SANCTIONED_SEAMS: Readonly<Record<string, Exclude<SeamClass, "open">>> = {
  ...DEV_TOOLING_SEAMS,
  ...HOME_ATLAS_SEAMS,
  ...BROWSER_WORKFLOW_SEAMS,
  ...WORKSPACE_SEAMS,
  ...CORPUS_LIVE_SEAMS,
  ...OPERATIONAL_SEAMS,
};
