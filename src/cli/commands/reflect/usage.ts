/**
 * The usage lines of every `slopweaver reflect` verb, and nothing else.
 *
 * A LEAF on purpose: `cli/manifests/reflect.ts` reads these strings on EVERY invocation, because `--help`, `catalog`
 * and `discoverCommands` enumerate the manifest barrel whether or not one of these verbs runs. Kept in a command
 * module, a string would put that module and everything it imports on every invocation's load path. The command modules
 * import these from here, never the reverse. Import only other leaves:
 * `src/__tests__/unit/cli/manifestBarrelClosure.test.ts` fails on anything else.
 */

/**
 * The verb's usage line, and the only copy of it. Imported directly by the manifest so the drift
 * `manifestUsagePairs.test.ts` exists to catch is structurally impossible rather than merely tested.
 */
export const REFLECT_BOARD_USAGE = "usage: slopweaver reflect board [--now <iso>] [--json]";

/**
 * The verb's usage line, and the only copy of it. Imported directly by the manifest so the drift
 * `manifestUsagePairs.test.ts` exists to catch is structurally impossible rather than merely tested.
 */
export const REFLECT_BRIEF_USAGE =
  "usage: slopweaver reflect brief [--from 24h] [--to now] [--cap 5] [--json] [--write] [--dry-run]";

/**
 * The verb's usage line, and the only copy of it.
 *
 * It lives in this pure module rather than in `telemetryRun.ts` so the manifest can import it directly:
 * `core.ts` pulls in no provider client, so an eager manifest load costs nothing, and the drift between a
 * manifest copy and a command copy that `manifestUsagePairs.test.ts` exists to catch is structurally
 * impossible here rather than merely tested.
 */
export const REFLECT_TELEMETRY_USAGE =
  "usage: slopweaver reflect telemetry [--from 24h] [--to now] [--limit 500] [--json]";

/**
 * The verb's usage line, and the only copy of it. Imported directly by the manifest so the drift
 * `manifestUsagePairs.test.ts` exists to catch is structurally impossible rather than merely tested.
 */
export const REFLECT_FRICTION_REVIEW_USAGE =
  "usage: slopweaver reflect friction-review [--republish | --mark-published] [--home <dir>] [--json]";

/**
 * The verb's usage line, and the only copy of it. Imported directly by the manifest so the drift
 * `manifestUsagePairs.test.ts` exists to catch is structurally impossible rather than merely tested.
 */
export const REFLECT_GRADE_USAGE =
  "usage: slopweaver reflect grade <finding-id> keep|adjust|drop [--why <text>] [--closed-by <anchor>] [--home <dir>] [--json]";
