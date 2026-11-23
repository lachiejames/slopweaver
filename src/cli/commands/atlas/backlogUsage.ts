/**
 * `slopweaver atlas backlog`'s usage line, and nothing else.
 *
 * A LEAF on purpose: `cli/manifests/atlasEstate.ts` reads these strings on EVERY invocation, because `--help`,
 * `catalog` and `discoverCommands` enumerate the manifest barrel whether or not one of these verbs runs. Kept in a
 * command module, a string would put that module and everything it imports on every invocation's load path. The command
 * modules import these from here, never the reverse. Import only other leaves:
 * `src/__tests__/unit/cli/manifestBarrelClosure.test.ts` fails on anything else.
 */

/** The usage line, shared by `--help` and the manifest so the two cannot drift. */
export const ATLAS_BACKLOG_USAGE =
  "usage: slopweaver atlas backlog [--platform <name>] [--ground <ground>] [--named-only] [--deferred] [--json]\n" +
  "  --platform     only this atlas's refused rows\n" +
  "  --ground       only this ground — `not-fetched` or `shape-index`; it narrows the EXCLUSION half alone\n" +
  "  --named-only   only the nine atlases the owner's order names\n" +
  "  --deferred     also sweep the kinds every published generation left `deferred`, the gate's third\n" +
  "                 refused shape — this half reads the LOCAL STORE, and names every atlas it could not read\n" +
  "  --json         the whole register, for a page or a sweep to read\n" +
  "  without --deferred it reads only what each descriptor declares: no store, no network, no credential\n" +
  "  ALWAYS exits 0 — this is a backlog, never a gate on an atlas pull request";
