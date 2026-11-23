/**
 * The `org-health` verbs' usage lines, and nothing else.
 *
 * A LEAF on purpose: `cli/manifests/orgHealth.ts` reads it on EVERY invocation, because `--help`, `catalog` and
 * `discoverCommands` enumerate the manifest barrel whether or not this verb runs. Import only other leaves:
 * `src/__tests__/unit/cli/manifestBarrelClosure.test.ts` fails on anything else.
 */

export const ORG_HEALTH_READ_USAGE = "usage: slopweaver org-health read [--json] [--now <iso>] [--home <dir>]";

export const ORG_HEALTH_STATUS_USAGE = "usage: slopweaver org-health status [--json] [--now <iso>] [--home <dir>]";

export const ORG_HEALTH_ACK_USAGE =
  "usage: slopweaver org-health ack --ref <INC-n> [--by-session <s>] [--json] [--home <dir>] [--now <iso>]";
