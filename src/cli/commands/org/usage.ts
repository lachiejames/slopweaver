/**
 * The `org` verbs' usage lines, and nothing else.
 *
 * A LEAF on purpose: `cli/manifests/org.ts` reads it on EVERY invocation, because `--help`, `catalog` and
 * `discoverCommands` enumerate the manifest barrel whether or not this verb runs. Import only other leaves:
 * `src/__tests__/unit/cli/manifestBarrelClosure.test.ts` fails on anything else.
 */

export const ORG_SHOW_USAGE = "usage: slopweaver org show [--json] [--home <dir>]";

export const ORG_SET_USAGE =
  "usage: slopweaver org set --display-name <name> --github-owner <login> " +
  "(--google-domain <domain> | --without-google) (--slack-host <host> [--slack-host <host> …] | --without-slack) " +
  "(--linear-workspace <slug> | --without-linear) (--vanta-workspace <slug> | --without-vanta) " +
  "--repository <owner/repo> [--repository <owner/repo> …] [--dependency-bot <login> …] [--json] [--home <dir>]";
