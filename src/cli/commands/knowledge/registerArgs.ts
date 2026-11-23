/**
 * Flag specs, usage text and parses for the `knowledge` verbs that move the WHOLE register — `import-lessons`,
 * `export`, `restore` and `domains`. Pure: no I/O, no clock.
 *
 * Apart from `./core.ts` because these four are maintenance rather than the per-claim write and read path,
 * and a session recording one lesson never needs them. Kept apart from the verb modules for the reason
 * `./core.ts` gives: the help-truth ratchet reads a flag list without importing a command.
 */
import { err, ok, type Result } from "../../../lib/result.js";
import { type FlagSpec, parseFlags } from "../../parseFlags.js";

import { flagNames } from "./flagSpecs.js";

const IMPORT_FLAGS: FlagSpec = {
  boolean: ["json", "dry-run", "apply", "rekey"],
  string: ["file", "home"],
};

const RESTORE_FLAGS: FlagSpec = {
  boolean: ["json", "merge", "redact"],
  string: ["file"],
};

const EXPORT_FLAGS: FlagSpec = {
  boolean: ["json"],
  string: ["out"],
};

const DOMAINS_FLAGS: FlagSpec = {
  boolean: ["migrate", "apply", "json"],
  repeatable: ["alias"],
  string: ["home", "slug", "holds", "alias"],
};

/** `--`-prefixed import flags, for the help-truth ratchet. */
export const KNOWLEDGE_IMPORT_FLAG_NAMES: readonly string[] = flagNames({ spec: IMPORT_FLAGS });

/** `--`-prefixed export flags, for the help-truth ratchet. */
export const KNOWLEDGE_EXPORT_FLAG_NAMES: readonly string[] = flagNames({ spec: EXPORT_FLAGS });

/** `--`-prefixed restore flags, for the help-truth ratchet. */
export const KNOWLEDGE_RESTORE_FLAG_NAMES: readonly string[] = flagNames({ spec: RESTORE_FLAGS });

/** `--`-prefixed domains flags, for the help-truth ratchet. */
export const KNOWLEDGE_DOMAINS_FLAG_NAMES: readonly string[] = flagNames({ spec: DOMAINS_FLAGS });

/**
 * Parse `knowledge import-lessons`'s flags.
 *
 * @param rest the argv after the verb
 * @returns the parsed flags, or the parser's refusals
 */
export function parseKnowledgeImportArgs({ rest }: { rest: readonly string[] }): ReturnType<typeof parseFlags> {
  return parseFlags({ args: rest, spec: IMPORT_FLAGS });
}

/**
 * Parse `knowledge restore`'s flags.
 *
 * @param rest the argv after the verb
 * @returns the parsed flags, or the parser's refusals
 */
export function parseKnowledgeRestoreArgs({ rest }: { rest: readonly string[] }): ReturnType<typeof parseFlags> {
  return parseFlags({ args: rest, spec: RESTORE_FLAGS });
}

/**
 * Parse `knowledge export`'s flags.
 *
 * @param rest the argv after the verb
 * @returns the parsed flags, or the parser's refusals
 */
export function parseKnowledgeExportArgs({ rest }: { rest: readonly string[] }): ReturnType<typeof parseFlags> {
  return parseFlags({ args: rest, spec: EXPORT_FLAGS });
}

/**
 * Parse `knowledge domains`'s flags.
 *
 * @param rest the argv after the verb
 * @returns the parsed flags, or the parser's refusals
 */
export function parseKnowledgeDomainsArgs({ rest }: { rest: readonly string[] }): ReturnType<typeof parseFlags> {
  return parseFlags({ allowPositionals: true, args: rest, spec: DOMAINS_FLAGS });
}

/**
 * The `--alias <from>=<to>` values of `knowledge domains add`, as one map, or every value that is not a pair.
 *
 * @param pairs each `--alias` value, in the order given
 * @returns the retired spelling of each pair keyed to the domain it folds into, or one refusal per bad value
 */
export function parseAliasPairs({ pairs }: { pairs: readonly string[] }): Result<Readonly<Record<string, string>>> {
  const aliases: Record<string, string> = {};
  const problems: string[] = [];
  pairs.forEach((pair) => {
    const split = pair.indexOf("=");
    const from = pair.slice(0, Math.max(split, 0)).trim();
    const to = pair.slice(split + 1).trim();
    if (split < 0 || from.length === 0 || to.length === 0) {
      problems.push(`--alias ${pair} is not <from>=<to>`);
      return;
    }
    if (Object.hasOwn(aliases, from)) {
      problems.push(`--alias ${from} was given twice`);
      return;
    }
    aliases[from] = to;
  });
  return problems.length > 0 ? err(problems) : ok(aliases);
}

