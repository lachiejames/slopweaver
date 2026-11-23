/**
 * The one read of this install's own knowledge domains a `knowledge` verb makes, before any domain-dependent
 * work, against the same home its store connection uses — and the dependency every such verb is handed.
 *
 * The domains live in the store (`../../../knowledge/domainPort.ts`), so the read goes through a REQUIRED port:
 * a verb's exported `…WithDeps` shell takes it, and only the argv entry point builds the production one. A
 * store that cannot answer refuses the verb before it writes anything; there is no file to fall back on.
 */
import type { KnowledgeDomainPort } from "../../../knowledge/domainPort.js";
import { knowledgeDomainPort } from "../../../knowledge/domainStoreRows.js";
import type { InstallKnowledgeDomains } from "../../../knowledge/domainVocabulary.js";
import { logger } from "../../../lib/logger.js";
import { EXIT_ERROR } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";

/** What a `knowledge` verb that judges a domain is handed. */
export interface KnowledgeDomainDeps {
  /** Where this install's own domains are read and added. */
  readonly domains: KnowledgeDomainPort;
}

/**
 * The production dependencies: the store. Argv entry points only.
 *
 * @returns the deps every production verb runs over
 */
export function productionKnowledgeDomainDeps(): KnowledgeDomainDeps {
  return { domains: knowledgeDomainPort() };
}

/**
 * Read the install vocabulary, or print why it could not be read and return the exit code.
 *
 * @param home the `--home` override, or undefined for the ambient home — the same value the verb connects with
 * @param verb the verb's name, prefixed to the refusal
 * @param domains where the install's domains are read
 * @returns the install vocabulary, or `EXIT_ERROR` already printed
 */
export async function installDomainsOrExit({
  domains,
  home,
  verb,
}: {
  domains: KnowledgeDomainPort;
  home: string | undefined;
  verb: string;
}): Promise<InstallKnowledgeDomains | number> {
  const read = await domains.read({ home: resolveHome({ named: home }) });
  if (read.isErr()) {
    logger.error({ msg: `${verb}: ${read.error.message}` });
    return EXIT_ERROR;
  }
  return read.value;
}
