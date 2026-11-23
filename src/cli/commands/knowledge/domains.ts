/**
 * `slopweaver knowledge domains` — print the closed domain vocabulary, fold the stored register onto it, or
 * `add` one of this install's own domains to its store.
 *
 * The vocabulary and why it is closed live in `../../../knowledge/domains.ts`; what an install's own may hold in
 * `../../../knowledge/installDomains.ts`, and where they are stored in `../../../knowledge/domainPort.ts`; the fold's plan, and why a domain change is an id change, in
 * `../../../knowledge/domainMigration.ts`. This file is the shell: it reads the install's domains and the register,
 * prints the plan, and applies it only on `--apply` with nothing unmapped.
 */
import { type DomainMigrationPlan, planDomainMigration } from "../../../knowledge/domainMigration.js";
import { type InstallKnowledgeDomains, knowledgeDomainEntries } from "../../../knowledge/domainVocabulary.js";
import { homeFlag } from "../../../knowledge/errors.js";
import { applyDomainMigration } from "../../../knowledge/memoryRewriteStore.js";
import { readAllMemories } from "../../../knowledge/memoryStore.js";
import { isLessonDomain } from "../../../knowledge/row.js";
import { logger } from "../../../lib/logger.js";
import { connectStore } from "../../../store/client.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";
import { repeatedFlagValues } from "../../parseFlags.js";

import { VERB_ARG_OFFSET } from "./core.js";
import { installDomainsOrExit, type KnowledgeDomainDeps, productionKnowledgeDomainDeps } from "./installDomainsEdge.js";
import { DOMAINS_USAGE, parseAliasPairs, parseKnowledgeDomainsArgs } from "./registerArgs.js";

/**
 * The vocabulary, one slug a line, with what each named domain holds. An atlas platform prints bare: its
 * atlas is what it holds. One of this install's own is marked `(install)`.
 *
 * @returns the lines to print
 */
export function vocabularyLines({ installDomains }: { installDomains: InstallKnowledgeDomains }): readonly string[] {
  return knowledgeDomainEntries({ installDomains }).map((entry) => {
    if (entry.holds === null) {
      return `${entry.slug}  (atlas platform)`;
    }
    if (entry.source === "install") {
      return `${entry.slug}  ${entry.holds}  (install)`;
    }
    return `${entry.slug}  ${entry.holds}`;
  });
}

/**
 * The `--json` listing: every slug, as before, and which of them are this install's own.
 *
 * @returns the document to print
 */
export function vocabularyDocument({ installDomains }: { installDomains: InstallKnowledgeDomains }): {
  readonly domains: readonly string[];
  readonly install: readonly string[];
} {
  const entries = knowledgeDomainEntries({ installDomains });
  return {
    domains: entries.map((entry) => entry.slug),
    install: entries.filter((entry) => entry.source === "install").map((entry) => entry.slug),
  };
}

/**
 * A plan, as a reader checks it before applying.
 *
 * @param plan the fold
 * @param home the state home whose store an unmapped domain is added to
 * @returns the lines to print
 */
export function migrationLines({ home, plan }: { home: string; plan: DomainMigrationPlan }): readonly string[] {
  if (plan.rewrites.length === 0 && plan.unmapped.length === 0) {
    return ["knowledge domains: every stored recording already names a canonical domain"];
  }
  const lines = [
    `knowledge domains: ${String(plan.rewrites.length)} recording(s) to rewrite, ${String(plan.idMap.length)} claim id(s) to move, ${String(plan.merges)} merge(s) into an existing claim`,
    ...plan.folds.map((fold) => `  ${fold.from} → ${fold.to}  (${String(fold.recordings)})`),
  ];
  if (plan.unmapped.length > 0) {
    lines.push(
      `  UNMAPPED (${String(plan.unmapped.length)}) — add each to this install's store before --apply, saying what it holds:`,
      ...plan.unmapped.map((slug) => {
        // A restored or imported row can carry any string, and one that is no slug can never be added.
        if (!isLessonDomain({ domain: slug })) {
          return `    ${JSON.stringify(slug)} is not a domain slug, so it cannot be added — its recordings need another domain`;
        }
        return `    slopweaver knowledge domains add --slug ${slug} --holds "<what it holds>" ${homeFlag({ home })}`;
      }),
    );
  }
  return lines;
}

