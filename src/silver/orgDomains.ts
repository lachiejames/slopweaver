/**
 * Which email domains belong to the OWNER'S OWN organisation — the check that stops a mention resolving to
 * a stranger.
 *
 * Measured, and the reason this file exists: a bare first name resolved — confidently, at
 * `email` confidence, with a real Linear id — to an external guest at ANOTHER company who happened to
 * carry that name as their Linear handle, while four colleagues of the same first name were passed over.
 * Nothing was ambiguous and nothing failed; a different human at a different company was simply returned,
 * and tagging what came back would have pulled that stranger into a thread about customer-data access under the
 * owner's name. Reproduce the shape on any home whose Linear workspace has ever had an external guest:
 * `slopweaver identity resolve <that first name> --json`.
 *
 * The domains themselves are never a literal here, and that is per-install state rather than secrecy: one
 * install's domains are wrong for every other install's, so the module INFERS the set from member bronze, and
 * an operator who needs to override the inference writes `$SLOPWEAVER_HOME/org-domains.txt` (one domain per
 * line).
 *
 * Inference is a plurality with a stated margin, and it REFUSES rather than guessing when the margin is not
 * there — a wrong org domain would silently invert this whole check, marking colleagues external and
 * strangers internal, which is worse than having no check at all. Pure: the caller injects the rows.
 */
import type { MemberBronzeRow } from "../corpus/members/types.js";
import { err, ok, type Result } from "../lib/result.js";

/**
 * The smallest plurality that counts as evidence of an organisation. Below this the corpus is too thin to
 * infer from at all — a home three days into its first backfill would otherwise pin the org to whichever
 * handful of addresses landed first.
 *
 * Measured on a real home with `slopweaver identity org-domains`: the top domain carries over a thousand
 * distinct non-bot members against dozens for the runner-up, so the real signal clears both bounds by an order
 * of magnitude. The bounds are here for the thin home, not for this one.
 */
const MIN_MEMBERS = 5;

/** How far the top domain must clear the runner-up. See {@link MIN_MEMBERS} for the measurement. */
const MIN_MARGIN = 2;

/** An inferred or configured org-domain set, and how it was arrived at. */
export interface OrgDomains {
  /** The normalised domains, sorted. A member whose email domain is in here is a colleague. */
  readonly domains: readonly string[];
  /** How the set was established — `configured` (the home's file) or the inference and its counts. */
  readonly basis: string;
}

/** Lower-case + trim a domain, dropping a leading `@` so a pasted `@example.com` works. Pure. */
function normaliseDomain({ domain }: { domain: string }): string {
  const bare = domain.startsWith("@") ? domain.slice(1) : domain;
  return bare.trim().toLowerCase();
}

/**
 * The domain part of an email address, normalised. Pure.
 *
 * @param email the address
 * @returns the domain, or `undefined` when there is no `@` or nothing after it
 */
export function emailDomain({ email }: { email: string }): string | undefined {
  const at = email.lastIndexOf("@");
  if (at < 0) {
    return undefined;
  }
  const domain = normaliseDomain({ domain: email.slice(at + 1) });
  return domain.length > 0 ? domain : undefined;
}

/**
 * The registrable-looking first label of a domain — `example` for `example.com`, `example.com.au` and
 * `example.co.nz` alike. Pure.
 *
 * Sibling TLDs are the case this exists for. A real org runs several: measured on a real home, the
 * plurality domain has siblings carrying a few members each, and a plurality-only rule would have
 * marked those colleagues external. Matching on the first label recognises them without the module
 * needing to know a public-suffix list — or, more to the point, without the org's name being written down.
 *
 * @param domain a normalised domain
 * @returns its first dot-separated label
 */
export function domainLabel({ domain }: { domain: string }): string {
  // `split` always returns at least one element — the whole string when it holds no dot — so index 0 is present.
  return domain.split(".")[0]!;
}

