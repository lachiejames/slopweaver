/**
 * The noun BARREL — the single registration point for every noun on the lazy-load bridge.
 * `nounGroups.ts` folds this array into `NOUN_GROUPS` + `NOUN_SUMMARIES` generically, so adding a noun
 * never edits that central registry's import-and-assign list.
 *
 * To add a noun: write `cli/manifests/<noun>.ts` (its lazy verb map), then append ONE
 * `{ noun, summary, verbs }` row to the family file it belongs to. That is the whole edit.
 *
 * Where the rows live, each file exporting a `readonly NounManifestModule[]` spread below:
 * - `setupManifests.ts`: the install, machine and dev loop — preflight, secrets, checkouts, plans, routing.
 * - `corpusManifests.ts`: the local world model — ingest, derivation, the store and its readers.
 * - `fleetManifests.ts`: the fleet — the board, sessions, ledgers, registers and what reaches the owner.
 * - `doorManifests.ts`: the provider doors and the Slack bot's turn path.
 * - `atlasManifests.ts`: the platform atlases and the live read-only clients.
 *
 * A noun's row appears in exactly one family file, and `src/__tests__/unit/cli/manifests/manifestFamilies.test.ts` fails on
 * a noun named twice, because a spread would silently let the later row replace the earlier one. A family file
 * nearing the 300-code-line cap splits again into a sixth rather than growing past it.
 *
 * Pure: importing the barrel loads manifest modules, the `*Usage.ts` leaves they quote, and a pinned handful of
 * shared constant leaves — no command module and no npm package. The first command `import()` fires only on a
 * verb's `load()`. `src/__tests__/unit/cli/manifestBarrelClosure.test.ts` walks the static closure and fails on
 * anything else, so a new usage string goes in a leaf beside its command, never in the command module itself.
 *
 * The handover manifest reader (`src/handover/manifestBarrel.ts`) parses this file's TEXT, following each
 * `...FAMILY` spread into the family file that exports it: keep every spread a bare imported name.
 */

import type { NounManifestModule } from "../manifest.js";
import { accessReviewModule } from "./accessReview.js";
import { ATLAS_MANIFEST_MODULES } from "./atlasManifests.js";
import { CORPUS_MANIFEST_MODULES } from "./corpusManifests.js";
import { DOOR_MANIFEST_MODULES } from "./doorManifests.js";
import { FLEET_MANIFEST_MODULES } from "./fleetManifests.js";
import { SETUP_MANIFEST_MODULES } from "./setupManifests.js";

export const MANIFEST_MODULES: readonly NounManifestModule[] = [
  accessReviewModule,
  ...SETUP_MANIFEST_MODULES,
  ...CORPUS_MANIFEST_MODULES,
  ...FLEET_MANIFEST_MODULES,
  ...DOOR_MANIFEST_MODULES,
  ...ATLAS_MANIFEST_MODULES,
];
