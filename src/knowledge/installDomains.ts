/**
 * This install's own knowledge domains: what one is, every check an addition is held to, and the decoder of the
 * retired `knowledge/domains.json` its one-time import reads. Pure — the store half is `./domainPort.ts`.
 *
 * ## Why these are state, not code
 *
 * `./domains.ts` commits the GENERIC vocabulary: the fleet's own systems and every atlas platform. A domain
 * naming one installation's own repository is a name of that installation, and AGENTS.md § no organisation
 * names keeps every such name out of git. So it lives in the installation's store, beside the rest of its state,
 * and the verbs that judge a domain join the two.
 *
 * ## What the semantic checks protect
 *
 * An install may ADD, never redefine: a domain may not repeat a committed domain or an atlas platform, an alias
 * may not shadow any domain or re-point a committed alias, and every alias must fold into a domain the merged
 * vocabulary holds — an install alias may fold into a committed domain as well as into its own. The same checks
 * judge the old file at its import, the rows a read returns, and every `knowledge domains add`.
 */
import { z } from "zod";

import { atlasPlatforms } from "../atlas/registry.js";
import { err, ok, type Result } from "../lib/result.js";

import { KNOWLEDGE_DOMAIN_ALIASES, KNOWLEDGE_DOMAINS, type KnowledgeDomainEntry } from "./domains.js";
import type { InstallKnowledgeDomains } from "./domainVocabulary.js";
import { isLessonDomain } from "./row.js";

/** One stored install entry: a domain and what it holds, or a retired spelling and the domain it folds into. */
export type InstallDomainRecord =
  | { readonly kind: "domain"; readonly slug: string; readonly holds: string }
  | { readonly kind: "alias"; readonly slug: string; readonly foldsInto: string };

/** An `add` names a slug or an alias the vocabulary already holds, or would redefine a committed one. */
export interface InstallKnowledgeDomainsAddRefusedError {
  readonly code: "KNOWLEDGE_DOMAINS_ADD_REFUSED";
  readonly message: string;
  readonly home: string;
  readonly problems: readonly string[];
}

/** Constructors for {@link InstallKnowledgeDomainsAddRefusedError}. The only place one is built. */
const InstallKnowledgeDomainsErrors = {
  addRefused: ({
    home,
    problems,
  }: {
    home: string;
    problems: readonly string[];
  }): InstallKnowledgeDomainsAddRefusedError => ({
    code: "KNOWLEDGE_DOMAINS_ADD_REFUSED",
    home,
    message: `refused to add to the knowledge domains of ${home} — ${problems.join("; ")}`,
    problems,
  }),
} as const;

/** The retired file's shape. Strict at both levels, so a misspelt key is refused rather than ignored. */
const InstallDomainsFileSchema = z.strictObject({
  aliases: z.record(z.string(), z.string()),
  domains: z.array(
    z.strictObject({
      holds: z.string().trim().min(1, "holds is empty"),
      slug: z.string(),
    }),
  ),
});

/**
 * Every way an install vocabulary would redefine rather than add to the committed one. Empty when it is valid.
 *
 * @param domains the install's own domains
 * @param aliases the install's own retired spellings
 * @returns one sentence per problem, in a stable order
 */
export function installDomainProblems({
  domains,
  aliases,
}: {
  domains: readonly KnowledgeDomainEntry[];
  aliases: Readonly<Record<string, string>>;
}): readonly string[] {
  const problems: string[] = [];
  const committed = new Set([...KNOWLEDGE_DOMAINS.map((entry) => entry.slug), ...atlasPlatforms()]);
  const seen = new Set<string>();
  domains.forEach(({ slug, holds }) => {
    if (holds.trim() === "") {
      problems.push(`domain "${slug}" says nothing about what it holds`);
    }
    if (!isLessonDomain({ domain: slug })) {
      problems.push(`domain "${slug}" is not a domain slug`);
    } else if (committed.has(slug)) {
      problems.push(`domain "${slug}" is already a committed domain`);
    } else if (Object.hasOwn(KNOWLEDGE_DOMAIN_ALIASES, slug)) {
      problems.push(`domain "${slug}" is already a committed alias`);
    } else if (seen.has(slug)) {
      problems.push(`domain "${slug}" appears twice`);
    }
    seen.add(slug);
  });
  const merged = new Set([...committed, ...seen]);
  Object.entries(aliases).forEach(([alias, target]) => {
    if (!isLessonDomain({ domain: alias })) {
      problems.push(`alias "${alias}" is not a domain slug`);
    } else if (merged.has(alias)) {
      problems.push(`alias "${alias}" is itself a domain`);
    } else if (Object.hasOwn(KNOWLEDGE_DOMAIN_ALIASES, alias)) {
      problems.push(`alias "${alias}" is already a committed alias`);
    }
    if (!merged.has(target)) {
      problems.push(`alias "${alias}" folds into "${target}", which is not a domain`);
    }
  });
  return problems;
}

/**
 * The records an install vocabulary is stored as: its domains, then its aliases, each sorted by slug.
 *
 * @param domains the install's own domains
 * @param aliases the install's own retired spellings, keyed by spelling
 * @returns one record per domain and per alias
 */
