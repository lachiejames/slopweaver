/**
 * The three `access-review` usage blocks, in a leaf the MANIFEST can reach without loading a command module.
 *
 * `.claude/rules/area-cli.md` names the leak this avoids: a manifest that imports a `*_USAGE` constant from
 * the command module it describes makes enumerating the surface load that module and everything it pulls in,
 * which defeats the lazy-load bridge for every unrelated invocation. `commands/listen/listenUsage.ts` is the
 * shape this copies.
 *
 * It imports exactly one thing — the level table, so the platform list in `platform`'s usage cannot drift
 * from the platforms the verb actually accepts — and that module imports only `#lib/parsers.js`.
 */
import { ACCESS_LEVEL_TABLE } from "../../../accessReview/levels.js";

/** The shared tail of every usage block — the lines that are true of all three verbs. */
export const ACCESS_REVIEW_COMMON_USAGE =
  "  --json          the whole section as one document, for a page or a gate to read\n" +
  "  --home          the state home to read, instead of $SLOPWEAVER_HOME\n" +
  "  reads local atlas generations only: no network call, no credential. It is a REPORT and not a tick —\n" +
  "  a whole-platform read costs seconds, so never put it on a scheduled freshness path";

/** `access-review platform` — one platform's roster report. */
export const ACCESS_REVIEW_PLATFORM_USAGE =
  "usage: slopweaver access-review platform <platform> [--json] [--home <dir>]\n" +
  `  <platform>      one of: ${ACCESS_LEVEL_TABLE.map((spec) => spec.platform).join(", ")}\n` +
  ACCESS_REVIEW_COMMON_USAGE;

/** `access-review former` — the three-bucket join. */
export const ACCESS_REVIEW_FORMER_USAGE =
  "usage: slopweaver access-review former [--json] [--home <dir>]\n" +
  "  joins every platform carrying a per-user level against the Vanta roster spine and prints three\n" +
  "  buckets: CONFIRMED (departed before that platform's own read and still live at it), UNMEASURED\n" +
  "  (departed after some platform's read, so that atlas cannot say) and CLEAN (departed before every\n" +
  "  platform's read, and live at none). A REHIRE is not a finding: one address can carry several\n" +
  "  employment spells, and a live spell means the account is legitimately held. The match is by\n" +
  "  address, so a person rehired under a NEW address leaves the old address in its bucket. When a\n" +
  "  platform refused, CONFIRMED is a lower bound, UNMEASURED is provisional either way (that read\n" +
  "  could confirm anyone in it) and CLEAN is not computed.\n" +
  "  Exits non-zero when the confirmed bucket is non-empty or any platform refused its read\n" +
  ACCESS_REVIEW_COMMON_USAGE;

/** `access-review privileged` — the ISO A.8.2 evidence pack. */
export const ACCESS_REVIEW_PRIVILEGED_USAGE =
  "usage: slopweaver access-review privileged [--json] [--home <dir>]\n" +
  "  every console administrator on a platform that names a role, against employment from the roster\n" +
  "  spine. The WHOLE table rather than an extract — an empty one prints the subject it examined, so a\n" +
  "  zero is never read as `no privileged accounts`\n" +
  ACCESS_REVIEW_COMMON_USAGE;
