/**
 * The lookups over the knowledge domain vocabulary: which slugs a writer may name, and where one slug stands.
 * Pure: no I/O, no clock.
 *
 * The vocabulary is three sources joined, in this order: the committed domains and retired spellings in
 * `./domains.ts`, every atlas platform `../atlas/registry.ts` registers, and this install's own from its store's
 * `knowledge_domain` table (`./domainPort.ts`). Why the vocabulary is closed, and why an organisation's own
 * systems are state rather than code, is `./domains.ts`'s file overview.
 */
import { atlasPlatforms } from "../atlas/registry.js";

import { KNOWLEDGE_DOMAIN_ALIASES, KNOWLEDGE_DOMAINS, type KnowledgeDomainEntry } from "./domains.js";

/**
 * This install's own domains and aliases, read from its store through `./domainPort.ts`. Every function below
 * that judges a domain takes one, REQUIRED rather than defaulted, so a caller that forgot to read the install's
 * domains fails to compile instead of silently judging against the generic vocabulary alone.
 */
export interface InstallKnowledgeDomains {
  /** The state home whose store these were read from — named in a refusal, so the fix says where to add one. */
  readonly home: string;
  /** The install's own domains, joined to the committed domains and the atlas platforms. */
  readonly domains: readonly KnowledgeDomainEntry[];
  /** The install's own retired spellings, joined to the committed aliases. */
  readonly aliases: Readonly<Record<string, string>>;
}

/** One domain of the merged vocabulary, with where it came from. */
export interface ResolvedKnowledgeDomainEntry {
  readonly slug: string;
  /** What it holds; null for an atlas platform, whose atlas is what it holds. */
  readonly holds: string | null;
  /** Committed in `./domains.ts`, an atlas platform, or the install's own. */
  readonly source: "code" | "atlas" | "install";
}

/**
 * The install vocabulary of an install that adds nothing — what a store holding no install domain reads as.
 *
 * @param home the state home whose store would have held them
 * @returns no domains and no aliases, naming the home
 */
export function noInstallDomains({ home }: { home: string }): InstallKnowledgeDomains {
  return { aliases: {}, domains: [], home };
}

/**
 * Every domain a writer may name, with its source: the committed ones, every atlas platform, then the install's
 * own, sorted by slug. A slug two sources name appears once, from the earlier source — `./installDomains.ts`
 * refuses an install file that tries it, so this is a backstop rather than a rule.
 *
 * @param installDomains the install's own domains read from its store, joined after the committed ones
 * @returns the whole vocabulary, one entry per slug
 */
export function knowledgeDomainEntries({
  installDomains,
}: {
  installDomains: InstallKnowledgeDomains;
}): readonly ResolvedKnowledgeDomainEntry[] {
  const bySlug = new Map<string, ResolvedKnowledgeDomainEntry>();
  const admit = ({ entry }: { entry: ResolvedKnowledgeDomainEntry }): void => {
    if (!bySlug.has(entry.slug)) {
      bySlug.set(entry.slug, entry);
    }
  };
  KNOWLEDGE_DOMAINS.forEach(({ holds, slug }) => {
    admit({ entry: { holds, slug, source: "code" } });
  });
  atlasPlatforms().forEach((slug) => {
    admit({ entry: { holds: null, slug, source: "atlas" } });
  });
  installDomains.domains.forEach(({ holds, slug }) => {
    admit({ entry: { holds, slug, source: "install" } });
  });
  return [...bySlug.values()].toSorted((left, right) => left.slug.localeCompare(right.slug));
}

/**
 * Every domain a writer may name: the named ones, every atlas platform and the install's own, sorted, without
 * duplicates.
 *
 * @param installDomains the install's own domains read from its store, joined after the committed ones
 * @returns the whole vocabulary
 */
export function knowledgeDomainSlugs({
  installDomains,
}: {
  installDomains: InstallKnowledgeDomains;
}): readonly string[] {
  return knowledgeDomainEntries({ installDomains }).map((entry) => entry.slug);
}

/** Where a domain stands against the vocabulary. */
export type DomainStanding =
  | { readonly kind: "canonical" }
  | { readonly kind: "alias"; readonly canonical: string }
  | { readonly kind: "unknown" };

/**
 * The domain a retired spelling folded into, committed or install-held, or undefined when it is none.
 *
 * @param domain the candidate spelling
 * @param installDomains this install's own aliases, consulted after the committed ones
 * @returns the canonical domain, or undefined
 */
function aliasTarget({
  domain,
  installDomains,
}: {
  domain: string;
  installDomains: InstallKnowledgeDomains;
}): string | undefined {
  if (Object.hasOwn(KNOWLEDGE_DOMAIN_ALIASES, domain)) {
    return KNOWLEDGE_DOMAIN_ALIASES[domain];
  }
  if (Object.hasOwn(installDomains.aliases, domain)) {
    return installDomains.aliases[domain];
  }
  return undefined;
}

/**
 * Where one domain stands: in the vocabulary, a retired spelling of a domain that is, or neither.
 *
 * @param domain the slug a writer supplied or a stored row carries
 * @param installDomains this install's own domains and aliases, joined to the committed ones
 * @returns its standing, naming the canonical domain for an alias
 */
export function domainStanding({
  domain,
  installDomains,
}: {
  domain: string;
  installDomains: InstallKnowledgeDomains;
}): DomainStanding {
  if (knowledgeDomainSlugs({ installDomains }).includes(domain)) {
    return { kind: "canonical" };
  }
  const canonical = aliasTarget({ domain, installDomains });
  if (canonical !== undefined) {
    return { canonical, kind: "alias" };
  }
  return { kind: "unknown" };
}