/** The distinct non-bot members per email domain — one vote per `(source, sourceId)`, never per row. */
function domainCounts({ rows }: { rows: readonly MemberBronzeRow[] }): ReadonlyMap<string, number> {
  const voters = new Map<string, string>();
  for (const row of rows) {
    if (row.profile.bot === true) {
      continue;
    }
    const email = row.identity.emailNormalised;
    const domain = email !== undefined ? emailDomain({ email }) : undefined;
    if (domain !== undefined) {
      voters.set(`${row.source}:${row.sourceId}`, domain);
    }
  }
  const counts = new Map<string, number>();
  for (const domain of voters.values()) {
    // A domain's tally opens at its first voter.
    if (!counts.has(domain)) {
      counts.set(domain, 0);
    }
    counts.set(domain, counts.get(domain)! + 1);
  }
  return counts;
}

/**
 * How many members the runner-up domain holds. A corpus whose every voting member shares one domain has no
 * runner-up: no member voted for any other domain, so the count against the plurality is zero.
 */
function runnerUpMembers({ ranked }: { ranked: readonly (readonly [string, number])[] }): number {
  const runnerUp = ranked[1];
  if (runnerUp === undefined) {
    return 0;
  }
  return runnerUp[1];
}

/**
 * Parse a configured `org-domains.txt` body: one domain per line, `#` comments and blanks ignored. Pure.
 *
 * @param content the file body
 * @returns the normalised domains, sorted and deduped; empty when the file carries nothing usable
 */
export function parseOrgDomainsFile({ content }: { content: string }): readonly string[] {
  const domains = content
    .split("\n")
    .map((line) => normaliseDomain({ domain: line.split("#")[0]! }))
    .filter((line) => line.length > 0);
  return [...new Set(domains)].toSorted();
}

/**
 * Establish the org's email domains: the configured set when the home declares one, else the plurality
 * inferred from member bronze plus its sibling TLDs. Pure.
 *
 * @param rows every source's member rows
 * @param configured the domains `$SLOPWEAVER_HOME/org-domains.txt` declared — wins outright when non-empty
 * @returns the domain set and its basis, or the reason the corpus could not settle one. The failure is a
 *   refusal on purpose: a guessed org domain would mark colleagues external and strangers internal, and
 *   both directions are silent
 */
export function resolveOrgDomains({
  rows,
  configured = [],
}: {
  rows: readonly MemberBronzeRow[];
  configured?: readonly string[];
}): Result<OrgDomains> {
  if (configured.length > 0) {
    return ok({ basis: `configured: ${configured.join(", ")}`, domains: [...configured].toSorted() });
  }
  const counts = [...domainCounts({ rows })].toSorted((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const top = counts[0];
  if (top === undefined) {
    return err([
      "no member email carries a domain, so the org's own domains cannot be inferred — run `slopweaver refresh --all-sources` to hydrate members, or declare them in $SLOPWEAVER_HOME/org-domains.txt",
    ]);
  }
  const runnerUp = runnerUpMembers({ ranked: counts });
  if (top[1] < MIN_MEMBERS || top[1] < runnerUp * MIN_MARGIN) {
    return err([
      `no email domain is a clear plurality among ${String(counts.length)} domains (top holds ${String(top[1])} members, runner-up ${String(runnerUp)}) — declare the org's domains in $SLOPWEAVER_HOME/org-domains.txt`,
    ]);
  }
  const label = domainLabel({ domain: top[0] });
  const domains = counts.filter(([domain]) => domainLabel({ domain }) === label).map(([domain]) => domain);
  return ok({
    basis: `inferred: ${String(top[1])} members on the plurality domain, ${String(runnerUp)} on the runner-up, ${String(domains.length)} sibling domain(s)`,
    domains: domains.toSorted(),
  });
}

/**
 * Whether an email belongs to the organisation. Pure.
 *
 * @param email the address to classify
 * @param orgDomains the established org domains
 * @returns true when the address's domain is one of the org's
 */
export function isOrgEmail({ email, orgDomains }: { email: string; orgDomains: readonly string[] }): boolean {
  const domain = emailDomain({ email });
  return domain !== undefined && orgDomains.includes(domain);
}