/**
 * Plan the fold over the stored register, and apply it when asked.
 *
 * @param home the state home whose store is read, when given
 * @param apply whether to perform the plan
 * @param json whether to print the plan as one JSON document
 * @param installDomains this install's own domains and aliases, read from the same home
 * @returns the exit code
 */
async function migrate({
  apply,
  home,
  installDomains,
  json,
}: {
  apply: boolean;
  home: string | undefined;
  installDomains: InstallKnowledgeDomains;
  json: boolean;
}): Promise<number> {
  const opened = await connectStore(home === undefined ? {} : { home });
  if (opened.isErr()) {
    logger.error({ msg: `knowledge domains: ${opened.error.message}` });
    return EXIT_ERROR;
  }
  const client = opened.value;
  try {
    const rows = await readAllMemories({ client });
    if (rows.isErr()) {
      logger.error({ msg: `knowledge domains: ${rows.error.message}` });
      return EXIT_ERROR;
    }
    const plan = planDomainMigration({ installDomains, rows: rows.value });
    if (json) {
      logger.out({ line: JSON.stringify(plan) });
    } else {
      migrationLines({ home: installDomains.home, plan }).forEach((line) => {
        logger.out({ line });
      });
    }
    if (!apply) {
      if (plan.rewrites.length > 0) {
        logger.error({ msg: "knowledge domains: a dry run — `knowledge export` first, then re-run with --apply" });
      }
      return EXIT_OK;
    }
    if (plan.unmapped.length > 0) {
      logger.error({ msg: "knowledge domains: refused — an unmapped domain would leave the register half-folded" });
      return EXIT_ERROR;
    }
    const applied = await applyDomainMigration({ client, plan });
    if (applied.isErr()) {
      logger.error({ msg: `knowledge domains: ${applied.error.message}` });
      return EXIT_ERROR;
    }
    logger.out({
      line: `knowledge domains: applied — ${String(applied.value.recordings)} recording(s), ${String(applied.value.recalls)} recall(s) rewritten`,
    });
    return EXIT_OK;
  } finally {
    await client.close();
  }
}

/**
 * Run `knowledge domains` over the production store.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runKnowledgeDomains(argv: readonly string[]): Promise<number> {
  return runKnowledgeDomainsWithDeps({ argv, deps: productionKnowledgeDomainDeps() });
}

/**
 * Run `knowledge domains` over the dependencies it is handed.
 *
 * @param argv the full process argv
 * @param deps where the install's own domains are read and added
 * @returns the process exit code
 */
export async function runKnowledgeDomainsWithDeps({
  argv,
  deps,
}: {
  argv: readonly string[];
  deps: KnowledgeDomainDeps;
}): Promise<number> {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: DOMAINS_USAGE });
    return EXIT_OK;
  }
  const parsed = parseKnowledgeDomainsArgs({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((problem) => {
      logger.error({ msg: problem });
    });
    logger.error({ msg: DOMAINS_USAGE });
    return EXIT_USAGE;
  }
  const { positionals, values } = parsed.value;
  const apply = values["apply"] === true;
  const json = values["json"] === true;
  const homeValue = values["home"];
  const home = typeof homeValue === "string" ? homeValue : undefined;
  const mode = domainsMode({ positionals, values });
  if (mode.kind === "usage") {
    return usageRefusal({ why: mode.why });
  }
  if (mode.kind === "add") {
    return addDomain({ deps, home, json, rest, values });
  }
  const installDomains = await installDomainsOrExit({ domains: deps.domains, home, verb: "knowledge domains" });
  if (typeof installDomains === "number") {
    return installDomains;
  }
  if (mode.kind === "migrate") {
    return migrate({ apply, home, installDomains, json });
  }
  if (json) {
    logger.out({ line: JSON.stringify(vocabularyDocument({ installDomains })) });
    return EXIT_OK;
  }
  vocabularyLines({ installDomains }).forEach((line) => {
    logger.out({ line });
  });
  return EXIT_OK;
}

