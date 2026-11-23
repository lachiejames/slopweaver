/**
 * Lazy manifest for the `atlas` noun — the local ground truth of what a platform CONTAINS, as opposed to
 * the world model, which holds what people said in it.
 *
 * Deliberately a noun of its own rather than a verb under `slack`: the atlas idea is per-platform and Slack
 * was the first of several, so the shape belongs where a second one can join it without a rename.
 *
 * ## Every platform row is BUILT, not written
 *
 * The registry (`src/atlas/registry.ts`) is the one list of atlases this build has, and each row carries
 * what its catalogue entry says and which verbs it answers. So the platform rows here are derived from it,
 * one per registration, by `atlasPlatformManifestRow` — the next atlas joins by registering and gets its
 * row, its usage block and every kit verb with no manifest edit at all. This file used to hold those rows
 * by hand across nine files and 2,000 lines, each restating a verb list two other files also held.
 *
 * The rows that are NOT platforms stay hand-written beside them: Slack's three (`atlasSlack.ts`), which
 * predate the kit and are keyed on verbs rather than a platform, and the estate's three
 * (`atlasEstate.ts`), which sweep every atlas rather than address one.
 */

import { atlasRegistrations } from "../../atlas/registry.js";
import type { VerbManifestEntry } from "../manifest.js";

import { atlasEstateManifest } from "./atlasEstate.js";
import { atlasPlatformManifestRow } from "./atlasPlatformMeta.js";
import { atlasSlackManifest } from "./atlasSlack.js";

/**
 * One row per registered platform, keyed by platform name — every platform except Slack, whose row is the
 * hand-written map in `atlasSlack.ts` because `atlas slack` with no verb IS the map.
 */
const platformRows: Readonly<Record<string, VerbManifestEntry>> = Object.fromEntries(
  atlasRegistrations()
    .filter((registration) => registration.fallback === undefined)
    .map((registration) => [registration.platform, atlasPlatformManifestRow({ registration })]),
);

export const atlasManifest: Readonly<Record<string, VerbManifestEntry>> = {
  ...platformRows,
  ...atlasEstateManifest,
  ...atlasSlackManifest,
};