function installDomainRecords({
  domains,
  aliases,
}: {
  domains: readonly KnowledgeDomainEntry[];
  aliases: Readonly<Record<string, string>>;
}): readonly InstallDomainRecord[] {
  const domainRecords = domains
    .toSorted((left, right) => left.slug.localeCompare(right.slug))
    .map(({ holds, slug }): InstallDomainRecord => ({ holds: holds.trim(), kind: "domain", slug }));
  const aliasRecords = Object.entries(aliases)
    .toSorted(([left], [right]) => left.localeCompare(right))
    .map(([slug, foldsInto]): InstallDomainRecord => ({ foldsInto, kind: "alias", slug }));
  return [...domainRecords, ...aliasRecords];
}

/**
 * An install vocabulary assembled from its stored records and held to every check, so a row written by hand that
 * would redefine a committed domain is refused at the read rather than trusted.
 *
 * @param home the state home whose store the records came from
 * @param records every stored record
 * @returns the vocabulary, or every problem found
 */
export function installDomainsFromRecords({
  home,
  records,
}: {
  home: string;
  records: readonly InstallDomainRecord[];
}): Result<InstallKnowledgeDomains> {
  const domains: KnowledgeDomainEntry[] = [];
  const aliasPairs: [string, string][] = [];
  records.forEach((record) => {
    if (record.kind === "domain") {
      domains.push({ holds: record.holds, slug: record.slug });
      return;
    }
    aliasPairs.push([record.slug, record.foldsInto]);
  });
  // `Object.fromEntries` defines each key as an own property, so a stored slug such as `__proto__` is held to the
  // checks below like any other rather than vanishing into the prototype, as an assignment onto `{}` would make it.
  const aliases: Record<string, string> = Object.fromEntries(aliasPairs);
  const problems = installDomainProblems({ aliases, domains });
  if (problems.length > 0) {
    return err(problems);
  }
  return ok({ aliases, domains, home });
}

/**
 * Decode the retired `knowledge/domains.json` into the records its one-time import writes, holding it to every
 * check a read is.
 *
 * @param value the file's parsed document
 * @returns its records, or every problem found
 */
export function decodeInstallDomainsDocument({ value }: { value: unknown }): Result<readonly InstallDomainRecord[]> {
  const shaped = InstallDomainsFileSchema.safeParse(value);
  if (!shaped.success) {
    return err(
      shaped.error.issues.map((issue) => {
        const where = issue.path.map(String).join(".");
        return where.length === 0 ? issue.message : `${where}: ${issue.message}`;
      }),
    );
  }
  const { aliases, domains } = shaped.data;
  const problems = installDomainProblems({ aliases, domains });
  if (problems.length > 0) {
    return err(problems);
  }
  return ok(installDomainRecords({ aliases, domains }));
}

/**
 * The vocabulary once an add's records have committed, assembled from what was read and what was written —
 * no further statement, so no read after the commit can turn a landed add into a refusal.
 *
 * @param installDomains the vocabulary the add was checked against
 * @param records the records {@link addInstallKnowledgeDomain} answered and the insert committed
 * @returns the vocabulary as it now stands
 */
export function withAddedInstallDomains({
  installDomains,
  records,
}: {
  installDomains: InstallKnowledgeDomains;
  records: readonly InstallDomainRecord[];
}): InstallKnowledgeDomains {
  const domains: KnowledgeDomainEntry[] = [...installDomains.domains];
  const aliasPairs: [string, string][] = Object.entries(installDomains.aliases);
  records.forEach((record) => {
    if (record.kind === "domain") {
      domains.push({ holds: record.holds, slug: record.slug });
      return;
    }
    aliasPairs.push([record.slug, record.foldsInto]);
  });
  return { aliases: Object.fromEntries(aliasPairs), domains, home: installDomains.home };
}

/**
 * The records one `knowledge domains add` writes — a domain and its aliases — refusing a slug or alias the
 * vocabulary already holds, then holding the extended vocabulary to every check a read is.
 *
 * @param installDomains the vocabulary as it stands
 * @param entry the new domain
 * @param aliases the retired spellings to fold into a domain, keyed by spelling
 * @returns the records to insert, or why the vocabulary may not be extended
 */
export function addInstallKnowledgeDomain({
  installDomains,
  entry,
  aliases,
}: {
  installDomains: InstallKnowledgeDomains;
  entry: KnowledgeDomainEntry;
  aliases: Readonly<Record<string, string>>;
}): Result<readonly InstallDomainRecord[], InstallKnowledgeDomainsAddRefusedError> {
  const { home } = installDomains;
  const duplicates: string[] = [];
  if (installDomains.domains.some((existing) => existing.slug === entry.slug)) {
    duplicates.push(`domain "${entry.slug}" is already configured`);
  }
  Object.keys(aliases)
    .filter((alias) => Object.hasOwn(installDomains.aliases, alias))
    .forEach((alias) => {
      duplicates.push(`alias "${alias}" is already configured`);
    });
  if (duplicates.length > 0) {
    return err(InstallKnowledgeDomainsErrors.addRefused({ home, problems: duplicates }));
  }
  const added = { holds: entry.holds.trim(), slug: entry.slug };
  const problems = installDomainProblems({
    aliases: { ...installDomains.aliases, ...aliases },
    domains: [...installDomains.domains, added],
  });
  if (problems.length > 0) {
    return err(InstallKnowledgeDomainsErrors.addRefused({ home, problems }));
  }
  return ok(installDomainRecords({ aliases, domains: [added] }));
}