/** What `knowledge import-lessons --help` prints. */
export const IMPORT_USAGE =
  "usage: slopweaver knowledge import-lessons --file <absolute path> (--dry-run | --apply | --rekey) \\\n" +
  "         [--home <dir>] [--json]\n" +
  "\n" +
  "Brings the append-only lessons.jsonl register into the memories table. Not a runtime compatibility\n" +
  "reader: nothing else ever reads that file again.\n" +
  "\n" +
  "  Every row imports with learner, behaviour-change and retrieval-cue NULL, because the old register\n" +
  "  carried none of the three and inventing them would fabricate facts in a store of observations.\n" +
  "  The import key is the LINE's own SHA-256 plus its physical line number, so a file that has GROWN\n" +
  "  since the last apply imports only what was appended, and re-applying an unchanged one is a no-op.\n" +
  "  A present key AFTER an absent one is a hole an append-only file never produces, and it is refused.\n" +
  "\n" +
  "  --rekey    rewrite stored keys onto the per-line scheme, for a table imported under the older\n" +
  "             whole-FILE-digest key that one append invalidated for every row. Each row is verified\n" +
  "             against the line its key names and one mismatch abandons the whole rewrite";

/** What `knowledge export --help` prints. */
export const EXPORT_USAGE =
  "usage: slopweaver knowledge export --out <path> [--json]\n" +
  "\n" +
  "Write every recording back out as one .jsonl, streamed a row at a time. This is the recovery leg: a\n" +
  "paid-for observation cannot be fetched again from a provider the way content can, so the table owes a\n" +
  "readable copy that does not depend on the database being up.";

/** What `knowledge domains --help` prints. */
export const DOMAINS_USAGE =
  "usage: slopweaver knowledge domains [--migrate [--apply]] [--home <dir>] [--json]\n" +
  "       slopweaver knowledge domains add --slug <slug> --holds <what it holds> [--alias <from>=<to> ...]\n" +
  "         [--home <dir>] [--json]\n" +
  "\n" +
  "Print the closed domain vocabulary a row may name: the generic domains in src/knowledge/domains.ts, every\n" +
  "atlas platform, and this install's own from its store, marked (install). A writer naming a retired alias\n" +
  "is refused with the domain it folded into. A store that cannot say which domains it holds refuses every\n" +
  "domain-checked verb rather than reading as empty.\n" +
  "\n" +
  "  add        add ONE of this install's own domains to its store, with any retired spellings that\n" +
  "             fold into it or into another domain. Refuses a slug or alias already held, an alias that\n" +
  "             is itself a domain or re-points a committed one, and an alias folding into no domain\n" +
  "  --slug     the new domain's slug, as a writer will pass it to --domain\n" +
  "  --holds    what a lesson filed there is about\n" +
  "  --alias    <from>=<to>: a retired spelling and the domain it folds into; repeat for more\n" +
  "\n" +
  "  --migrate  plan folding every STORED row still under a retired alias onto its canonical domain. A\n" +
  "             domain is part of a claim's id, so the fold rewrites the id too, every `supersedes` naming\n" +
  "             it and every recall of it — one claim filed under two spellings becomes one series\n" +
  "  --apply    perform the plan, in one transaction. Refused while any stored domain is unmapped.\n" +
  "             Run `slopweaver knowledge export` first: it is the undo";

/** What `knowledge restore --help` prints. */
export const RESTORE_USAGE =
  "usage: slopweaver knowledge restore --file <path> [--merge] [--redact] [--json]\n" +
  "\n" +
  "Put a `knowledge export` file, and the recall ledger beside it, back into the memories tables — the\n" +
  "other half of the recovery leg. Both files are decoded completely first, then both tables are written in\n" +
  "ONE transaction: a bad ledger line or a refused row writes nothing at all. Every identity is preserved\n" +
  "verbatim, recording ids and claim ids included.\n" +
  "\n" +
  "  By default both tables must be EMPTY: recovery into a fresh database, every seq kept as exported.\n" +
  "  --merge    add the export to a live database. A row the database already holds identically is\n" +
  "             skipped; one that differs, or an import key another recording holds, refuses the whole\n" +
  "             merge. Inserted rows are renumbered above the live seq, in the export's own order, and\n" +
  "             every supersedes and recall must link to a row that exists, of the right claim\n" +
  "  --redact   run `knowledge redact`'s rewrite over the file's rows before they land: the install's\n" +
  "             replacement map, then the committed hashed rules mask what is left. A claim whose text\n" +
  "             changed takes the id its new text derives, in its recalls too. The file is never touched";
