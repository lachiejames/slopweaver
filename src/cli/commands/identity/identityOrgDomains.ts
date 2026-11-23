/**
 * `slopweaver identity org-domains` — print the domains the resolution treats as internal.
 *
 * The one verb in this family that answers a question about CONFIGURATION rather than about a human, so it
 * imports {@link ./identityShared} and nothing else in the family. Its distance from the person emitters is
 * a property of the import graph now rather than a fact about which functions it happened to call.
 */

import { EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { parseFlags } from "../../parseFlags.js";
import { homeFor, type IdentityDeps, verbTail } from "./identityShared.js";

const ORG_DOMAINS_USAGE = "usage: slopweaver identity org-domains [--home <dir>] [--json]";

/** The flag spec `identity org-domains` parses. */
const ORG_DOMAINS_FLAGS = { boolean: ["json"], string: ["home"] } as const;

/** `--`-prefixed, so the help-truth ratchet can compare the usage string against the parser both ways. */
export const IDENTITY_ORG_DOMAINS_FLAG_NAMES: readonly string[] = [
  ...ORG_DOMAINS_FLAGS.string,
  ...ORG_DOMAINS_FLAGS.boolean,
]
  .map((name) => `--${name}`)
  .toSorted();

/**
 * Parse `identity org-domains` flags. Exported so the help-truth ratchet probes the REAL parser rather than
 * a copy of it that could drift.
 *
 * @param rest the argv after the noun and verb
 * @returns the parsed flags
 */
export function parseIdentityOrgDomainsArgs({ rest }: { rest: readonly string[] }): ReturnType<typeof parseFlags> {
  return parseFlags({ allowPositionals: false, args: rest, spec: ORG_DOMAINS_FLAGS });
}

/**
 * Run `identity org-domains` — print the org's own email domains and how they were settled.
 *
 * This is the reproduction path for the domain check every mention now applies: the check silently inverts
 * if the domains are wrong, so the domains have to be printable.
 *
 * @param argv the full process argv
 * @param deps the effectful seams
 * @returns the process exit code — `EXIT_EXPECTED_EMPTY` when no domain set could be settled at all
 */
export function runIdentityOrgDomainsWithDeps({ argv, deps }: { argv: readonly string[]; deps: IdentityDeps }): number {
  const rest = verbTail({ argv, verb: "org-domains" });
  if (rest.includes("--help") || rest.includes("-h")) {
    deps.logger.out({ line: ORG_DOMAINS_USAGE });
    return EXIT_OK;
  }
  const parsed = parseIdentityOrgDomainsArgs({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((e) => {
      deps.logger.error({ msg: e });
    });
    deps.logger.error({ msg: ORG_DOMAINS_USAGE });
    return EXIT_USAGE;
  }
  const home = homeFor({ deps, values: parsed.value.values });
  const directory = deps.loadDirectory({ home });
  if (parsed.value.values["json"] === true) {
    deps.logger.out({
      line: JSON.stringify(
        { basis: directory.basis, domains: directory.orgDomains, warnings: directory.warnings },
        null,
        2,
      ),
    });
  } else {
    directory.warnings.forEach((w) => {
      deps.logger.warn({ msg: w });
    });
    deps.logger.out({ line: `org domains (${directory.basis}):` });
    directory.orgDomains.forEach((domain) => {
      deps.logger.out({ line: `  ${domain}` });
    });
  }
  return directory.orgDomains.length > 0 ? EXIT_OK : EXIT_EXPECTED_EMPTY;
}
