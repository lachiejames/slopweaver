/**
 * Lazy manifest for the `access-review` noun — the ISO access review, derived from the atlases that carry a
 * per-user level rather than from a day of clicking through consoles.
 *
 * ## Why a noun rather than three more `atlas` rows
 *
 * `atlasEstate.ts` states the criterion for its own membership: its rows "sweep whatever the registry holds
 * and ask one question of each". These three do not — they address four NAMED atlases and join them against
 * one of them as a roster spine, which is a different animal from both an estate sweep and a per-platform
 * read. That file also exists because `atlas.ts` "crossed the 600-code-line `file-size-ratchet` cap again
 * when `freshness` landed", and the cap is 300 code lines now, so adding rows there
 * re-opens exactly the pressure it was cut to relieve.
 *
 * The report also grows by design: the dependency order the settled page names adds Trelica, GitHub org
 * membership and Google Workspace. A noun absorbs those; a third estate row renamed later does not.
 */
import {
  ACCESS_REVIEW_FORMER_USAGE,
  ACCESS_REVIEW_PLATFORM_USAGE,
  ACCESS_REVIEW_PRIVILEGED_USAGE,
} from "../commands/accessReview/usage.js";
import { lazy, type NounManifestModule, type VerbManifestEntry } from "../manifest.js";

/** What every row here shares: a local read, no credential, no work item, no door. */
const READ_ONLY_META = {
  createsWorkItem: false,
  diagnostic: true,
  doorRouted: false,
  dryParseSafe: true,
  effect: "none",
  parseRejectIsIoFree: true,
} as const;

export const accessReviewManifest: Readonly<Record<string, VerbManifestEntry>> = {
  former: lazy({
    load: () => import("../commands/accessReview/formerRun.js").then((m) => m.accessReviewFormerCommand),
    meta: {
      ...READ_ONLY_META,
      example: "slopweaver access-review former --json",
      summary:
        "Join every atlas carrying a per-user level against the Vanta roster spine and print three " +
        "buckets: CONFIRMED (left before that platform's own read and still live at it), UNMEASURED " +
        "(left after some platform's read, so that atlas cannot say either way) and CLEAN (every read " +
        "after they left, live at none). The unmeasured bucket is PRINTED on purpose — it is staleness " +
        "made visible, and without it the next resync resolving it looks like a spike of new violations. " +
        "The match is by address, so a rehire under a NEW address leaves the old one in its bucket. Exits " +
        "non-zero when anything is confirmed or any platform refused its read",
      usage: ACCESS_REVIEW_FORMER_USAGE,
    },
  }),
  platform: lazy({
    load: () => import("../commands/accessReview/platformRun.js").then((m) => m.accessReviewPlatformCommand),
    meta: {
      ...READ_ONLY_META,
      example: "slopweaver access-review platform jumpcloud",
      summary:
        "One roster row per person on ONE platform, carrying that platform's own level field VERBATIM — " +
        "never a normalised grade — plus the per-kind read stamp and the declared boundary. An absent " +
        "field prints as absent and a stored empty string prints as empty, because folding the two turns " +
        "`nothing was stored` into `the setting is off`",
      usage: ACCESS_REVIEW_PLATFORM_USAGE,
    },
  }),
  privileged: lazy({
    load: () => import("../commands/accessReview/privilegedRun.js").then((m) => m.accessReviewPrivilegedCommand),
    meta: {
      ...READ_ONLY_META,
      example: "slopweaver access-review privileged",
      summary:
        "Every console administrator on a platform that names a role, against employment from the roster " +
        "spine — the ISO A.8.2 evidence pack, the WHOLE table rather than an extract. An empty table " +
        "prints the platform, the kind, the read stamp and how many people were examined, so a zero is " +
        "never read as `this organisation has no privileged accounts`",
      usage: ACCESS_REVIEW_PRIVILEGED_USAGE,
    },
  }),
};

/** The noun as the barrel folds it: its name, its `slopweaver access-review` line, and its verbs. */
export const accessReviewModule: NounManifestModule = {
  noun: "access-review",
  summary:
    "The ISO access review off the atlases carrying a per-user level: a roster report per platform, the " +
    "three-bucket former-staff join against the Vanta spine, and the privileged-access table",
  verbs: accessReviewManifest,
};