/**
 * Which of its three acts one `knowledge domains` invocation asks for, or why the arguments name none.
 *
 * @param positionals the arguments that are not flags — `add`, or nothing
 * @param values the parsed flags
 * @returns the act, or the usage refusal's reason
 */
function domainsMode({
  positionals,
  values,
}: {
  positionals: readonly string[];
  values: Readonly<Record<string, unknown>>;
}): { readonly kind: "add" | "migrate" | "list" } | { readonly kind: "usage"; readonly why: string } {
  const migrating = values["migrate"] === true;
  const apply = values["apply"] === true;
  const adding = positionals.length === 1 && positionals[0] === "add";
  if (positionals.length > 0 && !adding) {
    return { kind: "usage", why: `unexpected argument: ${positionals.join(" ")} — the one subcommand is add` };
  }
  if (adding) {
    if (migrating || apply) {
      return { kind: "usage", why: "add is its own act; --migrate and --apply are not part of it" };
    }
    return { kind: "add" };
  }
  const addFlags = ["slug", "holds", "alias"].filter((name) => values[name] !== undefined);
  if (addFlags.length > 0) {
    return {
      kind: "usage",
      why: `${addFlags.map((name) => `--${name}`).join(", ")} belong to \`knowledge domains add\``,
    };
  }
  if (!migrating && apply) {
    return { kind: "usage", why: "--apply applies a --migrate plan; pass both" };
  }
  return { kind: migrating ? "migrate" : "list" };
}

/**
 * Print a usage refusal and the usage, and return the usage exit code.
 *
 * @param why what the caller got wrong
 * @returns `EXIT_USAGE`
 */
function usageRefusal({ why }: { why: string }): number {
  logger.error({ msg: `knowledge domains: ${why}` });
  logger.error({ msg: DOMAINS_USAGE });
  return EXIT_USAGE;
}

/**
 * `knowledge domains add` — add one of this install's own domains, and its aliases, to its store.
 *
 * The port reads the vocabulary, checks the addition and inserts every row in ONE transaction that commits only
 * if none of the slugs was taken meanwhile, so two concurrent adds cannot lose each other's domain. A conflict is
 * not retried: the check has to run again, so it is reported and the caller runs the verb again.
 *
 * @param deps where the install's own domains are added
 * @param home the `--home` override, or undefined for the ambient home
 * @param json print what was written as one JSON document
 * @param rest the argv tail, which the repeated `--alias` values are read off
 * @param values the parsed flags
 * @returns the exit code
 */
async function addDomain({
  deps,
  home,
  json,
  rest,
  values,
}: {
  deps: KnowledgeDomainDeps;
  home: string | undefined;
  json: boolean;
  rest: readonly string[];
  values: Readonly<Record<string, unknown>>;
}): Promise<number> {
  const slug = values["slug"];
  const holds = values["holds"];
  if (typeof slug !== "string" || typeof holds !== "string") {
    return usageRefusal({ why: "add needs --slug and --holds" });
  }
  const aliases = parseAliasPairs({ pairs: repeatedFlagValues({ name: "alias", rest }) });
  if (aliases.isErr()) {
    return usageRefusal({ why: aliases.error.join("; ") });
  }
  const resolved = resolveHome({ named: home });
  const written = await deps.domains.add({ aliases: aliases.value, entry: { holds, slug }, home: resolved });
  if (written.isErr()) {
    logger.error({ msg: `knowledge domains: ${written.error.message}` });
    return written.error.code === "KNOWLEDGE_DOMAINS_ADD_REFUSED" ? EXIT_USAGE : EXIT_ERROR;
  }
  const added = Object.keys(aliases.value).toSorted();
  if (json) {
    logger.out({ line: JSON.stringify({ aliases: added, home: resolved, slug }) });
    return EXIT_OK;
  }
  logger.out({
    line: `knowledge domains: added ${slug} to the store of ${resolved}, with ${String(added.length)} alias(es)`,
  });
  return EXIT_OK;
}

export const knowledgeDomainsCommand = defineCommand({ run: runKnowledgeDomains });
